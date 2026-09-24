import { Mesh } from '../engine/scene/Mesh.js';
import { Group } from '../engine/scene/Group.js';
import { BufferGeometry, Float32BufferAttribute, BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, IcosahedronGeometry, RoundedBoxGeometry, TorusGeometry } from '../engine/geometry/index.js';
import { Material } from '../engine/render/Material.js';
import { ShaderModule } from '../engine/gpu/Shader.js';
import { Color, Vector3, MathUtils } from '../engine/math/index.js';
import { ToyBuilder, toyMaterials } from './Toy.js';

// The launch island: an analytic heightfield (the same function in JS and WGSL, so the ocean can
// shade its shallows and surf line without a texture), a vertex-coloured terrain mesh and toy props:
// the launch pad on the beach, the workshop, a lighthouse, palms and rocks.
//
// World frame: gameplay happens in the z = 0 plane (x right, y up), the camera sits on +z looking
// toward -z. The island lies behind the plane, its south beach crossing it at the launch pad (0, 0).

const ISLAND = {
	center: [ - 40, - 190 ], radii: [ 380, 240 ],
	hills: [ [ - 120, - 300, 165, 72 ], [ 125, - 335, 110, 40 ], [ - 300, - 210, 90, 22 ] ],
};

export const LAUNCH = { x: 0, deckY: 3.2, z: 0 };
// the rocket / starship launch barge, anchored in deeper water east of the beach
export const BARGE = { x: 150, deckY: 3.3, z: 0 };

// ---- height function (keep in sync with ISLAND_WGSL)
export function islandHeight( x, z ) {

	const ex = ( x - ISLAND.center[ 0 ] ) / ISLAND.radii[ 0 ], ez = ( z - ISLAND.center[ 1 ] ) / ISLAND.radii[ 1 ];
	const de = Math.sqrt( ex * ex + ez * ez );
	const mask = smooth( 1.05, 0.7, de );
	// (beyond the island's shelf the seabed drops away to the deep ocean)
	let h = - 14 + 15.2 * mask - 60 * smooth( 1.15, 1.8, de );
	for ( const [ cx, cz, r, a ] of ISLAND.hills ) {

		const dx = x - cx, dz = z - cz;
		h += a * Math.exp( - ( dx * dx + dz * dz ) / ( r * r ) ) * mask;

	}

	h += ( 3.0 * Math.sin( x * 0.021 + z * 0.013 ) * Math.sin( z * 0.017 - x * 0.011 ) + 1.2 * Math.sin( x * 0.052 ) * Math.sin( z * 0.047 ) ) * mask * mask;
	// the launch beach: a flat sand shelf around the pad
	const pd = Math.hypot( x - LAUNCH.x, ( z - LAUNCH.z + 18 ) * 1.3 );
	h = MathUtils.lerp( h, Math.max( h, 1.4 ), smooth( 45, 20, pd ) );
	return h;

}

function smooth( e0, e1, x ) {

	const t = MathUtils.clamp( ( x - e0 ) / ( e1 - e0 ), 0, 1 );
	return t * t * ( 3 - 2 * t );

}

const f = ( x ) => ( Number.isInteger( x ) ? x + '.0' : String( x ) );

export const islandModule = new ShaderModule( {
	name: 'island',
	code: /* wgsl */`
fn islandHeight( p: vec2f ) -> f32 {
	let e = ( p - vec2f( ${ f( ISLAND.center[ 0 ] ) }, ${ f( ISLAND.center[ 1 ] ) } ) ) / vec2f( ${ f( ISLAND.radii[ 0 ] ) }, ${ f( ISLAND.radii[ 1 ] ) } );
	let de = length( e );
	let mask = smoothstep( 1.05, 0.7, de );
	var h = -14.0 + 15.2 * mask - 60.0 * smoothstep( 1.15, 1.8, de );
${ ISLAND.hills.map( ( [ cx, cz, r, a ] ) => `	{ let d = p - vec2f( ${ f( cx ) }, ${ f( cz ) } ); h += ${ f( a ) } * exp( - dot( d, d ) / ${ f( r * r ) } ) * mask; }` ).join( '\n' ) }
	h += ( 3.0 * sin( p.x * 0.021 + p.y * 0.013 ) * sin( p.y * 0.017 - p.x * 0.011 ) + 1.2 * sin( p.x * 0.052 ) * sin( p.y * 0.047 ) ) * mask * mask;
	let pd = length( vec2f( p.x - ${ f( LAUNCH.x ) }, ( p.y - ${ f( LAUNCH.z ) } + 18.0 ) * 1.3 ) );
	h = mix( h, max( h, 1.4 ), smoothstep( 45.0, 20.0, pd ) );
	return h;
}

fn islandHash( p: vec2f ) -> f32 {
	var q = fract( p * vec2f( 123.34, 456.21 ) );
	q += dot( q, q + 45.32 );
	return fract( q.x * q.y );
}
fn islandNoise( p: vec2f ) -> f32 {
	let i = floor( p );
	let f = fract( p );
	let u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( islandHash( i ), islandHash( i + vec2f( 1.0, 0.0 ) ), u.x ), mix( islandHash( i + vec2f( 0.0, 1.0 ) ), islandHash( i + vec2f( 1.0, 1.0 ) ), u.x ), u.y );
}
fn islandFbm( p: vec2f ) -> f32 {
	return islandNoise( p ) * 0.55 + islandNoise( p * 2.07 + vec2f( 5.2, 1.3 ) ) * 0.3 + islandNoise( p * 4.13 + vec2f( 2.7, 8.1 ) ) * 0.15;
}
// gradient of a noise layer (for detail normals)
fn islandNoiseGrad( p: vec2f, k: f32 ) -> vec2f {
	let e = 0.12;
	let c = islandNoise( p * k );
	return vec2f( islandNoise( ( p + vec2f( e, 0.0 ) ) * k ) - c, islandNoise( ( p + vec2f( 0.0, e ) ) * k ) - c ) / e;
}

// the island's normal per pixel (finer than its mesh)
fn islandNormal( p: vec2f ) -> vec3f {
	let e = 0.35;
	let hx = islandHeight( p + vec2f( e, 0.0 ) ) - islandHeight( p - vec2f( e, 0.0 ) );
	let hz = islandHeight( p + vec2f( 0.0, e ) ) - islandHeight( p - vec2f( 0.0, e ) );
	return normalize( vec3f( -hx, 2.0 * e, -hz ) );
}

struct IslandGround { albedo: vec3f, rough: f32, normal: vec3f, wet: f32 };

// what the ground looks like at real position p (xz), height h (m above the sea), normal n: dry and
// wet sand with wind ripples, the seabed with its own ripples and seagrass, grass with patches, dry
// spots and flowers, rock on the steep slopes. Fine detail fades with the viewing distance.
fn islandGround( p: vec2f, h: f32, n: vec3f, dist: f32 ) -> IslandGround {
	var g: IslandGround;
	let near = 1.0 - smoothstep( 25.0, 140.0, dist );
	let mid = 1.0 - smoothstep( 250.0, 1400.0, dist );
	let slope = 1.0 - n.y;
	let big = islandFbm( p * 0.035 );
	let small = islandFbm( p * 0.27 + vec2f( 7.0, 3.0 ) );
	var dN = vec2f( 0.0 );

	// sand: ripples across the wind, grains, darker and glossy where the swash keeps it wet
	let wind = normalize( vec2f( 0.35, 0.94 ) );
	let rp = dot( p, wind ) * 2.4 + islandNoise( p * 0.35 ) * 5.0;
	let ripple = sin( rp );
	var sand = vec3f( 0.84, 0.64, 0.33 ) * ( 0.9 + small * 0.18 ) * ( 0.96 + ripple * 0.04 * near );
	sand *= 0.93 + islandHash( floor( p * 30.0 ) ) * 0.14 * near;
	dN += wind * cos( rp ) * 0.12 * near;
	let wet = smoothstep( 1.1, 0.25, h );
	sand = mix( sand, sand * vec3f( 0.5, 0.48, 0.46 ), wet );

	// the seabed: paler sand in big ripples, darker with depth, patches of seagrass
	let bp = dot( p, vec2f( 0.8, 0.6 ) ) * 0.9 + islandNoise( p * 0.12 ) * 6.0;
	let seagrass = smoothstep( 0.62, 0.72, islandFbm( p * 0.06 + vec2f( 3.0 ) ) ) * smoothstep( -1.5, -3.5, h );
	var bed = vec3f( 0.62, 0.52, 0.3 ) * ( 0.88 + small * 0.2 ) * ( 0.95 + sin( bp ) * 0.05 );
	bed = mix( bed, vec3f( 0.09, 0.14, 0.05 ) * ( 0.7 + small * 0.6 ), seagrass );
	bed = mix( bed, bed * 0.75, smoothstep( -2.0, -12.0, h ) );

	// grass: two greens in big patches, dry yellow spots, blades, flowers
	var grass = mix( vec3f( 0.13, 0.36, 0.05 ), vec3f( 0.05, 0.2, 0.03 ), big );
	grass = mix( grass, vec3f( 0.36, 0.34, 0.1 ), smoothstep( 0.58, 0.78, small ) * 0.55 );
	grass *= 0.85 + islandNoise( p * 3.1 ) * 0.3 * near;
	let fl = islandHash( floor( p * 3.0 ) + vec2f( 17.0 ) );
	let flowerCol = select( select( vec3f( 0.95, 0.9, 0.85 ), vec3f( 0.95, 0.75, 0.1 ), fl > 0.9935 ), vec3f( 0.9, 0.3, 0.55 ), fl > 0.997 );
	let fp = fract( p * 3.0 ) - 0.5;
	let flower = step( 0.99, fl ) * smoothstep( 0.2, 0.08, length( fp ) ) * near;
	grass = mix( grass, flowerCol, flower );
	let gN = ( islandNoiseGrad( p, 5.5 ) * 0.06 + islandNoiseGrad( p, 0.8 ) * 0.1 ) * near;

	// rock: grey strata, a little lichen
	let strata = sin( h * 2.6 + islandNoise( p * 0.2 ) * 4.0 ) * 0.5 + 0.5;
	var rock = mix( vec3f( 0.22, 0.2, 0.18 ), vec3f( 0.33, 0.3, 0.26 ), strata ) * ( 0.85 + small * 0.3 );
	rock = mix( rock, vec3f( 0.3, 0.32, 0.12 ), smoothstep( 0.62, 0.75, islandFbm( p * 0.5 ) ) * 0.4 );
	let rN = islandNoiseGrad( p, 0.9 ) * 0.5 * mid;

	// layers: seabed -> wet sand -> dry sand -> grass (ragged edge), rock on steep slopes
	var alb = mix( bed, sand, smoothstep( -0.6, 0.0, h ) );
	var rough = mix( 0.8, mix( 0.9, 0.35, wet ), smoothstep( -0.6, 0.0, h ) );
	let gK = smoothstep( 2.4, 4.2, h + ( big - 0.5 ) * 3.0 + small * 0.8 ) * ( 1.0 - smoothstep( 0.25, 0.45, slope ) );
	alb = mix( alb, grass, gK );
	rough = mix( rough, 0.95, gK );
	dN = mix( dN, gN, gK );
	let rK = smoothstep( 0.3, 0.52, slope + ( small - 0.5 ) * 0.15 ) * smoothstep( 2.0, 6.0, h );
	alb = mix( alb, rock, rK );
	rough = mix( rough, 0.75, rK );
	dN = mix( dN, rN, rK );

	g.albedo = alb;
	g.rough = rough;
	g.wet = wet * ( 1.0 - gK );
	g.normal = normalize( n + vec3f( -dN.x, 0.0, -dN.y ) );
	return g;
}

// caustics on the seabed: two drifting networks of bright lines (the edges of animated cells)
fn islandCausticLayer( p: vec2f, t: f32 ) -> f32 {
	let i = floor( p );
	let f = fract( p );
	var d1 = 8.0;
	var d2 = 8.0;
	for ( var y = -1; y <= 1; y++ ) {
		for ( var x = -1; x <= 1; x++ ) {
			let g = vec2f( f32( x ), f32( y ) );
			let h = vec2f( islandHash( i + g ), islandHash( i + g + vec2f( 31.0, 17.0 ) ) );
			let o = 0.5 + 0.42 * sin( t * ( 0.6 + h * 0.5 ) + h * 6.2831 );
			let d = length( g + o - f );
			if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) { d2 = d; }
		}
	}
	return 1.0 - smoothstep( 0.0, 0.16, d2 - d1 );
}
fn islandCaustics( p: vec2f, t: f32 ) -> f32 {
	let a = islandCausticLayer( p * 0.55, t * 0.9 );
	let b = islandCausticLayer( p * 0.55 * 1.37 + vec2f( 3.7, 1.3 ), t * 1.1 + 2.0 );
	return a * b * 2.2 + ( a + b ) * 0.22;
}
`,
} );

// ---- terrain

const SAND = new Color().setRGB( 0.93, 0.83, 0.6, 'srgb' );
const WET = new Color().setRGB( 0.7, 0.6, 0.42, 'srgb' );
const GRASS = new Color().setRGB( 0.38, 0.66, 0.26, 'srgb' );
const GRASS2 = new Color().setRGB( 0.24, 0.5, 0.2, 'srgb' );
const ROCK = new Color().setRGB( 0.55, 0.5, 0.46, 'srgb' );
const SEABED = new Color().setRGB( 0.78, 0.72, 0.55, 'srgb' );

function buildTerrain() {

	const x0 = - 560, x1 = 480, z0 = - 600, z1 = 70, step = 4;
	const nx = Math.round( ( x1 - x0 ) / step ) + 1, nz = Math.round( ( z1 - z0 ) / step ) + 1;
	const pos = new Float32Array( nx * nz * 3 ), nrm = new Float32Array( nx * nz * 3 ), col = new Float32Array( nx * nz * 4 );
	const c = new Color();
	for ( let j = 0; j < nz; j ++ ) for ( let i = 0; i < nx; i ++ ) {

		const x = x0 + i * step, z = z0 + j * step;
		const h = islandHeight( x, z );
		const k = j * nx + i;
		pos.set( [ x, h, z ], k * 3 );
		const e = 0.5;
		const hx = islandHeight( x + e, z ) - islandHeight( x - e, z ), hz = islandHeight( x, z + e ) - islandHeight( x, z - e );
		const n = new Vector3( - hx, 2 * e, - hz ).normalize();
		nrm.set( [ n.x, n.y, n.z ], k * 3 );
		const slope = 1 - n.y;
		const v = Math.sin( x * 0.11 + Math.sin( z * 0.07 ) * 3 ) * 0.5 + 0.5;
		if ( h < - 0.2 ) c.copy( SEABED ).lerp( WET, MathUtils.clamp( ( h + 3 ) / 3, 0, 1 ) );
		else if ( h < 0.8 ) c.copy( WET ).lerp( SAND, MathUtils.clamp( ( h + 0.2 ) / 1.0, 0, 1 ) );
		else c.copy( SAND );
		const g = smooth( 2.6, 4.5, h + v * 1.5 ) * ( 1 - smooth( 0.25, 0.45, slope ) );
		c.lerp( new Color().copy( GRASS ).lerp( GRASS2, v * 0.8 + smooth( 20, 60, h ) * 0.4 ), g );
		c.lerp( ROCK, smooth( 0.3, 0.55, slope ) * smooth( 2, 6, h ) );
		col.set( [ c.r, c.g, c.b, 1 ], k * 4 );

	}

	const idx = [];
	for ( let j = 0; j < nz - 1; j ++ ) for ( let i = 0; i < nx - 1; i ++ ) {

		const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
		// skip cells entirely deep under the sea (the ocean is opaque there)
		if ( pos[ a * 3 + 1 ] < - 9 && pos[ b * 3 + 1 ] < - 9 && pos[ d * 3 + 1 ] < - 9 && pos[ e * 3 + 1 ] < - 9 ) continue;
		idx.push( a, d, b, b, d, e );

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new Float32BufferAttribute( nrm, 3 ) );
	g.setAttribute( 'color', new Float32BufferAttribute( col, 4 ) );
	g.setIndex( idx );
	g.computeBoundingBox();
	g.computeBoundingSphere();
	return g;

}

// ---- props

function rng( seed ) {

	let s = seed >>> 0;
	return () => {

		s = ( s + 0x6D2B79F5 ) >>> 0;
		let t = s;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

function launchPad( b ) {

	const { x, deckY, z } = LAUNCH;
	const wood = 0x9a6b43, dark = 0x6e4a2c;
	// stilts
	for ( const sx of [ - 5, 0, 5 ] ) for ( const sz of [ - 5, 0, 5 ] ) {

		const gy = islandHeight( x + sx, z + sz );
		const h = deckY - gy + 0.5;
		b.add( new CylinderGeometry( 0.28, 0.32, h, 8 ), { position: [ x + sx, gy + h / 2 - 0.5, z + sz ], color: dark } );

	}

	// deck: planks
	for ( let i = - 6; i <= 6; i ++ ) b.add( new RoundedBoxGeometry( 1.0, 0.3, 12.5, 1, 0.08 ), { position: [ x + i * 1.02, deckY, z ], color: i % 2 ? wood : 0xa87650, jitter: 0.15 } );
	// launch ring: painted target on the deck
	b.add( new CylinderGeometry( 3.2, 3.2, 0.06, 40 ), { position: [ x, deckY + 0.18, z ], color: 0xf4efe6 } );
	b.add( new CylinderGeometry( 2.5, 2.5, 0.07, 40 ), { position: [ x, deckY + 0.19, z ], color: 0xe2463a } );
	b.add( new CylinderGeometry( 1.6, 1.6, 0.08, 40 ), { position: [ x, deckY + 0.2, z ], color: 0xf4efe6 } );
	// railing
	for ( const sz of [ - 6.1, 6.1 ] ) {

		for ( let i = - 6; i <= 6; i += 2 ) b.add( new CylinderGeometry( 0.09, 0.09, 1.1, 6 ), { position: [ x + i, deckY + 0.7, z + sz ], color: 0xf4efe6 } );
		b.add( new CylinderGeometry( 0.08, 0.08, 12.4, 6 ), { position: [ x, deckY + 1.25, z + sz ], rotation: [ 0, 0, Math.PI / 2 ], color: 0xf4efe6 } );

	}

	// steps down to the sand (toward the island)
	for ( let i = 0; i < 5; i ++ ) b.add( new BoxGeometry( 2.4, 0.25, 1.0 ), { position: [ x - 3, deckY - 0.5 - i * 0.55, z - 6.9 - i * 0.9 ], color: wood } );

}

function hangar( b, x, z, yaw ) {

	const y = islandHeight( x, z );
	const place = ( lx, ly, lz ) => {

		const c = Math.cos( yaw ), s = Math.sin( yaw );
		return [ x + lx * c + lz * s, y + ly, z - lx * s + lz * c ];

	};

	// foundation
	b.add( new BoxGeometry( 22, 1.2, 16 ), { position: place( 0, 0, 0 ), rotation: [ 0, yaw, 0 ], color: 0xcfc6b8 } );
	// walls (warm cream) and a big door
	b.add( new BoxGeometry( 20, 8, 14 ), { position: place( 0, 4.5, 0 ), rotation: [ 0, yaw, 0 ], color: 0xf1e6cf } );
	b.add( new BoxGeometry( 10, 6.5, 0.3 ), { position: place( 0, 3.8, 7.05 ), rotation: [ 0, yaw, 0 ], color: 0x3a6ea5 } );
	for ( let i = - 4; i <= 4; i ++ ) b.add( new BoxGeometry( 0.12, 6.5, 0.1 ), { position: place( i * 1.1, 3.8, 7.25 ), rotation: [ 0, yaw, 0 ], color: 0x2d5680 } );
	// barrel roof (half cylinder), bright red
	b.add( new CylinderGeometry( 7.6, 7.6, 21, 24, 1, false, - Math.PI / 2, Math.PI ), { position: place( 0, 8.4, 0 ), rotation: [ 0, yaw, Math.PI / 2 ], scale: [ 1, 1, 0.55 ], color: 0xd9412f } );
	// sign
	b.add( new RoundedBoxGeometry( 8, 1.6, 0.4, 2, 0.15 ), { position: place( 0, 10.6, 7.2 ), rotation: [ 0, yaw, 0 ], color: 0xffcf3f } );
	// windows
	for ( const lx of [ - 8, 8 ] ) b.add( new BoxGeometry( 2.6, 2.2, 0.2 ), { position: place( lx, 5, 7.05 ), rotation: [ 0, yaw, 0 ], color: 0x9fd4ea } );
	// fuel tanks beside it
	for ( let i = 0; i < 3; i ++ ) b.add( new CylinderGeometry( 1.1, 1.1, 3.4, 16 ), { position: place( 12.4, 2.2, - 4 + i * 2.6 ), color: [ 0xe8e2d6, 0xd9412f, 0xe8e2d6 ][ i ] } );

}

function lighthouse( b, x, z ) {

	const y = islandHeight( x, z ) - 0.5;
	b.add( new CylinderGeometry( 5.5, 6, 2, 20 ), { position: [ x, y + 1, z ], color: 0xcfc6b8 } );
	const bands = 7, hTot = 26;
	for ( let i = 0; i < bands; i ++ ) {

		const r0 = 3.6 - i * 0.22, r1 = 3.6 - ( i + 1 ) * 0.22;
		b.add( new CylinderGeometry( r1, r0, hTot / bands, 20 ), { position: [ x, y + 2 + ( i + 0.5 ) * hTot / bands, z ], color: i % 2 ? 0xd9412f : 0xf6f1e7 } );

	}

	const top = y + 2 + hTot;
	b.add( new CylinderGeometry( 3.2, 3.2, 0.6, 20 ), { position: [ x, top + 0.3, z ], color: 0x2b2f36 } );
	b.add( new CylinderGeometry( 2, 2, 3, 16 ), { position: [ x, top + 2.1, z ], color: 0xbfe6f5 } );
	b.add( new ConeGeometry( 2.6, 2.4, 16 ), { position: [ x, top + 4.8, z ], color: 0xd9412f } );
	b.add( new SphereGeometry( 0.5, 10, 8 ), { position: [ x, top + 6.2, z ], color: 0x2b2f36 } );
	return new Vector3( x, top + 2.1, z );

}

function palm( b, x, z, r, f = b ) {

	const y = islandHeight( x, z ) - 0.3;
	const h = 7 + r() * 5, lean = ( r() - 0.5 ) * 0.5, yaw = r() * Math.PI * 2;
	const segs = 6;
	let px = x, py = y, pz = z;
	const dx = Math.cos( yaw ) * lean, dz = Math.sin( yaw ) * lean;
	for ( let i = 0; i < segs; i ++ ) {

		const t = i / segs;
		const len = h / segs;
		const bend = t * t * 1.4;
		const nx = px + dx * len * ( 1 + bend ), nz = pz + dz * len * ( 1 + bend ), ny = py + len;
		const mx = ( px + nx ) / 2, my = ( py + ny ) / 2, mz = ( pz + nz ) / 2;
		const dir = new Vector3( nx - px, ny - py, nz - pz ).normalize();
		const rotX = Math.atan2( dir.z, dir.y ), rotZ = - Math.atan2( dir.x, dir.y );
		b.add( new CylinderGeometry( 0.28 - t * 0.1, 0.34 - t * 0.1, len * 1.05, 7 ), { position: [ mx, my, mz ], rotation: [ rotX, 0, rotZ ], color: i % 2 ? 0x8a6a48 : 0x7a5c3e } );
		px = nx; py = ny; pz = nz;

	}

	// coconuts + fronds
	for ( let i = 0; i < 3; i ++ ) b.add( new SphereGeometry( 0.3, 8, 6 ), { position: [ px + Math.cos( i * 2.1 ) * 0.35, py - 0.3, pz + Math.sin( i * 2.1 ) * 0.35 ], color: 0x5a4028 } );
	const fronds = 7;
	for ( let i = 0; i < fronds; i ++ ) {

		const a = i / fronds * Math.PI * 2 + r() * 0.4;
		const len = 3.6 + r() * 1.2;
		f.add( new BoxGeometry( len, 0.12, 0.9 ), { position: [ px + Math.cos( a ) * len * 0.45, py - 0.35, pz + Math.sin( a ) * len * 0.45 ], rotation: [ 0, - a, - 0.45 - r() * 0.2 ], color: r() > 0.5 ? 0x3f8f35 : 0x2f7a2c, flat: true } );
		// a drooping tip
		f.add( new BoxGeometry( len * 0.45, 0.1, 0.7 ), { position: [ px + Math.cos( a ) * len * 0.98, py - 0.35 - len * 0.32, pz + Math.sin( a ) * len * 0.98 ], rotation: [ 0, - a, - 0.95 - r() * 0.2 ], color: 0x2f7a2c, flat: true } );

	}

}

// a broadleaf jungle tree: a trunk and a few lumpy blobs of canopy
function tree( b, f, x, z, r ) {

	const y = islandHeight( x, z ) - 0.4;
	const h = 6 + r() * 7, w = 2.4 + r() * 2.2;
	b.add( new CylinderGeometry( 0.3, 0.5, h, 7 ), { position: [ x, y + h / 2, z ], rotation: [ ( r() - 0.5 ) * 0.15, 0, ( r() - 0.5 ) * 0.15 ], color: 0x6b4f35 } );
	const greens = [ 0x2e7d32, 0x3f8f35, 0x256b2a, 0x4a9a3a, 0x5aa33a ];
	const n = 3 + Math.floor( r() * 3 );
	for ( let i = 0; i < n; i ++ ) {

		const a = r() * Math.PI * 2, d = i === 0 ? 0 : w * ( 0.4 + r() * 0.35 );
		const s = w * ( i === 0 ? 1 : 0.6 + r() * 0.3 );
		f.add( new IcosahedronGeometry( s, 1 ), { position: [ x + Math.cos( a ) * d, y + h + ( i === 0 ? 0.4 : - r() * 1.2 ), z + Math.sin( a ) * d ], scale: [ 1, 0.72 + r() * 0.2, 1 ], color: greens[ Math.floor( r() * greens.length ) ], flat: true, jitter: 0.18 } );

	}

}

// a bush: a clump of small blobs, sometimes flowering
function bush( f, x, z, r ) {

	const y = islandHeight( x, z ) - 0.2;
	const n = 2 + Math.floor( r() * 3 );
	const flowers = r() < 0.3 ? [ 0xff5a8a, 0xffc93c, 0xf4efe6, 0xff7a3c ][ Math.floor( r() * 4 ) ] : 0;
	for ( let i = 0; i < n; i ++ ) {

		const s = 0.8 + r() * 0.9;
		const px = x + ( r() - 0.5 ) * 2.2, pz = z + ( r() - 0.5 ) * 2.2;
		f.add( new IcosahedronGeometry( s, 1 ), { position: [ px, y + s * 0.55, pz ], scale: [ 1, 0.8, 1 ], color: r() > 0.5 ? 0x357a2f : 0x4a8f35, flat: true, jitter: 0.2 } );
		if ( flowers ) for ( let k = 0; k < 4; k ++ ) f.add( new IcosahedronGeometry( 0.14, 0 ), { position: [ px + ( r() - 0.5 ) * s * 1.4, y + s * ( 0.7 + r() * 0.5 ), pz + ( r() - 0.5 ) * s * 1.4 ], color: flowers } );

	}

}

// a tuft of grass blades
function tuft( f, x, z, r ) {

	const y = islandHeight( x, z ) - 0.05;
	const n = 4 + Math.floor( r() * 4 );
	for ( let i = 0; i < n; i ++ ) {

		const a = r() * Math.PI * 2, h = 0.5 + r() * 0.6;
		f.add( new ConeGeometry( 0.06, h, 3 ), { position: [ x + Math.cos( a ) * 0.18, y + h / 2, z + Math.sin( a ) * 0.18 ], rotation: [ ( r() - 0.5 ) * 0.7, 0, ( r() - 0.5 ) * 0.7 ], color: r() > 0.5 ? 0x5d9a2c : 0x7aa83a } );

	}

}

function rock( b, x, z, s, r ) {

	const y = islandHeight( x, z );
	b.add( new IcosahedronGeometry( s, 0 ), { position: [ x, y + s * 0.2, z ], rotation: [ r() * 3, r() * 3, r() * 3 ], scale: [ 1, 0.65 + r() * 0.3, 1 ], color: 0x8b847a, flat: true, jitter: 0.25 } );

}

// a sea-going launch platform: grey deck, hazard stripes, a mount, a red lattice gantry and lamps
function barge() {

	const b = new ToyBuilder();
	const W = 40, D = 26, H = 3.4;
	b.add( new BoxGeometry( W, H, D ), { position: [ 0, - H / 2 + 0.6, 0 ], color: 0x3b3f48 } );
	b.add( new BoxGeometry( W - 1, 0.3, D - 1 ), { position: [ 0, 0.75, 0 ], color: 0x6f7780, jitter: 0.08 } );
	// hazard stripes along the edges
	for ( let i = 0; i < 20; i ++ ) {

		b.add( new BoxGeometry( 1.0, 0.32, 0.6 ), { position: [ - W / 2 + 1 + i * 2, 0.78, D / 2 - 0.6 ], color: i % 2 ? 0x1d1d1f : 0xffc93c } );
		b.add( new BoxGeometry( 1.0, 0.32, 0.6 ), { position: [ - W / 2 + 1 + i * 2, 0.78, - D / 2 + 0.6 ], color: i % 2 ? 0x1d1d1f : 0xffc93c } );

	}

	// landing target
	b.add( new CylinderGeometry( 7, 7, 0.05, 48 ), { position: [ 0, 0.92, 0 ], color: 0xf4efe6 } );
	b.add( new CylinderGeometry( 6.2, 6.2, 0.06, 48 ), { position: [ 0, 0.93, 0 ], color: 0x3b3f48 } );
	b.add( new BoxGeometry( 7, 0.07, 1.2 ), { position: [ 0, 0.95, 0 ], color: 0xf4efe6 } );
	b.add( new BoxGeometry( 1.2, 0.07, 7 ), { position: [ 0, 0.95, 0 ], color: 0xf4efe6 } );
	// launch mount (a ring on four legs)
	for ( const [ x, z ] of [ [ - 2.4, - 2.4 ], [ 2.4, - 2.4 ], [ - 2.4, 2.4 ], [ 2.4, 2.4 ] ] ) b.add( new BoxGeometry( 0.7, 2.0, 0.7 ), { position: [ x, 1.9, z ], color: 0x8f9aa6 } );
	b.add( new TorusGeometry( 2.6, 0.35, 8, 32 ), { position: [ 0, 2.9, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xb8c2cc } );
	// gantry tower: red lattice beside the rocket
	const gx = - 9, gz = - 4, gh = 34;
	for ( const [ x, z ] of [ [ - 1.4, - 1.4 ], [ 1.4, - 1.4 ], [ - 1.4, 1.4 ], [ 1.4, 1.4 ] ] ) b.add( new BoxGeometry( 0.35, gh, 0.35 ), { position: [ gx + x, gh / 2 + 0.8, gz + z ], color: 0xd9412f } );
	for ( let y = 2; y < gh; y += 3 ) {

		b.add( new BoxGeometry( 3.1, 0.25, 0.25 ), { position: [ gx, y, gz - 1.4 ], color: 0xd9412f } );
		b.add( new BoxGeometry( 3.1, 0.25, 0.25 ), { position: [ gx, y, gz + 1.4 ], color: 0xd9412f } );
		b.add( new BoxGeometry( 0.25, 0.25, 3.1 ), { position: [ gx - 1.4, y, gz ], color: 0xd9412f } );
		b.add( new BoxGeometry( 0.25, 0.25, 3.1 ), { position: [ gx + 1.4, y, gz ], color: 0xd9412f } );
		b.add( new BoxGeometry( 0.2, 4.3, 0.2 ), { position: [ gx, y + 1.5, gz - 1.4 ], rotation: [ 0, 0, 0.78 * ( ( y / 3 ) % 2 ? 1 : - 1 ) ], color: 0xb8352a } );

	}

	// access arms and a crane top
	for ( const y of [ 12, 22 ] ) b.add( new BoxGeometry( 6, 0.5, 1.2 ), { position: [ gx + 4.2, y, gz + 1.5 ], color: 0x8f9aa6 } );
	b.add( new BoxGeometry( 10, 0.6, 0.6 ), { position: [ gx + 3, gh + 1.2, gz ], color: 0xffc93c } );
	b.add( new CylinderGeometry( 0.5, 0.5, 1.2, 12 ), { position: [ gx, gh + 1.7, gz ], color: 0x2b2f36 } );
	// deck clutter: containers, a fuel sphere
	b.add( new BoxGeometry( 6, 2.6, 2.4 ), { position: [ 12, 2.1, - 8 ], color: 0x2f6fde } );
	b.add( new BoxGeometry( 6, 2.6, 2.4 ), { position: [ 12, 2.1, - 5.2 ], color: 0xff5a36 } );
	b.add( new SphereGeometry( 3, 18, 12 ), { position: [ 13, 4, 7 ], color: 0xf4efe6 } );
	for ( const [ x, z ] of [ [ 11, 5 ], [ 15, 5 ], [ 11, 9 ], [ 15, 9 ] ] ) b.add( new BoxGeometry( 0.4, 2.4, 0.4 ), { position: [ x, 1.9, z ], color: 0x8f9aa6 } );
	return b.build();

}

export class Island {

	constructor( scene ) {

		this.group = new Group();
		scene.add( this.group );
		const mats = toyMaterials();

		// the terrain: shaded per pixel from the analytic height (normals finer than the mesh) with the
		// ground's procedural look; real coordinates through the floating origin
		this.terrainMaterial = new Material( {
			name: 'island-terrain', roughness: 0.92,
			modules: [ islandModule ],
			surface: /* wgsl */`
	let pr = in.P.xz + vec2f( frame.originX, 0.0 );
	let h = in.P.y - frame.seaLevel;
	let n0 = islandNormal( pr );
	let g = islandGround( pr, h, n0, length( in.P - frame.cameraPos ) );
	s.albedo = g.albedo;
	s.roughness = g.rough;
	s.normal = g.normal;
	s.specularIntensity = mix( 0.5, 1.0, g.wet );
	// the shallows under a thin sheet of water catch the caustics
	let sub = smoothstep( 0.3, -0.4, h );
	s.albedo *= 1.0 + islandCaustics( pr, frame.time ) * sub * 0.8;
`,
		} );
		const terrain = new Mesh( buildTerrain(), this.terrainMaterial );
		terrain.receiveShadow = true;
		terrain.castShadow = true;
		terrain.staticVelocity = true;
		this.group.add( terrain );

		const b = new ToyBuilder();
		launchPad( b );
		hangar( b, - 46, - 34, 0.35 );
		this.lampPos = lighthouse( b, 150, - 330 );
		const r = rng( 7 );
		// foliage (fronds, canopies, bushes, grass): its own mesh, swaying, lit through from behind
		const fb = new ToyBuilder();
		const clear = ( x, z, pad = 22 ) => Math.hypot( x - LAUNCH.x, z - LAUNCH.z ) < pad || Math.hypot( x + 46, z + 34 ) < 22 || Math.hypot( x - 150, z + 330 ) < 14;
		let placed = 0;
		for ( let tries = 0; tries < 2400 && placed < 110; tries ++ ) {

			const x = - 380 + r() * 700, z = - 420 + r() * 420;
			const h = islandHeight( x, z );
			// palms crowd the beach fringe, thin out uphill
			if ( h < 1.6 || h > 38 || ( h > 7 && r() < 0.75 ) ) continue;
			if ( clear( x, z ) ) continue;
			palm( b, x, z, r, fb );
			placed ++;

		}

		placed = 0;
		for ( let tries = 0; tries < 3000 && placed < 150; tries ++ ) {

			const x = - 400 + r() * 720, z = - 450 + r() * 450;
			const h = islandHeight( x, z );
			if ( h < 7 || clear( x, z, 30 ) ) continue;
			// denser on the hills
			if ( r() > smooth( 6, 30, h ) + 0.15 ) continue;
			tree( b, fb, x, z, r );
			placed ++;

		}

		placed = 0;
		for ( let tries = 0; tries < 3000 && placed < 220; tries ++ ) {

			const x = - 400 + r() * 720, z = - 450 + r() * 460;
			const h = islandHeight( x, z );
			if ( h < 2.6 || clear( x, z, 12 ) ) continue;
			bush( fb, x, z, r );
			placed ++;

		}

		// grass tufts where the camera looks most: around the pad and up the slope behind it
		placed = 0;
		for ( let tries = 0; tries < 4000 && placed < 520; tries ++ ) {

			const x = - 140 + r() * 260, z = - 160 + r() * 150;
			const h = islandHeight( x, z );
			if ( h < 3.2 || clear( x, z, 9 ) ) continue;
			tuft( fb, x, z, r );
			placed ++;

		}

		this.foliageMaterial = new Material( {
			name: 'foliage', vertexColors: true, roughness: 0.75,
			modules: [ islandModule ],
			vertex: /* wgsl */`
	// sway in the wind: more the higher above the ground (real coordinates for the ground height)
	let wp0 = ( v.model * vec4f( v.position, 1.0 ) ).xyz;
	let pr = wp0.xz + vec2f( frame.originX, 0.0 );
	let above = max( wp0.y - frame.seaLevel - islandHeight( pr ), 0.0 );
	let k = min( above * above * 0.004, 0.6 );
	let ph = frame.time * 1.3 + pr.x * 0.08 + pr.y * 0.05;
	v.worldOffset = vec3f( sin( ph ) * 0.35 + sin( ph * 2.3 ) * 0.1, 0.0, cos( ph * 0.8 ) * 0.25 ) * k;
	v.prevWorldOffset = vec3f( sin( ph - frame.dt * 1.3 ) * 0.35 + sin( ( ph - frame.dt * 1.3 ) * 2.3 ) * 0.1, 0.0, cos( ( ph - frame.dt * 1.3 ) * 0.8 ) * 0.25 ) * k;
`,
			surface: /* wgsl */`
	s.translucency = s.albedo * 0.22;
	s.albedo *= 0.9 + fract( sin( dot( floor( in.P.xz * 0.5 ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 0.2;
`,
		} );
		const foliage = new Mesh( fb.build(), this.foliageMaterial );
		foliage.castShadow = true;
		foliage.receiveShadow = true;
		this.group.add( foliage );

		for ( let i = 0; i < 40; i ++ ) {

			const x = - 420 + r() * 800, z = - 450 + r() * 460;
			const h = islandHeight( x, z );
			if ( h < - 1.5 || Math.hypot( x - LAUNCH.x, z - LAUNCH.z ) < 16 ) continue;
			rock( b, x, z, 1 + r() * 3.5, r );

		}

		// a windsock by the pad
		b.add( new CylinderGeometry( 0.08, 0.1, 6, 6 ), { position: [ 9, islandHeight( 9, - 8 ) + 3, - 8 ], color: 0xf4efe6 } );
		const props = new Mesh( b.build(), mats.matte );
		props.castShadow = true;
		props.receiveShadow = true;
		props.staticVelocity = true;
		this.group.add( props );
		this.sock = new Mesh( new ToyBuilder()
			.add( new CylinderGeometry( 0.55, 0.3, 1.2, 10, 1, true ), { position: [ 0, 0, 0.6 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xff6a1f } )
			.add( new CylinderGeometry( 0.3, 0.18, 1.1, 10, 1, true ), { position: [ 0, 0, 1.75 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xf4efe6 } )
			.build(), mats.matte );
		this.sock.material = new Material( { name: 'sock', vertexColors: true, roughness: 0.9, side: 'double' } );
		this.sock.position.set( 9, islandHeight( 9, - 8 ) + 5.7, - 8 );
		this.sock.castShadow = true;
		this.group.add( this.sock );

		// the launch barge for rockets and starships
		this.barge = new Mesh( barge(), mats.matte );
		this.barge.position.set( BARGE.x, 0, BARGE.z );
		this.barge.castShadow = true;
		this.barge.receiveShadow = true;
		this.group.add( this.barge );
		// floodlight heads (emissive)
		const lamps = new ToyBuilder();
		for ( const [ x, z ] of [ [ - 18, - 11 ], [ 18, - 11 ], [ - 18, 11 ], [ 18, 11 ] ] ) {

			lamps.add( new BoxGeometry( 0.3, 7, 0.3 ), { position: [ x, 4.3, z ], color: 0x8f9aa6 } );
			lamps.add( new BoxGeometry( 1.4, 0.8, 0.5 ), { position: [ x, 8.1, z ], color: 0xfff1c0 } );

		}

		this.bargeLamps = new Mesh( lamps.build(), mats.glow );
		this.barge.add( this.bargeLamps );

	}

	update( dt, time, wind ) {

		// the barge rides the swell
		this.barge.position.y = Math.sin( time * 0.7 ) * 0.25;
		this.barge.rotation.set( Math.sin( time * 0.5 ) * 0.012, 0, Math.sin( time * 0.63 + 1 ) * 0.01 );

		// the windsock points downwind and flutters
		const a = Math.atan2( wind.x, 0.4 );
		this.sock.rotation.set( - 0.25 + Math.sin( time * 7 ) * 0.05, a, 0 );

	}

}
