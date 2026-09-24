import { GPU } from '../engine/gpu/GPU.js';
import { UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { RenderTarget, StorageBuffer } from '../engine/gpu/Texture.js';
import { FullscreenPass } from '../engine/render/FullscreenPass.js';
import { FrameUniforms, setFrameCamera } from '../engine/render/Frame.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { MathUtils, Matrix4, Vector2, Vector3 } from '../engine/math/index.js';
import { TemporalUpscale } from './TemporalUpscale.js';
import { MotionBlur } from './MotionBlur.js';
import { LensFlare } from './LensFlare.js';

// Post chain, a lean take on Tidewater's PostFX (no AO, no underwater):
//   opaque scene -> composite: height fog / aerial perspective, then the volumetric clouds
//   composited by depth (in front of the ocean when flying above them) -> transparents -> TAAU (anti-aliasing +
//   upscale) -> bloom -> grade + vignette + motion blur + lens flare -> ACES -> canvas.
// Auto exposure meters the 1/16 bloom level; the result drives the next frame.
//
// Per frame: beginFrame() (sizes, jitter, frame camera), scene, render(), endFrame().

const CLR = [ 0, 0, 0, 0 ];

const ACES = /* wgsl */`
fn RRTAndODTFit( v: vec3f ) -> vec3f {
	let a = v * ( v + 0.0245786 ) - 0.000090537;
	let b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
fn acesFilmicToneMapping( colorIn: vec3f, exposure: f32 ) -> vec3f {
	let ACESInputMat = transpose( mat3x3f(
		0.59719, 0.35458, 0.04823,
		0.07600, 0.90834, 0.01566,
		0.02840, 0.13383, 0.83777 ) );
	let ACESOutputMat = transpose( mat3x3f(
		1.60475, -0.53108, -0.07367,
		-0.10208, 1.10813, -0.00605,
		-0.00327, -0.07276, 1.07602 ) );
	var color = colorIn * exposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return clamp( color, vec3f( 0.0 ), vec3f( 1.0 ) );
}
`;

export class Post {

	constructor( renderer, { sceneRenderer, camera, atmosphere, clouds = null } ) {

		this.renderer = renderer;
		this.camera = camera;
		this.sceneRenderer = sceneRenderer;
		this.atmosphere = atmosphere;
		this.clouds = clouds;
		this.scale = 1;
		this.outputFormat = GPU.format;

		this.uniforms = new UniformBlock( 'PostParams', {
			bloom: [ 'f32', 0.06 ],
			vignette: [ 'f32', 0.3 ],
			saturation: [ 'f32', 1.08 ],
			contrast: [ 'f32', 1.05 ],
			warmth: [ 'f32', 0.02 ],
			grain: [ 'f32', 0.01 ],
			sharpen: [ 'f32', 0.35 ],
			// height fog: extinction at sea level (1/m), scale height (m)
			fogDensity: [ 'f32', 0.000045 ],
			fogHeight: [ 'f32', 1400 ],
			// white-out inside a cloud (0..1), set by the game from the cloud density around the camera
			cloudFog: [ 'f32', 0 ],
			// hit flash / damage tint (0..1)
			damage: [ 'f32', 0 ],
			// speed lines strength (0..1)
			speed: [ 'f32', 0 ],
			// chromatic aberration (0..1)
			chroma: [ 'f32', 0 ],
			// light shafts: strength, and the sun on screen ( uv, visibility, _ )
			rays: [ 'f32', 0.7 ],
			// water on the lens (0..1): after surfacing or flying out of a cloud
			droplets: [ 'f32', 0 ],
			sunScreen: [ 'vec4f', [ 0.5, 0.5, 0, 0 ] ],
		}, { label: 'post' } );
		this.params = this.uniforms.fields;

		this.aeUniforms = new UniformBlock( 'AutoExposureParams', {
			enabled: [ 'f32', 1 ],
			refLum: [ 'f32', 0.3 ],
			min: [ 'f32', 0.35 ],
			max: [ 'f32', 4.0 ],
			up: [ 'f32', 1.4 ],
			down: [ 'f32', 1.2 ],
		}, { label: 'autoExposure' } );
		this.autoExposure = this.aeUniforms.fields;
		this.exposure = new StorageBuffer( { label: 'autoExposure', count: 1, type: 'f32', data: new Float32Array( [ 1 ] ) } );

		const sceneRT = sceneRenderer.sceneRT;
		this.sceneColor = sceneRT.texture;
		this.finalDepth = sceneRT.depthTexture;
		this.taau = new TemporalUpscale( () => this.sceneColor, this.finalDepth, sceneRenderer.velocityTexture, camera, sceneRenderer.waterMaskTexture );
		this.motionBlur = new MotionBlur( { velocityTexture: sceneRenderer.velocityTexture, depthTexture: sceneRT.depthTexture, color: () => this.taau.texture } );
		this.motionBlur.uniforms.fields.shutter.value = 0.35;
		this.flare = new LensFlare( { depthTexture: sceneRT.depthTexture, clouds, sunDir: atmosphere.sunDir } );

		this._outW = 0; this._outH = 0; this._inW = 0; this._inH = 0;
		this._prevVP = new Matrix4();
		this._prevCamPos = new Vector3();
		this._hasPrev = false;
		this._built = false;

	}

	_build() {

		this._built = true;
		const A = this.atmosphere;
		const clouds = this.clouds;
		const modules = [ A.module ];
		if ( clouds ) modules.push( clouds.compositeModule );

		// runs between the opaque and the transparent passes (SceneRenderer.onBeforeWater): reads the
		// opaque copy and writes the scene colour, so glass, flames and bubbles go over the clouds
		this._beautyPass = new FullscreenPass( {
			label: 'beauty (fog + clouds)',
			colorFormats: [ 'rgba16float' ],
			modules,
			bindings: {
				post: { uniform: this.uniforms },
				postScene: { texture: () => this.sceneRenderer.opaqueCopy.texture },
				postDepth: { texture: () => this.sceneRenderer.opaqueCopy.depthTexture },
			},
			code: /* wgsl */`
// optical depth of exponential height fog between the camera and P
fn fogOpticalDepth( P: vec3f, d: f32 ) -> f32 {
	let H = post.fogHeight;
	let h0 = max( frame.cameraPos.y - frame.seaLevel, 0.0 );
	let h1 = max( P.y - frame.seaLevel, 0.0 );
	let dh = h1 - h0;
	let e0 = exp( - h0 / H );
	var k = e0;
	if ( abs( dh ) > 1.0 ) { k = H * ( e0 - exp( - h1 / H ) ) / dh; }
	return post.fogDensity * d * k;
}
fn fogColor( dir: vec3f ) -> vec3f {
	// the sky just above the horizon in this azimuth (the haze glows toward the sun)
	let h = normalize( vec3f( dir.x, abs( dir.y ) * 0.15 + 0.02, dir.z ) + vec3f( 1e-5, 0.0, 0.0 ) );
	return atmosphereSkyLuminance( h );
}
fn fragment( in: FSIn ) -> vec4f {
	let s = vec2i( textureDimensions( postDepth ) );
	let px = clamp( vec2i( in.pos.xy ), vec2i( 0 ), s - 1 );
	let d = textureLoad( postDepth, px, 0 );
	var c = textureLoad( postScene, px, 0 ).rgb;
	let dir = viewRay( in.uv );
	var dist = 1e9;
	if ( d > 0.0 ) {
		let P = worldFromDepth( in.uv, d );
		dist = length( P - frame.cameraPos );
		let T = exp( - fogOpticalDepth( P, dist ) );
		c = c * T + fogColor( dir ) * ( 1.0 - T );
	}
${ clouds ? /* wgsl */`
	// volumetric clouds in front of the geometry (the sky background already has them)
	if ( d > 0.0 ) {
		let cl = cloudsComposite( dir, in.uv, dist );
		c = c * cl.a + cl.rgb;
	}` : '' }
	// under the sea: the water swallows red first, then everything, with a shimmer of caustics
	if ( frame.cameraPos.y < frame.seaLevel - 0.05 ) {
		let dd = min( dist, 300.0 );
		let T = exp( - vec3f( 0.42, 0.075, 0.035 ) * dd * 0.6 );
		let waterCol = frame.skyIrradiance * vec3f( 0.03, 0.14, 0.16 ) + frame.sunColor * vec3f( 0.002, 0.014, 0.016 );
		let shimmer = 1.0 + 0.25 * sin( dir.x * 40.0 + frame.time * 2.0 ) * sin( dir.z * 37.0 - frame.time * 1.7 ) * max( dir.y, 0.0 );
		c = ( c * T + waterCol * ( 1.0 - T ) ) * shimmer;
	}
	// inside a cloud: soft white-out toward the ambient cloud colour
	let inCloud = post.cloudFog;
	if ( inCloud > 0.001 ) {
		let amb = frame.skyIrradiance * 3.2 + frame.sunColor * 0.12;
		let k = inCloud * ( 1.0 - exp( - min( dist, 400.0 ) * 0.012 ) );
		c = mix( c, amb, k );
	}
	return vec4f( c, 1.0 );
}
`,
		} );

		this._buildBloom();
		this._buildRays();
		this._buildMeter();
		this._buildFinal();

	}

	_buildBloom() {

		const mk = ( name ) => new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], label: name } );
		this.bloomScales = [ 0.5, 0.25, 0.125, 0.0625, 0.03125 ];
		this.bloomDown = this.bloomScales.map( ( s, i ) => mk( 'bloomDown' + ( i + 1 ) ) );
		this.bloomUp = this.bloomScales.slice( 0, 4 ).map( ( s, i ) => mk( 'bloomUp' + ( i + 1 ) ) );

		const TAPS = /* wgsl */`
fn bTap( uv: vec2f, texel: vec2f, x: f32, y: f32 ) -> vec3f { return textureSampleLevel( bSrc, smpLinearClamp, uv + texel * vec2f( x, y ), 0.0 ).rgb; }
fn karis( c: vec3f ) -> vec3f { return c / ( luminance( c ) + 1.0 ); }
`;
		const down = ( src, first ) => new FullscreenPass( {
			label: 'bloom down', colorFormats: [ 'rgba16float' ], bindings: { bSrc: { texture: src } },
			code: TAPS + /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	let texel = 1.0 / vec2f( textureDimensions( bSrc ) );
	let a = bTap( uv, texel, -2.0, -2.0 ); let b = bTap( uv, texel, 0.0, -2.0 ); let c = bTap( uv, texel, 2.0, -2.0 );
	let d = bTap( uv, texel, -2.0, 0.0 ); let e = bTap( uv, texel, 0.0, 0.0 ); let f = bTap( uv, texel, 2.0, 0.0 );
	let g = bTap( uv, texel, -2.0, 2.0 ); let h = bTap( uv, texel, 0.0, 2.0 ); let i = bTap( uv, texel, 2.0, 2.0 );
	let j = bTap( uv, texel, -1.0, -1.0 ); let k = bTap( uv, texel, 1.0, -1.0 ); let l = bTap( uv, texel, -1.0, 1.0 ); let m = bTap( uv, texel, 1.0, 1.0 );
${ first ? /* wgsl */`
	let g0 = karis( ( j + k + l + m ) * 0.25 ) * 0.5;
	let g1 = karis( ( a + b + d + e ) * 0.25 ) * 0.125;
	let g2 = karis( ( b + c + e + f ) * 0.25 ) * 0.125;
	let g3 = karis( ( d + e + g + h ) * 0.25 ) * 0.125;
	let g4 = karis( ( e + f + h + i ) * 0.25 ) * 0.125;
	let s = g0 + g1 + g2 + g3 + g4;
	return vec4f( s / max( 1.0 - luminance( s ), 0.02 ), 1.0 );` : /* wgsl */`
	let s = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;
	return vec4f( s, 1.0 );` }
}
`,
		} );

		const up = ( small, base ) => new FullscreenPass( {
			label: 'bloom up', colorFormats: [ 'rgba16float' ], bindings: { bSrc: { texture: small }, bBase: { texture: base } },
			code: TAPS + /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	let texel = 1.0 / vec2f( textureDimensions( bSrc ) );
	let s = ( bTap( uv, texel, 0.0, 0.0 ) * 4.0
		+ ( bTap( uv, texel, -1.0, 0.0 ) + bTap( uv, texel, 1.0, 0.0 ) + bTap( uv, texel, 0.0, -1.0 ) + bTap( uv, texel, 0.0, 1.0 ) ) * 2.0
		+ ( bTap( uv, texel, -1.0, -1.0 ) + bTap( uv, texel, 1.0, -1.0 ) + bTap( uv, texel, -1.0, 1.0 ) + bTap( uv, texel, 1.0, 1.0 ) ) ) / 16.0;
	return vec4f( textureSampleLevel( bBase, smpLinearClamp, uv, 0.0 ).rgb + s, 1.0 );
}
`,
		} );

		const D = this.bloomDown, U = this.bloomUp;
		this._bloomPasses = [
			[ down( () => this.taau.texture, true ), D[ 0 ] ],
			[ down( () => D[ 0 ].texture, false ), D[ 1 ] ],
			[ down( () => D[ 1 ].texture, false ), D[ 2 ] ],
			[ down( () => D[ 2 ].texture, false ), D[ 3 ] ],
			[ down( () => D[ 3 ].texture, false ), D[ 4 ] ],
			[ up( () => D[ 4 ].texture, () => D[ 3 ].texture ), U[ 3 ] ],
			[ up( () => U[ 3 ].texture, () => D[ 2 ].texture ), U[ 2 ] ],
			[ up( () => U[ 2 ].texture, () => D[ 1 ].texture ), U[ 1 ] ],
			[ up( () => U[ 1 ].texture, () => D[ 0 ].texture ), U[ 0 ] ],
		];
		this.bloomTex = U[ 0 ];
		this.meterRT = D[ 3 ];

	}

	// light shafts: a radial blur toward the sun of the bright sky around it (quarter resolution), so
	// the sun streams through gaps in the clouds and around anything in front of it
	_buildRays() {

		this.raysRT = new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], label: 'rays' } );
		this._raysPass = new FullscreenPass( {
			label: 'light shafts', colorFormats: [ 'rgba16float' ],
			bindings: {
				post: { uniform: this.uniforms },
				rColor: { texture: () => this.taau.texture },
				rDepth: { texture: () => this.finalDepth },
				rExposure: { storage: this.exposure, access: 'read' },
			},
			code: /* wgsl */`
fn rSample( uv: vec2f ) -> vec3f {
	let ds = vec2f( textureDimensions( rDepth ) );
	let d = textureLoad( rDepth, vec2i( clamp( uv, vec2f( 0.0 ), vec2f( 0.999 ) ) * ds ), 0 );
	if ( d > 0.0 ) { return vec3f( 0.0 ); }
	let c = textureSampleLevel( rColor, smpLinearClamp, uv, 0.0 ).rgb;
	// only what is bright after exposure: the sun, its aureole, sunlit cloud edges
	let l = luminance( c ) * rExposure[ 0 ];
	return c * smoothstep( 1.1, 4.0, l );
}
fn fragment( in: FSIn ) -> vec4f {
	let ss = post.sunScreen;
	if ( ss.z <= 0.001 ) { return vec4f( 0.0 ); }
	let uv = in.uv;
	let delta = ( ss.xy - uv );
	let n = 36;
	let stepV = delta / f32( n ) * 0.9;
	let jit = fract( 52.9829189 * fract( dot( in.pos.xy, vec2f( 0.06711056, 0.00583715 ) ) ) + f32( frame.frameIndex % 16u ) * 0.0625 );
	var p = uv + stepV * jit;
	var acc = vec3f( 0.0 );
	var w = 1.0;
	for ( var i = 0; i < n; i++ ) {
		// weighted toward the sun: the bright core feeds the shafts
		let toSun = length( ( ss.xy - p ) * vec2f( 1.0, 0.6 ) );
		acc += rSample( p ) * w * exp( - toSun * 3.0 );
		w *= 0.965;
		p += stepV;
	}
	return vec4f( acc / f32( n ), 1.0 );
}
`,
		} );

	}

	_buildMeter() {

		const W = 256;
		let reduce = '';
		for ( let s = W / 2; s > 0; s >>= 1 ) reduce += /* wgsl */`
	if ( t < ${ s }u ) {
		sumL[ t ] += sumL[ t + ${ s }u ];
		sumW[ t ] += sumW[ t + ${ s }u ];
	}
	workgroupBarrier();`;

		this.meterKernel = new ComputeKernel( {
			label: 'Auto Exposure',
			modules: [ commonModule ],
			bindings: {
				ae: { uniform: this.aeUniforms },
				aeTex: { texture: () => this.meterRT.texture },
				aeExposure: { storage: this.exposure, access: 'read_write' },
			},
			workgroupSize: [ W, 1, 1 ],
			code: /* wgsl */`
var<workgroup> sumL: array<f32, ${ W }>;
var<workgroup> sumW: array<f32, ${ W }>;
@compute @workgroup_size( WG_X, 1, 1 )
fn main( @builtin( local_invocation_id ) lid: vec3u ) {
	let t = lid.x;
	let size = textureDimensions( aeTex );
	let n = size.x * size.y;
	var accL = 0.0; var accW = 0.0;
	for ( var i = 0u; i < 160u; i++ ) {
		let idx = t + i * ${ W }u;
		if ( idx < n ) {
			let x = idx % size.x; let y = idx / size.x;
			let c = textureLoad( aeTex, vec2i( i32( x ), i32( y ) ), 0 ).rgb;
			// (black space counts as dim, not as a void: the Earth from orbit mustn't blow out)
			let l = log2( max( luminance( c ), ae.refLum * 0.04 ) );
			let uvc = vec2f( ( f32( x ) + 0.5 ) / f32( size.x ), ( f32( y ) + 0.5 ) / f32( size.y ) ) - 0.5;
			let w = max( 1.0 - length( uvc * vec2f( 1.0, 1.4 ) ) * 1.2, 0.15 );
			accL += l * w;
			accW += w;
		}
	}
	sumL[ t ] = accL;
	sumW[ t ] = accW;
	workgroupBarrier();
${ reduce }
	if ( t == 0u ) {
		let avg = exp2( sumL[ 0 ] / max( sumW[ 0 ], 1e-4 ) );
		let ratio = ae.refLum / avg;
		let partial = select( ratio, pow( ratio, 0.75 ), ratio > 1.0 );
		let tgt = clamp( partial, ae.min, ae.max );
		let cur = aeExposure[ 0 ];
		let rate = select( ae.down, ae.up, tgt > cur );
		let k = 1.0 - exp( - frame.dt * rate );
		let next = exp2( mix( log2( max( cur, 1e-3 ) ), log2( tgt ), k ) );
		aeExposure[ 0 ] = select( 1.0, next, ae.enabled > 0.5 );
	}
}
`,
		} );

	}

	_buildFinal() {

		const modules = [ commonModule, this.motionBlur.module, this.flare.module ];
		this._finalPass = new FullscreenPass( {
			label: 'final (grade + tonemap)',
			colorFormats: [ this.outputFormat ],
			modules,
			bindings: {
				post: { uniform: this.uniforms },
				postResolved: { texture: () => this.taau.texture },
				postBloom: { texture: () => this.bloomTex.texture },
				postRays: { texture: () => this.raysRT.texture },
				postExposure: { storage: this.exposure, access: 'read' },
			},
			code: ACES + /* wgsl */`
fn tm( c: vec3f ) -> vec3f { return c / ( max( c.r, max( c.g, c.b ) ) + 1.0 ); }
fn loadResolved( p: vec2i ) -> vec3f { return textureLoad( postResolved, p, 0 ).rgb; }

// RCAS (FSR1 robust contrast-adaptive sharpening) on the resolved image
fn rcas( uvIn: vec2f ) -> vec3f {
	let size = vec2i( textureDimensions( postResolved ) );
	let pc = clamp( vec2i( uvIn * vec2f( size ) ), vec2i( 1 ), size - 2 );
	let e = tm( loadResolved( pc ) );
	let b = tm( loadResolved( pc + vec2i( 0, -1 ) ) ); let d = tm( loadResolved( pc + vec2i( -1, 0 ) ) );
	let f = tm( loadResolved( pc + vec2i( 1, 0 ) ) ); let h = tm( loadResolved( pc + vec2i( 0, 1 ) ) );
	let mn4 = min( min( b, d ), min( f, h ) );
	let mx4 = max( max( b, d ), max( f, h ) );
	let hitMin = min( mn4, e ) / ( mx4 * 4.0 + 1e-5 );
	let hitMax = ( vec3f( 1.0 ) - max( mx4, e ) ) / ( mn4 * 4.0 - 4.0 );
	let lobeRGB = max( - hitMin, hitMax );
	let dS = textureLoad( mbDepth, clamp( vec2i( uvIn * vec2f( textureDimensions( mbDepth ) ) ), vec2i( 0 ), vec2i( textureDimensions( mbDepth ) ) - 1 ), 0 );
	let skyK = select( 1.0, 0.3, dS < 1e-7 );
	let lobe = max( ${ - ( 0.25 - 1.0 / 16.0 ) }, min( max( lobeRGB.r, max( lobeRGB.g, lobeRGB.b ) ), 0.0 ) ) * post.sharpen * skyK;
	let r = max( ( ( b + d + f + h ) * lobe + e ) / ( lobe * 4.0 + 1.0 ), vec3f( 0.0 ) );
	return r / max( 1.0 - max( r.r, max( r.g, r.b ) ), 1e-3 );
}

fn postHash( p: vec2u, f: u32 ) -> f32 {
	var x = p.x * 1664525u + p.y * 1013904223u + f * 2654435761u;
	x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
	return f32( x >> 8u ) / 16777216.0;
}

fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	var base = rcas( uv );
	// water drops on the lens: each cell may hold a drop that slides down, bending the view inside it
	if ( post.droplets > 0.01 ) {
		let gd = vec2f( 18.0, 11.0 );
		let cellUv = uv * gd;
		let cid = floor( cellUv );
		let hh = fract( sin( dot( cid, vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
		if ( hh < post.droplets * 0.75 ) {
			let slide = fract( hh * 7.0 ) * 0.3 * ( 1.0 - post.droplets );
			let ctr = vec2f( 0.3 + fract( hh * 13.0 ) * 0.4, 0.3 + fract( hh * 29.0 ) * 0.4 + slide );
			let rel = ( fract( cellUv ) - ctr ) * vec2f( 1.0, 1.3 );
			let rad = 0.12 + fract( hh * 53.0 ) * 0.14;
			let q = length( rel ) / rad;
			if ( q < 1.0 ) {
				let lensUv = uv - rel * 0.06 * ( 1.0 - q );
				base = textureSampleLevel( postResolved, smpLinearClamp, lensUv, 0.0 ).rgb * 0.9;
				base += vec3f( 0.6 ) * smoothstep( 0.75, 0.95, q ) * smoothstep( 1.0, 0.95, q ) * ( 0.5 + 0.5 * select( 0.0, 1.0, rel.y < 0.0 ) );
			}
		}
	}
	// chromatic aberration: red and blue pulled apart toward the edges (hits, jumps, huge speed)
	if ( post.chroma > 0.0005 ) {
		let off = ( uv - 0.5 ) * post.chroma * 0.02;
		base.r = textureSampleLevel( postResolved, smpLinearClamp, uv + off, 0.0 ).r;
		base.b = textureSampleLevel( postResolved, smpLinearClamp, uv - off, 0.0 ).b;
	}
	var c = mbApply( base, uv ) + textureSampleLevel( postBloom, smpLinearClamp, uv, 0.0 ).rgb * post.bloom + flareLight( uv );
	// light shafts
	c += textureSampleLevel( postRays, smpLinearClamp, uv, 0.0 ).rgb * post.rays * post.sunScreen.z * 0.9;
	c *= postExposure[ 0 ];
	c = c * vec3f( 1.0 + post.warmth, 1.0, 1.0 - post.warmth );
	let l = luminance( c );
	c = mix( vec3f( l ), c, post.saturation );
	c = pow( max( c, vec3f( 0.0 ) ) / 0.18, vec3f( post.contrast ) ) * 0.18;
	let dv = ( uv - 0.5 ) * vec2f( 1.0, 0.8 );
	let rv = length( dv );
	c *= 1.0 - smoothstep( 0.25, 0.75, rv ) * post.vignette;
	// damage: red pulse at the edges
	c = mix( c, c * vec3f( 1.6, 0.35, 0.3 ) + vec3f( 0.05, 0.0, 0.0 ), post.damage * smoothstep( 0.2, 0.7, rv ) );
	// speed lines racing out of the centre
	if ( post.speed > 0.01 ) {
		let ang = atan2( dv.y, dv.x ) / 6.2832 + 0.5;
		let cell = floor( ang * 150.0 );
		let hh = fract( sin( cell * 12.9898 ) * 43758.5453 );
		let across = abs( fract( ang * 150.0 ) - 0.5 );
		let m = fract( rv * 2.2 - frame.time * ( 1.6 + hh * 2.2 ) + hh * 7.0 );
		let streak = smoothstep( 0.0, 0.08, m ) * smoothstep( 0.45, 0.08, m ) * smoothstep( 0.3, 0.05, across ) * step( 0.82, hh );
		c += vec3f( 0.9, 0.95, 1.0 ) * streak * smoothstep( 0.28, 0.62, rv ) * post.speed * 0.35;
	}
	let px = vec2u( in.pos.xy );
	let fi = frame.frameIndex;
	let n = ( postHash( px, fi ) + postHash( px + vec2u( 7919u, 104729u ), fi ) - 1.0 ) * 0.5;
	c = c + c * ( n * post.grain );
	let t = acesFilmicToneMapping( c, frame.exposure );
	let dq = ( postHash( px + vec2u( 31337u, 271u ), fi ) + postHash( px + vec2u( 1013u, 65537u ), fi ) - 1.0 ) / 255.0;
	return vec4f( linearToSrgb( t ) + vec3f( dq ), 1.0 );
}
`,
		} );

	}

	_outputSize() {

		const r = this.renderer;
		return { width: r.width, height: r.height };

	}

	_resize() {

		const { width: ow, height: oh } = this._outputSize();
		const iw = Math.max( 1, Math.round( ow * this.scale ) ), ih = Math.max( 1, Math.round( oh * this.scale ) );
		if ( ow === this._outW && oh === this._outH && iw === this._inW && ih === this._inH ) return;
		this._outW = ow; this._outH = oh; this._inW = iw; this._inH = ih;
		this.sceneRenderer.setSize( iw, ih );
		this.taau.setSize( ow, oh );
		if ( this.bloomDown ) {

			this.bloomScales.forEach( ( s, i ) => this.bloomDown[ i ].setSize( Math.max( 1, Math.round( ow * s ) ), Math.max( 1, Math.round( oh * s ) ) ) );
			this.bloomScales.slice( 0, 4 ).forEach( ( s, i ) => this.bloomUp[ i ].setSize( Math.max( 1, Math.round( ow * s ) ), Math.max( 1, Math.round( oh * s ) ) ) );

		}

		this.flare.setDepthHeight( ih );
		if ( this.raysRT ) this.raysRT.setSize( Math.max( 1, Math.round( ow / 4 ) ), Math.max( 1, Math.round( oh / 4 ) ) );

	}

	setScale( s ) {

		if ( s === this.scale ) return;
		this.scale = s;
		this.sceneRenderer.scale = s;
		this.taau.frameWeight.value = MathUtils.lerp( 0.035, 0.07, MathUtils.clamp( ( s - 0.6 ) / 0.4, 0, 1 ) );

	}

	internalSize( target = new Vector2() ) {

		return target.set( this._inW, this._inH );

	}

	beginFrame() {

		if ( ! this._built ) {

			this._build();
			this._outW = 0;

		}

		this._resize();
		const cam = this.camera;
		cam.updateMatrixWorld();
		if ( cam.matrixWorldInverse ) cam.matrixWorldInverse.copy( cam.matrixWorld ).invert();
		this.motionBlur.updateCamera( cam );
		this.taau.advance();
		const [ jx, jy ] = this.taau.jitter();
		setFrameCamera( cam, this._inW, this._inH, {
			jitterX: - jx, jitterY: jy,
			prevViewProj: this._hasPrev ? this._prevVP : null,
			prevCameraPos: this._hasPrev ? this._prevCamPos : null,
		} );
		const F = FrameUniforms.fields;
		F.outputResolution.value.set( this._outW, this._outH );
		this._prevVP.copy( F.viewProjNoJitter.value );
		this._prevCamPos.copy( F.cameraPos.value );
		this._hasPrev = true;

	}

	// drop the temporal history (camera cuts)
	cut() {

		this._hasPrev = false;
		if ( this.taau.resetHistory ) this.taau.resetHistory();

	}

	render() {

		this.motionBlur.compute( this._outW, this._outH );
		this.taau.render();
		for ( const [ pass, rt ] of this._bloomPasses ) pass.render( { colorViews: [ rt.texture ], clear: CLR } );
		if ( this.params.sunScreen.value[ 2 ] > 0.001 && this.params.rays.value > 0 ) this._raysPass.render( { colorViews: [ this.raysRT.texture ], clear: CLR } );
		const out = GPU.context.getCurrentTexture().createView();
		this._finalPass.render( { colorViews: [ out ], clear: CLR } );
		this.meterKernel.dispatch( [ 1, 1, 1 ] );

	}

	// fog + clouds over the opaque scene (SceneRenderer.onBeforeWater)
	composite() {

		if ( ! this._built ) this._build();
		this._beautyPass.render( { colorViews: [ this.sceneColor ] } );

	}

	endFrame() {

		this.taau.clearViewOffset();
		this.taau.endFrame();

	}

}
