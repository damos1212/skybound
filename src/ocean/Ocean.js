import { Mesh } from '../engine/scene/Mesh.js';
import { BufferGeometry, Float32BufferAttribute } from '../engine/geometry/index.js';
import { Material } from '../engine/render/Material.js';
import { UniformBlock, ShaderModule } from '../engine/gpu/Shader.js';
import { Vector2, Vector4 } from '../engine/math/index.js';
import { islandModule } from '../world/Island.js';
import { localLightsCoreModule } from '../world/LocalLights.js';

// The sea: a polar grid centred under the camera (fine rings near it, geometric growth out to the
// horizon, several hundred km so it still reaches the horizon from the stratosphere), displaced by
// Tidewater's FFT cascades near the camera, by breaking waves that roll in over the island's shelf,
// and bent down with the planet's curvature so its horizon meets the atmosphere's.
//
// Shaded here (after Tidewater's water model, MIT: see src/engine/LICENSE-tidewater), without scene
// lighting:
//   - reflection: the sky (clouds included), the island's hills (a short heightfield march of the
//     reflected ray), the sun's glitter (GGX with the roughness of the unresolved waves)
//   - refraction: the view ray bends into the water and is traced to the seabed (the island's
//     analytic height), which is shaded with the ground's look and animated caustics; along the way
//     the water absorbs and scatters (single scattering of the sun and the sky, analytic): clear
//     turquoise over the sand, deep blue offshore
//   - crests glow where the sun shines through them; whitecaps from the FFT, a breaking surf zone and
//     a bubbly swash line where the sea meets the beach
//   - from high up it blends into the sky's shading of the planet below

const EARTH_R = 6360000;
const SEGMENTS = 192;
const RING_Q = 1 + 2 * Math.PI / SEGMENTS;
const IOR = 1.333;

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

// breaking waves over the shelf: crests follow the depth contours and roll in toward the beach,
// steepening as the water shoals; sections of the crest stand taller and break first (the break
// peels along the wave), leaving tumbling whitewater; after each wave a sheet of water runs up the
// sand and drains back. vec4( height, whitewater, shoaling, run-up height ) at real xz, depth d (m).
// (sin-based wobble: Game.js computes the same crests in JS for the spray)
const SHORE_WGSL = /* wgsl */`
fn oceanShoreWobble( xz: vec2f ) -> f32 {
	return sin( xz.x * 0.011 + xz.y * 0.007 ) * 2.6 + sin( xz.x * 0.031 - xz.y * 0.023 ) * 1.1;
}
fn oceanShoreWave( xz: vec2f, d: f32, t: f32 ) -> vec4f {
	let wob = oceanShoreWobble( xz );
	let phase = d * 0.85 + t * 0.9 + wob;
	let w = fract( phase / 6.2832 );
	let zone = smoothstep( 10.0, 3.5, d ) * smoothstep( -0.3, 0.9, d );
	var h = 0.0;
	var white = 0.0;
	var amp = 0.0;
	if ( zone > 0.0 ) {
		let crest = pow( smoothstep( 0.0, 0.75, w ) * smoothstep( 1.0, 0.8, w ), 2.2 );
		let shoulder = 0.65 + 0.35 * sin( dot( xz, vec2f( 0.021, -0.017 ) ) + phase * 0.35 );
		amp = zone * mix( 0.35, 1.0, smoothstep( 8.0, 2.5, d ) ) * shoulder;
		let breaking = smoothstep( 2.4 * shoulder + 0.6, 1.0, d );
		h = crest * amp * mix( 1.0, 0.45, breaking );
		let tumble = smoothstep( 0.45, 0.74, w ) * smoothstep( 0.82, 0.75, w );
		white = ( crest * 0.8 + tumble * 0.9 ) * breaking * zone;
	}
	let runW = fract( ( t * 0.9 + wob ) / 6.2832 + 0.12 );
	let runup = 0.42 * smoothstep( 0.0, 0.12, runW ) * smoothstep( 0.75, 0.12, runW );
	return vec4f( h, white, amp, runup );
}
`;

const shoreModule = new ShaderModule( { name: 'oceanShore', deps: [ islandModule ], code: SHORE_WGSL } );

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
			// boats for their wakes: real x, z, heading (rad), speed (m/s; 0: none)
			boats: [ 'vec4f[4]', [ 0, 1, 2, 3 ].map( () => new Vector4() ) ],
		}, { label: 'oceanSurface' } );

		this.material = new Material( {
			name: 'ocean',
			lit: false,
			modules: [ fft.module, sky.module, islandModule, shoreModule, localLightsCoreModule, sky.clouds && sky.clouds.shadowModule ].filter( Boolean ),
			bindings: { os: { uniform: this.params } },
			varyings: { vDisp: 'vec4f', vShore: 'vec2f' },
			side: 'double',
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
	let depth = - islandHeight( xz );
	var shore = vec4f( 0.0 );
	if ( fade > 0.0 ) {
		let lod = log2( max( camDist / 60.0, 1.0 ) );
		for ( var c = 0; c < OCEAN_CASCADES; c++ ) {
			let s = textureSampleLevel( oceanDisplacement, smpLinearRepeat, xz / ocean.sizes[ c ].x, c, lod );
			let w = select( 1.0, 1.0 - smoothstep( 80.0, 400.0, camDist ), c >= 2 );
			d += s.xyz * w;
			foam += s.w * w;
		}
		// calmer in the shallows (the waves feel the bottom) and flat on the beach
		d *= mix( 0.3, 1.0, smoothstep( 0.0, 7.0, depth ) );
		// breaking waves rolling in over the shelf, pushed toward the beach at the crest
		if ( depth < 11.0 && depth > -2.0 ) {
			shore = oceanShoreWave( xz, depth, frame.time );
			let e = 1.5;
			let up = vec2f( islandHeight( xz + vec2f( e, 0.0 ) ) - islandHeight( xz - vec2f( e, 0.0 ) ), islandHeight( xz + vec2f( 0.0, e ) ) - islandHeight( xz - vec2f( 0.0, e ) ) );
			let upN = up / max( length( up ), 1e-4 );
			d += vec3f( upN.x * shore.x * 0.7, shore.x, upN.y * shore.x * 0.7 );
			// the swash: the water's edge surges up the sand and drains back
			d.y += shore.w * smoothstep( 1.4, 0.2, depth );
		}
		d *= fade;
	}
	// planet curvature: the sea drops away from under the camera
	let drop = r * r / ${ ( 2 * EARTH_R ).toFixed( 1 ) };
	v.useWorld = true;
	v.worldPos = vec3f( xzDrawn.x + d.x, frame.seaLevel + d.y - drop, xzDrawn.y + d.z );
	v.worldNormal = vec3f( 0.0, 1.0, 0.0 );
	o.vDisp = vec4f( xz, foam * fade, d.y );
	o.vShore = vec2f( shore.y * fade, shore.w );
`,
			surface: /* wgsl */`
	let xz = in.vs.vDisp.xy;
	let P = in.P;
	let dist = length( P - frame.cameraPos );
	let V = in.V;
	let L = frame.sunDir;
	let t = frame.time;
	// per pixel: the depth under this point of the surface (m)
	let depth = - islandHeight( xz );
	// slopes from the derivative cascades (with the texture's own mip filtering)
	var sx = 0.0; var sz = 0.0; var jx = 0.0; var jz = 0.0;
	for ( var c = 0; c < OCEAN_CASCADES; c++ ) {
		let tx = textureSample( oceanDerivatives, smpAnisoRepeat, xz / ocean.sizes[ c ].x, c );
		sx += tx.x; sz += tx.y; jx += tx.z; jz += tx.w;
	}
	let calm = mix( 0.3, 1.0, smoothstep( 0.0, 7.0, depth ) );
	let far = smoothstep( 6000.0, 30000.0, dist );
	var N = normalize( vec3f( - sx / ( 1.0 + jx ) * calm * ( 1.0 - far ), 1.0, - sz / ( 1.0 + jz ) * calm * ( 1.0 - far ) ) );
	// the breaking waves' faces (screen-space slope of their height; derivatives in uniform control flow)
	let sw = oceanShoreWave( xz, depth, t ).x;
	// the sheet of water over the sand: how thick it is here (0 at the running edge)
	let thickness = ( P.y - frame.seaLevel ) - islandHeight( xz );
	let dx = dpdx( sw ); let dy = dpdy( sw );
	let px = dpdx( xz ); let py = dpdy( xz );
	let det = px.x * py.y - px.y * py.x;
	if ( abs( det ) > 1e-8 && depth < 11.0 ) {
		let g = vec2f( dx * py.y - dy * px.y, dy * px.x - dx * py.x ) / det;
		N = normalize( N - vec3f( g.x, 0.0, g.y ) * ( 1.0 - smoothstep( 300.0, 900.0, dist ) ) );
	}
	if ( dot( N, V ) < 0.02 ) { N = normalize( N + V * ( 0.02 - dot( N, V ) ) ); }
	let NoV = sat( dot( N, V ) );
	let F = 0.02 + 0.98 * pow5( 1.0 - NoV );
	let sunVis = sunShadowPCF( P, vec3f( 0.0, 1.0, 0.0 ), in.pixel );
	var sunLight = frame.sunColor * sunVis;
${ sky.clouds ? '	sunLight *= cloudsShadow( xz );' : '' }

	// roughness of the waves smaller than a pixel (Cox-Munk mean square slope, as in Tidewater): the
	// average reflection tilts up toward the higher, darker sky far away, the glitter spreads
	let footprint = max( length( fwidth( xz ) ), 1e-4 );
	let unresolved = sat( log2( 110.0 * footprint / PI ) / 9.0 );
	let mss = ( 0.003 + frame.windSpeed * 0.00512 ) * calm;
	let sigmaUnres = sqrt( mss * unresolved );

	// ---- reflection: sky, the island's hills, the sun
	let Rraw = reflect( -V, N );
	let Rup = max( Rraw.y, 0.004 ) + sigmaUnres * 1.3 * ( 1.0 - max( Rraw.y, 0.0 ) );
	let R = normalize( vec3f( Rraw.x, Rup, Rraw.z ) );
	var refl = mix( frame.horizonColor * 0.35, skyReflectionRadiance( R ), smoothstep( -0.12, 0.08, Rraw.y ) );
	let posR = vec3f( xz.x, P.y - frame.seaLevel, xz.y );
	let islandD = length( ( xz - vec2f( -40.0, -190.0 ) ) / vec2f( 380.0, 240.0 ) );
	if ( islandD < 2.2 && R.y < 0.35 && dist < 3000.0 ) {
		var tr = 1.5;
		var hit = -1.0;
		for ( var i = 0; i < 28; i++ ) {
			let q = posR + R * tr;
			if ( q.y > 110.0 ) { break; }
			if ( q.y < islandHeight( q.xz ) ) { hit = tr; break; }
			tr = tr * 1.22 + 1.2;
		}
		if ( hit > 0.0 ) {
			var a = hit / 1.22 - 1.0; var b = hit;
			for ( var k = 0; k < 4; k++ ) {
				let m = ( a + b ) * 0.5;
				let q = posR + R * m;
				if ( q.y < islandHeight( q.xz ) ) { b = m; } else { a = m; }
			}
			let q = posR + R * b;
			let hq = islandHeight( q.xz );
			let nq = islandNormal( q.xz );
			let gq = islandGround( q.xz, hq, nq, dist + b );
			let lit = gq.albedo * ( frame.sunColor * sat( dot( nq, L ) ) + frame.skyIrradiance * PI * 0.8 ) * INV_PI;
			refl = mix( refl, lit, smoothstep( 2200.0, 1500.0, dist + b ) );
		}
	}
	let H = normalize( L + V );
	let rough = 0.06 * mix( 1.4, 1.0, smoothstep( 0.0, 3.0, depth ) );
	let a2 = pow2( rough * rough ) + mss * 2.0 * unresolved;
	let NoH = sat( dot( N, H ) );
	let NoL = sat( dot( N, L ) );
	let D = a2 / ( PI * pow2( NoH * NoH * ( a2 - 1.0 ) + 1.0 ) );
	let Vis = 0.5 / max( NoL * sqrt( NoV * NoV * ( 1.0 - a2 ) + a2 ) + NoV * sqrt( NoL * NoL * ( 1.0 - a2 ) + a2 ), 1e-4 );
	let Fs = 0.02 + 0.98 * pow5( 1.0 - sat( dot( V, H ) ) );
	let spec = sunLight * min( D * Vis * Fs * NoL, 80.0 );

	// ---- refraction: the view ray bends into the water and runs down to the seabed
	let sigA = frame.waterAbsorption;
	let sigS = frame.waterScattering;
	let sigT = sigA + sigS;
	let Tr = refract( -V, N, ${ ( 1 / IOR ).toFixed( 6 ) } );
	let Tv = normalize( vec3f( Tr.x, min( Tr.y, -0.06 ), Tr.z ) );
	let tDown = max( -Tv.y, 0.04 );
	// the path to the bed (two refinements over the sloping sand), capped: deep water is opaque long before
	var Lp = max( depth, 0.0 ) / tDown;
	if ( depth < 40.0 ) {
		let L1 = max( - islandHeight( xz + Tv.xz * min( Lp, 150.0 ) ), 0.0 ) / tDown;
		Lp = max( - islandHeight( xz + Tv.xz * min( ( L1 + Lp ) * 0.5, 150.0 ) ), 0.0 ) / tDown;
	}
	let pathLen = min( Lp, 160.0 );
	// the sun under water, and the single scattering of the sun and the sky along the view ray
	let Ls = -refract( -L, vec3f( 0.0, 1.0, 0.0 ), ${ ( 1 / IOR ).toFixed( 6 ) } );
	let muS = max( Ls.y, 0.1 );
	let sunIn = sunLight * ( 1.0 - 0.02 );
	let kSun = sigT * ( 1.0 + tDown / muS );
	let kAmb = sigT * ( 1.0 + tDown / 0.75 );
	let cosPh = dot( Tv, Ls );
	let g2 = 0.86 * 0.86;
	let phase = ( ( 1.0 - g2 ) / ( 4.0 * PI ) ) / pow( max( 1.0 + g2 - cosPh * 2.0 * 0.86, 1e-4 ), 1.5 ) * 0.7 + 0.3 / ( 4.0 * PI );
	let bb = sigS * 0.035;
	let albedoMS = bb * 1.32 / ( sigA + bb );
	let inSun = sunIn * ( sigS * phase + albedoMS * sigT * INV_PI ) * ( 1.0 - exp( -kSun * pathLen ) ) / kSun;
	let inAmb = frame.skyIrradiance * ( sigS * 0.25 + albedoMS * sigT ) * ( 1.0 - exp( -kAmb * pathLen ) ) / kAmb;
	let Tview = exp( -sigT * pathLen );
	var bedCol = vec3f( 0.0 );
	if ( depth < 60.0 && pathLen < 159.0 ) {
		let bxz = xz + Tv.xz * pathLen;
		let bh = islandHeight( bxz );
		let bn = islandNormal( bxz );
		let bg = islandGround( bxz, bh, bn, dist + pathLen );
		// the sun reaches the bed through the water above it, focused into caustics by the waves
		let dBed = max( -bh, 0.0 );
		let Tsun = exp( -sigT * dBed / muS );
		let caus = islandCaustics( bxz, t ) * smoothstep( 25.0, 1.0, dBed ) * ( 1.0 - smoothstep( 150.0, 600.0, dist ) );
		let Eb = sunLight * Tsun * sat( dot( bn, Ls ) ) * ( 0.55 + caus * 1.6 ) + frame.skyIrradiance * PI * exp( -sigT * dBed / 0.75 ) * 0.9;
		bedCol = bg.albedo * Eb * INV_PI;
	}
	// crests glow where the sun shines through them
	let vH = normalize( vec2f( V.x, V.z ) + 1e-5 );
	let lH = normalize( vec2f( L.x, L.z ) + 1e-5 );
	let back = pow( sat( dot( vH, -lH ) * 0.6 + 0.4 ), 2.5 );
	let crestH = sat( in.vs.vDisp.w * 0.7 + 0.15 ) * ( sat( ( 1.0 - N.y ) * 4.0 ) + 0.25 );
	let sss = sunLight * vec3f( 0.12, 0.55, 0.45 ) * 0.07 * back * crestH * smoothstep( 0.0, 0.25, L.y );
	let transmitted = bedCol * Tview + inSun + inAmb + sss;
	// the lamps', the lighthouse's and the engines' glints on the water
	var col = mix( transmitted, refl, F ) + spec + localLightsSpecular( P, N, V, 0.12 + sqrt( mss * unresolved ) );

	// ---- foam: whitecaps, the breaking surf, the swash line on the beach, bubbly and patchy
	let foamFFT = smoothstep( 0.45, 1.1, in.vs.vDisp.z ) * ( 1.0 - far );
	// (the bubble and lace noise only up close: past a couple of km it is sub-pixel)
	var bub = 0.5;
	var lace = 0.62;
	if ( dist < 2500.0 ) {
		bub = islandFbm( xz * 1.3 + vec2f( t * 0.15, -t * 0.1 ) );
		lace = smoothstep( 0.35, 0.75, islandFbm( xz * 0.45 - vec2f( t * 0.05 ) ) * 0.6 + bub * 0.4 );
	}
	let surf = smoothstep( 0.05, 0.6, in.vs.vShore.x ) * mix( 0.55, 1.0, lace );
	// behind the breakers a trail of bubbles fades out
	let trail = smoothstep( 3.0, 1.0, depth ) * smoothstep( -0.3, 0.6, depth ) * lace * 0.45;
	// a bubbly bead along the running edge of the swash, thinning lace behind it
	let nearShore = smoothstep( 1.2, 0.3, depth );
	let bead = smoothstep( 0.14, 0.02, thickness ) * nearShore * mix( 0.55, 1.0, bub );
	let sheet = smoothstep( 0.4, 0.1, thickness ) * nearShore * lace * 0.45;
	// wind streaks: foam combed into long lines down the wind
	var streaks = 0.0;
	if ( dist < 2000.0 ) {
		let wd = frame.windDir;
		let along = dot( xz, wd );
		let across = dot( xz, vec2f( -wd.y, wd.x ) );
		let stn = islandNoise( vec2f( along * 0.01 - t * 0.06, across * 0.55 ) ) * 0.7 + islandNoise( vec2f( along * 0.04, across * 1.3 ) ) * 0.3;
		let windPatch = smoothstep( 0.42, 0.72, islandNoise( xz * 0.0035 + vec2f( t * 0.012, 0.0 ) ) );
		streaks = smoothstep( 0.66, 0.86, stn ) * 0.26 * windPatch * ( 1.0 - smoothstep( 300.0, 2000.0, dist ) ) * smoothstep( 4.0, 14.0, depth );
	}
	// boat wakes: the Kelvin wedge, a churned trail and a bow wave
	var wake = 0.0;
	for ( var i = 0; i < select( 4, 0, dist > 3000.0 ); i++ ) {
		let b = os.boats[ i ];
		if ( b.w <= 0.0 ) { continue; }
		let fw = vec2f( cos( b.z ), sin( b.z ) );
		let rel = xz - b.xy;
		let back = - dot( rel, fw );
		let side = abs( dot( rel, vec2f( -fw.y, fw.x ) ) );
		if ( back > -8.0 && back < 170.0 ) {
			let arm = exp( - pow( ( side - back * 0.36 ) / ( 0.5 + back * 0.025 ), 2.0 ) ) * smoothstep( -2.0, 4.0, back ) * exp( - back / 70.0 );
			let mid = exp( - pow( side / ( 0.8 + back * 0.035 ), 2.0 ) ) * smoothstep( 0.0, 3.0, back ) * exp( - back / 30.0 );
			let bow = exp( - ( pow( back + 4.5, 2.0 ) + side * side ) / 5.0 );
			wake += ( arm * 0.75 + mid * 0.8 + bow ) * ( 0.35 + lace * 0.8 ) * smoothstep( 0.5, 4.0, b.w );
		}
	}
	let foam = sat( foamFFT + surf + trail + bead + sheet + streaks + wake );
	let foamLit = ( sunLight * ( sat( dot( N, L ) ) * 0.75 + 0.25 ) * INV_PI + frame.skyIrradiance * 0.95 ) * 0.85;
	col = mix( col, foamLit + spec * 0.05, foam );

	// seen from below (the camera under the sea): Snell's window of the sky overhead, total internal
	// reflection of the dim blue water outside it, fading into the water's own colour with distance
	if ( ! in.front ) {
		let dirU = -V;
		let Nw = -N;
		let Tt = refract( dirU, Nw, 1.333 );
		let deepU = frame.skyIrradiance * vec3f( 0.03, 0.14, 0.16 ) + frame.sunColor * vec3f( 0.002, 0.014, 0.016 );
		var under = deepU;
		if ( dot( Tt, Tt ) > 0.5 ) {
			let Fu = 0.02 + 0.98 * pow5( 1.0 - sat( dot( V, -Nw ) ) );
			under = mix( skyRadianceWithClouds( normalize( Tt ), true ) * vec3f( 0.7, 0.9, 0.95 ), deepU, Fu );
		}
		col = mix( deepU, under, exp( - dist * 0.05 ) );
	}

	// seen from high up the sea becomes the planet: blend into the sky's ground shading (the same
	// function renders the Earth past the edge of this mesh and from orbit)
	let camAlt = frame.cameraPos.y - frame.seaLevel;
	let planetK = smoothstep( 6000.0, 30000.0, camAlt );
	if ( planetK > 0.0 && skyGroundHit( -V ) > 0.0 ) { col = mix( col, skyGroundRadiance( -V ) + atmosphereSkyLuminance( -V ) * planetK, planetK ); }
	s.albedo = vec3f( 0.0 );
	s.emissive = min( col, vec3f( 20000.0 ) );
`,
		} );
		// custom shaded: only the sun shadow of the scene lighting
		this.material.lightingHooks = false;

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
