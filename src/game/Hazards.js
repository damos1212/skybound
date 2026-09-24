import { Group } from '../engine/scene/Group.js';
import { Mesh } from '../engine/scene/Mesh.js';
import { Material } from '../engine/render/Material.js';
import { BoxGeometry, CylinderGeometry, SphereGeometry, ConeGeometry, IcosahedronGeometry, TorusGeometry, RoundedBoxGeometry } from '../engine/geometry/index.js';
import { Vector3, MathUtils } from '../engine/math/index.js';
import { ToyBuilder, toyMaterials } from '../world/Toy.js';
import { islandHeight } from '../world/Island.js';
import { windAt } from './Physics.js';

// Everything in the air besides the player: hazards (birds, kites, drones, gliders, planes, storm
// cells, airliners, weather balloons, jets) and pickups (coins, fuel cans). Spawned ahead of the
// climbing balloon by altitude, moved, collided in the gameplay plane and recycled when left behind.

// ------------------------------------------------------------------ models (built once)

let MODELS = null;

function models() {

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

	return M;

}

// ------------------------------------------------------------------ materials

let MATS = null;

function mats() {

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
	};
	MATS.trail.side = 'double';
	return MATS;

}

function mesh( geo, mat, shadow = true ) {

	const m = new Mesh( geo, mat );
	m.castShadow = shadow;
	return m;

}

// ------------------------------------------------------------------ hazard types

// y ranges (m), relative spawn weight, damage
const TYPES = {
	gulls: { min: 20, max: 1400, weight: 3, damage: 1 },
	kite: { min: 25, max: 260, weight: 2, damage: 1 },
	drone: { min: 120, max: 1600, weight: 2, damage: 1 },
	paraglider: { min: 350, max: 2600, weight: 1.2, damage: 1 },
	seaplane: { min: 500, max: 3200, weight: 1.2, damage: 2 },
	storm: { min: 1800, max: 5200, weight: 1.6, damage: 1 },
	geese: { min: 1100, max: 6500, weight: 2, damage: 1 },
	airliner: { min: 6500, max: 12500, weight: 1.5, damage: 3 },
	weather: { min: 7000, max: 32000, weight: 1.2, damage: 1 },
	jet: { min: 9500, max: 22000, weight: 1.3, damage: 2 },
};

function pickType( y, rnd ) {

	let total = 0;
	const opts = [];
	for ( const k in TYPES ) {

		const t = TYPES[ k ];
		if ( y < t.min || y > t.max ) continue;
		// fade in / out at the ends of the range
		const w = t.weight * Math.min( 1, ( y - t.min ) / 150 + 0.3 ) * Math.min( 1, ( t.max - y ) / 300 + 0.2 );
		opts.push( [ k, w ] );
		total += w;

	}

	let r = rnd() * total;
	for ( const [ k, w ] of opts ) {

		if ( ( r -= w ) <= 0 ) return k;

	}

	return opts.length ? opts[ opts.length - 1 ][ 0 ] : null;

}

function mulberry( seed ) {

	let s = seed >>> 0;
	return () => {

		s = ( s + 0x6D2B79F5 ) >>> 0;
		let t = s;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export class Hazards {

	constructor( scene ) {

		this.scene = scene;
		this.group = new Group();
		this.group.name = 'hazards';
		scene.add( this.group );
		this.items = [];
		this.pickups = [];
		this.rnd = mulberry( 1 );
		this.nextHazardY = 0;
		this.nextCoinY = 0;
		this.nextFuelY = 0;
		this.nextStarY = 0;
		models();
		mats();

	}

	reset( seed = ( Math.random() * 1e9 ) | 0 ) {

		for ( const h of this.items ) this.group.remove( h.mesh );
		for ( const p of this.pickups ) this.group.remove( p.mesh );
		this.items = [];
		this.pickups = [];
		this.rnd = mulberry( seed );
		this.nextHazardY = 45;
		this.nextCoinY = 18;
		this.nextFuelY = 140;
		this.nextStarY = 900;

	}

	// ---------------------------------------------------------------- spawning

	// view: { halfW, halfH } of the visible gameplay plane around the camera target (m)
	spawnAhead( player, view, dt ) {

		const ahead = player.y + view.halfH * 1.6 + Math.max( 0, player.vy ) * 1.2;
		let guard = 0;
		while ( this.nextHazardY < ahead && guard ++ < 8 ) {

			const y = this.nextHazardY;
			const type = pickType( y, this.rnd );
			if ( type ) this._spawnHazard( type, y, player, view );
			this.nextHazardY += this._hazardSpacing( y );

		}

		guard = 0;
		while ( this.nextCoinY < ahead && guard ++ < 8 ) {

			this._spawnCoins( this.nextCoinY, player, view );
			this.nextCoinY += 34 + this.nextCoinY * 0.035 + this.rnd() * 30;

		}

		guard = 0;
		while ( this.nextFuelY < ahead && guard ++ < 4 ) {

			this._spawnPickup( 'fuel', this.nextFuelY, player, view );
			this.nextFuelY += 170 + this.nextFuelY * 0.38 + this.rnd() * 160;

		}

		guard = 0;
		while ( this.nextStarY < ahead && guard ++ < 2 ) {

			this._spawnPickup( 'star', this.nextStarY, player, view );
			this.nextStarY += 1400 + this.nextStarY * 0.4 + this.rnd() * 900;

		}

		void dt;

	}

	_hazardSpacing( y ) {

		// denser near the ground, spreading out as the climb gets faster
		return ( 38 + y * 0.045 ) * ( 0.6 + this.rnd() * 0.8 );

	}

	_placeX( player, view, y, spread = 0.85 ) {

		// where the player will roughly be when reaching y (drift with the wind)
		const t = Math.max( 0, ( y - player.y ) / Math.max( 8, player.vy ) );
		const drift = Math.min( 400, windAt( y ) * Math.min( t, 12 ) * 0.6 );
		return player.x + drift + ( this.rnd() * 2 - 1 ) * view.halfW * spread;

	}

	_spawnHazard( type, y, player, view ) {

		const M = models(), X = mats(), r = this.rnd;
		const g = new Group();
		const h = { type, mesh: g, x: 0, y, vx: 0, vy: 0, t: r() * 10, damage: TYPES[ type ].damage, circles: [], alive: true, warn: false, parts: {} };
		const side = r() < 0.5 ? - 1 : 1;
		const crossX = ( speed ) => {

			h.x = player.x - side * ( view.halfW + 30 + speed * 0.5 );
			h.vx = side * speed;

		};

		switch ( type ) {

			case 'gulls':
			case 'geese': {

				const n = type === 'gulls' ? 2 + Math.floor( r() * 4 ) : 5 + Math.floor( r() * 4 );
				const speed = type === 'gulls' ? 9 + r() * 6 : 16 + r() * 8;
				crossX( speed );
				h.birds = [];
				for ( let i = 0; i < n; i ++ ) {

					const b = new Group();
					const body = mesh( type === 'gulls' ? M.gullBody : M.gooseBody, X.matte );
					const wl = mesh( type === 'gulls' ? M.gullWing : M.gooseWing, X.matte );
					const wr = mesh( type === 'gulls' ? M.gullWing : M.gooseWing, X.matte );
					wr.scale.set( - 1, 1, 1 );
					b.add( body, wl, wr );
					// V formation for geese, loose flock for gulls
					const ox = type === 'geese' ? - Math.abs( i - n / 2 ) * 3.2 : ( r() - 0.5 ) * 9;
					const oy = type === 'geese' ? ( i - n / 2 ) * 2.2 : ( r() - 0.5 ) * 7;
					b.position.set( ox * side, oy, ( r() - 0.5 ) * 4 );
					b.rotation.y = side > 0 ? Math.PI / 2 : - Math.PI / 2;
					b.scale.setScalar( type === 'gulls' ? 1.25 : 1.35 );
					g.add( b );
					h.birds.push( { g: b, wl, wr, phase: r() * 6, ox: b.position.x, oy } );
					h.circles.push( { ox: b.position.x, oy, r: 1.6 } );

				}

				break;

			}

			case 'kite': {

				h.x = this._placeX( player, view, y, 0.7 );
				h.anchor = { x: h.x - 25 - r() * 30, y: Math.max( 0.5, islandHeight( h.x - 30, 0 ) ) };
				const k = mesh( M.kite, X.paint );
				k.scale.setScalar( 1.4 );
				g.add( k );
				h.parts.kite = k;
				h.line = mesh( new ToyBuilder().add( new CylinderGeometry( 0.05, 0.05, 1, 4 ), { color: 0x3b3b44 } ).build(), X.matte, false );
				this.group.add( h.line );
				h.circles.push( { ox: 0, oy: 0, r: 1.9 } );
				break;

			}

			case 'drone': {

				h.x = this._placeX( player, view, y, 0.9 );
				h.home = { x: h.x, y };
				g.add( mesh( M.drone, X.paint ) );
				g.add( mesh( M.droneLed, X.glow, false ) );
				g.scale.setScalar( 1.4 );
				h.circles.push( { ox: 0, oy: 0, r: 1.9 } );
				break;

			}

			case 'paraglider': {

				crossX( 6 + r() * 4 );
				h.vy = - 1.2;
				const p = mesh( M.paraglider, X.paint );
				p.rotation.y = side > 0 ? 0 : Math.PI;
				g.add( p );
				h.circles.push( { ox: 0, oy: - 1.2, r: 3.6 }, { ox: - 3.2, oy: - 2.2, r: 1.8 }, { ox: 3.2, oy: - 2.2, r: 1.8 }, { ox: 0, oy: - 7.2, r: 1.0 } );
				break;

			}

			case 'seaplane': {

				crossX( 38 + r() * 14 );
				const p = mesh( M.seaplane, X.paint );
				const prop = mesh( M.prop, X.matte );
				prop.position.set( 4.75, 0, 0 );
				p.add( prop );
				p.rotation.y = side > 0 ? 0 : Math.PI;
				g.add( p );
				h.parts.prop = prop;
				h.warn = true;
				h.circles.push( { ox: 0, oy: 0, r: 2.2 }, { ox: 2.8 * side, oy: 0, r: 1.6 }, { ox: - 3 * side, oy: 0.6, r: 1.5 }, { ox: 1.2 * side, oy: 0.8, r: 1.2 }, { ox: 1.0 * side, oy: - 1.6, r: 1.1 } );
				break;

			}

			case 'storm': {

				h.x = this._placeX( player, view, y, 0.7 );
				const c = mesh( M.storm, X.cloud );
				g.add( c );
				g.scale.setScalar( 1.2 + r() * 0.5 );
				const bolt = mesh( M.bolt, X.bolt, false );
				bolt.position.set( 0, - 4, 3 );
				bolt.visible = false;
				g.add( bolt );
				h.parts.bolt = bolt;
				h.strike = 2 + r() * 2.5;
				h.circles.push( { ox: 0, oy: 0, r: 0, off: true } );
				break;

			}

			case 'airliner': {

				crossX( 150 + r() * 60 );
				const a = mesh( M.airliner, X.paint );
				a.rotation.y = side > 0 ? 0 : Math.PI;
				g.add( a );
				const trail = mesh( M.contrail, X.trail, false );
				trail.layers.set( 2 );
				this.group.add( trail );
				h.trail = trail;
				h.warn = true;
				for ( let i = - 3; i <= 3; i ++ ) h.circles.push( { ox: i * 5 * side, oy: 0, r: 2.6 } );
				h.circles.push( { ox: 1 * side, oy: - 0.8, r: 3.5 }, { ox: - 18 * side, oy: 4, r: 2.5 } );
				break;

			}

			case 'weather': {

				h.x = this._placeX( player, view, y, 0.8 );
				h.vy = 4 + r() * 3;
				g.add( mesh( M.weather, X.paint ) );
				h.circles.push( { ox: 0, oy: 0, r: 3.4 }, { ox: 0, oy: - 9.5, r: 0.8 } );
				break;

			}

			case 'jet': {

				crossX( 260 + r() * 80 );
				const j = mesh( M.jet, X.metal );
				j.rotation.y = side > 0 ? 0 : Math.PI;
				g.add( j );
				h.warn = true;
				h.circles.push( { ox: 0, oy: 0, r: 1.6 }, { ox: 5 * side, oy: 0, r: 1.2 }, { ox: - 3 * side, oy: 0, r: 2.8 } );
				break;

			}

		}

		g.position.set( h.x, h.y, 0 );
		this.group.add( g );
		this.items.push( h );

	}

	_spawnCoins( y, player, view ) {

		const r = this.rnd;
		const x0 = this._placeX( player, view, y, 0.6 );
		const value = y < 300 ? 2 : y < 1500 ? 5 : y < 5000 ? 10 : y < 12000 ? 25 : 60;
		const pattern = Math.floor( r() * 4 );
		const pts = [];
		if ( pattern === 0 ) for ( let i = 0; i < 5; i ++ ) pts.push( [ 0, i * 3.2 ] );
		else if ( pattern === 1 ) for ( let i = 0; i < 7; i ++ ) pts.push( [ Math.sin( i / 6 * Math.PI ) * 6 - 3, i * 3 ] );
		else if ( pattern === 2 ) for ( let i = 0; i < 8; i ++ ) pts.push( [ Math.cos( i / 8 * Math.PI * 2 ) * 5, Math.sin( i / 8 * Math.PI * 2 ) * 5 ] );
		else for ( let i = 0; i < 6; i ++ ) pts.push( [ ( i - 2.5 ) * 3, Math.abs( i - 2.5 ) * 1.5 ] );
		for ( const [ dx, dy ] of pts ) this._addPickup( 'coin', x0 + dx, y + dy, value );

	}

	_spawnPickup( kind, y, player, view ) {

		this._addPickup( kind, this._placeX( player, view, y, 0.55 ), y, kind === 'star' ? Math.round( 50 + y * 0.05 ) : 0 );

	}

	_addPickup( kind, x, y, value ) {

		const M = models(), X = mats();
		const m = kind === 'coin' ? mesh( M.coin, X.gold ) : kind === 'fuel' ? mesh( M.fuel, X.paint ) : mesh( M.star, X.star );
		if ( kind === 'coin' ) m.scale.setScalar( 1.15 );
		m.position.set( x, y, 0 );
		this.group.add( m );
		this.pickups.push( { kind, x, y, value, mesh: m, t: this.rnd() * 6, r: kind === 'coin' ? 1.3 : 2.0, alive: true } );

	}

	// ---------------------------------------------------------------- update

	update( dt, player, view, time ) {

		const keepBelow = player.y - view.halfH * 2.5 - 60;
		const farX = view.halfW * 3.5 + 400;
		for ( const h of this.items ) {

			h.t += dt;
			switch ( h.type ) {

				case 'gulls':
				case 'geese':
					for ( const b of h.birds ) {

						const flap = Math.sin( h.t * ( h.type === 'gulls' ? 9 : 6 ) + b.phase );
						b.wl.rotation.z = flap * 0.7;
						b.wr.rotation.z = - flap * 0.7;
						b.g.position.y = b.oy + Math.sin( h.t * 1.3 + b.phase ) * 0.6;

					}

					break;
				case 'kite': {

					const sway = Math.sin( h.t * 0.8 ) * 6 + Math.sin( h.t * 2.1 ) * 1.5;
					h.x = h.anchor.x + 30 + sway;
					h.parts.kite.rotation.z = Math.sin( h.t * 1.7 ) * 0.35;
					// the line from the beach up to the kite
					const dx = h.x - h.anchor.x, dy = h.y - h.anchor.y;
					const len = Math.hypot( dx, dy );
					h.line.position.set( ( h.x + h.anchor.x ) / 2, ( h.y + h.anchor.y ) / 2, - 0.2 );
					h.line.scale.set( 1, len, 1 );
					h.line.rotation.set( 0, 0, - Math.atan2( dx, dy ) );
					break;

				}

				case 'drone':
					h.x = h.home.x + Math.sin( h.t * 0.5 ) * 14;
					h.y = h.home.y + Math.sin( h.t * 0.9 ) * 4;
					h.mesh.rotation.set( 0, h.t * 0.3, Math.cos( h.t * 0.5 ) * 0.15 );
					break;
				case 'seaplane':
					h.parts.prop.rotation.x = h.t * 40;
					h.y += Math.sin( h.t * 0.7 ) * 0.05;
					break;
				case 'storm': {

					h.x += windAt( h.y, time ) * 0.4 * dt;
					h.strike -= dt;
					const bolt = h.parts.bolt;
					if ( h.strike <= 0 ) {

						bolt.visible = true;
						bolt.rotation.z = ( this.rnd() - 0.5 ) * 0.8;
						h.flash = 0.35;
						h.strike = 2.2 + this.rnd() * 2.5;
						h.circles[ 0 ].off = false;
						h.circles[ 0 ].oy = - 18;
						h.circles[ 0 ].r = 9;
						h.onStrike && h.onStrike( h );

					}

					if ( h.flash > 0 ) {

						h.flash -= dt;
						bolt.scale.set( 1, 1 + ( 0.35 - h.flash ) * 2, 1 );
						if ( h.flash <= 0 ) {

							bolt.visible = false;
							h.circles[ 0 ].off = true;

						}

					}

					break;

				}

				case 'airliner': {

					// contrail stretching behind
					const len = Math.min( 900, h.t * Math.abs( h.vx ) );
					const dir = Math.sign( h.vx );
					h.trail.position.set( h.x - dir * ( 12 + len / 2 ), h.y - 1.9, - 1 );
					h.trail.scale.set( len, 1 + len * 0.004, 1 + len * 0.004 );
					h.trail.rotation.set( 0, dir > 0 ? 0 : Math.PI, 0 );
					break;

				}

				case 'weather':
					h.mesh.rotation.z = Math.sin( h.t * 0.6 ) * 0.08;
					break;

			}

			h.x += h.vx * dt;
			h.y += h.vy * dt;
			h.mesh.position.set( h.x, h.y, 0 );
			if ( h.y < keepBelow || Math.abs( h.x - player.x ) > farX + Math.abs( h.vx ) * 3 ) h.alive = false;

		}

		for ( const p of this.pickups ) {

			p.t += dt;
			if ( p.kind === 'coin' ) p.mesh.rotation.set( 0, p.t * 3, 0 );
			else if ( p.kind === 'fuel' ) {

				p.y -= 1.2 * dt;
				p.mesh.rotation.z = Math.sin( p.t * 1.5 ) * 0.15;

			} else {

				p.mesh.rotation.set( p.t, p.t * 1.3, 0 );
				p.mesh.scale.setScalar( 1 + Math.sin( p.t * 5 ) * 0.12 );

			}

			if ( p.pulled ) {

				p.x += p.pulled.x * dt;
				p.y += p.pulled.y * dt;

			}

			p.mesh.position.set( p.x, p.y, 0 );
			if ( p.y < keepBelow ) p.alive = false;

		}

		this._sweep();

	}

	_sweep() {

		const keep = [];
		for ( const h of this.items ) {

			if ( h.alive ) keep.push( h );
			else {

				this.group.remove( h.mesh );
				if ( h.line ) this.group.remove( h.line );
				if ( h.trail ) this.group.remove( h.trail );

			}

		}

		this.items = keep;
		const kp = [];
		for ( const p of this.pickups ) {

			if ( p.alive ) kp.push( p );
			else this.group.remove( p.mesh );

		}

		this.pickups = kp;

	}

	// ---------------------------------------------------------------- collisions

	// circles: world-space [ { x, y, r } ] of the player. Returns the first hazard hit (or null).
	hitTest( circles ) {

		for ( const h of this.items ) {

			if ( h.spent ) continue;
			for ( const c of h.circles ) {

				if ( c.off ) continue;
				const hx = h.x + c.ox * ( h.mesh.scale.x ), hy = h.y + c.oy * ( h.mesh.scale.y );
				const hr = c.r * h.mesh.scale.x;
				for ( const p of circles ) {

					const dx = p.x - hx, dy = p.y - hy;
					if ( dx * dx + dy * dy < ( p.r + hr ) * ( p.r + hr ) ) return { hazard: h, x: hx, y: hy };

				}

			}

		}

		return null;

	}

	// pickups within reach (and magnet pull toward `center`)
	collect( circles, center, magnet ) {

		const got = [];
		for ( const p of this.pickups ) {

			if ( ! p.alive ) continue;
			if ( magnet > 0 ) {

				const dx = center.x - p.x, dy = center.y - p.y;
				const d = Math.hypot( dx, dy );
				if ( d < magnet ) {

					const s = ( 1 - d / magnet ) * 60 + 12;
					p.pulled = { x: dx / d * s, y: dy / d * s };

				}

			}

			for ( const c of circles ) {

				const dx = c.x - p.x, dy = c.y - p.y;
				if ( dx * dx + dy * dy < ( c.r + p.r ) * ( c.r + p.r ) ) {

					p.alive = false;
					got.push( p );
					break;

				}

			}

		}

		return got;

	}

}

export { MathUtils };
