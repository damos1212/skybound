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
//   - space backdrops: up to 8 bodies (Moon, Mars, Jupiter, Saturn and its rings, Neptune, a Kuiper
//     world, the Earth as a far marble, a black hole with lensing and an accretion disk) and a nebula
//   - the volumetric clouds composited in (faded out by `cloudMix` above the cloud heights)
//
// WGSL module (`sky.module`, prefix `sky`): skyRadiance, skyRadianceWithClouds, skyReflectionRadiance,
// skyViewRadiance, skyGroundRadiance( dir ) (the planet below, or 0 when the ray misses it),
// skyGroundHit( dir ) -> f32 (km, -1 on a miss).

const STAR_CELLS = 160;
const STAR_SIGMA = 0.1;
const MW = new Vector3( 0.3, 0.2, 1 ).normalize();
const STAR_REFLECTION = 0.08;
export const MAX_BODIES = 8;

export const BODY = { moon: 1, mars: 2, jupiter: 3, saturn: 4, neptune: 5, earth: 7, blackhole: 8, kuiper: 9 };

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
			// aurora curtains (0..1): night skies and the edge of space
			aurora: [ 'f32', 0 ],
			bodyCount: [ 'u32', 0 ],
			pad0: [ 'f32', 0 ],
			// per body: xyz direction from the camera (unit), w angular radius (rad)
			bodyDir: [ 'vec4f[8]', v4s() ],
			// x type, y spin (rad), z ring tilt / spare, w brightness
			bodyInfo: [ 'vec4f[8]', v4s() ],
			// xyz direction toward the sun at the body, w distance (km, for the black hole lensing)
			bodyLight: [ 'vec4f[8]', v4s() ],
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
		this._module = null;
		this._background = null;

	}

	// bodies: [ { type, dir: Vector3 (unit, from the camera), angle (rad), spin, tilt, light: Vector3, brightness } ]
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
	return c;
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
	return ( star + glow ) * skyParams.starIntensity * horizon;
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
	base = skyBodies( dir0, base );
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
