import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { FullscreenPass } from '../engine/render/FullscreenPass.js';
import { SCENE_FORMATS, DEPTH_FORMAT } from '../engine/render/SceneRenderer.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { Vector3, Vector4, MathUtils } from '../engine/math/index.js';
import { SUN_ANGULAR_RADIUS } from './Atmosphere.js';

// Sky radiance, from the beach to interstellar space (adapted from Tidewater's Sky.js):
//   - the atmosphere (sky view LUT) and the sun disk, whose size follows `sunRadius` (it grows on
//     the way to the Sun)
//   - stars: at night, and in daylight once the sky above goes dark with altitude
//   - the Earth seen from above: ray-sphere hit of the ground, procedural oceans, continents,
//     cloud cover and city lights, lit through the atmosphere's transmittance, plus its in-scatter
//   - space backdrops: up to 12 bodies (Moon, Mars, Jupiter, Saturn and its rings, Neptune, a Kuiper
//     world, the Earth as a far marble, a black hole with lensing and an accretion disk, other stars,
//     exoplanets, glowing nebulae, a pulsar's beams, galaxies, star and galaxy clusters, quasar jets)
//   - deep space: a faint field of distant galaxies, the cosmic web, the microwave background at the
//     edge of the observable universe, and the warp tunnel of a hyperjump
//   - the volumetric clouds composited in (faded out by `cloudMix` above the cloud heights)
//
// WGSL module (`sky.module`, prefix `sky`): skyRadiance, skyRadianceWithClouds, skyReflectionRadiance,
// skyViewRadiance, skyGroundRadiance( dir ) (the planet below, or 0 when the ray misses it),
// skyGroundHit( dir ) -> f32 (km, -1 on a miss).

const STAR_CELLS = 160;
const STAR_SIGMA = 0.1;
const MW = new Vector3( 0.3, 0.2, 1 ).normalize();
const STAR_REFLECTION = 0.08;
export const MAX_BODIES = 12;

export const BODY = { moon: 1, mars: 2, jupiter: 3, saturn: 4, neptune: 5, earth: 7, blackhole: 8, kuiper: 9, star: 10, planet: 11, nebula: 12, pulsar: 13, galaxy: 14, cluster: 15, quasar: 16, edge: 18 };

const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

const v4s = () => Array.from( { length: MAX_BODIES }, () => new Vector4() );

export class Sky {

	constructor( atmosphere ) {

		this.atmosphere = atmosphere;
		this.clouds = null;
		this.params = new UniformBlock( 'SkyParams', {
			moonDir: [ 'vec3f', new Vector3( - 0.3, 0.5, 0.8 ).normalize() ],
			sunDiskIntensity: [ 'f32', 1 ],
			// sun direction only uses atmosphereParams.sunDir; its angular radius (rad) and corona
			sunGlow: [ 'vec3f', new Vector3( 0, 0, 0 ) ],
			sunRadius: [ 'f32', SUN_ANGULAR_RADIUS ],
			starIntensity: [ 'f32', 0 ],
			// 0: stars only at night, 1: stars in daylight (high altitude / space)
			starsDay: [ 'f32', 0 ],
			// 0..1: fade out the atmosphere (deep space: no Earth below any more)
			spaceMix: [ 'f32', 0 ],
			// 0..1: how much of the volumetric clouds is composited
			cloudMix: [ 'f32', 1 ],
			// nebula tint (rgb) and strength (w) for deep space
			nebula: [ 'vec4f', new Vector4( 0.5, 0.2, 0.7, 0 ) ],
			// planet surface: time (s) for drifting clouds, city lights strength
			planetTime: [ 'f32', 0 ],
			// colour of the key star (disc and glow)
			sunTint: [ 'vec3f', new Vector3( 1, 1, 1 ) ],
			// 0..1: the Milky Way's stars (0 outside galaxies)
			starField: [ 'f32', 1 ],
			// the route frame (universe axes of the view's x, y, z) for the deep-space backdrops
			frameX: [ 'vec3f', new Vector3( 1, 0, 0 ) ],
			// 0..1: faint distant galaxies everywhere
			deepField: [ 'f32', 0 ],
			frameY: [ 'vec3f', new Vector3( 0, 1, 0 ) ],
			// 0..1: the cosmic web's filaments
			web: [ 'f32', 0 ],
			frameZ: [ 'vec3f', new Vector3( 0, 0, 1 ) ],
			// 0..1: the microwave background (the edge of the observable universe)
			cmb: [ 'f32', 0 ],
			// where the ship is in the cosmic web (cells)
			webOffset: [ 'vec3f', new Vector3() ],
			// 0..1: hyperjump warp tunnel
			tunnel: [ 'f32', 0 ],
			// aurora curtains (0..1): night skies and the edge of space
			aurora: [ 'f32', 0 ],
			bodyCount: [ 'u32', 0 ],
			pad0: [ 'f32', 0 ],
			// per body: xyz direction from the camera (unit), w angular radius (rad)
			bodyDir: [ 'vec4f[12]', v4s() ],
			// x type, y spin (rad) / seed, z ring tilt / style, w brightness
			bodyInfo: [ 'vec4f[12]', v4s() ],
			// xyz direction toward the sun at the body (a galaxy's disc normal, a jet or beam axis), w distance (km)
			bodyLight: [ 'vec4f[12]', v4s() ],
			// rgb colour (a star's, or the light's for planets), w: distance in radii (or a star's point brightness)
			bodyExtra: [ 'vec4f[12]', v4s() ],
		}, { label: 'sky' } );
		const U = this.params.fields;
		this.sunDiskIntensity = U.sunDiskIntensity;
		this.moonDir = U.moonDir;
		this.starIntensity = U.starIntensity;
		this.starsDay = U.starsDay;
		this.spaceMix = U.spaceMix;
		this.cloudMix = U.cloudMix;
		this.sunRadius = U.sunRadius;
		this.sunGlow = U.sunGlow;
		this.nebula = U.nebula;
		this.planetTime = U.planetTime;
		this.aurora = U.aurora;
		this.sunTint = U.sunTint;
		this._module = null;
		this._background = null;

	}

	// bodies: [ { type, dir: Vector3 (unit, from the camera), angle (rad), spin, tilt (or style), light: Vector3,
	// brightness, distance, extra: [ r, g, b, w ] } ]
	setBodies( bodies ) {

		const U = this.params.fields;
		const n = Math.min( MAX_BODIES, bodies.length );
		U.bodyCount.value = n;
		for ( let i = 0; i < n; i ++ ) {

			const b = bodies[ i ];
			U.bodyDir.value[ i ].set( b.dir.x, b.dir.y, b.dir.z, Math.max( 1e-7, b.angle ) );
			U.bodyInfo.value[ i ].set( b.type, b.spin || 0, b.tilt || 0, b.brightness ?? 1 );
			const l = b.light || { x: 0, y: 1, z: 0 };
			U.bodyLight.value[ i ].set( l.x, l.y, l.z, b.distance || 0 );
			const e = b.extra || [ 1, 1, 1, 0 ];
			U.bodyExtra.value[ i ].set( e[ 0 ], e[ 1 ], e[ 2 ], e[ 3 ] );

		}

	}

	get module() {

		if ( ! this._module ) this._module = this._buildModule();
		return this._module;

	}

	_buildModule() {

		const clouds = this.clouds;
		const deps = [ commonModule, this.atmosphere.module ];
		if ( clouds ) deps.push( clouds.module );
		const composite = ( sampler ) => clouds
			? `let c = ${ sampler }( dir );\n\treturn mix( base, base * c.a + c.rgb, skyParams.cloudMix );`
			: 'return base;';

		return new ShaderModule( {
			name: 'sky',
			deps,
			uniforms: this.params,
			uniformName: 'skyParams',
			bindings: clouds ? { skyNoiseTex: { texture: clouds.noise } } : {},
			code: /* wgsl */`
fn skyHash13( p: vec3f ) -> f32 {
	var p3 = fract( p * vec3f( 0.1031, 0.1030, 0.0973 ) );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

// cheap value noise / fbm for the procedural planets
fn skyVnoise( p: vec3f ) -> f32 {
	let i = floor( p );
	let fr = fract( p );
	let u = fr * fr * ( 3.0 - 2.0 * fr );
	return mix( mix( mix( skyHash13( i ), skyHash13( i + vec3f( 1.0, 0.0, 0.0 ) ), u.x ),
			mix( skyHash13( i + vec3f( 0.0, 1.0, 0.0 ) ), skyHash13( i + vec3f( 1.0, 1.0, 0.0 ) ), u.x ), u.y ),
		mix( mix( skyHash13( i + vec3f( 0.0, 0.0, 1.0 ) ), skyHash13( i + vec3f( 1.0, 0.0, 1.0 ) ), u.x ),
			mix( skyHash13( i + vec3f( 0.0, 1.0, 1.0 ) ), skyHash13( i + vec3f( 1.0, 1.0, 1.0 ) ), u.x ), u.y ), u.z );
}
fn skyFbm( p: vec3f, oct: i32 ) -> f32 {
	var s = 0.0; var a = 0.5; var q = p; var n = 0.0;
	for ( var i = 0; i < oct; i++ ) { s += skyVnoise( q ) * a; n += a; a *= 0.5; q = q * 2.03 + vec3f( 17.1, 3.7, 9.2 ); }
	return s / n;
}


// 3D noise (4 channels, tiling every unit): the clouds' Perlin-Worley texture when there is one
fn skyNoise3( p: vec3f ) -> vec4f {
	${ clouds ? 'return textureSampleLevel( skyNoiseTex, smpLinearRepeat, p, 0.0 );' : 'return vec4f( skyVnoise( p * 5.0 ), skyVnoise( p * 9.0 + 3.1 ), skyVnoise( p * 17.0 + 7.3 ), skyVnoise( p * 31.0 + 1.7 ) );' }
}

// a view direction in the universe's axes (the route frame), for backdrops fixed to the cosmos
fn skyUniverse( dir: vec3f ) -> vec3f {
	return skyParams.frameX * dir.x + skyParams.frameY * dir.y + skyParams.frameZ * dir.z;
}

// a point of light around direction c: a small core, a halo and four diffraction spikes (I: peak)
fn skyPoint( dir: vec3f, c: vec3f, I: f32, tint: vec3f ) -> vec3f {
	let cosT = dot( dir, c );
	if ( I <= 0.0 || cosT < 0.995 ) { return vec3f( 0.0 ); }
	let off = dir - c * cosT;
	let a2 = dot( off, off );
	var ax = vec3f( 1.0, 0.0, 0.0 ) - c * c.x;
	if ( dot( ax, ax ) < 1e-4 ) { ax = vec3f( 0.0, 1.0, 0.0 ) - c * c.y; }
	ax = normalize( ax );
	let ay = cross( c, ax );
	let u = abs( dot( off, ax ) );
	let v = abs( dot( off, ay ) );
	let core = exp( -a2 / ( 0.0017 * 0.0017 ) );
	let halo = 0.03 / ( 1.0 + a2 / ( 0.005 * 0.005 ) );
	let spikes = ( exp( -u / 0.0007 - v / 0.03 ) + exp( -v / 0.0007 - u / 0.03 ) ) * 0.2 * sat( log2( max( I, 1.0 ) ) * 0.15 );
	return tint * I * ( core + halo + spikes );
}

// closest approach of the view ray (from the eye along dir) to the segment p + a s, s in [ -1, 1 ]:
// vec2( distance, s )
fn skySegment( dir: vec3f, p: vec3f, a: vec3f ) -> vec2f {
	let b = dot( a, dir );
	let d = dot( dir, p );
	let e = dot( a, p );
	let s = clamp( ( b * d - e ) / max( 1.0 - b * b, 1e-5 ), -1.0, 1.0 );
	let t = max( dot( dir, p + a * s ), 0.0 );
	return vec2f( length( p + a * s - dir * t ), s );
}

// the viewer's position in the planet frame (km)
fn skyViewer() -> vec3f { return vec3f( 0.0, atmosphereParams.viewHeight, 0.0 ); }

// km along dir to the ground sphere (-1: misses the planet)
fn skyGroundHit( dir: vec3f ) -> f32 {
	return atmosphereRaySphereNearest( skyViewer(), dir, ATMO_RG );
}

// ---- the Earth's surface seen from above (n: surface normal in the planet frame)
fn skyEarthAlbedo( n: vec3f, t: f32 ) -> vec4f {
	// the launch island sits under the zenith: keep open sea around it
	let away = smoothstep( 0.02, 0.25, 1.0 - n.y );
	let q = n * 2.2 + vec3f( 3.1, 1.7, -2.3 );
	let land = smoothstep( 0.54, 0.6, skyFbm( q, 6 ) ) * away;
	let polar = smoothstep( 0.82, 0.9, abs( n.z ) );
	let desert = smoothstep( 0.5, 0.7, skyFbm( n * 5.0 + vec3f( 9.0 ), 4 ) ) * ( 1.0 - smoothstep( 0.3, 0.6, abs( n.z ) ) );
	let green = mix( vec3f( 0.07, 0.16, 0.05 ), vec3f( 0.2, 0.17, 0.09 ), skyFbm( n * 12.0, 3 ) );
	let ground = mix( green, vec3f( 0.46, 0.36, 0.22 ), desert );
	let sea = vec3f( 0.008, 0.04, 0.11 );
	var alb = mix( sea, ground, land );
	alb = mix( alb, vec3f( 0.85, 0.88, 0.92 ), polar );
	// cloud cover drifting slowly
	let cq = n * 4.0 + vec3f( t * 0.002, 0.0, t * 0.0013 );
	let cl = smoothstep( 0.55, 0.76, skyFbm( cq + skyFbm( n * 9.0, 3 ) * 0.6, 5 ) );
	return vec4f( alb, max( cl, polar * 0.3 ) * 0.9 + land * 0.0 );
}

fn skySurfaceLight( n: vec3f, L: vec3f, dir: vec3f, alb: vec4f, cityK: f32 ) -> vec3f {
	let NdL = dot( n, L );
	// (a little less of the low sun's orange: the planet reads blue and white from orbit)
	let T0 = atmosphereSampleTransmittance( ATMO_RG + 0.5, NdL );
	let Tsun = mix( T0, vec3f( luminance( T0 ) ), 0.55 );
	let sun = atmosphereParams.sunIlluminance * Tsun * max( NdL, 0.0 );
	let surface = mix( alb.rgb, vec3f( 0.8 ), alb.a );
	var c = sun * surface * INV_PI;
	// ocean glint where no cloud / land
	let H = normalize( L - dir );
	let glint = pow( max( dot( n, H ), 0.0 ), 180.0 ) * 2.5 * ( 1.0 - alb.a ) * step( alb.r + alb.g, 0.04 );
	c += atmosphereParams.sunIlluminance * Tsun * glint * max( NdL, 0.0 );
	// city lights on the night side (land only, under clear skies)
	let night = smoothstep( 0.05, -0.15, NdL );
	let cities = step( 0.035, alb.g - alb.b * 0.5 ) * step( 0.93, skyHash13( floor( n * 700.0 ) ) ) * ( 1.0 - alb.a );
	c += vec3f( 1.0, 0.7, 0.35 ) * cities * night * 0.06 * cityK;
	return c;
}

// radiance of the ground along dir (0 when the ray misses the planet)
fn skyGroundRadiance( dir: vec3f ) -> vec3f {
	let t = skyGroundHit( dir );
	if ( t < 0.0 ) { return vec3f( 0.0 ); }
	let P = skyViewer() + dir * t;
	let n = normalize( P );
	let L = atmosphereParams.sunDir;
	let alb = skyEarthAlbedo( n, skyParams.planetTime );
	// transmittance ground -> viewer: ( ground -> space ) / ( viewer -> space ) along the ray
	let Tg = atmosphereSampleTransmittance( ATMO_RG + 0.1, dot( n, -dir ) );
	let Tv = atmosphereSampleTransmittance( min( atmosphereParams.viewHeight, ATMO_RT ), -dir.y );
	let T = clamp( Tg / max( Tv, vec3f( 1e-4 ) ), vec3f( 0.0 ), vec3f( 1.0 ) );
	return skySurfaceLight( n, L, dir, alb, 1.0 ) * T;
}

// Sun disk radiance along dir (transmittance included), any angular size, hidden by the planet
fn skySunDisk( dir: vec3f ) -> vec3f {
	let cosA = dot( dir, atmosphereParams.sunDir );
	let ang = acos( clamp( cosA, -1.0, 1.0 ) );
	let R = skyParams.sunRadius;
	let r = ang / R;
	let mask = smoothstep( 1.0, 0.95, r );
	let mu = sqrt( max( 1.0 - r * r, 0.0 ) );
	let limb = 1.0 - 0.6 * ( 1.0 - mu );
	let T = atmosphereTransmittanceToSpace( dir );
	let hidden = select( 1.0, 0.0, skyGroundHit( dir ) > 0.0 );
	// granulation once the disc is big on screen
	let gran = 1.0 + ( skyFbm( dir * ( 40.0 / R ) + vec3f( skyParams.planetTime * 0.05 ), 3 ) - 0.5 ) * smoothstep( 0.01, 0.1, R ) * 0.6;
	// (the physical disk radiance would be ~1.6e5: clamped for fp16, scaled down as it grows)
	// (dimmer per steradian as it grows, so a close Sun doesn't just white the screen out)
	let lum = 2500.0 * min( 1.0, pow( ${ f( SUN_ANGULAR_RADIUS ) } / R, 1.6 ) + 0.004 );
	var c = T * mask * limb * gran * lum * skyParams.sunDiskIntensity * hidden;
	// corona / glare around the disc
	let g = skyParams.sunGlow;
	c += ( vec3f( 1.0, 0.85, 0.6 ) * exp( -( ang - R ) / max( R * 1.5, 1e-4 ) ) * g.x + vec3f( 1.0, 0.7, 0.4 ) * exp( -ang * 3.0 ) * g.y ) * hidden * step( R, ang );
	return c * skyParams.sunTint;
}

fn skyStars( dir0: vec3f ) -> vec3f {
	let dir = dir0;
	let a = abs( dir );
	let onX = a.x > a.y && a.x > a.z;
	let onY = a.y > a.z;
	let face = select( select( sign( dir.z ) + 8.0, sign( dir.y ) + 5.0, onY ), sign( dir.x ) + 2.0, onX );
	let uv = select( select( dir.xy / a.z, dir.xz / a.y, onY ), dir.yz / a.x, onX ) * ${ f( STAR_CELLS ) };
	let cell = vec3f( floor( uv ), face );
	let h = skyHash13( cell );
	let bx = dot( dir, vec3f( ${ f( MW.x ) }, ${ f( MW.y ) }, ${ f( MW.z ) } ) ) * 4.0;
	let band = exp( - bx * bx );
	let has = h < band * 0.035 + 0.025;
	let uc = max( skyHash13( cell + 7.7 ), 2e-4 );
	let m = log2( uc ) * 0.602 + 6.5;
	// dark enough: night, or the thin air high up
	let dark = max( 1.0 - smoothstep( -0.28, -0.1, atmosphereParams.sunDir.y ), skyParams.starsDay );
	let vis = smoothstep( m - 0.6, m + 0.6, dark * 7.5 - 1.0 ) * select( 0.0, 1.0, has );
	let sp = ( floor( uv ) + vec2f( skyHash13( cell + 3.1 ), skyHash13( cell + 5.7 ) ) * 0.4 + 0.3 ) / ${ f( STAR_CELLS ) };
	let sdir = normalize( select( select( vec3f( sp, sign( dir.z ) ), vec3f( sp.x, sign( dir.y ), sp.y ), onY ), vec3f( sign( dir.x ), sp ), onX ) );
	let d = length( dir - sdir ) * ${ f( STAR_CELLS ) };
	let flux = pow( uc, -0.8 );
	let size = log2( flux ) * 0.08 + 1.0;
	let psf = exp( d * d / ( size * size ) * ${ f( - 0.5 / ( STAR_SIGMA * STAR_SIGMA ) ) } ) / ( size * size );
	let tw = sin( frame.time * ( skyHash13( cell + 13.3 ) * 9.0 + 5.0 ) + h * 60.0 ) * mix( 0.18, 0.06, sat( dir.y * 2.0 ) ) * ( 1.0 - skyParams.starsDay ) + 1.0;
	let col = mix( vec3f( 1.0, 0.8, 0.6 ), vec3f( 0.75, 0.85, 1.0 ), skyHash13( cell + 17.0 ) ) * 0.5 + 0.5;
	let star = col * ( psf * flux * vis * tw * 0.0075 );
	let glow = vec3f( 0.55, 0.6, 0.75 ) * ( band * dark * 0.0035 );
	// extinction toward the horizon inside the atmosphere; none in space
	let horizon = mix( smoothstep( 0.0, 0.2, dir.y ), 1.0, skyParams.starsDay );
	return ( star + glow ) * skyParams.starIntensity * horizon * skyParams.starField;
}

// aurora: rippling green curtains with violet tops low over the northern horizon (fantasy: the
// island is tropical), stronger from the edge of space
fn skyAurora( dir: vec3f ) -> vec3f {
	let k = skyParams.aurora;
	if ( k <= 0.0 || skyGroundHit( dir ) > 0.0 ) { return vec3f( 0.0 ); }
	let az = atan2( dir.x, -dir.z );
	let north = smoothstep( 1.9, 0.3, abs( az + 0.2 ) );
	let t = skyParams.planetTime;
	let wave = az * 3.0 + sin( az * 7.0 + t * 0.3 ) * 0.4 + sin( az * 17.0 - t * 0.5 ) * 0.1;
	let rays = pow( sat( skyVnoise( vec3f( wave * 6.0, t * 0.15, 1.0 ) ) ), 3.0 ) * 1.5 + 0.2;
	let base = 0.03 + sin( az * 2.3 + t * 0.1 ) * 0.02;
	let h = dir.y - base;
	let curtain = smoothstep( 0.0, 0.03, h ) * exp( - max( h, 0.0 ) * 6.0 );
	let top = smoothstep( 0.05, 0.3, h );
	let col = mix( vec3f( 0.15, 1.0, 0.45 ), vec3f( 0.6, 0.25, 1.0 ), top );
	return col * curtain * rays * north * k * 0.02;
}

fn skyNebula( dir: vec3f ) -> vec3f {
	let k = skyParams.nebula.w;
	if ( k <= 0.0 ) { return vec3f( 0.0 ); }
	let n1 = skyFbm( dir * 2.5 + vec3f( 5.0 ), 5 );
	let n2 = skyFbm( dir * 4.0 + vec3f( 1.3, 7.1, 2.2 ), 4 );
	let c = mix( skyParams.nebula.rgb, vec3f( 0.15, 0.35, 0.8 ), n2 );
	return c * pow( smoothstep( 0.45, 0.85, n1 ), 2.0 ) * k * 0.004;
}


// faint distant galaxies all over the sky (fixed to the universe)
fn skyDeepField( dir: vec3f ) -> vec3f {
	let k = skyParams.deepField;
	if ( k <= 0.0 ) { return vec3f( 0.0 ); }
	let u = skyUniverse( dir );
	return ( skyGalaxySprite( u, 90.0, 0.2, 71.0 ) * 0.25 + skyGalaxySprite( u, 220.0, 0.25, 13.0 ) * 0.12 ) * k;
}

fn skyWorley( p: vec3f ) -> vec2f {
	let i = floor( p );
	let f = fract( p );
	var d1 = 8.0;
	var d2 = 8.0;
	for ( var z = -1; z <= 1; z++ ) {
		for ( var y = -1; y <= 1; y++ ) {
			for ( var x = -1; x <= 1; x++ ) {
				let g = vec3f( f32( x ), f32( y ), f32( z ) );
				let o = vec3f( skyHash13( i + g ), skyHash13( i + g + 19.1 ), skyHash13( i + g + 47.7 ) );
				let d = length( g + o - f );
				if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) { d2 = d; }
			}
		}
	}
	return vec2f( d1, d2 );
}

// the cosmic web: filaments of galaxies along the edges of vast cells, knots where they meet; two
// shells drift at different rates as the ship moves (parallax)
fn skyWeb( dir: vec3f ) -> vec3f {
	let k = skyParams.web;
	if ( k <= 0.0 ) { return vec3f( 0.0 ); }
	let u = skyUniverse( dir );
	var col = vec3f( 0.0 );
	for ( var i = 0; i < 2; i++ ) {
		let far = f32( i );
		var p = u * mix( 2.5, 5.0, far ) + skyParams.webOffset * mix( 1.0, 0.45, far );
		// warped cells: wavy filaments rather than straight edges
		p += ( skyNoise3( p * 0.21 + vec3f( far * 0.37 ) ).rgb - 0.5 ) * 0.9;
		let w = skyWorley( p );
		let fil = exp( -( w.y - w.x ) * mix( 16.0, 22.0, far ) );
		// clumpy: galaxies strung along the filaments, knots of clusters where they meet
		let clump = pow( skyNoise3( p * 0.7 + vec3f( 3.1 ) ).r, 2.0 ) * 2.5;
		let node = exp( -w.x * w.x * 30.0 ) * fil;
		let grain = step( 0.8, skyHash13( floor( u * 700.0 ) ) ) * fil * 2.0;
		col += ( vec3f( 0.42, 0.3, 1.0 ) * fil * clump * 0.18 + vec3f( 0.9, 0.8, 1.0 ) * grain * 0.3 + vec3f( 1.0, 0.75, 0.9 ) * node * 0.7 ) * mix( 1.0, 0.45, far );
	}
	return col * k;
}

// the cosmic microwave background, in the map's famous palette: a wall of light ahead
fn skyCMB( dir: vec3f ) -> vec3f {
	let k = skyParams.cmb;
	if ( k <= 0.0 ) { return vec3f( 0.0 ); }
	let u = skyUniverse( dir );
	let n = skyFbm( u * 4.0, 5 ) * 0.7 + skyFbm( u * 16.0 + vec3f( 3.0 ), 3 ) * 0.3;
	let x = sat( ( n - 0.33 ) / 0.34 );
	var c = mix( vec3f( 0.02, 0.05, 0.5 ), vec3f( 0.1, 0.55, 1.0 ), smoothstep( 0.0, 0.3, x ) );
	c = mix( c, vec3f( 0.9, 0.9, 0.75 ), smoothstep( 0.35, 0.5, x ) * 0.8 );
	c = mix( c, vec3f( 1.0, 0.72, 0.18 ), smoothstep( 0.5, 0.7, x ) );
	c = mix( c, vec3f( 0.9, 0.18, 0.05 ), smoothstep( 0.7, 1.0, x ) );
	let ahead = smoothstep( -0.7, 1.0, dir.y );
	return c * k * ( 0.1 + ahead * ahead * 1.4 ) * ( 0.4 + k * 2.0 );
}

// hyperjump: star streaks racing out of the point ahead, a glow at the end of the tunnel
fn skyTunnel( dir: vec3f ) -> vec3f {
	let k = skyParams.tunnel;
	if ( k <= 0.0 ) { return vec3f( 0.0 ); }
	let a = acos( clamp( dir.y, -1.0, 1.0 ) );
	let az = ( atan2( dir.z, dir.x ) / 6.2832 + 0.5 ) * 180.0;
	let lane = floor( az );
	let h = skyHash13( vec3f( lane, 3.0, 7.0 ) );
	let da = fract( az ) - 0.5;
	let across = exp( -da * da * 30.0 ) * step( h, 0.7 );
	let s = fract( log( max( a, 0.02 ) ) * 1.3 - frame.time * ( 1.2 + h * 2.5 ) + h * 17.0 );
	let streak = smoothstep( 0.55, 0.97, s ) * ( 1.0 - smoothstep( 0.97, 1.0, s ) ) * smoothstep( 0.03, 0.4, a );
	let col = mix( vec3f( 0.35, 0.55, 1.0 ), vec3f( 1.0, 0.9, 1.0 ), h );
	let glow = exp( -a * 3.5 ) * 1.5 + exp( -pow( ( a - 1.3 ) / 0.45, 2.0 ) ) * 0.12;
	return ( col * streak * across * 2.5 + vec3f( 0.6, 0.5, 1.0 ) * glow ) * k;
}

fn skyMoon( dir: vec3f ) -> vec3f {
	let cosA = dot( dir, skyParams.moonDir );
	let ang = acos( clamp( cosA, -1.0, 1.0 ) );
	let r = ang / 0.0048;
	let mask = smoothstep( 1.0, 0.92, r );
	return vec3f( 0.9, 0.92, 1.0 ) * mask * 3.0 * skyParams.starIntensity * smoothstep( -0.02, 0.02, dir.y ) * ( 1.0 - skyParams.starsDay );
}

fn skyMoonSky( dir: vec3f ) -> vec3f {
	let cosA = dot( dir, skyParams.moonDir );
	let ang = acos( clamp( cosA, -1.0, 1.0 ) );
	let aureole = exp( ang * -14.0 ) * 2.4 + exp( ang * -2.5 ) * 0.9;
	let grad = mix( 1.7, 1.0, sat( dir.y * 3.0 ) );
	let up = smoothstep( -0.05, 0.15, skyParams.moonDir.y );
	return vec3f( 0.005, 0.0068, 0.0105 ) * ( grad + aureole ) * frame.night * up;
}

// ---- space bodies

struct SkyBodyHit { hit: bool, n: vec3f, ang: f32 };

// sphere seen at angular radius R around direction c: surface normal where dir hits it
fn skyBodyHit( dir: vec3f, c: vec3f, R: f32 ) -> SkyBodyHit {
	var h: SkyBodyHit;
	let cosT = dot( dir, c );
	h.ang = acos( clamp( cosT, -1.0, 1.0 ) );
	h.hit = cosT > 0.0 && h.ang < R;
	if ( h.hit ) {
		let u = ( dir - c * cosT ) / max( sin( R ), 1e-7 );
		let l2 = min( dot( u, u ), 1.0 );
		h.n = normalize( u - c * sqrt( 1.0 - l2 ) );
	}
	return h;
}

// a frame whose y is the body's spin axis (tilted toward the camera a little)
fn skySpin( n: vec3f, spin: f32 ) -> vec3f {
	let cs = cos( spin ); let sn = sin( spin );
	return vec3f( n.x * cs - n.z * sn, n.y, n.x * sn + n.z * cs );
}

fn skyBodyAlbedo( kind: i32, n: vec3f, spin: f32 ) -> vec3f {
	let q = skySpin( n, spin );
	if ( kind == 1 ) {
		// the Moon: highlands, dark maria, crater speckle
		let maria = smoothstep( 0.5, 0.62, skyFbm( q * 2.4 + vec3f( 2.0 ), 5 ) );
		let crater = skyFbm( q * 18.0, 3 );
		return mix( vec3f( 0.36, 0.35, 0.33 ), vec3f( 0.14, 0.14, 0.15 ), maria ) * ( 0.75 + crater * 0.5 );
	}
	if ( kind == 2 ) {
		// Mars: rust, dark basalt plains, polar caps
		let dark = smoothstep( 0.48, 0.62, skyFbm( q * 3.0 + vec3f( 7.0 ), 5 ) );
		let cap = smoothstep( 0.86, 0.92, abs( q.y ) );
		let c = mix( vec3f( 0.55, 0.22, 0.09 ), vec3f( 0.25, 0.11, 0.06 ), dark ) * ( 0.85 + skyFbm( q * 14.0, 3 ) * 0.3 );
		return mix( c, vec3f( 0.9, 0.88, 0.85 ), cap );
	}
	if ( kind == 3 ) {
		// Jupiter: turbulent bands and the Great Red Spot
		let turb = skyFbm( q * vec3f( 3.0, 12.0, 3.0 ), 5 ) - 0.5;
		let lat = q.y + turb * 0.08;
		let bands = sin( lat * 22.0 ) * 0.5 + 0.5;
		var c = mix( vec3f( 0.78, 0.66, 0.5 ), vec3f( 0.55, 0.36, 0.24 ), bands );
		c = mix( c, vec3f( 0.92, 0.88, 0.8 ), smoothstep( 0.6, 0.9, sin( lat * 9.0 ) * 0.5 + 0.5 ) * 0.4 );
		let spot = length( ( q - normalize( vec3f( 0.5, -0.36, 0.78 ) ) ) * vec3f( 1.0, 2.0, 1.0 ) );
		return mix( c, vec3f( 0.62, 0.22, 0.12 ), smoothstep( 0.2, 0.12, spot ) );
	}
	if ( kind == 4 ) {
		// Saturn: pale butterscotch bands
		let lat = q.y + ( skyFbm( q * vec3f( 2.0, 8.0, 2.0 ), 4 ) - 0.5 ) * 0.04;
		return mix( vec3f( 0.82, 0.72, 0.52 ), vec3f( 0.68, 0.56, 0.38 ), sin( lat * 26.0 ) * 0.5 + 0.5 );
	}
	if ( kind == 5 ) {
		// Neptune: deep blue with bright streaks
		let streak = smoothstep( 0.7, 0.85, skyFbm( q * vec3f( 2.0, 16.0, 2.0 ), 4 ) );
		return mix( vec3f( 0.12, 0.24, 0.62 ), vec3f( 0.75, 0.82, 0.95 ), streak * 0.6 );
	}
	if ( kind == 9 ) {
		// an icy Kuiper world: beige plains, a pale heart
		let heart = smoothstep( 0.35, 0.2, length( q - normalize( vec3f( 0.3, -0.2, 0.9 ) ) ) );
		return mix( vec3f( 0.55, 0.45, 0.36 ) * ( 0.8 + skyFbm( q * 8.0, 4 ) * 0.4 ), vec3f( 0.92, 0.9, 0.86 ), heart );
	}
	return vec3f( 0.5 );
}


// exoplanets: rgb albedo, a glowing lava
fn skyExoAlbedo( style: i32, n: vec3f, spin: f32, L: vec3f ) -> vec4f {
	let q = skySpin( n, spin );
	if ( style == 0 ) {
		// an ocean world: deep blue seas, a few green islands, swirling cloud
		let land = smoothstep( 0.6, 0.64, skyFbm( q * 2.5 + vec3f( 4.0 ), 5 ) );
		let cl = smoothstep( 0.5, 0.78, skyFbm( q * vec3f( 3.0, 6.0, 3.0 ) + vec3f( skyParams.planetTime * 0.004, 0.0, 0.0 ), 5 ) );
		var c = mix( vec3f( 0.015, 0.07, 0.2 ), vec3f( 0.2, 0.28, 0.1 ), land );
		return vec4f( mix( c, vec3f( 0.85 ), cl * 0.9 ), 0.0 );
	}
	if ( style == 1 ) {
		// a lava world: black crust, glowing cracks and lakes
		let crust = skyFbm( q * 4.0, 5 );
		let cracks = smoothstep( 0.035, 0.0, abs( skyFbm( q * 6.0 + vec3f( 2.0 ), 4 ) - 0.5 ) );
		return vec4f( vec3f( 0.07, 0.055, 0.05 ) * ( 0.6 + crust ), cracks + smoothstep( 0.64, 0.72, crust ) * 0.6 );
	}
	if ( style == 2 ) {
		// an ice world: white plains, blue fractures
		let cr = smoothstep( 0.03, 0.0, abs( skyFbm( q * 5.0 + vec3f( 9.0 ), 4 ) - 0.5 ) );
		return vec4f( mix( vec3f( 0.8, 0.87, 0.95 ), vec3f( 0.2, 0.42, 0.7 ), cr * 0.85 ) * ( 0.85 + skyFbm( q * 12.0, 3 ) * 0.3 ), 0.0 );
	}
	if ( style == 3 ) {
		// a desert world: dune seas
		let dunes = sin( q.y * 40.0 + skyFbm( q * 6.0, 4 ) * 14.0 ) * 0.5 + 0.5;
		return vec4f( mix( vec3f( 0.55, 0.33, 0.17 ), vec3f( 0.78, 0.56, 0.32 ), dunes * 0.6 ) * ( 0.8 + skyFbm( q * 3.0, 4 ) * 0.4 ), 0.0 );
	}
	if ( style == 4 ) {
		// an eyeball world, tidally locked: an ocean under its sun, ice everywhere else
		let day = dot( n, L ) + ( skyFbm( q * 5.0, 4 ) - 0.5 ) * 0.3;
		let ocean = smoothstep( 0.45, 0.6, day );
		let shore = smoothstep( 0.2, 0.42, day ) * ( 1.0 - ocean );
		let ice = vec3f( 0.82, 0.86, 0.9 ) * ( 0.8 + skyFbm( q * 10.0, 3 ) * 0.3 );
		return vec4f( mix( mix( ice, vec3f( 0.42, 0.3, 0.2 ), shore ), vec3f( 0.02, 0.1, 0.22 ), ocean ), 0.0 );
	}
	// a little violet gas giant
	let lat = q.y + ( skyFbm( q * vec3f( 2.0, 10.0, 2.0 ), 4 ) - 0.5 ) * 0.08;
	return vec4f( mix( vec3f( 0.42, 0.28, 0.58 ), vec3f( 0.78, 0.62, 0.82 ), sin( lat * 18.0 ) * 0.5 + 0.5 ), 0.0 );
}

// another star: a disc with limb darkening and granulation (or a supergiant's huge convection cells)
// and a corona once it is close, a point of light (brightness I) from afar
fn skyStarBody( dir: vec3f, c: vec3f, R: f32, tint: vec3f, k: f32, style: i32, I: f32 ) -> vec3f {
	let cosT = dot( dir, c );
	var col = skyPoint( dir, c, I, tint );
	if ( R < 0.0004 ) { return col; }
	let ang = acos( clamp( cosT, -1.0, 1.0 ) );
	if ( ang > R * 12.0 + 0.2 ) { return col; }
	let lum = 2500.0 * min( 1.0, pow( ${ f( SUN_ANGULAR_RADIUS ) } / R, 1.6 ) + 0.004 ) * k;
	let h = skyBodyHit( dir, c, R );
	if ( h.hit ) {
		let r = ang / R;
		let mu = sqrt( max( 1.0 - r * r, 0.0 ) );
		var surf: vec3f;
		if ( style == 1 ) {
			let q = skySpin( h.n, skyParams.planetTime * 0.004 );
			let cells = skyFbm( q * 2.6 + vec3f( skyParams.planetTime * 0.01 ), 4 );
			let fine = skyFbm( q * 13.0 - vec3f( skyParams.planetTime * 0.03 ), 3 );
			let hot = smoothstep( 0.35, 0.75, cells ) * 0.85 + fine * 0.3;
			surf = mix( tint * vec3f( 0.4, 0.2, 0.16 ), tint * vec3f( 1.25, 1.1, 1.0 ), hot ) * ( 1.0 - 0.75 * ( 1.0 - mu ) );
		} else {
			let gran = 1.0 + ( skyFbm( h.n * 60.0 + vec3f( skyParams.planetTime * 0.05 ), 3 ) - 0.5 ) * 0.5;
			surf = tint * gran * ( 1.0 - 0.6 * ( 1.0 - mu ) );
		}
		col += surf * lum * smoothstep( R, R * 0.985, ang );
	} else {
		let g = exp( -( ang - R ) / max( R * 0.9, 1e-4 ) );
		col += tint * ( g * 0.25 + g * g * 1.5 ) * sqrt( lum ) * 0.15;
	}
	return col;
}

// a glowing gas cloud of unit radius seen from -c * q (from inside when q < 1): rgb emission, a
// transmittance of its dust
fn skyNebulaBody( dir: vec3f, c: vec3f, q: f32, tint: vec3f, style: i32, seed: f32 ) -> vec4f {
	let o = -c * q;
	let b = dot( o, dir );
	let disc = b * b - ( dot( o, o ) - 1.0 );
	if ( disc <= 0.0 ) { return vec4f( 0.0, 0.0, 0.0, 1.0 ); }
	let sq = sqrt( disc );
	let t0 = max( -b - sq, 0.0 );
	let t1 = -b + sq;
	if ( t1 <= 0.0 ) { return vec4f( 0.0, 0.0, 0.0, 1.0 ); }
	let n = 10;
	let dt = ( t1 - t0 ) / f32( n );
	let jit = skyHash13( dir * 911.0 + vec3f( fract( frame.time * 7.1 ) ) );
	var em = vec3f( 0.0 );
	var T = 1.0;
	let sd = vec3f( seed * 0.37, seed * 0.11, seed * 0.23 );
	for ( var i = 0; i < n; i++ ) {
		let p = o + dir * ( t0 + ( f32( i ) + jit ) * dt );
		let r = length( p );
		let nz = skyNoise3( p * 0.9 + sd );
		let nd = skyNoise3( p * 2.7 + sd.yzx );
		var col: vec3f;
		var dust = 0.0;
		if ( style == 1 ) {
			// a supernova remnant: a cage of thin orange filaments in a wobbly shell around a blue
			// synchrotron glow
			let rr = r + ( nz.r - 0.5 ) * 0.3;
			let shell = exp( -pow( ( rr - 0.78 ) / 0.14, 2.0 ) );
			let fil = pow( 1.0 - abs( nd.r * 2.0 - 1.0 ), 18.0 ) * shell * ( 0.5 + nz.g );
			col = mix( vec3f( 1.0, 0.22, 0.05 ), vec3f( 1.0, 0.6, 0.28 ), nz.b ) * fil * 7.0 + vec3f( 0.3, 0.5, 1.0 ) * exp( -r * r * 3.5 ) * ( 0.15 + nz.g * 0.6 ) * 0.7;
		} else {
			// an emission nebula: billows of pink hydrogen, teal oxygen in the hot heart, bright
			// ridges where the starlight hits, dark dust lanes
			let shape = sat( 1.0 - r * r );
			let base = nz.r * 0.6 + nd.r * 0.4;
			let billow = smoothstep( 0.52, 0.85, base );
			let ridge = pow( 1.0 - abs( nd.g * 2.0 - 1.0 ), 10.0 );
			let dens = ( billow * 1.2 + ridge * billow * 4.0 + ridge * 0.3 ) * shape;
			let core = exp( -r * r * 10.0 );
			col = mix( tint, vec3f( 0.15, 0.9, 0.8 ), core * 0.85 ) * dens + vec3f( 1.0, 0.9, 0.8 ) * core * 0.25;
			dust = smoothstep( 0.45, 0.65, nz.g * 0.5 + nd.b * 0.5 ) * shape * 12.0;
		}
		em += col * dt * T;
		T *= exp( -dust * dt );
	}
	return vec4f( em * 0.9, T );
}

// a pulsar: a blinding point and two beams sweeping round (a: beam axis, q: distance in beam lengths)
fn skyPulsar( dir: vec3f, c: vec3f, q: f32, a: vec3f, tint: vec3f, k: f32 ) -> vec3f {
	let seg = skySegment( dir, c * q, a );
	let w = 0.01 + abs( seg.y ) * 0.08;
	let beam = exp( -( seg.x * seg.x ) / ( w * w ) ) * pow( 1.0 - abs( seg.y ), 1.5 );
	// the lighthouse flash when a beam sweeps across the viewer
	let flash = pow( abs( dot( a, c ) ), 80.0 );
	return ( tint * ( beam * 2.5 + flash * 0.4 ) + skyPoint( dir, c, 70.0, tint ) ) * k;
}

// a galaxy of unit radius seen from -c * q: a bulge, a disc with spiral arms (or a bar, or the clumps
// of an irregular), dust lanes and star-forming knots; ellipticals are all bulge. rgb emission, a
// transmittance of the dust
fn skyGalaxy( dir: vec3f, c: vec3f, q: f32, N: vec3f, tint: vec3f, style: i32, seed: f32 ) -> vec4f {
	let o = -c * q;
	if ( q > 1.6 && dot( dir, c ) < cos( asin( 1.6 / q ) ) ) { return vec4f( 0.0, 0.0, 0.0, 1.0 ); }
	let tc = max( -dot( o, dir ), 0.0 );
	let dc = length( o + dir * tc );
	if ( style == 3 ) {
		let g = exp( -pow( dc / 0.45, 0.6 ) * 4.5 );
		return vec4f( tint * g * 2.5, 1.0 );
	}
	var em = vec3f( 1.0, 0.82, 0.6 ) * exp( -pow( dc / 0.08, 0.75 ) * 3.0 ) * select( 3.5, 1.0, style == 2 );
	var T = 1.0;
	let dn = dot( dir, N );
	if ( abs( dn ) > 1e-4 ) {
		let t = -dot( o, N ) / dn;
		let p = o + dir * t;
		var U = cross( N, vec3f( 0.0, 1.0, 0.0 ) );
		if ( dot( U, U ) < 1e-4 ) { U = cross( N, vec3f( 1.0, 0.0, 0.0 ) ); }
		U = normalize( U );
		let V = cross( N, U );
		let x = dot( p, U );
		let y = dot( p, V );
		let r = length( vec2f( x, y ) );
		if ( t > 0.0 && r < 1.4 ) {
			let th = atan2( y, x ) + seed;
			let lr = log( max( r, 0.01 ) );
			let nz = skyNoise3( vec3f( x, y, seed * 0.13 ) * 1.7 );
			var arm: f32;
			if ( style == 2 ) {
				arm = smoothstep( 0.3, 0.75, skyNoise3( vec3f( x * 0.8, y * 0.8, seed * 0.29 ) ).r );
			} else {
				arm = pow( 0.5 + 0.5 * cos( th * 2.0 - lr * 3.4 ), 2.5 );
				if ( style == 1 ) {
					let bx = x * cos( seed ) + y * sin( seed );
					let by = -x * sin( seed ) + y * cos( seed );
					arm = max( arm * smoothstep( 0.12, 0.3, r ), exp( -bx * bx / 0.06 - by * by / 0.004 ) );
				}
			}
			let disk = exp( -r * 3.0 ) * smoothstep( 1.4, 0.8, r );
			let light = disk * ( 0.25 + 1.4 * arm * ( 0.35 + nz.r ) );
			var col = mix( vec3f( 1.0, 0.8, 0.6 ), vec3f( 0.55, 0.7, 1.0 ), sat( arm * 1.4 ) * smoothstep( 0.05, 0.35, r ) ) * light;
			col += vec3f( 1.0, 0.3, 0.55 ) * smoothstep( 0.7, 0.82, nz.g ) * arm * disk * 3.0;
			// resolved stars up close
			let cell = floor( vec2f( x, y ) * 500.0 );
			col += vec3f( 1.0, 0.95, 0.9 ) * step( 0.992, skyHash13( vec3f( cell, seed ) ) ) * disk * 4.0 * sat( 1.5 / q - 0.3 );
			// seen edge on the disc piles up; dust lanes trail the arms
			let proj = min( 1.0 / max( abs( dn ), 0.12 ), 3.5 );
			let lane = select( pow( 0.5 + 0.5 * cos( th * 2.0 - lr * 3.4 - 0.7 ), 6.0 ), smoothstep( 0.6, 0.8, nz.b ), style == 2 );
			let dust = lane * smoothstep( 0.04, 0.25, r ) * disk * 6.0 * ( 0.4 + nz.b );
			T = exp( -dust * proj * 0.3 );
			if ( t < tc ) { em *= T; }
			em += col * proj * 0.8;
		}
	}
	return vec4f( em * tint, T );
}

// a cluster of unit radius seen from -c * q: an unresolved glow (and hot gas) with resolved members
// on a grid of directions: stars for a globular (style 1), galaxies otherwise; the Great Attractor
// (style 2) adds streams of galaxies pouring into its heart
fn skyGalaxySprite( dir: vec3f, cells: f32, fill: f32, seed: f32 ) -> vec3f {
	let a = abs( dir );
	let onX = a.x > a.y && a.x > a.z;
	let onY = a.y > a.z;
	let face = select( select( sign( dir.z ) + 8.0, sign( dir.y ) + 5.0, onY ), sign( dir.x ) + 2.0, onX );
	let g = select( select( dir.xy / a.z, dir.xz / a.y, onY ), dir.yz / a.x, onX ) * cells;
	let cell = vec3f( floor( g ), face + seed );
	if ( skyHash13( cell ) > fill ) { return vec3f( 0.0 ); }
	let fr = fract( g ) - 0.5 - ( vec2f( skyHash13( cell + 3.1 ), skyHash13( cell + 5.3 ) ) - 0.5 ) * 0.5;
	let an = skyHash13( cell + 7.0 ) * 6.283;
	let rot = vec2f( fr.x * cos( an ) + fr.y * sin( an ), -fr.x * sin( an ) + fr.y * cos( an ) );
	let el = 1.0 + skyHash13( cell + 9.0 ) * 2.5;
	let sz = 0.06 + skyHash13( cell + 13.0 ) * 0.12;
	let d2 = ( rot.x * rot.x + rot.y * rot.y * el * el ) / ( sz * sz );
	let hc = skyHash13( cell + 17.0 );
	return select( vec3f( 1.0, 0.85, 0.65 ), vec3f( 0.65, 0.75, 1.0 ), hc < 0.25 ) * exp( -d2 * 2.0 ) * ( 0.6 + hc * 1.5 );
}

fn skyCluster( dir: vec3f, c: vec3f, q: f32, tint: vec3f, style: i32, seed: f32 ) -> vec3f {
	let o = -c * q;
	let b = dot( o, dir );
	let disc = b * b - ( dot( o, o ) - 1.0 );
	if ( disc <= 0.0 ) { return vec3f( 0.0 ); }
	let sq = sqrt( disc );
	let chord = max( -b + sq, 0.0 ) - max( -b - sq, 0.0 );
	if ( chord <= 0.0 ) { return vec3f( 0.0 ); }
	let dc = length( o - dir * b );
	let rc = select( 0.2, 0.07, style == 1 );
	let prof = chord / ( 1.0 + dc * dc / ( rc * rc ) );
	var col = tint * prof * select( select( 0.12, 0.06, style == 2 ), 0.6, style == 1 );
	if ( style == 1 ) {
		// a globular cluster: countless old stars
		let a = abs( dir );
		let onX = a.x > a.y && a.x > a.z;
		let onY = a.y > a.z;
		let face = select( select( sign( dir.z ) + 8.0, sign( dir.y ) + 5.0, onY ), sign( dir.x ) + 2.0, onX );
		let g = select( select( dir.xy / a.z, dir.xz / a.y, onY ), dir.yz / a.x, onX ) * 300.0;
		let cell = vec3f( floor( g ), face + seed );
		if ( skyHash13( cell ) < min( prof * 0.8, 0.85 ) ) {
			let fr = fract( g ) - 0.5 - ( vec2f( skyHash13( cell + 3.1 ), skyHash13( cell + 5.3 ) ) - 0.5 ) * 0.6;
			let hc = skyHash13( cell + 11.0 );
			let sc = select( select( vec3f( 1.0, 0.9, 0.72 ), vec3f( 1.0, 0.5, 0.25 ), hc > 0.86 ), vec3f( 0.6, 0.75, 1.0 ), hc < 0.07 );
			col += sc * exp( -dot( fr, fr ) * 70.0 ) * ( 1.2 + hc * 4.0 );
		}
		return col;
	}
	col += vec3f( 0.45, 0.35, 1.0 ) * prof * 0.08;
	col += skyGalaxySprite( dir, 70.0, min( prof * 0.5, 0.8 ), seed ) * 1.5;
	col += skyGalaxySprite( dir, 170.0, min( prof * 0.4, 0.7 ), seed + 31.0 ) * 0.8;
	if ( style == 2 ) {
		let pc = o - dir * b;
		let rho = length( pc );
		let streams = pow( skyNoise3( normalize( pc + vec3f( 1e-5 ) ) * 0.6 + vec3f( rho * 0.12 ) ).g, 3.0 );
		col += vec3f( 0.75, 0.6, 1.0 ) * streams * exp( -rho * 2.0 ) * 1.2 + vec3f( 1.0, 0.85, 0.95 ) * exp( -rho * rho * 40.0 ) * 0.8;
	}
	return col;
}

// a quasar (style 0) or M87 (style 1): relativistic jets along N with bright knots, radio lobes, the
// host galaxy and a blinding core (q: distance in jet lengths)
fn skyQuasar( dir: vec3f, c: vec3f, q: f32, N: vec3f, tint: vec3f, style: i32, k: f32 ) -> vec3f {
	let p = c * q;
	let seg = skySegment( dir, p, N );
	let s = seg.y;
	let one = select( 1.0, step( 0.0, s ), style == 1 );
	let w = 0.006 + abs( s ) * 0.035;
	let knots = 0.55 + 0.45 * sin( abs( s ) * 38.0 - skyParams.planetTime * 1.5 );
	var col = mix( vec3f( 0.9, 0.95, 1.0 ), vec3f( 0.55, 0.4, 1.0 ), abs( s ) ) * exp( -( seg.x * seg.x ) / ( w * w ) ) * ( 1.0 - abs( s ) * 0.7 ) * knots * 4.0 * one;
	if ( style == 0 ) {
		for ( var i = 0; i < 2; i++ ) {
			let L = p + N * select( -1.0, 1.0, i == 1 );
			let tl = max( dot( dir, L ), 0.0 );
			let dl = length( L - dir * tl );
			col += vec3f( 0.6, 0.35, 1.0 ) * exp( -( dl * dl ) / 0.05 ) * 0.5;
		}
	}
	let tc = max( dot( dir, p ), 0.0 );
	let dc = length( p - dir * tc );
	col += vec3f( 1.0, 0.85, 0.65 ) * exp( -pow( dc / select( 0.07, 0.3, style == 1 ), 0.7 ) * 3.0 ) * select( 1.2, 2.5, style == 1 );
	col += vec3f( 1.0, 0.6, 0.3 ) * exp( -( dc * dc ) / 0.0004 ) * 3.0;
	col += skyPoint( dir, c, select( 90.0, 25.0, style == 1 ), vec3f( 0.85, 0.9, 1.0 ) );
	return col * tint * k;
}

// composite the bodies over the sky radiance base along dir
fn skyBodies( dir: vec3f, base: vec3f ) -> vec3f {
	var col = base;
	let count = skyParams.bodyCount;
	let E = atmosphereParams.sunIlluminance;
	for ( var i = 0u; i < ${ MAX_BODIES }u; i++ ) {
		if ( i >= count ) { break; }
		let bd = skyParams.bodyDir[ i ];
		let info = skyParams.bodyInfo[ i ];
		let light = skyParams.bodyLight[ i ];
		let kind = i32( info.x + 0.5 );
		let c = bd.xyz;
		let R = bd.w;
		let L = light.xyz;
		let ex = skyParams.bodyExtra[ i ];
		let style = i32( info.z + 0.5 );
		if ( kind == 10 ) { col += skyStarBody( dir, c, R, ex.rgb, info.w, style, ex.w ); continue; }
		if ( kind == 12 ) {
			let n = skyNebulaBody( dir, c, ex.w, ex.rgb, style, info.y );
			col = col * n.a + n.rgb * info.w;
			continue;
		}
		if ( kind == 13 ) { col += skyPulsar( dir, c, ex.w, L, ex.rgb, info.w ); continue; }
		if ( kind == 14 ) {
			let g = skyGalaxy( dir, c, ex.w, L, ex.rgb, style, info.y );
			col = col * g.a + g.rgb * info.w;
			continue;
		}
		if ( kind == 15 ) { col += skyCluster( dir, c, ex.w, ex.rgb, style, info.y ) * info.w; continue; }
		if ( kind == 16 ) { col += skyQuasar( dir, c, ex.w, L, ex.rgb, style, info.w ); continue; }
		if ( kind >= 17 ) { continue; }
		if ( kind == 8 ) {
			// black hole: shadow, photon ring, accretion disk
			let h = skyBodyHit( dir, c, R * 2.6 );
			let ang = h.ang / R;
			let side = dot( normalize( dir - c * dot( dir, c ) ), normalize( cross( c, vec3f( 0.0, 1.0, 0.1 ) ) ) );
			// disk: an ellipse-ish band around the shadow, with a lensed arc above it
			let up = abs( dot( normalize( dir - c * dot( dir, c ) + vec3f( 1e-6 ) ), vec3f( 0.0, 1.0, 0.0 ) ) );
			let band = exp( - pow( ( ang * ( 0.35 + up * 0.9 ) - 3.4 ), 2.0 ) * 1.6 ) * ( 1.0 - up * 0.4 );
			let arc = exp( - pow( ang - 3.0, 2.0 ) * 8.0 ) * 0.7;
			let doppler = 1.0 + side * 0.7;
			let heat = vec3f( 1.0, 0.62, 0.3 ) * band * doppler + vec3f( 1.0, 0.85, 0.7 ) * arc;
			let ring = exp( - pow( ang - 2.62, 2.0 ) * 60.0 ) * 2.0;
			col += ( heat * 18.0 + vec3f( 1.0, 0.9, 0.8 ) * ring * 30.0 ) * info.w;
			if ( ang < 2.6 ) { col = col * smoothstep( 2.4, 2.6, ang ) + vec3f( 1.0, 0.9, 0.8 ) * ring * 30.0 * info.w; }
			continue;
		}
		// rings behind the planet (Saturn): drawn first, the planet covers them
		var ringCol = vec3f( 0.0 ); var ringA = 0.0; var ringFront = false;
		if ( kind == 4 ) {
			let tilt = info.z;
			let N = normalize( vec3f( 0.0, cos( tilt ), sin( tilt ) ) );
			// camera at -c / sin( R ) in units of the planet radius
			let o = - c / max( sin( R ), 1e-7 );
			let dn = dot( dir, N );
			if ( abs( dn ) > 1e-5 ) {
				let t = - dot( o, N ) / dn;
				let p = o + dir * t;
				let r = length( p );
				if ( t > 0.0 && r > 1.25 && r < 2.3 ) {
					let rr = ( r - 1.25 ) / 1.05;
					let gap = smoothstep( 0.52, 0.55, rr ) * smoothstep( 0.62, 0.59, rr );
					let dens = ( 0.55 + 0.45 * sin( rr * 60.0 ) * sin( rr * 13.0 ) ) * ( 1.0 - gap * 0.9 ) * smoothstep( 1.0, 0.9, rr );
					// the planet's shadow on the rings
					let shadowed = select( 1.0, 0.15, dot( p, L ) < 0.0 && length( p - L * dot( p, L ) ) < 1.0 );
					ringCol = vec3f( 0.85, 0.76, 0.6 ) * E * max( abs( dot( N, L ) ), 0.15 ) * INV_PI * 0.9 * shadowed * info.w;
					ringA = dens * 0.85;
					// in front of the planet when closer than its hit point
					let oc = dot( o, dir );
					let tp = - oc - sqrt( max( 1.0 - ( dot( o, o ) - oc * oc ), 0.0 ) );
					ringFront = t < tp || ( dot( o, o ) - oc * oc ) > 1.0;
				}
			}
		}
		let h = skyBodyHit( dir, c, R );
		if ( ringA > 0.0 && ! ringFront ) { col = mix( col, ringCol, ringA ); }
		if ( h.hit ) {
			var surf: vec3f;
			if ( kind == 7 ) {
				let alb = skyEarthAlbedo( h.n, skyParams.planetTime );
				surf = skySurfaceLight( h.n, L, dir, alb, 1.0 ) * info.w;
			} else if ( kind == 11 ) {
				let a = skyExoAlbedo( style, h.n, info.y, L );
				let NdL = dot( h.n, L );
				surf = a.rgb * ex.rgb * E * max( NdL, 0.0 ) * INV_PI * info.w + a.rgb * 0.0004 + vec3f( 1.0, 0.35, 0.08 ) * a.a * 0.8;
				let rimE = pow( 1.0 - sat( dot( h.n, -dir ) ), 3.0 ) * sat( NdL + 0.3 );
				if ( style == 0 || style == 4 ) { surf += vec3f( 0.3, 0.5, 1.0 ) * rimE * E * 0.05 * info.w * ex.rgb; }
			} else {
				let alb = skyBodyAlbedo( kind, h.n, info.y );
				let NdL = dot( h.n, L );
				surf = alb * E * max( NdL, 0.0 ) * INV_PI * info.w + alb * 0.0004;
			}
			// thin atmospheres glow at the limb (Earth, Mars, gas giants)
			let rim = pow( 1.0 - sat( dot( h.n, -dir ) ), 3.0 ) * sat( dot( h.n, L ) + 0.3 );
			if ( kind == 7 ) { surf += vec3f( 0.25, 0.45, 1.0 ) * rim * E * 0.08 * info.w; }
			if ( kind == 2 ) { surf += vec3f( 0.9, 0.5, 0.35 ) * rim * E * 0.02 * info.w; }
			if ( kind == 3 || kind == 4 || kind == 5 ) { surf += vec3f( 0.5, 0.6, 0.9 ) * rim * E * 0.02 * info.w; }
			let edge = smoothstep( R, R * 0.985, h.ang );
			col = mix( col, surf, edge );
		} else if ( kind == 7 || kind == 2 ) {
			// atmosphere halo just outside the limb
			let halo = exp( - ( h.ang - R ) / ( R * 0.03 ) ) * step( R, h.ang );
			col += select( vec3f( 0.9, 0.5, 0.35 ) * 0.02, vec3f( 0.25, 0.45, 1.0 ) * 0.08, kind == 7 ) * halo * E * 0.5 * info.w;
		}
		if ( ringA > 0.0 && ringFront ) { col = mix( col, ringCol, ringA ); }
	}
	return col;
}

// black holes bend the light of what lies behind them
fn skyLens( dir: vec3f ) -> vec3f {
	var d = dir;
	for ( var i = 0u; i < ${ MAX_BODIES }u; i++ ) {
		if ( i >= skyParams.bodyCount ) { break; }
		if ( i32( skyParams.bodyInfo[ i ].x + 0.5 ) != 8 ) { continue; }
		let c = skyParams.bodyDir[ i ].xyz;
		let R = skyParams.bodyDir[ i ].w;
		let cosT = dot( d, c );
		let ang = acos( clamp( cosT, -1.0, 1.0 ) );
		if ( cosT > 0.0 && ang < R * 30.0 ) {
			let perp = normalize( d - c * cosT + vec3f( 1e-7 ) );
			let bend = R * R * 4.0 / max( ang, R * 0.5 );
			d = normalize( c * cos( ang + bend ) + perp * sin( ang + bend ) );
		}
	}
	return d;
}

// Everything behind the clouds except the sun and moon disks
fn skyBackground( dir: vec3f, starK: f32 ) -> vec3f {
	let atm = 1.0 - skyParams.spaceMix;
	var L = vec3f( 0.0 );
	if ( atm > 0.0 ) { L = ( atmosphereSkyLuminance( dir ) + skyGroundRadiance( dir ) ) * atm; }
	if ( skyParams.starIntensity > 0.001 ) {
		// the planet hides the stars behind it
		let occ = select( 1.0, 0.0, skyGroundHit( dir ) > 0.0 && atm > 0.5 );
		L += ( skyMoonSky( dir ) * atm + skyStars( dir ) * starK + skyNebula( dir ) ) * occ;
	}
	if ( skyParams.spaceMix > 0.5 ) { L += skyDeepField( dir ) + skyWeb( dir ) + skyCMB( dir ); }
	L += skyAurora( dir ) * atm;
	return L;
}

fn skyRadiance( dir: vec3f, withSun: bool ) -> vec3f {
	var L = skyBackground( dir, 1.0 ) + skyMoon( dir );
	if ( withSun ) { L += skySunDisk( dir ); }
	return skyBodies( dir, L );
}

fn skyRadianceWithClouds( dir: vec3f, withSun: bool ) -> vec3f {
	var base: vec3f;
	if ( withSun ) { base = skyBackground( dir, 1.0 ) + skyMoon( dir ) + skySunDisk( dir ); }
	else { base = skyBackground( dir, ${ f( STAR_REFLECTION ) } ); }
	base = skyBodies( dir, base );
	${ composite( 'cloudsSample' ) }
}

fn skyReflectionRadiance( dir: vec3f ) -> vec3f {
	let base = skyBackground( dir, ${ f( STAR_REFLECTION ) } );
	${ composite( 'cloudsSample' ) }
}

// Main view background: lensed stars, bodies, full resolution clouds
fn skyViewRadiance( dir0: vec3f ) -> vec3f {
	let dir = skyLens( dir0 );
	var base = skyBackground( dir, 1.0 ) + skyMoon( dir ) + skySunDisk( dir );
	base = skyBodies( dir0, base ) + skyTunnel( dir0 );
	let dirC = dir0;
	${ clouds ? `let c = cloudsSampleView( dirC );\n\treturn mix( base, base * c.a + c.rgb, skyParams.cloudMix );` : 'return base;' }
}
`,
		} );

	}

	get background() {

		if ( ! this._background ) {

			const pass = new FullscreenPass( {
				label: 'sky background',
				modules: [ this.module ],
				colorFormats: SCENE_FORMATS,
				depthFormat: DEPTH_FORMAT,
				depthCompare: 'equal',
				depthWrite: false,
				depth: 0,
				code: /* wgsl */`
struct SkyOut {
	@location( 0 ) color: vec4f,
	@location( 1 ) velocity: vec4f,
	@location( 2 ) mask: vec4f,
};
@fragment fn fs( in: FSIn ) -> SkyOut {
	let uv = in.pos.xy * frame.invResolution;
	let dir = viewRay( uv );
	var o: SkyOut;
	o.color = vec4f( min( skyViewRadiance( dir ), vec3f( 60000.0 ) ), 1.0 );
	let c = frame.viewProjNoJitter * vec4f( dir, 0.0 );
	let p = frame.prevViewProjNoJitter * vec4f( dir, 0.0 );
	let cur = c.xy / max( abs( c.w ), 1e-6 ) * sign( c.w );
	let prev = p.xy / max( abs( p.w ), 1e-6 ) * sign( p.w );
	o.velocity = vec4f( select( vec2f( 0.0 ), ( cur - prev ) * vec2f( 0.5, -0.5 ), c.w > 1e-6 && p.w > 1e-6 ), 0.0, 1.0 );
	o.mask = vec4f( 0.0 );
	return o;
}
`,
			} );
			this._background = { pass, draw: ( rp ) => pass.draw( rp ) };

		}

		return this._background;

	}

	backgroundNode() {

		return this.background;

	}

}

export function sunDirectionFromTime( hours, latitudeDeg = 24, declinationDeg = 6, out = new Vector3() ) {

	const phi = MathUtils.degToRad( latitudeDeg );
	const dec = MathUtils.degToRad( declinationDeg );
	const H = MathUtils.degToRad( ( hours - 12 ) * 15 );
	const east = - Math.cos( dec ) * Math.sin( H );
	const north = Math.cos( phi ) * Math.sin( dec ) - Math.sin( phi ) * Math.cos( dec ) * Math.cos( H );
	const up = Math.sin( phi ) * Math.sin( dec ) + Math.cos( phi ) * Math.cos( dec ) * Math.cos( H );
	return out.set( east, up, - north ).normalize();

}
