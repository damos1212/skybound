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

// ---- height function (keep in sync with ISLAND_WGSL)
export function islandHeight( x, z ) {

	const ex = ( x - ISLAND.center[ 0 ] ) / ISLAND.radii[ 0 ], ez = ( z - ISLAND.center[ 1 ] ) / ISLAND.radii[ 1 ];
	const de = Math.sqrt( ex * ex + ez * ez );
	const mask = smooth( 1.05, 0.7, de );
	let h = - 14 + 15.2 * mask;
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
	let mask = smoothstep( 1.05, 0.7, length( e ) );
	var h = -14.0 + 15.2 * mask;
${ ISLAND.hills.map( ( [ cx, cz, r, a ] ) => `	{ let d = p - vec2f( ${ f( cx ) }, ${ f( cz ) } ); h += ${ f( a ) } * exp( - dot( d, d ) / ${ f( r * r ) } ) * mask; }` ).join( '\n' ) }
	h += ( 3.0 * sin( p.x * 0.021 + p.y * 0.013 ) * sin( p.y * 0.017 - p.x * 0.011 ) + 1.2 * sin( p.x * 0.052 ) * sin( p.y * 0.047 ) ) * mask * mask;
	let pd = length( vec2f( p.x - ${ f( LAUNCH.x ) }, ( p.y - ${ f( LAUNCH.z ) } + 18.0 ) * 1.3 ) );
	h = mix( h, max( h, 1.4 ), smoothstep( 45.0, 20.0, pd ) );
	return h;
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

function palm( b, x, z, r ) {

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
		b.add( new BoxGeometry( len, 0.12, 0.9 ), { position: [ px + Math.cos( a ) * len * 0.45, py - 0.35, pz + Math.sin( a ) * len * 0.45 ], rotation: [ 0, - a, - 0.45 - r() * 0.2 ], color: r() > 0.5 ? 0x3f8f35 : 0x2f7a2c, flat: true } );

	}

}

function rock( b, x, z, s, r ) {

	const y = islandHeight( x, z );
	b.add( new IcosahedronGeometry( s, 0 ), { position: [ x, y + s * 0.2, z ], rotation: [ r() * 3, r() * 3, r() * 3 ], scale: [ 1, 0.65 + r() * 0.3, 1 ], color: 0x8b847a, flat: true, jitter: 0.25 } );

}

export class Island {

	constructor( scene ) {

		this.group = new Group();
		scene.add( this.group );
		const mats = toyMaterials();

		this.terrainMaterial = new Material( { name: 'island-terrain', vertexColors: true, roughness: 0.92 } );
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
		let placed = 0;
		for ( let tries = 0; tries < 900 && placed < 70; tries ++ ) {

			const x = - 380 + r() * 700, z = - 420 + r() * 420;
			const h = islandHeight( x, z );
			if ( h < 1.6 || h > 38 ) continue;
			if ( Math.hypot( x - LAUNCH.x, z - LAUNCH.z ) < 22 || Math.hypot( x + 46, z + 34 ) < 22 || Math.hypot( x - 150, z + 330 ) < 14 ) continue;
			palm( b, x, z, r );
			placed ++;

		}

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

	}

	update( dt, time, wind ) {

		// the windsock points downwind and flutters
		const a = Math.atan2( wind.x, 0.4 );
		this.sock.rotation.set( - 0.25 + Math.sin( time * 7 ) * 0.05, a, 0 );

	}

}
