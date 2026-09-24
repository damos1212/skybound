import { Group } from '../engine/scene/Group.js';
import { CylinderGeometry } from '../engine/geometry/index.js';
import { ToyBuilder } from '../world/Toy.js';
import { islandHeight } from '../world/Island.js';
import { windAt } from './Physics.js';
import { zoneAt } from './Zones.js';
import { models, mats, mesh } from './Models.js';

// Everything in the air (or the void) besides the player: hazards and pickups, spawned ahead of the
// climbing vehicle by altitude / route zone, moved, collided in the gameplay plane (x, y) and
// recycled once left behind.
//
// Coordinates are the game's local frame (see App.originY): on the ground it is the real world; high
// up and in space the player's local y advances at a capped "visual" speed, so the obstacles come at a
// dodgeable pace whatever the true speed. `ctx.h` is the real altitude / route distance (m) that picks
// what spawns, `ctx.hRate` the real metres per local metre ahead.

// type registry: min / max (real metres) or zones (ids), weight, damage, flags
const TYPES = {
	// ---- Earth
	gulls: { min: 20, max: 1400, weight: 3, damage: 1 },
	kite: { min: 25, max: 260, weight: 2, damage: 1 },
	drone: { min: 120, max: 1600, weight: 2, damage: 1 },
	heli: { min: 150, max: 1800, weight: 1.2, damage: 2, warn: true },
	hangglider: { min: 200, max: 1500, weight: 1, damage: 1 },
	rival: { min: 300, max: 4000, weight: 1, damage: 1 },
	paraglider: { min: 350, max: 2600, weight: 1, damage: 1 },
	seaplane: { min: 500, max: 3200, weight: 1.2, damage: 2, warn: true },
	blimp: { min: 600, max: 2600, weight: 0.8, damage: 2 },
	storm: { min: 1800, max: 5200, weight: 1.6, damage: 1 },
	geese: { min: 1100, max: 6500, weight: 2, damage: 1 },
	airliner: { min: 6500, max: 12500, weight: 1.5, damage: 3, warn: true },
	weather: { min: 7000, max: 36000, weight: 1.2, damage: 1 },
	jet: { min: 9500, max: 22000, weight: 1.3, damage: 2, warn: true },
	ufo: { min: 3000, max: 90000, weight: 0.5, damage: 2, night: true },
	// ---- near space
	meteor: { min: 40000, max: 1.2e6, weight: 2.2, damage: 2 },
	satellite: { min: 150000, max: 4.2e7, weight: 2.2, damage: 2 },
	debris: { min: 200000, max: 4.2e7, weight: 2.6, damage: 1 },
	// ---- deep space
	asteroid: { zones: [ 'cislunar', 'moon', 'mars', 'jupiter', 'alphacen', 'trappist' ], weight: 2.5, damage: 2 },
	flare: { zones: [ 'sun', 'alphacen', 'betelgeuse' ], weight: 3, damage: 2 },
	ice: { zones: [ 'saturn', 'neptune', 'kuiper', 'trappist' ], weight: 3, damage: 1 },
	comet: { zones: [ 'jupiter', 'saturn', 'neptune', 'kuiper', 'interstellar', 'alphacen', 'trappist' ], weight: 1.4, damage: 2, warn: true },
	spaceufo: { zones: [ 'mars', 'kuiper', 'interstellar', 'blackhole', 'trappist', 'orion', 'crab', 'halo', 'omegacen', 'lmc', 'andromeda', 'virgo', 'laniakea' ], weight: 1, damage: 2 },
	whale: { zones: [ 'neptune', 'kuiper', 'interstellar', 'orion', 'lmc', 'andromeda', 'elgordo' ], weight: 0.6, damage: 3 },
	spacedebris: { zones: [ 'moon', 'mars', 'sun', 'jupiter', 'saturn', 'neptune', 'kuiper', 'interstellar', 'blackhole', 'alphacen', 'trappist' ], weight: 1.5, damage: 1 },
	// ---- other stars, nebulae and the galactic centre
	plasmoid: { zones: [ 'alphacen', 'betelgeuse', 'crab', 'blackhole' ], weight: 2.4, damage: 2 },
	beam: { zones: [ 'crab' ], weight: 3.2, damage: 2, warn: true },
	protostar: { zones: [ 'orion' ], weight: 2.8, damage: 2 },
	hvstar: { zones: [ 'blackhole', 'halo', 'omegacen', 'lmc', 'andromeda' ], weight: 1.6, damage: 3, warn: true },
	// ---- between the galaxies
	darkmatter: { zones: [ 'halo', 'omegacen', 'lmc', 'andromeda', 'virgo', 'laniakea', 'quasar', 'elgordo', 'edge' ], weight: 2.4, damage: 2 },
	mothership: { zones: [ 'lmc', 'andromeda', 'virgo', 'quasar' ], weight: 0.9, damage: 3, warn: true },
	cstring: { zones: [ 'laniakea', 'elgordo', 'edge' ], weight: 2.2, damage: 2 },
	jetburst: { zones: [ 'virgo', 'quasar' ], weight: 1.8, damage: 2 },
};

// energy colours by hazard (and zone)
const ENERGY = { plasmoid: [ 1, 0.5, 0.12 ], plasmoidBlue: [ 0.4, 0.6, 1 ], plasmoidPink: [ 1, 0.35, 0.8 ], beam: [ 0.55, 0.75, 1 ], protostar: [ 1, 0.75, 0.9 ], jet: [ 0.6, 0.8, 1 ], hvstar: [ 1, 0.9, 0.7 ], cstring: [ 0.7, 0.4, 1 ], jetburst: [ 0.55, 0.6, 1 ] };

function pickType( h, zoneId, night, rnd ) {

	let total = 0;
	const opts = [];
	for ( const k in TYPES ) {

		const t = TYPES[ k ];
		if ( t.night && ! night ) continue;
		let w = 0;
		if ( t.zones ) {

			if ( t.zones.includes( zoneId ) ) w = t.weight;

		} else if ( h >= t.min && h <= t.max ) {

			const span = t.max - t.min;
			w = t.weight * Math.min( 1, ( h - t.min ) / Math.max( 150, span * 0.1 ) + 0.3 ) * Math.min( 1, ( t.max - h ) / Math.max( 300, span * 0.1 ) + 0.2 );

		}

		if ( w > 0 ) {

			opts.push( [ k, w ] );
			total += w;

		}

	}

	let r = rnd() * total;
	for ( const [ k, w ] of opts ) if ( ( r -= w ) <= 0 ) return k;
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

const ORB_COLORS = { shieldOrb: [ 0.4, 0.8, 1.0 ], magnetOrb: [ 1.0, 0.35, 0.3 ], boostOrb: [ 1.0, 0.8, 0.2 ] };

export class Hazards {

	constructor( scene, particles ) {

		this.scene = scene;
		this.particles = particles;
		this.group = new Group();
		this.group.name = 'hazards';
		scene.add( this.group );
		this.items = [];
		this.pickups = [];
		this.rnd = mulberry( 1 );
		this.onEvent = null;
		models();
		const X = mats();
		this.orbMats = {};
		for ( const k in ORB_COLORS ) {

			this.orbMats[ k ] = X.orb.clone();
			this.orbMats[ k ].set( 'tint', ORB_COLORS[ k ] );

		}

		this.reset();

	}

	reset( seed = ( Math.random() * 1e9 ) | 0, startY = 0 ) {

		for ( const h of this.items ) this._remove( h );
		for ( const p of this.pickups ) this.group.remove( p.mesh );
		this.items = [];
		this.pickups = [];
		this.rnd = mulberry( seed );
		this.nextHazardY = startY + 45;
		this.nextCoinY = startY + 18;
		this.nextFuelY = startY + 140;
		this.nextStarY = startY + 700;
		this.nextOrbY = startY + 400;
		this.nextSpecialY = startY + 300;
		this.nextRingY = startY + 160;
		this.issDone = false;

	}

	_remove( h ) {

		this.group.remove( h.mesh );
		if ( h.line ) this.group.remove( h.line );
		if ( h.trail ) this.group.remove( h.trail );

	}

	// ---------------------------------------------------------------- spawning

	// player: local { x, y, vy }, view: { halfW, halfH }, ctx: { h, local, night, hRate, localSpeed }
	spawnAhead( player, view, ctx ) {

		const ahead = player.y + view.halfH * 1.6 + Math.max( 0, player.vy ) * 1.2;
		const realAt = ( y ) => ctx.h + ( y - player.y ) * ( ctx.hRate || 1 );
		let guard = 0;
		while ( this.nextHazardY < ahead && guard ++ < 8 ) {

			const y = this.nextHazardY;
			const h = realAt( y );
			const type = pickType( h, zoneAt( h ).id, ctx.night, this.rnd );
			if ( type ) this._spawnHazard( type, y, player, view, ctx );
			this.nextHazardY += this._spacing( h, ctx );

		}

		guard = 0;
		while ( this.nextCoinY < ahead && guard ++ < 8 ) {

			this._spawnCoins( this.nextCoinY, player, view, zoneAt( realAt( this.nextCoinY ) ), ctx );
			this.nextCoinY += ctx.local ? 40 + this.rnd() * 30 : 34 + this.nextCoinY * 0.035 + this.rnd() * 30;

		}

		guard = 0;
		while ( this.nextFuelY < ahead && guard ++ < 4 ) {

			this._spawnPickup( 'fuel', this.nextFuelY, player, view, 0, ctx );
			this.nextFuelY += ctx.local ? 380 + this.rnd() * 300 : 170 + this.nextFuelY * 0.38 + this.rnd() * 160;

		}

		guard = 0;
		while ( this.nextStarY < ahead && guard ++ < 2 ) {

			const z = zoneAt( realAt( this.nextStarY ) );
			this._spawnPickup( 'star', this.nextStarY, player, view, z.coin * 25, ctx );
			this.nextStarY += ctx.local ? 900 + this.rnd() * 700 : 1400 + this.nextStarY * 0.4 + this.rnd() * 900;

		}

		guard = 0;
		while ( this.nextOrbY < ahead && guard ++ < 2 ) {

			const kinds = [ 'shieldOrb', 'magnetOrb', 'boostOrb' ];
			this._spawnPickup( kinds[ ( this.rnd() * 3 ) | 0 ], this.nextOrbY, player, view, 0, ctx );
			this.nextOrbY += ctx.local ? 520 + this.rnd() * 500 : 600 + this.nextOrbY * 0.3 + this.rnd() * 600;

		}

		// ring chains: warp rings in space, hoops in the sky (not right over the beach)
		guard = 0;
		while ( this.nextRingY < ahead && guard ++ < 2 ) {

			const h = realAt( this.nextRingY );
			if ( h > 60 ) this._spawnRingChain( this.nextRingY, player, view, zoneAt( h ), ctx.local ? 1 : 0.35 );
			this.nextRingY += ctx.local ? 280 + this.rnd() * 240 : 220 + this.nextRingY * 0.12 + this.rnd() * 200;

		}

		// high up and in space: stranded astronauts, lost probes, crystals, the space station
		if ( ctx.local ) {

			guard = 0;
			while ( this.nextSpecialY < ahead && guard ++ < 2 ) {

				const z = zoneAt( realAt( this.nextSpecialY ) );
				const roll = this.rnd();
				const kind = z.space ? ( roll < 0.45 ? 'crystal' : roll < 0.75 ? 'probe' : 'astronaut' ) : roll < 0.6 ? 'astronaut' : 'crystal';
				this._spawnPickup( kind, this.nextSpecialY, player, view, z.coin * ( kind === 'crystal' ? 12 : 40 ), ctx );
				this.nextSpecialY += 700 + this.rnd() * 900;

			}

			if ( ! this.issDone && ctx.h > 380000 && ctx.h < 480000 ) {

				this.issDone = true;
				this._spawnHazard( 'iss', player.y + view.halfH * 1.4, player, view, ctx );

			}

		}

	}

	_spacing( h, ctx ) {

		if ( ctx.local ) return ( 55 + ( ctx.localSpeed || 80 ) * 0.5 ) * ( 0.6 + this.rnd() * 0.8 );
		return ( 38 + h * 0.045 ) * ( 0.6 + this.rnd() * 0.8 );

	}

	_placeX( player, view, y, spread = 0.85, ctx = null ) {

		let drift = 0;
		if ( ! ctx || ! ctx.local ) {

			const t = Math.max( 0, ( y - player.y ) / Math.max( 8, player.vy ) );
			drift = Math.min( 400, windAt( y ) * Math.min( t, 12 ) * 0.6 );

		}

		return player.x + drift + ( this.rnd() * 2 - 1 ) * view.halfW * spread;

	}

	_spawnHazard( type, y, player, view, ctx ) {

		const M = models(), X = mats(), r = this.rnd;
		const g = new Group();
		const t = TYPES[ type ] || { damage: 3 };
		const item = { type, mesh: g, x: 0, y, vx: 0, vy: 0, t: r() * 10, damage: t.damage, circles: [], alive: true, warn: !! t.warn, parts: {} };
		const side = r() < 0.5 ? - 1 : 1;
		const crossX = ( speed ) => {

			item.x = player.x - side * ( view.halfW + 30 + speed * 0.5 );
			item.vx = side * speed;

		};

		const face = ( m ) => {

			m.rotation.y = side > 0 ? 0 : Math.PI;
			return m;

		};

		const local = { local: true };

		switch ( type ) {

			case 'gulls':
			case 'geese': {

				const n = type === 'gulls' ? 2 + Math.floor( r() * 4 ) : 5 + Math.floor( r() * 4 );
				crossX( type === 'gulls' ? 9 + r() * 6 : 16 + r() * 8 );
				item.birds = [];
				for ( let i = 0; i < n; i ++ ) {

					const b = new Group();
					const wl = mesh( type === 'gulls' ? M.gullWing : M.gooseWing, X.matte );
					const wr = mesh( type === 'gulls' ? M.gullWing : M.gooseWing, X.matte );
					wr.scale.set( - 1, 1, 1 );
					b.add( mesh( type === 'gulls' ? M.gullBody : M.gooseBody, X.matte ), wl, wr );
					const ox = type === 'geese' ? - Math.abs( i - n / 2 ) * 3.2 : ( r() - 0.5 ) * 9;
					const oy = type === 'geese' ? ( i - n / 2 ) * 2.2 : ( r() - 0.5 ) * 7;
					b.position.set( ox * side, oy, ( r() - 0.5 ) * 4 );
					b.rotation.y = side > 0 ? Math.PI / 2 : - Math.PI / 2;
					b.scale.setScalar( type === 'gulls' ? 1.25 : 1.35 );
					g.add( b );
					item.birds.push( { g: b, wl, wr, phase: r() * 6, oy } );
					item.circles.push( { ox: b.position.x, oy, r: 1.6 } );

				}

				break;

			}

			case 'kite': {

				item.x = this._placeX( player, view, y, 0.7 );
				item.anchor = { x: item.x - 25 - r() * 30, y: Math.max( 0.5, islandHeight( item.x - 30, 0 ) ) };
				const k = mesh( M.kite, X.paint );
				k.scale.setScalar( 1.4 );
				g.add( k );
				item.parts.kite = k;
				item.line = mesh( new ToyBuilder().add( new CylinderGeometry( 0.05, 0.05, 1, 4 ), { color: 0x3b3b44 } ).build(), X.matte, false );
				this.group.add( item.line );
				item.circles.push( { ox: 0, oy: 0, r: 1.9 } );
				break;

			}

			case 'drone':
				item.x = this._placeX( player, view, y, 0.9 );
				item.home = { x: item.x, y };
				g.add( mesh( M.drone, X.paint ), mesh( M.droneLed, X.glow, false ) );
				g.scale.setScalar( 1.4 );
				item.circles.push( { ox: 0, oy: 0, r: 1.9 } );
				break;

			case 'heli': {

				crossX( 22 + r() * 10 );
				const body = face( mesh( M.heli, X.paint ) );
				const rotor = mesh( M.rotor, X.matte );
				rotor.position.set( 0, 1.75, 0 );
				body.add( rotor );
				g.add( body );
				item.parts.rotor = rotor;
				item.circles.push( { ox: 0, oy: 0, r: 2.1 }, { ox: - 3.6 * side, oy: 0.3, r: 1 }, { ox: - 3 * side, oy: 1.75, r: 1.5 }, { ox: 3 * side, oy: 1.75, r: 1.5 } );
				break;

			}

			case 'hangglider': {

				crossX( 11 + r() * 5 );
				item.vy = - 0.8;
				const m = mesh( M.hangglider, X.paint );
				m.rotation.y = side > 0 ? Math.PI / 2 : - Math.PI / 2;
				g.add( m );
				item.circles.push( { ox: 0, oy: 0, r: 2.4 }, { ox: 0, oy: - 2.3, r: 0.9 } );
				break;

			}

			case 'rival':
				item.x = this._placeX( player, view, y, 0.8 );
				item.vy = 2 + r() * 3;
				g.add( mesh( M.rival, X.paint ) );
				g.scale.setScalar( 1.2 );
				item.circles.push( { ox: 0, oy: 5.5, r: 3.8 }, { ox: 0, oy: - 0.2, r: 0.9 } );
				break;

			case 'paraglider':
				crossX( 6 + r() * 4 );
				item.vy = - 1.2;
				g.add( face( mesh( M.paraglider, X.paint ) ) );
				item.circles.push( { ox: 0, oy: - 1.2, r: 3.6 }, { ox: - 3.2, oy: - 2.2, r: 1.8 }, { ox: 3.2, oy: - 2.2, r: 1.8 }, { ox: 0, oy: - 7.2, r: 1.0 } );
				break;

			case 'seaplane': {

				crossX( 38 + r() * 14 );
				const p = face( mesh( M.seaplane, X.paint ) );
				const prop = mesh( M.prop, X.matte );
				prop.position.set( 4.75, 0, 0 );
				p.add( prop );
				g.add( p );
				item.parts.prop = prop;
				item.circles.push( { ox: 0, oy: 0, r: 2.2 }, { ox: 2.8 * side, oy: 0, r: 1.6 }, { ox: - 3 * side, oy: 0.6, r: 1.5 }, { ox: 1.2 * side, oy: 0.8, r: 1.2 }, { ox: 1.0 * side, oy: - 1.6, r: 1.1 } );
				break;

			}

			case 'blimp':
				crossX( 5 + r() * 3 );
				g.add( face( mesh( M.blimp, X.paint ) ) );
				for ( let i = - 2; i <= 2; i ++ ) item.circles.push( { ox: i * 5.5, oy: 0, r: 4.6 - Math.abs( i ) * 0.8 } );
				break;

			case 'storm': {

				item.x = this._placeX( player, view, y, 0.7 );
				g.add( mesh( M.storm, X.cloud ) );
				g.scale.setScalar( 1.2 + r() * 0.5 );
				const bolt = mesh( M.bolt, X.bolt, false );
				bolt.position.set( 0, - 4, 3 );
				bolt.visible = false;
				g.add( bolt );
				item.parts.bolt = bolt;
				item.strike = 2 + r() * 2.5;
				item.circles.push( { ox: 0, oy: 0, r: 0, off: true } );
				break;

			}

			case 'airliner': {

				crossX( 150 + r() * 60 );
				g.add( face( mesh( M.airliner, X.paint ) ) );
				const trail = mesh( M.contrail, X.trail, false );
				trail.layers.set( 2 );
				this.group.add( trail );
				item.trail = trail;
				for ( let i = - 3; i <= 3; i ++ ) item.circles.push( { ox: i * 5 * side, oy: 0, r: 2.6 } );
				item.circles.push( { ox: 1 * side, oy: - 0.8, r: 3.5 }, { ox: - 18 * side, oy: 4, r: 2.5 } );
				break;

			}

			case 'weather':
				item.x = this._placeX( player, view, y, 0.8, ctx );
				item.vy = ctx.local ? 0 : 4 + r() * 3;
				g.add( mesh( M.weather, X.paint ) );
				item.circles.push( { ox: 0, oy: 0, r: 3.4 }, { ox: 0, oy: - 9.5, r: 0.8 } );
				break;

			case 'jet':
				crossX( 260 + r() * 80 );
				g.add( face( mesh( M.jet, X.metal ) ) );
				item.circles.push( { ox: 0, oy: 0, r: 1.6 }, { ox: 5 * side, oy: 0, r: 1.2 }, { ox: - 3 * side, oy: 0, r: 2.8 } );
				break;

			case 'ufo':
			case 'spaceufo': {

				crossX( 30 + r() * 25 );
				g.add( mesh( M.ufo, X.metal ) );
				const lights = mesh( M.ufoLights, X.glow, false );
				g.add( lights );
				item.wobble = r() * 6;
				item.circles.push( { ox: 0, oy: 0, r: 3.6 } );
				break;

			}

			case 'meteor': {

				item.x = player.x + ( r() * 2 - 1 ) * view.halfW * 1.2;
				item.vx = ( r() - 0.5 ) * 30;
				item.vy = - 40 - r() * 40;
				const m = mesh( M.meteor, X.matte );
				m.scale.setScalar( 1 + r() * 1.2 );
				g.add( m );
				item.spin = ( r() - 0.5 ) * 4;
				item.circles.push( { ox: 0, oy: 0, r: 1.7 * m.scale.x } );
				break;

			}

			case 'satellite':
				crossX( 12 + r() * 14 );
				g.add( mesh( M.satellite, X.paint ) );
				item.spin = ( r() - 0.5 ) * 0.6;
				item.circles.push( { ox: 0, oy: 0, r: 1.6 }, { ox: - 4.2, oy: 0, r: 1.2 }, { ox: 4.2, oy: 0, r: 1.2 }, { ox: - 7.2, oy: 0, r: 1.2 }, { ox: 7.2, oy: 0, r: 1.2 } );
				break;

			case 'debris':
			case 'spacedebris': {

				item.x = this._placeX( player, view, y, 1.0, local );
				item.vx = ( r() - 0.5 ) * 14;
				item.vy = ( r() - 0.5 ) * 6;
				const n = 1 + Math.floor( r() * 3 );
				for ( let i = 0; i < n; i ++ ) {

					const d = mesh( M.debris[ ( r() * 3 ) | 0 ], X.paint );
					d.position.set( ( r() - 0.5 ) * 6, ( r() - 0.5 ) * 6, ( r() - 0.5 ) * 3 );
					d.rotation.set( r() * 6, r() * 6, r() * 6 );
					g.add( d );
					item.circles.push( { ox: d.position.x, oy: d.position.y, r: 1.2 } );

				}

				item.tumble = [ ( r() - 0.5 ) * 2, ( r() - 0.5 ) * 2 ];
				break;

			}

			case 'iss':
				crossX( 18 );
				g.add( mesh( M.iss, X.paint ) );
				item.warn = true;
				for ( let i = - 5; i <= 5; i ++ ) item.circles.push( { ox: i * 5.5, oy: 0, r: 1.2 } );
				item.circles.push( { ox: 0, oy: - 2.6, r: 2.4 } );
				break;

			case 'asteroid': {

				item.x = this._placeX( player, view, y, 1.0, local );
				item.vx = ( r() - 0.5 ) * 10;
				item.vy = - r() * 8;
				const k = ( r() * 3 ) | 0;
				const m = mesh( M.asteroids[ k ], X.matte );
				const s = 0.8 + r() * 1.2;
				m.scale.setScalar( s );
				g.add( m );
				item.spin = ( r() - 0.5 ) * 1.2;
				item.circles.push( { ox: 0, oy: 0, r: ( 3 + k * 1.5 ) * s * 0.85 } );
				break;

			}

			case 'ice': {

				crossX( 8 + r() * 10 );
				const n = 4 + Math.floor( r() * 5 );
				for ( let i = 0; i < n; i ++ ) {

					const m = mesh( M.ice, X.paint );
					const s = 0.6 + r() * 1.2;
					m.scale.setScalar( s );
					m.position.set( ( r() - 0.5 ) * 30, ( r() - 0.5 ) * 8, ( r() - 0.5 ) * 4 );
					m.rotation.set( r() * 6, r() * 6, 0 );
					g.add( m );
					item.circles.push( { ox: m.position.x, oy: m.position.y, r: 1.6 * s } );

				}

				break;

			}

			case 'comet':
				crossX( 55 + r() * 30 );
				item.vy = - 10 - r() * 10;
				g.add( mesh( M.comet, X.paint ) );
				item.circles.push( { ox: 0, oy: 0, r: 3 } );
				break;

			case 'whale': {

				crossX( 7 + r() * 4 );
				const m = face( mesh( M.whale, X.paint ) );
				g.add( m );
				item.parts.whale = m;
				for ( let i = - 2; i <= 2; i ++ ) item.circles.push( { ox: i * 5 * side, oy: 0, r: 4.5 - Math.abs( i ) * 0.6 } );
				break;

			}

			case 'plasmoid':
			case 'beam':
			case 'protostar':
			case 'hvstar':
			case 'darkmatter':
			case 'mothership':
			case 'cstring':
			case 'jetburst':
				this._spawnCosmic( type, item, g, player, view, ctx, side, crossX );
				break;

			case 'flare': {

				// a looping prominence arching over the path, dangerous while it pulses bright
				item.x = this._placeX( player, view, y, 0.6, local );
				const arc = mesh( M.flare, X.plasma.clone(), false );
				arc.layers.set( 2 );
				arc.rotation.z = ( r() - 0.5 ) * 0.6;
				g.add( arc );
				item.parts.arc = arc;
				item.pulse = r() * 3;
				for ( let i = 0; i <= 8; i ++ ) {

					const a = i / 8 * Math.PI;
					item.circles.push( { ox: Math.cos( a ) * 16, oy: Math.sin( a ) * 16, r: 2.6 } );

				}

				break;

			}

		}

		g.position.set( item.x, item.y, 0 );
		this.group.add( g );
		this.items.push( item );

	}

	_energy( tint, k = 1 ) {

		const m = mats().energy.clone();
		m.set( 'tint', tint );
		m.set( 'k', k );
		return m;

	}

	_glowMesh( geo, mat ) {

		const m = mesh( geo, mat, false );
		m.layers.set( 2 );
		return m;

	}

	// beyond the solar system
	_spawnCosmic( type, item, g, player, view, ctx, side, crossX ) {

		const M = models(), X = mats(), r = this.rnd, local = { local: true };
		const zone = zoneAt( ctx.h ).id;
		switch ( type ) {

			case 'plasmoid': {

				item.x = this._placeX( player, view, item.y, 1.0, local );
				item.vx = ( r() - 0.5 ) * 16;
				item.vy = ( r() - 0.5 ) * 6;
				const tint = zone === 'crab' ? ENERGY.plasmoidBlue : zone === 'blackhole' ? ENERGY.plasmoidPink : ENERGY.plasmoid;
				const m = this._glowMesh( M.plasmoid, this._energy( tint ) );
				g.add( m );
				item.parts.core = m;
				item.pulse = r() * 6;
				g.scale.setScalar( 0.8 + r() * 0.8 );
				item.circles.push( { ox: 0, oy: 0, r: 2.1 } );
				break;

			}

			case 'beam': {

				// a pulsar beam sweeping across the path from a pivot beside the screen
				item.x = player.x + side * ( view.halfW + 12 );
				item.len = view.halfW * 2 + 30;
				item.theta = side > 0 ? Math.PI + ( r() - 0.5 ) * 2 : ( r() - 0.5 ) * 2;
				item.omega = ( r() < 0.5 ? - 1 : 1 ) * ( 1.0 + r() * 0.5 );
				const bm = this._glowMesh( M.beam, this._energy( ENERGY.beam ) );
				bm.scale.set( 1.3, item.len, 1.3 );
				g.add( bm );
				g.add( this._glowMesh( M.beamCore, this._energy( [ 0.8, 0.9, 1 ], 1.5 ) ) );
				item.parts.beam = bm;
				for ( let i = 1; i <= 24; i ++ ) item.circles.push( { ox: 0, oy: 0, r: 1.7, d: i / 24 * item.len } );
				break;

			}

			case 'protostar': {

				// a newborn star firing twin jets that switch on and off
				item.x = this._placeX( player, view, item.y, 0.7, local );
				item.vx = ( r() - 0.5 ) * 6;
				const core = this._glowMesh( M.plasmoid, this._energy( ENERGY.protostar ) );
				core.scale.setScalar( 1.1 );
				g.add( core );
				const a = ( r() - 0.5 ) * 1.0;
				item.jets = [];
				for ( const dir of [ 0, Math.PI ] ) {

					const j = this._glowMesh( M.beam, this._energy( ENERGY.jet ) );
					j.scale.set( 0.9, 20, 0.9 );
					j.rotation.z = a + dir - Math.PI / 2;
					g.add( j );
					item.jets.push( j );
					for ( let i = 1; i <= 7; i ++ ) item.circles.push( { ox: Math.cos( a + dir ) * ( 2 + i * 2.6 ), oy: Math.sin( a + dir ) * ( 2 + i * 2.6 ), r: 1.2 + i * 0.12, jet: true } );

				}

				item.pulse = r() * 3;
				item.circles.push( { ox: 0, oy: 0, r: 2.6 } );
				break;

			}

			case 'hvstar': {

				crossX( 140 + r() * 60 );
				item.vy = ( r() - 0.5 ) * 10;
				const m = this._glowMesh( M.beamCore, this._energy( ENERGY.hvstar, 1.4 ) );
				m.scale.setScalar( 2.2 );
				g.add( m );
				item.circles.push( { ox: 0, oy: 0, r: 2.4 } );
				break;

			}

			case 'darkmatter': {

				item.x = this._placeX( player, view, item.y, 0.9, local );
				item.vx = ( r() - 0.5 ) * 8;
				item.vy = ( r() - 0.5 ) * 4;
				const m = this._glowMesh( M.blob, X.dark.clone() );
				g.add( m );
				item.parts.blob = m;
				g.scale.setScalar( 0.9 + r() * 0.9 );
				item.circles.push( { ox: 0, oy: 0, r: 3.5 } );
				break;

			}

			case 'mothership': {

				crossX( 12 + r() * 8 );
				const m = mesh( M.mothership, X.metal );
				g.add( m );
				const lights = mesh( M.mothershipLights, X.glow, false );
				g.add( lights );
				item.parts.ship = m;
				item.parts.lights = lights;
				item.wobble = r() * 6;
				for ( let i = - 3; i <= 3; i ++ ) item.circles.push( { ox: i * 3.2, oy: 0, r: 2.6 } );
				item.circles.push( { ox: 0, oy: 1.8, r: 3.5 } );
				break;

			}

			case 'cstring': {

				// a cosmic string across the whole path, with one gap to thread
				item.x = player.x + ( r() * 2 - 1 ) * view.halfW * 0.45;
				item.vx = ( r() - 0.5 ) * 8;
				const W = view.halfW * 2 + 60, gap = 9;
				const mat = this._energy( ENERGY.cstring );
				for ( const sx of [ - 1, 1 ] ) {

					const b = this._glowMesh( M.beam, mat );
					b.scale.set( 0.5, W, 0.5 );
					b.position.x = sx * gap;
					b.rotation.z = - sx * Math.PI / 2;
					g.add( b );
					for ( let d = 0; d < W; d += 2.6 ) item.circles.push( { ox: sx * ( gap + d ), oy: 0, r: 1.1 } );

				}

				item.parts.mat = mat;
				break;

			}

			case 'jetburst': {

				// a relativistic jet flaring across the path: dim while it charges, deadly when lit
				item.x = this._placeX( player, view, item.y, 0.5, local );
				const a = side * ( 0.3 + r() * 0.5 ) + Math.PI / 2;
				const len = view.halfW * 1.6 + 30;
				const j = this._glowMesh( M.beam, this._energy( ENERGY.jetburst, 0.2 ) );
				j.scale.set( 2.2, len, 2.2 );
				j.position.set( - Math.cos( a ) * len / 2, - Math.sin( a ) * len / 2, 0 );
				j.rotation.z = a - Math.PI / 2;
				g.add( j );
				item.parts.jet = j;
				item.pulse = r() * 4;
				for ( let d = - len / 2; d <= len / 2; d += 3 ) item.circles.push( { ox: Math.cos( a ) * d, oy: Math.sin( a ) * d, r: 2.2, jet: true } );
				break;

			}

		}

	}

	_spawnRingChain( y, player, view, zone, wiggle = 1 ) {

		const r = this.rnd;
		const n = 4 + Math.floor( r() * 3 );
		const chain = { n, got: 0 };
		const x0 = player.x + ( r() * 2 - 1 ) * view.halfW * 0.4 * wiggle;
		const amp = view.halfW * ( 0.12 + r() * 0.28 ) * wiggle, ph = r() * 6;
		for ( let i = 0; i < n; i ++ ) this._addPickup( 'ring', x0 + Math.sin( ph + i * 0.9 ) * amp, y + i * 26, zone.coin * 3, chain );

	}

	_spawnCoins( y, player, view, zone, ctx ) {

		const r = this.rnd;
		const x0 = this._placeX( player, view, y, 0.6, ctx );
		const value = zone.coin;
		const pattern = Math.floor( r() * 5 );
		const pts = [];
		if ( pattern === 0 ) for ( let i = 0; i < 5; i ++ ) pts.push( [ 0, i * 3.2 ] );
		else if ( pattern === 1 ) for ( let i = 0; i < 7; i ++ ) pts.push( [ Math.sin( i / 6 * Math.PI ) * 6 - 3, i * 3 ] );
		else if ( pattern === 2 ) for ( let i = 0; i < 8; i ++ ) pts.push( [ Math.cos( i / 8 * Math.PI * 2 ) * 5, Math.sin( i / 8 * Math.PI * 2 ) * 5 ] );
		else if ( pattern === 3 ) for ( let i = 0; i < 6; i ++ ) pts.push( [ ( i - 2.5 ) * 3, Math.abs( i - 2.5 ) * 1.5 ] );
		else for ( let i = 0; i < 10; i ++ ) pts.push( [ Math.sin( i * 0.9 ) * 4, i * 2.6 ] );
		for ( const [ dx, dy ] of pts ) this._addPickup( 'coin', x0 + dx, y + dy, value );

	}

	_spawnPickup( kind, y, player, view, value, ctx ) {

		this._addPickup( kind, this._placeX( player, view, y, 0.55, ctx ), y, value );

	}

	_addPickup( kind, x, y, value, chain = null ) {

		const M = models(), X = mats();
		let m;
		switch ( kind ) {

			case 'coin': m = mesh( M.coin, X.gold ); m.scale.setScalar( 1.15 ); break;
			case 'fuel': m = mesh( M.fuel, X.paint ); break;
			case 'star': m = mesh( M.star, X.star ); break;
			case 'astronaut': m = mesh( M.astronaut, X.paint ); m.scale.setScalar( 1.4 ); break;
			case 'probe': m = mesh( M.probe, X.paint ); break;
			case 'crystal': m = mesh( M.crystal, X.crystal ); m.scale.setScalar( 1.3 ); break;
			case 'ring': m = mesh( M.ring, X.ring, false ); m.layers.set( 2 ); m.rotation.x = 1.15; break;
			default: m = mesh( M.orb, this.orbMats[ kind ], false ); m.layers.set( 2 ); break;

		}

		m.position.set( x, y, 0 );
		this.group.add( m );
		this.pickups.push( { kind, x, y, value, mesh: m, t: this.rnd() * 6, r: kind === 'coin' ? 1.3 : kind === 'ring' ? 3.0 : 2.2, alive: true, chain } );

	}

	// ---------------------------------------------------------------- update

	update( dt, player, view, time, ctx = {} ) {

		const keepBelow = player.y - view.halfH * 2.5 - 60;
		const farX = view.halfW * 3.5 + 400;
		const P = this.particles;
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
					const dx = h.x - h.anchor.x, dy = h.y - h.anchor.y;
					h.line.position.set( ( h.x + h.anchor.x ) / 2, ( h.y + h.anchor.y ) / 2, - 0.2 );
					h.line.scale.set( 1, Math.hypot( dx, dy ), 1 );
					h.line.rotation.set( 0, 0, - Math.atan2( dx, dy ) );
					break;

				}

				case 'drone':
					h.x = h.home.x + Math.sin( h.t * 0.5 ) * 14;
					h.y = h.home.y + Math.sin( h.t * 0.9 ) * 4;
					h.mesh.rotation.set( 0, h.t * 0.3, Math.cos( h.t * 0.5 ) * 0.15 );
					break;
				case 'heli':
					h.parts.rotor.rotation.y = h.t * 30;
					h.y += Math.sin( h.t * 1.1 ) * 0.04;
					break;
				case 'seaplane':
					h.parts.prop.rotation.x = h.t * 40;
					h.y += Math.sin( h.t * 0.7 ) * 0.05;
					break;
				case 'rival':
					h.mesh.rotation.y = h.t * 0.2;
					break;
				case 'storm': {

					h.x += windAt( Math.max( 0, ctx.h || 0 ), time ) * 0.4 * dt;
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
						if ( this.onEvent ) this.onEvent( 'thunder', h );

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
				case 'ufo':
				case 'spaceufo':
					h.y += Math.sin( h.t * 2 + h.wobble ) * 0.12;
					h.mesh.rotation.set( Math.sin( h.t ) * 0.15, h.t * 2, 0 );
					break;
				case 'meteor':
					h.mesh.rotation.x += h.spin * dt;
					h.mesh.rotation.y += h.spin * dt * 0.7;
					if ( P && Math.random() < 0.8 ) {

						P.emit( { x: h.x, y: h.y, z: 0, vx: - h.vx * 0.2, vy: - h.vy * 0.1, life: 0.6, size: 2.2, grow: 1.5, color: [ 14, 6, 1.5 ], cool: [ 0.3, 0.3, 0.35 ], drag: 1 } );
						P.emit( { soft: true, x: h.x, y: h.y + 1, z: 0, life: 1.8, size: 2, grow: 2.5, color: [ 0.2, 0.2, 0.22 ], alpha: 0.6, drag: 0.5 } );

					}

					break;
				case 'satellite':
					h.mesh.rotation.z += h.spin * dt;
					break;
				case 'debris':
				case 'spacedebris':
					h.mesh.rotation.x += h.tumble[ 0 ] * dt;
					h.mesh.rotation.y += h.tumble[ 1 ] * dt;
					break;
				case 'asteroid':
					h.mesh.rotation.x += h.spin * dt;
					h.mesh.rotation.z += h.spin * dt * 0.6;
					break;
				case 'ice':
					h.mesh.rotation.z += dt * 0.1;
					break;
				case 'comet':
					h.mesh.rotation.x += dt * 0.5;
					if ( P ) P.emit( { x: h.x + ( Math.random() - 0.5 ) * 2, y: h.y + ( Math.random() - 0.5 ) * 2, z: - 1, vx: - h.vx * 0.3 + ( Math.random() - 0.5 ) * 3, vy: 6 + Math.random() * 4, life: 2.5, size: 2.5, grow: 3, color: [ 0.6, 1.2, 2.2 ], drag: 0.2, fade: 1.5 } );
					break;
				case 'whale':
					h.parts.whale.rotation.z = Math.sin( h.t * 0.8 ) * 0.1;
					h.y += Math.sin( h.t * 0.8 ) * 0.08;
					break;
				case 'plasmoid': {

					const k = 0.75 + 0.25 * Math.sin( h.t * 5 + h.pulse );
					h.parts.core.material.set( 'k', k );
					h.parts.core.rotation.set( h.t * 0.7, h.t, 0 );
					if ( P && Math.random() < 0.3 ) P.emit( { x: h.x + ( Math.random() - 0.5 ) * 3, y: h.y + ( Math.random() - 0.5 ) * 3, z: 0, vx: ( Math.random() - 0.5 ) * 6, vy: ( Math.random() - 0.5 ) * 6, life: 0.5, size: 0.6, grow: 1.5, color: [ 8, 4, 1.5 ], drag: 1 } );
					break;

				}

				case 'beam': {

					h.theta += h.omega * dt;
					const c = Math.cos( h.theta ), sn = Math.sin( h.theta );
					h.parts.beam.rotation.z = h.theta - Math.PI / 2;
					h.parts.beam.material.set( 'k', 0.8 + 0.2 * Math.sin( h.t * 30 ) );
					for ( const q of h.circles ) {

						q.ox = c * q.d;
						q.oy = sn * q.d;

					}

					break;

				}

				case 'protostar': {

					const k = 0.5 + 0.5 * Math.sin( h.t * 1.5 + h.pulse );
					for ( const j of h.jets ) {

						j.material.set( 'k', 0.15 + k * 0.95 );
						j.scale.y = 12 + k * 10;

					}

					for ( const q of h.circles ) if ( q.jet ) q.off = k < 0.45;
					h.mesh.children[ 0 ].rotation.set( h.t, h.t * 0.6, 0 );
					break;

				}

				case 'hvstar':
					if ( P ) for ( let i = 0; i < 2; i ++ ) P.emit( { x: h.x - Math.sign( h.vx ) * i * 1.5, y: h.y + ( Math.random() - 0.5 ), z: - 0.5, vx: - h.vx * 0.05, life: 0.9, size: 1.8, grow: 1.2, color: [ 10, 8, 5 ], drag: 0.5, fade: 1.2 } );
					break;
				case 'darkmatter': {

					const d = Math.hypot( h.x - player.x, h.y - player.y );
					h.parts.blob.material.set( 'reveal', Math.max( 0.12, Math.min( 1, 1 - ( d - 12 ) / 55 ) ) );
					h.parts.blob.rotation.set( h.t * 0.3, h.t * 0.5, 0 );
					h.parts.blob.scale.set( 1 + Math.sin( h.t * 2 ) * 0.08, 1 + Math.cos( h.t * 1.7 ) * 0.08, 1 );
					break;

				}

				case 'mothership':
					h.y += Math.sin( h.t * 0.9 + h.wobble ) * 0.05;
					h.parts.lights.rotation.y = h.t * 0.8;
					h.mesh.rotation.x = Math.sin( h.t * 0.5 ) * 0.06;
					break;
				case 'cstring':
					h.parts.mat.set( 'k', 0.8 + 0.2 * Math.sin( h.t * 12 ) );
					h.mesh.position.z = 0;
					break;
				case 'jetburst': {

					const cyc = ( h.t * 0.5 + h.pulse ) % 2;
					const lit = cyc > 1.2 && cyc < 1.95;
					h.parts.jet.material.set( 'k', lit ? 1 : 0.12 + ( cyc < 1.2 ? cyc / 1.2 : 0 ) * 0.25 );
					for ( const q of h.circles ) q.off = ! lit;
					break;

				}

				case 'flare': {

					const k = 0.5 + 0.5 * Math.sin( h.t * 1.6 + h.pulse );
					h.parts.arc.material.set( 'k', 0.25 + k * 0.9 );
					for ( const c of h.circles ) c.off = k < 0.45;
					h.parts.arc.scale.setScalar( 0.85 + k * 0.2 );
					break;

				}

			}

			h.x += h.vx * dt;
			h.y += h.vy * dt;
			h.mesh.position.set( h.x, h.y, 0 );
			if ( h.y < keepBelow || Math.abs( h.x - player.x ) > farX + Math.abs( h.vx ) * 3 ) h.alive = false;

		}

		for ( const p of this.pickups ) {

			p.t += dt;
			switch ( p.kind ) {

				case 'coin': p.mesh.rotation.set( 0, p.t * 3, 0 ); break;
				case 'fuel':
					if ( ! ctx.local ) p.y -= 1.2 * dt;
					p.mesh.rotation.z = Math.sin( p.t * 1.5 ) * 0.15;
					break;
				case 'astronaut': p.mesh.rotation.set( p.t * 0.4, p.t * 0.7, Math.sin( p.t ) * 0.5 ); break;
				case 'probe': p.mesh.rotation.set( 0.3, p.t * 0.3, 0.2 ); break;
				case 'crystal': p.mesh.rotation.set( 0, p.t * 2, 0 ); p.mesh.scale.setScalar( 1.3 + Math.sin( p.t * 4 ) * 0.1 ); break;
				case 'star': p.mesh.rotation.set( p.t, p.t * 1.3, 0 ); p.mesh.scale.setScalar( 1 + Math.sin( p.t * 5 ) * 0.12 ); break;
				case 'ring': p.mesh.scale.setScalar( 1 + Math.sin( p.t * 4 ) * 0.05 ); p.mesh.rotation.z = p.t * 0.6; break;
				default: p.mesh.scale.setScalar( 1 + Math.sin( p.t * 6 ) * 0.1 ); break;

			}

			if ( p.pulled ) {

				p.x += p.pulled.x * dt;
				p.y += p.pulled.y * dt;

			}

			p.mesh.position.set( p.x, p.y, 0 );
			if ( p.y < keepBelow ) p.alive = false;
			if ( P && p.kind !== 'ring' && Math.random() < ( p.kind === 'coin' ? 0.02 : 0.08 ) ) P.emit( { x: p.x + ( Math.random() - 0.5 ) * 2, y: p.y + ( Math.random() - 0.5 ) * 2, z: 0.5, life: 0.5, size: 0.35, color: p.kind === 'coin' ? [ 6, 4.5, 1 ] : [ 3, 3, 4 ], fade: 1 } );

		}

		this._sweep();

	}

	_sweep() {

		const keep = [];
		for ( const h of this.items ) {

			if ( h.alive ) keep.push( h );
			else this._remove( h );

		}

		this.items = keep;
		const kp = [];
		for ( const p of this.pickups ) {

			if ( p.alive ) kp.push( p );
			else this.group.remove( p.mesh );

		}

		this.pickups = kp;

	}

	// shift everything down by dy (the moving local frame re-centres itself)
	shift( dy ) {

		for ( const h of this.items ) {

			h.y -= dy;
			if ( h.home ) h.home.y -= dy;
			if ( h.anchor ) h.anchor.y -= dy;

		}

		for ( const p of this.pickups ) p.y -= dy;
		this.nextHazardY -= dy; this.nextCoinY -= dy; this.nextFuelY -= dy; this.nextStarY -= dy; this.nextOrbY -= dy; this.nextSpecialY -= dy; this.nextRingY -= dy;

	}

	// ---------------------------------------------------------------- collisions

	hitTest( circles ) {

		for ( const h of this.items ) {

			if ( h.spent ) continue;
			for ( const c of h.circles ) {

				if ( c.off ) continue;
				const hx = h.x + c.ox * h.mesh.scale.x, hy = h.y + c.oy * h.mesh.scale.y;
				const hr = c.r * h.mesh.scale.x;
				for ( const p of circles ) {

					const dx = p.x - hx, dy = p.y - hy;
					if ( dx * dx + dy * dy < ( p.r + hr ) * ( p.r + hr ) ) return { hazard: h, x: hx, y: hy };

				}

			}

		}

		return null;

	}

	// hazards that passed within `margin` metres of the player without touching: close calls
	nearTest( circles, margin ) {

		const out = [];
		for ( const h of this.items ) {

			if ( h.spent || h.nearMissed ) continue;
			let near = false;
			for ( const c of h.circles ) {

				if ( c.off ) continue;
				const hx = h.x + c.ox * h.mesh.scale.x, hy = h.y + c.oy * h.mesh.scale.y;
				const hr = c.r * h.mesh.scale.x + margin;
				for ( const p of circles ) {

					const dx = p.x - hx, dy = p.y - hy;
					if ( dx * dx + dy * dy < ( p.r + hr ) * ( p.r + hr ) ) near = true;

				}

			}

			if ( near ) {

				h.nearMissed = true;
				out.push( h );

			}

		}

		return out;

	}

	collect( circles, center, magnet ) {

		const got = [];
		for ( const p of this.pickups ) {

			if ( ! p.alive ) continue;
			if ( magnet > 0 && p.kind !== 'ring' ) {

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

export { TYPES as HAZARD_TYPES };
