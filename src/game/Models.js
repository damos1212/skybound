import { Mesh } from '../engine/scene/Mesh.js';
import { Material } from '../engine/render/Material.js';
import { BoxGeometry, CylinderGeometry, SphereGeometry, ConeGeometry, IcosahedronGeometry, TorusGeometry, RoundedBoxGeometry } from '../engine/geometry/index.js';
import { Vector3 } from '../engine/math/index.js';
import { ToyBuilder, toyMaterials } from '../world/Toy.js';

// Toy models of everything that flies besides the player, built once and shared: Earth traffic,
// orbital junk, the solar system's rocks and ice, and the pickups.

// ------------------------------------------------------------------ models (built once)

let MODELS = null;

export function models() {

	if ( MODELS ) return MODELS;
	const M = MODELS = {};
	const T = () => new ToyBuilder();

	// gull (body + one wing, mirrored at runtime)
	M.gullBody = T()
		.add( new SphereGeometry( 0.45, 12, 8 ), { scale: [ 1, 0.8, 2.0 ], color: 0xf7f7f2 } )
		.add( new SphereGeometry( 0.3, 10, 8 ), { position: [ 0, 0.18, 0.75 ], color: 0xf7f7f2 } )
		.add( new ConeGeometry( 0.1, 0.45, 6 ), { position: [ 0, 0.14, 1.15 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xffb020 } )
		.add( new SphereGeometry( 0.05, 6, 4 ), { position: [ 0.16, 0.28, 0.9 ], color: 0x111111 } )
		.add( new SphereGeometry( 0.05, 6, 4 ), { position: [ - 0.16, 0.28, 0.9 ], color: 0x111111 } )
		.add( new BoxGeometry( 0.5, 0.08, 0.5 ), { position: [ 0, 0, - 0.95 ], rotation: [ 0.1, Math.PI / 4, 0 ], color: 0xdadada } )
		.build();
	M.gullWing = T()
		.add( new BoxGeometry( 1.6, 0.08, 0.7 ), { position: [ 0.8, 0, 0 ], color: 0xb9c0c7, flat: true } )
		.add( new BoxGeometry( 0.5, 0.07, 0.55 ), { position: [ 1.8, 0, - 0.05 ], color: 0x2a2d33, flat: true } )
		.build();
	M.gooseBody = T()
		.add( new SphereGeometry( 0.5, 12, 8 ), { scale: [ 1, 0.85, 2.1 ], color: 0x7a634d } )
		.add( new CylinderGeometry( 0.12, 0.15, 0.9, 8 ), { position: [ 0, 0.25, 1.2 ], rotation: [ 1.1, 0, 0 ], color: 0x1d1d1f } )
		.add( new SphereGeometry( 0.2, 10, 8 ), { position: [ 0, 0.45, 1.6 ], color: 0x1d1d1f } )
		.add( new BoxGeometry( 0.3, 0.12, 0.08 ), { position: [ 0, 0.4, 1.6 ], color: 0xf2f2f2 } )
		.add( new ConeGeometry( 0.08, 0.3, 6 ), { position: [ 0, 0.42, 1.85 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x222222 } )
		.build();
	M.gooseWing = T()
		.add( new BoxGeometry( 1.9, 0.08, 0.8 ), { position: [ 0.95, 0, 0 ], color: 0x8b7358, flat: true } )
		.add( new BoxGeometry( 0.6, 0.07, 0.6 ), { position: [ 2.1, 0, - 0.05 ], color: 0x3a2e24, flat: true } )
		.build();

	// kite: diamond sail + cross spars + a bowed tail
	const kite = T();
	kite.add( new BoxGeometry( 2.2, 2.2, 0.06 ), { rotation: [ 0, 0, Math.PI / 4 ], scale: [ 0.75, 1.0, 1 ], color: 0xff5a36, flat: true } );
	kite.add( new BoxGeometry( 1.6, 1.6, 0.07 ), { position: [ 0, 0, 0.01 ], rotation: [ 0, 0, Math.PI / 4 ], scale: [ 0.75, 1.0, 1 ], color: 0xffc93c, flat: true } );
	kite.add( new CylinderGeometry( 0.03, 0.03, 3.0, 5 ), { position: [ 0, 0, 0.06 ], color: 0x5a3b22 } );
	kite.add( new CylinderGeometry( 0.03, 0.03, 2.2, 5 ), { position: [ 0, 0.3, 0.06 ], rotation: [ 0, 0, Math.PI / 2 ], color: 0x5a3b22 } );
	for ( let i = 0; i < 5; i ++ ) kite.add( new BoxGeometry( 0.35, 0.18, 0.04 ), { position: [ Math.sin( i * 1.3 ) * 0.25, - 1.7 - i * 0.55, 0 ], rotation: [ 0, 0, i * 0.5 ], color: [ 0x3aa0ff, 0x3ccf6e, 0xff5a36, 0xffc93c, 0xb070ff ][ i ] } );
	M.kite = kite.build();

	// quadcopter
	const drone = T();
	drone.add( new RoundedBoxGeometry( 0.7, 0.28, 0.7, 2, 0.1 ), { color: 0xf4efe6 } );
	for ( const a of [ 0.785, 2.356, 3.927, 5.498 ] ) {

		drone.add( new BoxGeometry( 1.1, 0.08, 0.12 ), { position: [ Math.cos( a ) * 0.55, 0.05, Math.sin( a ) * 0.55 ], rotation: [ 0, - a, 0 ], color: 0x2b2f36 } );
		drone.add( new CylinderGeometry( 0.12, 0.12, 0.2, 8 ), { position: [ Math.cos( a ) * 1.05, 0.1, Math.sin( a ) * 1.05 ], color: 0x2b2f36 } );
		drone.add( new CylinderGeometry( 0.48, 0.48, 0.03, 16 ), { position: [ Math.cos( a ) * 1.05, 0.22, Math.sin( a ) * 1.05 ], color: 0x9fb4c4 } );

	}

	drone.add( new SphereGeometry( 0.14, 8, 6 ), { position: [ 0, - 0.18, 0.3 ], color: 0x1d2433 } );
	M.drone = drone.build();
	M.droneLed = T().add( new SphereGeometry( 0.09, 8, 6 ), { position: [ 0, 0.16, - 0.36 ], color: 0xff2020 } ).build();

	// paraglider: arched canopy of cells, lines and a pilot
	const pg = T();
	const cells = 9;
	for ( let i = 0; i < cells; i ++ ) {

		const a = ( i / ( cells - 1 ) - 0.5 ) * 2.2;
		pg.add( new RoundedBoxGeometry( 1.25, 0.35, 2.4, 1, 0.12 ), { position: [ Math.sin( a ) * 5, Math.cos( a ) * 5 - 5, 0 ], rotation: [ 0, 0, - a ], color: i % 2 ? 0x3ccf6e : 0xfaf3e3 } );

	}

	pg.add( new SphereGeometry( 0.35, 10, 8 ), { position: [ 0, - 6.8, 0 ], color: 0xff5a36 } );
	pg.add( new RoundedBoxGeometry( 0.6, 0.9, 0.5, 2, 0.15 ), { position: [ 0, - 7.5, 0 ], color: 0x2f6fde } );
	M.paraglider = pg.build();

	// seaplane (toy float plane)
	const sp = T();
	sp.add( new CylinderGeometry( 0.8, 0.55, 7, 12 ), { rotation: [ 0, 0, Math.PI / 2 ], color: 0xe2463a } );
	sp.add( new SphereGeometry( 0.8, 12, 8 ), { position: [ 3.5, 0, 0 ], color: 0xe2463a } );
	sp.add( new SphereGeometry( 0.62, 12, 8 ), { position: [ 1.8, 0.55, 0 ], scale: [ 1.2, 0.8, 1 ], color: 0x9fd4ea } );
	sp.add( new RoundedBoxGeometry( 1.6, 0.18, 11, 1, 0.08 ), { position: [ 1.2, 0.85, 0 ], color: 0xfaf3e3 } );
	sp.add( new RoundedBoxGeometry( 1.0, 1.6, 0.16, 1, 0.06 ), { position: [ - 3.2, 0.9, 0 ], color: 0xfaf3e3 } );
	sp.add( new RoundedBoxGeometry( 0.9, 0.14, 3.2, 1, 0.06 ), { position: [ - 3.2, 0.25, 0 ], color: 0xfaf3e3 } );
	for ( const z of [ - 1.4, 1.4 ] ) {

		sp.add( new CylinderGeometry( 0.28, 0.22, 4.2, 10 ), { position: [ 1.0, - 1.6, z ], rotation: [ 0, 0, Math.PI / 2 ], color: 0xfaf3e3 } );
		sp.add( new BoxGeometry( 0.08, 1.2, 0.08 ), { position: [ 1.6, - 0.9, z ], color: 0x3b3b44 } );

	}

	sp.add( new ConeGeometry( 0.3, 0.6, 10 ), { position: [ 4.4, 0, 0 ], rotation: [ 0, 0, - Math.PI / 2 ], color: 0x3b3b44 } );
	M.seaplane = sp.build();
	M.prop = T().add( new BoxGeometry( 0.08, 2.4, 0.22 ), { color: 0x2b2f36 } ).build();

	// storm cell: a heap of dark puffs; lightning bolt (emissive)
	const st = T();
	for ( let i = 0; i < 14; i ++ ) {

		const a = i * 2.4, r = 6 + ( i % 4 ) * 3;
		st.add( new IcosahedronGeometry( 5 + ( i % 3 ) * 2.2, 1 ), { position: [ Math.cos( a ) * r, Math.sin( i * 1.7 ) * 3 + ( i % 5 ) * 1.2, Math.sin( a ) * r * 0.5 ], color: i % 3 ? 0x5b6270 : 0x474d59, flat: true, jitter: 0.15 } );

	}

	M.storm = st.build();
	const bolt = T();
	let bx = 0, by = 0;
	for ( let i = 0; i < 7; i ++ ) {

		const nx = bx + ( i % 2 ? 1.6 : - 1.4 ), ny = by - 4.2;
		const mid = new Vector3( ( bx + nx ) / 2, ( by + ny ) / 2, 0 );
		const len = Math.hypot( nx - bx, ny - by );
		bolt.add( new BoxGeometry( 0.35, len, 0.35 ), { position: [ mid.x, mid.y, 0 ], rotation: [ 0, 0, Math.atan2( nx - bx, by - ny ) ], color: 0xdfe8ff } );
		bx = nx; by = ny;

	}

	M.bolt = bolt.build();

	// airliner
	const al = T();
	al.add( new CylinderGeometry( 2.2, 2.2, 34, 16 ), { rotation: [ 0, 0, Math.PI / 2 ], color: 0xf6f6f2 } );
	al.add( new SphereGeometry( 2.2, 16, 10 ), { position: [ 17, 0, 0 ], scale: [ 1.6, 1, 1 ], color: 0xf6f6f2 } );
	al.add( new ConeGeometry( 2.2, 7, 16 ), { position: [ - 20.5, 0.6, 0 ], rotation: [ 0, 0, Math.PI / 2 ], scale: [ 1, 1, 1 ], color: 0xf6f6f2 } );
	al.add( new CylinderGeometry( 2.25, 2.25, 34, 16, 1, true, 0, Math.PI ), { position: [ 0, - 0.02, 0 ], rotation: [ 0, 0, Math.PI / 2 ], scale: [ 1, 1, 1 ], color: 0x2f6fde } );
	al.add( new BoxGeometry( 7, 0.5, 36 ), { position: [ 1, - 0.6, 0 ], rotation: [ 0, 0, 0 ], scale: [ 1, 1, 1 ], color: 0xdde3ea } );
	al.add( new BoxGeometry( 5, 7, 0.5 ), { position: [ - 19, 4.2, 0 ], rotation: [ 0, 0, 0.35 ], color: 0x2f6fde } );
	al.add( new BoxGeometry( 4, 0.4, 12 ), { position: [ - 19.5, 1.2, 0 ], color: 0xdde3ea } );
	for ( const z of [ - 7, 7 ] ) al.add( new CylinderGeometry( 1.1, 1.0, 4.5, 12 ), { position: [ 3, - 1.9, z ], rotation: [ 0, 0, Math.PI / 2 ], color: 0xc9d0d8 } );
	for ( let i = 0; i < 14; i ++ ) al.add( new BoxGeometry( 0.7, 0.55, 0.1 ), { position: [ 12 - i * 2, 0.7, 2.18 ], color: 0x1d2433 } );
	M.airliner = al.build();
	M.contrail = T().add( new CylinderGeometry( 1.2, 0.35, 1, 10, 1, true ), { rotation: [ 0, 0, Math.PI / 2 ], color: 0xffffff } ).build();

	// weather balloon + radiosonde
	const wb = T();
	wb.add( new SphereGeometry( 3.2, 20, 14 ), { scale: [ 1, 1.1, 1 ], color: 0xf4f0e8 } );
	wb.add( new CylinderGeometry( 0.02, 0.02, 6, 4 ), { position: [ 0, - 6.3, 0 ], color: 0x444444 } );
	wb.add( new BoxGeometry( 0.6, 0.5, 0.6 ), { position: [ 0, - 9.5, 0 ], color: 0xff5a36 } );
	M.weather = wb.build();

	// fighter jet
	const jt = T();
	jt.add( new CylinderGeometry( 0.8, 0.9, 12, 10 ), { rotation: [ 0, 0, Math.PI / 2 ], color: 0x8e99a6 } );
	jt.add( new ConeGeometry( 0.8, 4, 10 ), { position: [ 8, 0, 0 ], rotation: [ 0, 0, - Math.PI / 2 ], color: 0x8e99a6 } );
	jt.add( new SphereGeometry( 0.6, 10, 8 ), { position: [ 3.5, 0.6, 0 ], scale: [ 2, 0.8, 1 ], color: 0xffc93c } );
	jt.add( new BoxGeometry( 5, 0.2, 9 ), { position: [ - 1.5, 0, 0 ], rotation: [ 0, 0, 0 ], color: 0x7b8591, flat: true } );
	jt.add( new BoxGeometry( 2.5, 3, 0.2 ), { position: [ - 5, 1.6, 0 ], rotation: [ 0, 0, 0.5 ], color: 0x7b8591 } );
	M.jet = jt.build();

	// pickups
	M.coin = T()
		.add( new CylinderGeometry( 0.9, 0.9, 0.2, 24 ), { rotation: [ Math.PI / 2, 0, 0 ], color: 0xffc93c } )
		.add( new CylinderGeometry( 0.62, 0.62, 0.24, 24 ), { rotation: [ Math.PI / 2, 0, 0 ], color: 0xffe07a } )
		.build();
	M.fuel = T()
		.add( new RoundedBoxGeometry( 1.2, 1.5, 0.6, 2, 0.12 ), { color: 0xe2463a } )
		.add( new BoxGeometry( 0.5, 0.2, 0.2 ), { position: [ 0.2, 0.85, 0 ], color: 0x2b2f36 } )
		.add( new BoxGeometry( 0.7, 0.18, 0.62 ), { position: [ 0, 0.2, 0 ], color: 0xffc93c } )
		.add( new CylinderGeometry( 0.015, 0.015, 2.2, 3 ), { position: [ - 0.9, 1.8, 0 ], rotation: [ 0, 0, - 0.4 ], color: 0x444444 } )
		.add( new CylinderGeometry( 0.015, 0.015, 2.2, 3 ), { position: [ 0.9, 1.8, 0 ], rotation: [ 0, 0, 0.4 ], color: 0x444444 } )
		.add( new SphereGeometry( 1.8, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2 ), { position: [ 0, 2.6, 0 ], scale: [ 1, 0.55, 1 ], color: 0xfaf3e3 } )
		.build();
	M.star = T().add( new IcosahedronGeometry( 1.1, 0 ), { color: 0xb070ff, flat: true } ).build();

	// ---- more Earth traffic
	const heli = T();
	heli.add( new SphereGeometry( 1.4, 16, 12 ), { scale: [ 1.5, 1.0, 1.0 ], color: 0xffc93c } );
	heli.add( new SphereGeometry( 1.0, 14, 10 ), { position: [ 1.2, 0.2, 0 ], scale: [ 1.0, 0.8, 0.9 ], color: 0x9fd4ea } );
	heli.add( new CylinderGeometry( 0.25, 0.45, 5, 10 ), { position: [ - 3.8, 0.3, 0 ], rotation: [ 0, 0, Math.PI / 2 ], color: 0xffc93c } );
	heli.add( new BoxGeometry( 0.2, 1.6, 0.9 ), { position: [ - 6.1, 0.9, 0 ], color: 0x2b2f36 } );
	for ( const z of [ - 0.9, 0.9 ] ) heli.add( new BoxGeometry( 3.2, 0.12, 0.12 ), { position: [ 0, - 1.5, z ], color: 0x2b2f36 } );
	heli.add( new CylinderGeometry( 0.15, 0.15, 0.8, 8 ), { position: [ 0, 1.3, 0 ], color: 0x2b2f36 } );
	M.heli = heli.build();
	M.rotor = T().add( new BoxGeometry( 9, 0.08, 0.35 ), { color: 0x2b2f36 } ).add( new BoxGeometry( 0.35, 0.08, 9 ), { color: 0x2b2f36 } ).build();

	const blimp = T();
	blimp.add( new SphereGeometry( 5, 24, 16 ), { scale: [ 3.2, 1, 1 ], color: 0xe8eef2 } );
	blimp.add( new CylinderGeometry( 5.02, 5.02, 5, 24, 1, true ), { position: [ 2, 0, 0 ], rotation: [ 0, 0, Math.PI / 2 ], color: 0xff5a36 } );
	for ( const r of [ 0, Math.PI / 2, Math.PI, Math.PI * 1.5 ] ) blimp.add( new BoxGeometry( 4, 3, 0.25 ), { position: [ - 14.5, Math.cos( r ) * 2.2, Math.sin( r ) * 2.2 ], rotation: [ r, 0, 0 ], color: 0x2f6fde, flat: true } );
	blimp.add( new RoundedBoxGeometry( 4.5, 1.4, 1.6, 2, 0.3 ), { position: [ 1, - 5.4, 0 ], color: 0x2b2f36 } );
	M.blimp = blimp.build();

	const hg = T();
	hg.add( new BoxGeometry( 3.6, 0.12, 9 ), { rotation: [ 0, 0, 0.08 ], color: 0xb070ff, flat: true } );
	hg.add( new BoxGeometry( 2.2, 0.14, 5 ), { position: [ - 1.2, 0.02, 0 ], color: 0xffc93c, flat: true } );
	hg.add( new CylinderGeometry( 0.04, 0.04, 2.2, 4 ), { position: [ 0.2, - 1.1, 0 ], color: 0x444444 } );
	hg.add( new SphereGeometry( 0.3, 10, 8 ), { position: [ 0.2, - 2.3, 0 ], color: 0xff5a36 } );
	hg.add( new RoundedBoxGeometry( 1.2, 0.4, 0.5, 2, 0.15 ), { position: [ - 0.3, - 2.5, 0 ], color: 0x2f6fde } );
	M.hangglider = hg.build();

	const rival = T();
	const rc = [ 0x3ccf6e, 0xf4efe6 ];
	for ( let i = 0; i < 12; i ++ ) rival.add( new SphereGeometry( 3.6, 3, 16, i / 12 * Math.PI * 2, Math.PI * 2 / 12 ), { position: [ 0, 5.5, 0 ], scale: [ 1, 1.2, 1 ], color: rc[ i % 2 ] } );
	rival.add( new RoundedBoxGeometry( 1.3, 1, 1.3, 2, 0.15 ), { position: [ 0, - 0.2, 0 ], color: 0xb98a4e } );
	for ( const [ x, z ] of [ [ - 0.5, - 0.5 ], [ 0.5, - 0.5 ], [ - 0.5, 0.5 ], [ 0.5, 0.5 ] ] ) rival.add( new CylinderGeometry( 0.03, 0.03, 2.4, 3 ), { position: [ x * 1.4, 1.4, z * 1.4 ], color: 0x3b3b44 } );
	M.rival = rival.build();

	const ufo = T();
	ufo.add( new SphereGeometry( 3.6, 28, 10 ), { scale: [ 1, 0.28, 1 ], color: 0xb8c2cc } );
	ufo.add( new SphereGeometry( 1.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2 ), { position: [ 0, 0.6, 0 ], color: 0x7fe3ff } );
	ufo.add( new TorusGeometry( 3.4, 0.18, 8, 32 ), { rotation: [ Math.PI / 2, 0, 0 ], color: 0x6f7a86 } );
	M.ufo = ufo.build();
	const ufoLights = T();
	for ( let i = 0; i < 10; i ++ ) ufoLights.add( new SphereGeometry( 0.22, 8, 6 ), { position: [ Math.cos( i / 10 * Math.PI * 2 ) * 3.3, - 0.3, Math.sin( i / 10 * Math.PI * 2 ) * 3.3 ], color: i % 2 ? 0x7fff9a : 0xffc93c } );
	M.ufoLights = ufoLights.build();

	// ---- near space
	M.meteor = T().add( new IcosahedronGeometry( 1.6, 1 ), { color: 0x5b4b40, flat: true, jitter: 0.3 } ).build();
	const sat = T();
	sat.add( new BoxGeometry( 1.6, 1.6, 2.2 ), { color: 0xd9a441 } );
	for ( const sx of [ - 1, 1 ] ) {

		sat.add( new BoxGeometry( 0.12, 0.12, 1.5 ), { position: [ sx * 1.5, 0, 0 ], rotation: [ 0, 0, Math.PI / 2 ], color: 0x8f9aa6 } );
		for ( let i = 0; i < 3; i ++ ) sat.add( new BoxGeometry( 1.8, 0.06, 2.2 ), { position: [ sx * ( 2.4 + i * 1.9 ), 0, 0 ], color: 0x1f3f7a, flat: true } );

	}

	sat.add( new SphereGeometry( 0.8, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2 ), { position: [ 0, 1.2, 0 ], rotation: [ Math.PI, 0, 0 ], scale: [ 1, 0.4, 1 ], color: 0xe8eef2 } );
	sat.add( new CylinderGeometry( 0.05, 0.05, 1.4, 4 ), { position: [ 0, 1.6, 0 ], color: 0x8f9aa6 } );
	M.satellite = sat.build();

	const debris = [];
	for ( let k = 0; k < 3; k ++ ) {

		const d = T();
		d.add( new BoxGeometry( 1.2 + k * 0.4, 0.6, 0.9 ), { rotation: [ k, k * 2, 0 ], color: [ 0x8f9aa6, 0xd9a441, 0xf4efe6 ][ k ], flat: true } );
		d.add( new BoxGeometry( 1.8, 0.05, 0.9 ), { position: [ 0.8, 0.4, 0 ], rotation: [ 0.4, 0, 0.3 ], color: 0x1f3f7a, flat: true } );
		d.add( new CylinderGeometry( 0.06, 0.06, 1.6, 4 ), { position: [ - 0.4, 0.2, 0.3 ], rotation: [ 1, 0, 0.5 ], color: 0x6f7a86 } );
		debris.push( d.build() );

	}

	M.debris = debris;

	const iss = T();
	iss.add( new BoxGeometry( 60, 0.8, 0.8 ), { color: 0xb8c2cc } );
	for ( let i = 0; i < 8; i ++ ) {

		const x = ( i - 3.5 ) * 7.2;
		for ( const z of [ - 7, 7 ] ) iss.add( new BoxGeometry( 3.4, 0.08, 11 ), { position: [ x, 0, z ], color: 0xb08a2e, flat: true } );

	}

	iss.add( new CylinderGeometry( 2.2, 2.2, 18, 16 ), { position: [ 0, - 2.6, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xf4efe6 } );
	iss.add( new CylinderGeometry( 2, 2, 12, 16 ), { position: [ 0, - 2.6, 0 ], rotation: [ 0, 0, Math.PI / 2 ], color: 0xe8eef2 } );
	for ( const x of [ - 12, 12 ] ) iss.add( new BoxGeometry( 1.4, 6, 4 ), { position: [ x, 3.6, 0 ], color: 0xe8eef2 } );
	M.iss = iss.build();

	// ---- deep space
	M.asteroids = [ 0, 1, 2 ].map( ( k ) => T().add( new IcosahedronGeometry( 3 + k * 1.5, 1 ), { scale: [ 1, 0.7 + k * 0.1, 0.85 ], color: [ 0x6b5d52, 0x57504a, 0x7a6a5a ][ k ], flat: true, jitter: 0.35 } ).build() );
	M.ice = T().add( new IcosahedronGeometry( 1.8, 0 ), { color: 0xcfe8f5, flat: true, jitter: 0.2 } ).build();
	M.comet = T().add( new IcosahedronGeometry( 3.2, 1 ), { color: 0x9fb4c4, flat: true, jitter: 0.25 } ).build();
	const whale = T();
	whale.add( new SphereGeometry( 5, 24, 14 ), { scale: [ 3, 1.1, 1.2 ], color: 0x2f4f8f } );
	whale.add( new SphereGeometry( 4.6, 20, 12 ), { position: [ 0, - 1.2, 0 ], scale: [ 2.8, 0.7, 1.05 ], color: 0xd8e6f5 } );
	whale.add( new BoxGeometry( 6, 0.4, 9 ), { position: [ - 16, 0, 0 ], rotation: [ 0, 0, 0.1 ], color: 0x2f4f8f, flat: true } );
	for ( const z of [ - 5, 5 ] ) whale.add( new BoxGeometry( 4, 0.3, 3 ), { position: [ 2, - 2.5, z ], rotation: [ z > 0 ? 0.5 : - 0.5, 0, 0 ], color: 0x2f4f8f, flat: true } );
	whale.add( new SphereGeometry( 0.5, 8, 6 ), { position: [ 9.5, 1, 3 ], color: 0x111111 } );
	M.whale = whale.build();
	M.flare = T().add( new TorusGeometry( 16, 2.4, 10, 40, Math.PI ), { color: 0xffffff } ).build();

	// ---- beyond the solar system
	M.plasmoid = T().add( new IcosahedronGeometry( 2.4, 2 ), { color: 0xffffff } ).build();
	// a unit beam along +y (scaled at runtime): pulsar beams, protostar jets, cosmic strings
	M.beam = T().add( new CylinderGeometry( 1, 1, 1, 14, 1, true ), { position: [ 0, 0.5, 0 ], color: 0xffffff } ).build();
	M.beamCore = T().add( new SphereGeometry( 1, 16, 12 ), { color: 0xffffff } ).build();
	M.blob = T().add( new IcosahedronGeometry( 4.2, 3 ), { color: 0xffffff } ).build();
	const ms = T();
	ms.add( new SphereGeometry( 11, 40, 12 ), { scale: [ 1, 0.22, 1 ], color: 0x6f7a86 } );
	ms.add( new SphereGeometry( 5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2 ), { position: [ 0, 1.6, 0 ], scale: [ 1, 0.7, 1 ], color: 0x3b3f48 } );
	ms.add( new TorusGeometry( 10.4, 0.5, 8, 56 ), { rotation: [ Math.PI / 2, 0, 0 ], color: 0x2b2f36 } );
	for ( let i = 0; i < 6; i ++ ) {

		const a = i / 6 * Math.PI * 2;
		ms.add( new BoxGeometry( 3, 1.2, 1.4 ), { position: [ Math.cos( a ) * 8, - 1.4, Math.sin( a ) * 8 ], rotation: [ 0, - a, 0 ], color: 0x8f9aa6 } );

	}

	M.mothership = ms.build();
	const msl = T();
	for ( let i = 0; i < 24; i ++ ) msl.add( new SphereGeometry( 0.45, 8, 6 ), { position: [ Math.cos( i / 24 * Math.PI * 2 ) * 10.2, - 0.8, Math.sin( i / 24 * Math.PI * 2 ) * 10.2 ], color: i % 3 ? 0x7fff9a : 0xff5ad0 } );
	msl.add( new CylinderGeometry( 2.2, 3.2, 0.6, 24 ), { position: [ 0, - 2.4, 0 ], color: 0x9ff0ff } );
	M.mothershipLights = msl.build();
	// warp ring (a hoop to fly through)
	M.ring = T().add( new TorusGeometry( 4.4, 0.32, 10, 56 ), { color: 0xffffff } ).build();

	// ---- pickups
	M.orb = T().add( new SphereGeometry( 1.2, 20, 14 ), { color: 0xffffff } ).build();
	const astro = T();
	astro.add( new RoundedBoxGeometry( 1.2, 1.5, 0.8, 2, 0.3 ), { color: 0xf4efe6 } );
	astro.add( new SphereGeometry( 0.62, 16, 12 ), { position: [ 0, 1.15, 0 ], color: 0xf4efe6 } );
	astro.add( new SphereGeometry( 0.45, 14, 10 ), { position: [ 0, 1.15, 0.25 ], scale: [ 1, 0.8, 0.6 ], color: 0xffb020 } );
	astro.add( new RoundedBoxGeometry( 0.9, 1.1, 0.5, 2, 0.15 ), { position: [ 0, 0.1, - 0.6 ], color: 0xc9d3dc } );
	for ( const sx of [ - 1, 1 ] ) {

		astro.add( new CylinderGeometry( 0.2, 0.2, 1.1, 8 ), { position: [ sx * 0.8, 0.2, 0 ], rotation: [ 0, 0, sx * 0.6 ], color: 0xf4efe6 } );
		astro.add( new CylinderGeometry( 0.22, 0.22, 1.1, 8 ), { position: [ sx * 0.35, - 1.2, 0 ], rotation: [ 0, 0, sx * 0.2 ], color: 0xf4efe6 } );

	}

	M.astronaut = astro.build();
	const probe = T();
	probe.add( new SphereGeometry( 1.8, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.4 ), { position: [ 0, 0.8, 0 ], rotation: [ Math.PI, 0, 0 ], scale: [ 1, 0.35, 1 ], color: 0xf4efe6 } );
	probe.add( new CylinderGeometry( 0.6, 0.6, 0.6, 10 ), { position: [ 0, 1.2, 0 ], color: 0xd9a441 } );
	probe.add( new CylinderGeometry( 0.04, 0.04, 5, 4 ), { position: [ 2.4, 1.2, 0 ], rotation: [ 0, 0, Math.PI / 2 ], color: 0x8f9aa6 } );
	probe.add( new CylinderGeometry( 0.04, 0.04, 4, 4 ), { position: [ - 1.6, 1.4, 1 ], rotation: [ 0.6, 0, Math.PI / 2 ], color: 0x8f9aa6 } );
	probe.add( new CylinderGeometry( 0.35, 0.35, 0.05, 16 ), { position: [ 0, 1.6, 0.62 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xffd23f } );
	M.probe = probe.build();
	M.crystal = T().add( new IcosahedronGeometry( 1.3, 0 ), { scale: [ 0.8, 1.5, 0.8 ], color: 0x7fe3ff, flat: true } ).build();

	return M;

}

// ------------------------------------------------------------------ materials

let MATS = null;

export function mats() {

	if ( MATS ) return MATS;
	const toy = toyMaterials();
	MATS = {
		paint: toy.paint,
		matte: toy.matte,
		metal: toy.metal,
		glow: toy.glow,
		gold: new Material( { name: 'gold', vertexColors: true, roughness: 0.25, metalness: 1, emissive: [ 0.25, 0.16, 0.02 ] } ),
		cloud: new Material( { name: 'storm', vertexColors: true, roughness: 1, surface: 's.albedo *= 0.9;' } ),
		bolt: new Material( { name: 'bolt', lit: false, vertexColors: true, surface: 's.emissive = s.albedo * 40.0; s.albedo = vec3f( 0.0 );' } ),
		trail: new Material( {
			name: 'contrail', lit: false, transparent: true, depthWrite: false, vertexColors: true, uniforms: { fade: [ 'f32', 1 ] },
			surface: /* wgsl */`
	let edge = pow( sat( abs( dot( in.N, in.V ) ) ), 1.5 );
	s.emissive = ( frame.sunColor * 0.18 + frame.skyIrradiance * 2.4 ) * 1.0;
	s.albedo = vec3f( 0.0 );
	s.alpha = edge * 0.65 * mat.fade;
`,
		} ),
		star: new Material( { name: 'star', vertexColors: true, roughness: 0.2, emissive: [ 0.5, 0.2, 0.9 ] } ),
		// glowing orb pickups (shield / magnet / boost): colour by uniform-free vertex colour tint
		orb: new Material( {
			name: 'orb', lit: false, transparent: true, depthWrite: false, blending: 'additive', uniforms: { tint: [ 'vec3f', [ 1, 1, 1 ] ] },
			surface: 'let f = pow( 1.0 - sat( dot( in.N, in.V ) ), 2.0 ); s.albedo = vec3f( 0.0 ); s.emissive = mat.tint * ( 1.5 + f * 12.0 ); s.alpha = 0.35 + f * 0.65;',
		} ),
		plasma: new Material( {
			name: 'plasma', lit: false, transparent: true, depthWrite: false, blending: 'additive', uniforms: { k: [ 'f32', 1 ] },
			surface: 'let f = sat( abs( dot( in.N, in.V ) ) ); let n = 0.6 + 0.4 * sin( in.P.x * 0.7 + frame.time * 6.0 ) * sin( in.P.y * 0.9 - frame.time * 4.0 ); s.albedo = vec3f( 0.0 ); s.emissive = mix( vec3f( 30.0, 8.0, 1.5 ), vec3f( 40.0, 30.0, 12.0 ), f ) * n * mat.k; s.alpha = f * mat.k;',
		} ),
		crystal: new Material( { name: 'crystal', vertexColors: true, roughness: 0.05, metalness: 0.2, emissive: [ 0.1, 0.5, 0.7 ] } ),
		// coloured energy (plasma balls, pulsar beams, jets, cosmic strings): clone per hazard, set tint / k
		energy: new Material( {
			name: 'energy', lit: false, transparent: true, depthWrite: false, blending: 'additive', uniforms: { k: [ 'f32', 1 ], tint: [ 'vec3f', [ 1, 1, 1 ] ] },
			surface: 'let f = sat( abs( dot( in.N, in.V ) ) ); let n = 0.7 + 0.3 * sin( in.P.x * 0.9 + in.P.y * 0.6 + frame.time * 8.0 ); s.albedo = vec3f( 0.0 ); s.emissive = mix( mat.tint * 5.0, mat.tint * 8.0 + vec3f( 2.5 ), pow( f, 4.0 ) ) * n * mat.k; s.alpha = f * mat.k;',
		} ),
		// dark matter: nearly invisible until it is close (reveal)
		dark: new Material( {
			name: 'dark-matter', lit: false, transparent: true, depthWrite: false, uniforms: { reveal: [ 'f32', 0.2 ] },
			surface: 'let f = pow( 1.0 - sat( abs( dot( in.N, in.V ) ) ), 2.0 ); let n = 0.6 + 0.4 * sin( in.P.x * 0.8 + frame.time * 2.0 ) * sin( in.P.y * 0.7 - frame.time * 1.5 ); s.albedo = vec3f( 0.0 ); s.emissive = vec3f( 0.7, 0.25, 1.6 ) * ( 0.25 + f * 4.0 ) * n * mat.reveal; s.alpha = ( 0.2 + f * 0.8 ) * mat.reveal;',
		} ),
		// warp rings
		ring: new Material( {
			name: 'warp-ring', lit: false, transparent: true, depthWrite: false, blending: 'additive', uniforms: { tint: [ 'vec3f', [ 0.35, 0.8, 1.0 ] ] },
			surface: 'let f = sat( abs( dot( in.N, in.V ) ) ); let run = 0.65 + 0.35 * sin( atan2( in.P.y, in.P.x ) * 6.0 - frame.time * 10.0 ); s.albedo = vec3f( 0.0 ); s.emissive = mix( mat.tint * 4.0, mat.tint * 6.0 + vec3f( 1.2 ), f * f * f ) * run; s.alpha = 0.4 + f * 0.6;',
		} ),
	};
	MATS.trail.side = 'double';
	return MATS;

}

export function mesh( geo, mat, shadow = true ) {

	const m = new Mesh( geo, mat );
	m.castShadow = shadow;
	return m;

}

