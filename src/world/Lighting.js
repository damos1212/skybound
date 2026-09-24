import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { SceneLighting } from '../engine/render/wgsl/lighting.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { islandModule } from './Island.js';

// Scene lighting hooks for the island world:
//
// Ground bounce (the main indirect light on a sunny beach): sunlight reflected off the sand, the grass
// or the sea under a surface lights it from below (the balloon's basket, the rocket's belly, the
// pier's underside, the palm fronds). Analytic: the albedo of the ground right below P (from the
// island's height), x the sun on it, x the lower-hemisphere view factor of the normal, fading with the
// height above the ground. Installed as the `bounce` hook; `strength` goes to 0 away from the world.
//
// Contact shadows: adapted from Tidewater's ContactShadows (MIT, see src/engine/LICENSE-tidewater).
// The fine sun shadows the cascaded maps miss (the basket on the deck, the gantry's feet, rocks on the
// sand): a short screen-space march toward the sun through the previous frame's opaque depth,
// reprojected with last frame's view-projection. Installed as the `contactShadow` hook.

// Ambient occlusion: a small hemisphere of samples around each point, tested against the previous
// frame's opaque depth (reprojected, as the contact shadows): creases, the ground under the pad and
// the props, trunks in the grass lose some of the sky light. Installed as the `ambientModulation` hook.
const aoParams = new UniformBlock( 'AOParams', { strength: [ 'f32', 1 ] }, { label: 'ambientOcclusion' } );
export const AmbientOcclusion = { strength: aoParams.fields.strength };

export function installAmbientOcclusion( depthTexture ) {

	SceneLighting.set( 'ambientModulation', new ShaderModule( {
		name: 'hook-ambientOcclusion',
		deps: [ commonModule ],
		uniforms: aoParams,
		uniformName: 'aoParams',
		bindings: { aoDepth: { texture: () => depthTexture } },
		code: /* wgsl */`
fn hookAmbientModulation( P: vec3f, N: vec3f ) -> vec3f {
#if IS_WATER || PASS_LATE || PASS_DEPTH || PASS_COLOR || NO_SSAO
	return vec3f( 1.0 );
#else
	let fwd = -vec3f( frame.view[ 0 ][ 2 ], frame.view[ 1 ][ 2 ], frame.view[ 2 ][ 2 ] );
	let w0 = dot( P - frame.cameraPos, fwd );
	if ( aoParams.strength <= 0.0 || w0 > 90.0 || w0 < 0.3 ) { return vec3f( 1.0 ); }
	let texSize = vec2f( textureDimensions( aoDepth ) );
	let R = 0.9 + w0 * 0.012;
	let T0 = normalize( select( vec3f( 1.0, 0.0, 0.0 ), vec3f( 0.0, 0.0, 1.0 ), abs( N.x ) > 0.8 ) - N * select( N.x, N.z, abs( N.x ) > 0.8 ) );
	let B0 = cross( N, T0 );
	let cc = frame.viewProj * vec4f( P, 1.0 );
	let pix = floor( ( cc.xy / cc.w * vec2f( 0.5, -0.5 ) + 0.5 ) * frame.resolution );
	let rot = ( interleavedGradientNoise( pix ) + f32( frame.frameIndex % 8u ) * 0.125 ) * 6.2832;
	let cr = cos( rot ); let sr = sin( rot );
	let T = T0 * cr + B0 * sr;
	let B = B0 * cr - T0 * sr;
	var occ = 0.0;
	for ( var i = 0; i < 8; i++ ) {
		let fi = f32( i );
		let ka = fi * 2.39996;
		let kr = sqrt( ( fi + 0.5 ) / 8.0 );
		let k = vec4f( cos( ka ) * kr, sin( ka ) * kr, sqrt( 1.0 - kr * kr ) * 0.8 + 0.2, 0.25 + 0.75 * pow2( ( fi + 1.0 ) / 8.0 ) );
		let S = P + ( T * k.x + B * k.y + N * k.z ) * R * k.w + N * 0.04;
		let q = frame.prevViewProjNoJitter * vec4f( S, 1.0 );
		let iw = 1.0 / max( q.w, 1e-4 );
		let uv = q.xy * iw * vec2f( 0.5, -0.5 ) + 0.5;
		if ( any( uv < vec2f( 0.0 ) ) || any( uv > vec2f( 1.0 ) ) ) { continue; }
		let d = textureLoad( aoDepth, vec2i( min( uv * texSize, texSize - 1.0 ) ), 0 );
		let k2 = frame.near * iw * iw;
		let diff = d - q.z * iw;
		// the depth buffer is in front of the sample (within range): occluded
		occ += select( 0.0, 1.0, diff > 0.02 * k2 && diff < R * 1.6 * k2 );
	}
	let ao = 1.0 - occ / 8.0 * 0.85 * aoParams.strength * smoothstep( 90.0, 60.0, w0 );
	return vec3f( ao * ao );
#endif
}
`,
	} ) );

}

// Cloud shadows: the volumetric clouds' shadow map darkens the sun on everything below the cloud base
// (the island, the props, the vehicles on the pad). Installed as the `directModulation` hook.
export function installCloudShadows( clouds ) {

	if ( ! clouds || ! clouds.shadowModule ) return;
	SceneLighting.set( 'directModulation', new ShaderModule( {
		name: 'hook-cloudShadow',
		deps: [ commonModule, clouds.shadowModule ],
		code: /* wgsl */`
fn hookDirectModulation( P: vec3f, N: vec3f ) -> vec3f {
#if IS_WATER
	return vec3f( 1.0 );
#else
	let hy = P.y - frame.seaLevel;
	if ( hy > 1500.0 ) { return vec3f( 1.0 ); }
	return vec3f( cloudsShadow( P.xz + vec2f( frame.originX, 0.0 ) ) );
#endif
}
`,
	} ) );

}

const bounceParams = new UniformBlock( 'GroundBounceParams', { strength: [ 'f32', 1 ] }, { label: 'groundBounce' } );
export const GroundBounce = { strength: bounceParams.fields.strength };

export function installGroundBounce() {

	SceneLighting.set( 'bounce', new ShaderModule( {
		name: 'hook-bounce',
		deps: [ commonModule, islandModule ],
		uniforms: bounceParams,
		uniformName: 'groundBounce',
		code: /* wgsl */`
fn hookBounce( P: vec3f, N: vec3f ) -> vec3f {
#if IS_WATER || NO_GROUND_BOUNCE
	return vec3f( 0.0 );
#else
	let down = sat( 0.5 - N.y * 0.5 );
	if ( groundBounce.strength <= 0.0 || down <= 0.0 ) { return vec3f( 0.0 ); }
	let pr = P.xz + vec2f( frame.originX, 0.0 );
	let hy = P.y - frame.seaLevel;
	let hg = islandHeight( pr );
	let above = hy - max( hg, 0.0 );
	let fade = exp( - max( above, 0.0 ) / 22.0 );
	if ( fade < 0.01 ) { return vec3f( 0.0 ); }
	// sand, grass or the sea (the seabed through the water) right below
	let sand = vec3f( 0.8, 0.6, 0.31 );
	let grass = vec3f( 0.1, 0.28, 0.05 );
	let sea = vec3f( 0.03, 0.09, 0.1 );
	let alb = select( select( grass, sand, hg < 3.0 ), sea, hg < -0.3 );
	let E = frame.sunColor * sat( frame.sunDir.y );
	return E * alb * down * fade * INV_PI * groundBounce.strength;
#endif
}
`,
	} ) );

}

const GROUP = 4;
const GROUPS = 2;
const STEPS = GROUP * GROUPS;
const MAX_DIST = 36;
const NEAR_DIST = 12;

const contactParams = new UniformBlock( 'ContactShadowParams', { strength: [ 'f32', 1 ] }, { label: 'contactShadows' } );
export const ContactShadows = { strength: contactParams.fields.strength, depthTexture: null };

export function installContactShadows( depthTexture ) {

	ContactShadows.depthTexture = depthTexture;
	const loop = [];
	for ( let g = 0; g < GROUPS; g ++ ) {

		let body = '';
		for ( let k = 0; k < GROUP; k ++ ) body += /* wgsl */`
			{
				let s = ( jit + ${ g * GROUP + k }.0 ) / ${ STEPS }.0;
				let u = s * s * 0.85 + s * 0.15;
				let q = q0 + qd * u;
				let iw = 1.0 / q.w;
				let uv = q.xy * iw * vec2f( 0.5, -0.5 ) + 0.5;
				let d = textureLoad( contactDepth, vec2i( min( clamp( uv, vec2f( 0.0 ), vec2f( 1.0 ) ) * texSize, texSize - 1.0 ) ), 0 );
				let k2 = frame.near * iw * iw;
				let diff = d - q.z * iw;
				let thick = bias + 0.06 + u * len * 0.3;
				let occ = diff > bias * k2 && diff < thick * k2 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
				hit = min( hit, select( 2.0, u, occ ) );
			}`;
		const go = g === 0 ? 'hit > 1.0' : `hit > 1.0 && w0 < ${ NEAR_DIST }.0`;
		loop.push( `\t\tif ( ${ go } ) {${ body }\n\t\t}` );

	}

	SceneLighting.set( 'contactShadow', new ShaderModule( {
		name: 'hook-contactShadow',
		deps: [ commonModule ],
		uniforms: contactParams,
		uniformName: 'contactShadowParams',
		bindings: { contactDepth: { texture: () => ContactShadows.depthTexture } },
		code: /* wgsl */`
fn hookContactShadow( P: vec3f, N: vec3f ) -> f32 {
#if IS_WATER || NO_CONTACT_SHADOWS || PASS_LATE || PASS_DEPTH || PASS_COLOR
	return 1.0;
#else
	let L = frame.sunDir;
	let fwd = -vec3f( frame.view[ 0 ][ 2 ], frame.view[ 1 ][ 2 ], frame.view[ 2 ][ 2 ] );
	let w0 = dot( P - frame.cameraPos, fwd );
	let slope = max( abs( dpdx( w0 ) ), abs( dpdy( w0 ) ) );
	var vis = 1.0;
	let lit = dot( frame.sunColor, frame.sunColor ) > 1e-8 && dot( N, L ) > 0.02;
	if ( contactShadowParams.strength > 0.0 && w0 < ${ MAX_DIST }.0 && lit ) {
		let texSize = vec2f( textureDimensions( contactDepth ) );
		let len = smoothstep( 2.0, 30.0, w0 ) * 0.9 + 0.35;
		let q0 = frame.prevViewProjNoJitter * vec4f( P, 1.0 );
		let qd = frame.prevViewProjNoJitter * vec4f( L * len, 0.0 );
		let bias = slope * 2.0 + w0 * 0.002 + 0.01;
		let cc = frame.viewProj * vec4f( P, 1.0 );
		let pix = floor( ( cc.xy / cc.w * vec2f( 0.5, -0.5 ) + 0.5 ) * frame.resolution );
		let jit = fract( interleavedGradientNoise( pix ) + f32( frame.frameIndex ) * 0.618034 );
		var hit = 2.0;
${ loop.join( '\n' ) }
		vis = select( 1.0, smoothstep( 0.55, 1.0, hit ), hit <= 1.0 );
		vis = 1.0 - ( 1.0 - vis ) * contactShadowParams.strength * smoothstep( ${ MAX_DIST }.0, ${ MAX_DIST - 8 }.0, w0 );
	}
	return vis;
#endif
}
`,
	} ) );

}
