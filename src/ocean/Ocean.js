import { Mesh } from '../engine/scene/Mesh.js';
import { BufferGeometry, Float32BufferAttribute } from '../engine/geometry/index.js';
import { Material } from '../engine/render/Material.js';
import { UniformBlock } from '../engine/gpu/Shader.js';
import { Vector2 } from '../engine/math/index.js';
import { islandModule } from '../world/Island.js';

// The sea: a polar grid centred under the camera (fine rings near it, geometric growth out to the
// horizon, several hundred km so it still reaches the horizon from the stratosphere), displaced by
// Tidewater's FFT cascades near the camera and bent down with the planet's curvature so its horizon
// meets the atmosphere's. Shaded here (no scene lighting): Fresnel sky reflection, sun glitter with a
// roughness that grows with distance (the unresolved waves), subsurface blue, turquoise shallows and
// a surf line around the island.

const EARTH_R = 6360000;
const SEGMENTS = 192;
const RING_Q = 1 + 2 * Math.PI / SEGMENTS;

function polarGrid() {

	const r0 = 1.5, rMax = 900000;
	const rings = Math.ceil( Math.log( rMax / r0 ) / Math.log( RING_Q ) );
	const pos = [ 0, 0, 0 ];
	for ( let i = 0; i <= rings; i ++ ) {

		const r = r0 * Math.pow( RING_Q, i );
		for ( let s = 0; s < SEGMENTS; s ++ ) {

			// alternate half-segment offset per ring: more even triangles
			const a = ( s + ( i % 2 ) * 0.5 ) / SEGMENTS * Math.PI * 2;
			pos.push( Math.cos( a ) * r, 0, Math.sin( a ) * r );

		}

	}

	const idx = [];
	for ( let s = 0; s < SEGMENTS; s ++ ) idx.push( 0, 1 + ( s + 1 ) % SEGMENTS, 1 + s );
	for ( let i = 0; i < rings; i ++ ) {

		const a0 = 1 + i * SEGMENTS, b0 = 1 + ( i + 1 ) * SEGMENTS;
		for ( let s = 0; s < SEGMENTS; s ++ ) {

			const s1 = ( s + 1 ) % SEGMENTS;
			if ( i % 2 === 0 ) idx.push( a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s );
			else idx.push( a0 + s, a0 + s1, b0 + s1, a0 + s, b0 + s1, b0 + s );

		}

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setIndex( idx );
	g.computeBoundingSphere();
	return g;

}

export class Ocean {

	constructor( { fft, sky } ) {

		this.fft = fft;
		this.params = new UniformBlock( 'OceanSurface', {
			center: [ 'vec2f', new Vector2() ],
			// floating origin (x): real x = drawn x + origin
			origin: [ 'f32', 0 ],
			// displacement fades out between these distances (m)
			fadeNear: [ 'f32', 600 ],
			fadeFar: [ 'f32', 2600 ],
		}, { label: 'oceanSurface' } );

		this.material = new Material( {
			name: 'ocean',
			lit: false,
			modules: [ fft.module, sky.module, islandModule ],
			bindings: { os: { uniform: this.params } },
			varyings: { vDisp: 'vec4f' },
			defines: { IS_WATER: 1 },
			vertex: /* wgsl */`
	let local = v.position.xz;
	let xzDrawn = os.center + local;
	let xz = xzDrawn + vec2f( os.origin, 0.0 );
	let r = length( local );
	// displacement near the camera: every cascade, the fine ones faded out earlier
	let camDist = length( vec3f( xzDrawn.x - frame.cameraPos.x, frame.cameraPos.y - frame.seaLevel, xzDrawn.y - frame.cameraPos.z ) );
	let fade = 1.0 - smoothstep( os.fadeNear, os.fadeFar, camDist );
	var d = vec3f( 0.0 );
	var foam = 0.0;
	if ( fade > 0.0 ) {
		let lod = log2( max( camDist / 60.0, 1.0 ) );
		for ( var c = 0; c < OCEAN_CASCADES; c++ ) {
			let s = textureSampleLevel( oceanDisplacement, smpLinearRepeat, xz / ocean.sizes[ c ].x, c, lod );
			let w = select( 1.0, 1.0 - smoothstep( 80.0, 400.0, camDist ), c >= 2 );
			d += s.xyz * w;
			foam += s.w * w;
		}
		d *= fade;
	}
	// calmer in the shallows (the waves feel the bottom) and flat on the beach
	let depth = - islandHeight( xz );
	let shallow = smoothstep( 0.0, 6.0, depth );
	d *= mix( 0.25, 1.0, shallow );
	// planet curvature: the sea drops away from under the camera
	let drop = r * r / ${ ( 2 * EARTH_R ).toFixed( 1 ) };
	v.useWorld = true;
	v.worldPos = vec3f( xzDrawn.x + d.x, frame.seaLevel + d.y - drop, xzDrawn.y + d.z );
	v.worldNormal = vec3f( 0.0, 1.0, 0.0 );
	o.vDisp = vec4f( xz, foam * fade, depth );
`,
			surface: /* wgsl */`
	let xz = in.vs.vDisp.xy;
	let dist = length( in.P - frame.cameraPos );
	// slopes from the derivative cascades (with the texture's own mip filtering)
	var sx = 0.0; var sz = 0.0; var jx = 0.0; var jz = 0.0;
	for ( var c = 0; c < OCEAN_CASCADES; c++ ) {
		let t = textureSample( oceanDerivatives, smpAnisoRepeat, xz / ocean.sizes[ c ].x, c );
		sx += t.x; sz += t.y; jx += t.z; jz += t.w;
	}
	let depth = in.vs.vDisp.w;
	let calm = mix( 0.3, 1.0, smoothstep( 0.0, 6.0, depth ) );
	let far = smoothstep( 1500.0, 9000.0, dist );
	var N = normalize( vec3f( - sx / ( 1.0 + jx ) * calm * ( 1.0 - far ), 1.0, - sz / ( 1.0 + jz ) * calm * ( 1.0 - far ) ) );
	let V = in.V;
	if ( dot( N, V ) < 0.02 ) { N = normalize( N + V * ( 0.02 - dot( N, V ) ) ); }
	let NoV = sat( dot( N, V ) );
	// Fresnel (Schlick, water F0 0.02)
	let F = 0.02 + 0.98 * pow5( 1.0 - NoV );
	var R = reflect( -V, N );
	R.y = max( R.y, 0.01 );
	R = normalize( R );
	let refl = skyReflectionRadiance( R );
	// sun glitter: GGX, the roughness grows with distance (waves smaller than a pixel)
	let L = frame.sunDir;
	let H = normalize( L + V );
	let rough = mix( 0.07, 0.28, smoothstep( 50.0, 20000.0, dist ) );
	let a2 = pow2( rough * rough );
	let NoH = sat( dot( N, H ) );
	let NoL = sat( dot( N, L ) );
	let D = a2 / ( PI * pow2( NoH * NoH * ( a2 - 1.0 ) + 1.0 ) );
	let Vis = 0.5 / max( NoL * sqrt( NoV * NoV * ( 1.0 - a2 ) + a2 ) + NoV * sqrt( NoL * NoL * ( 1.0 - a2 ) + a2 ), 1e-4 );
	let Fs = 0.02 + 0.98 * pow5( 1.0 - sat( dot( V, H ) ) );
	let spec = frame.sunColor * min( D * Vis * Fs * NoL, 60.0 );
	// the body of the water: deep blue scattering, turquoise over sand
	let deep = vec3f( 0.0035, 0.022, 0.045 );
	let shallowCol = vec3f( 0.03, 0.2, 0.2 );
	let sh = exp( - max( depth, 0.0 ) * 0.28 );
	let body = mix( deep, shallowCol, sh ) ;
	let light = frame.sunColor * ( 0.35 * sat( L.y ) ) + frame.skyIrradiance * PI * 0.6;
	// wave crests glow a little where the sun shines through them
	let sss = frame.sunColor * pow( sat( dot( V, -L ) * 0.5 + 0.5 ), 4.0 ) * sat( in.P.y - frame.seaLevel + 0.4 ) * vec3f( 0.02, 0.09, 0.08 );
	var col = mix( body * light + sss, refl, F ) + spec;
	// whitecaps (FFT foam) and the surf line where the sea meets the island
	let foamFFT = smoothstep( 0.45, 1.1, in.vs.vDisp.z ) * ( 1.0 - far );
	let surfBand = smoothstep( 1.6, 0.1, depth ) * smoothstep( -0.5, 0.1, depth );
	let wash = sin( depth * 6.0 - frame.time * 1.4 + sin( xz.x * 0.08 ) * 2.0 + sin( xz.x * 0.31 + frame.time * 0.3 ) );
	let lace = sat( sin( xz.x * 0.9 + sin( xz.y * 0.7 ) * 3.0 ) * 0.5 + sin( xz.y * 1.3 - xz.x * 0.4 ) * 0.5 + 0.2 );
	let surf = surfBand * smoothstep( 0.1, 0.9, wash ) * mix( 0.45, 1.0, lace ) * 0.8;
	let foam = sat( foamFFT + surf );
	let foamCol = frame.sunColor * sat( L.y ) * 0.25 + frame.skyIrradiance * PI * 0.9;
	col = mix( col, foamCol * 0.9, foam );
	// seen from high up the sea becomes the planet: blend into the sky's ground shading (the same
	// function renders the Earth past the edge of this mesh and from orbit)
	let camAlt = frame.cameraPos.y - frame.seaLevel;
	let planetK = smoothstep( 6000.0, 30000.0, camAlt );
	if ( planetK > 0.0 && skyGroundHit( -V ) > 0.0 ) { col = mix( col, skyGroundRadiance( -V ), planetK ); }
	s.albedo = vec3f( 0.0 );
	s.emissive = col;
`,
		} );

		this.mesh = new Mesh( polarGrid(), this.material );
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.staticVelocity = true;

	}

	update( camera, originX = 0 ) {

		// snap the grid centre (in real coordinates) so vertices don't swim as the camera drifts
		const snap = Math.max( 1, Math.pow( 2, Math.floor( Math.log2( Math.max( camera.position.y, 8 ) / 8 ) ) ) );
		const rx = camera.position.x + originX;
		this.params.fields.center.value.set( Math.round( rx / snap ) * snap - originX, Math.round( camera.position.z / snap ) * snap );
		this.params.fields.origin.value = originX;

	}

}
