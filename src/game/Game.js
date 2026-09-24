import { Vector3, MathUtils } from '../engine/math/index.js';
import { Mesh } from '../engine/scene/Mesh.js';
import { BoxGeometry } from '../engine/geometry/index.js';
import { ToyBuilder, toyMaterials } from '../world/Toy.js';
import { G } from '../engine/render/Frame.js';
import { models as hazardModels, mats as hazardMats } from './Models.js';
import { Balloon } from './Balloon.js';
import { Rocket, ROCKET_LIVERIES } from './Rocket.js';
import { Starship, SHIP_LIVERIES } from './Starship.js';
import { Warpship } from './Warpship.js';
import { Ark } from './Ark.js';
import { Hazards } from './Hazards.js';
import { Input } from './Input.js';
import { createState, step, dropBag, windAt, createRocketState, stepRocket, createShipState, stepShip, ORBIT_START, SHIP_START, JUMP_TIME, AFTERBURNER_TIME } from './Physics.js';
import { computeStats, defaultLevels, UPGRADES, VEHICLES, VEHICLE_BY_ID, isShip } from './Upgrades.js';
import { ZONES, zoneAt, zoneIndex, zoneById, altitudePay, formatAltitude } from './Zones.js';
import { ACHIEVEMENTS } from './Achievements.js';
import { refreshMissions, missionProgress } from './Missions.js';
import { rollEvent } from './Events.js';
import { funFact } from './Facts.js';
import { routeAt, flybyAt, toWorld, BODIES, BODY_BY_ID, AU, LY, GC, ROUTE_LENGTH, T as BT, norm, sub, len, dot, cross, mul } from './Route.js';
import { LAUNCH, BARGE, islandHeight } from '../world/Island.js';
import { TIMES_OF_DAY } from '../App.js';
import { MAX_BODIES } from '../sky/Sky.js';

const RING_KICK = 0.8;
// hazards that stay dangerous after a hit, and what a hit says
const LASTING = [ 'storm', 'flare', 'beam', 'protostar', 'cstring', 'jetburst' ];
const HIT_TEXT = { storm: 'Zapped!', flare: 'Scorched!', beam: 'Pulsar beam!', protostar: 'Jet blast!', jetburst: 'Jet blast!', cstring: 'Cosmic string!', darkmatter: 'Dark matter!', hvstar: 'Star strike!', plasmoid: 'Plasma burn!' };
import { UI } from '../ui/UI.js';
import { Sound } from '../audio/Sound.js';
import { Music } from '../audio/Music.js';

// The game loop on top of App: hangar (vehicle select, workshop, paint shop, time of day), a launch
// countdown, flight for the five vehicles, results. Keeps the save in localStorage.
//
// Flight coordinates: the physics state `s` is real (metres; a space vehicle's `d` is its route
// distance). The drawn "local" position `lp` follows it at a capped speed (followLocal), the lag goes
// into App.originX / originY so the world stays put; in space App.space carries the route to the sky.
// Hazards live in the local frame, so they always come at a dodgeable pace.

const SAVE_KEY = 'skybound.save.v2';
const OLD_KEY = 'skybound.save.v1';
const PAD_Y = LAUNCH.deckY + 0.16;

function freshSave() {

	return {
		version: 2, cash: 0, vehicle: 'balloon', unlocked: [ 'balloon' ], levels: defaultLevels(),
		best: 0, bestBy: { balloon: 0, rocket: 0, starship: 0, warpship: 0, ark: 0 }, zones: [ 'shore' ], achievements: {},
		paints: { rocket: 'classic', starship: 'classic', warpship: 'classic', ark: 'classic' },
		ownedPaints: [ 'rocket:classic', 'starship:classic', 'warpship:classic', 'ark:classic' ],
		timeOfDay: 'afternoon', settings: { music: 0.55, sfx: 0.85 }, muted: false,
		seen: {}, won: false,
		stats: { runs: 0, coins: 0, splashes: 0, pops: 0, zaps: 0, blocked: 0, orbs: 0, stars: 0, astronauts: 0, probes: 0, crystals: 0, bags: 0, nightRuns: 0, times: [], maxSpeed: 0, earned: 0, flightTime: 0 },
	};

}

function loadSave() {

	const fresh = freshSave();
	try {

		const raw = localStorage.getItem( SAVE_KEY );
		if ( raw ) {

			const s = JSON.parse( raw );
			const levels = defaultLevels();
			for ( const v in levels ) Object.assign( levels[ v ], ( s.levels || {} )[ v ] || {} );
			const ownedPaints = [ ...new Set( [ ...fresh.ownedPaints, ...( s.ownedPaints || [] ) ] ) ];
			return { ...fresh, ...s, levels, ownedPaints, stats: { ...fresh.stats, ...( s.stats || {} ) }, settings: { ...fresh.settings, ...( s.settings || {} ) }, bestBy: { ...fresh.bestBy, ...( s.bestBy || {} ) }, paints: { ...fresh.paints, ...( s.paints || {} ) } };

		}

		// the first release's save: balloon only
		const old = localStorage.getItem( OLD_KEY );
		if ( old ) {

			const o = JSON.parse( old );
			Object.assign( fresh.levels.balloon, o.levels || {} );
			fresh.cash = o.cash || 0;
			fresh.best = o.best || 0;
			fresh.bestBy.balloon = o.best || 0;
			fresh.zones = o.zones || [ 'shore' ];
			fresh.muted = !! o.muted;
			fresh.stats.runs = o.runs || 0;
			fresh.stats.coins = o.coins || 0;
			fresh.seen.balloon = !! o.seenHelp;
			fresh.migrated = true;

		}

	} catch { /* a broken save starts over */ }

	return fresh;

}

const _v = new Vector3();

const STARS = BODIES.filter( ( b ) => b.star );
// the Crab pulsar's spin axis and a frame around it
const PULSAR_AXIS = norm( [ 0.3, 0.2, 0.93 ] );
const PULSAR_U = norm( cross( PULSAR_AXIS, [ 0, 1, 0 ] ) );
const PULSAR_V = cross( PULSAR_AXIS, PULSAR_U );

function hashOf( id ) {

	let h = 2166136261;
	for ( let i = 0; i < id.length; i ++ ) h = Math.imul( h ^ id.charCodeAt( i ), 16777619 );
	return ( h >>> 0 ) / 4294967296;

}

export class Game {

	constructor( app, root ) {

		this.app = app;
		this.root = root;
		this.save = loadSave();
		this.state = 'boot';
		this.time = 0;
		this.camDist = 30;
		this.camPos = new Vector3( 0, 10, 30 );
		this.camTarget = new Vector3( 0, 8, 0 );
		this.shake = 0;
		this.hitFlash = 0;
		this.shieldHit = 0;
		this.view = { halfW: 30, halfH: 17 };
		this.lp = { x: 0, y: 0, vx: 0, vy: 0 };
		this.mode = 'earth';
		this.warp = 1;
		this.buffs = { magnet: 0, boost: 0 };

	}

	async init( progress = () => {} ) {

		progress( 0.6, 'Stitching the balloon' );
		const app = this.app;
		this.particles = app.particles;
		this.models = {
			balloon: new Balloon( app.scene ),
			rocket: new Rocket( app.scene ),
			starship: new Starship( app.scene ),
			warpship: new Warpship( app.scene ),
			ark: new Ark( app.scene ),
		};
		this.hazards = new Hazards( app.scene, this.particles );
		// the player's best height for this vehicle, a glowing line across the sky ahead
		this.bestLine = new Mesh( new ToyBuilder().add( new BoxGeometry( 1, 0.12, 0.12 ), { color: 0xffd23f } ).build(), toyMaterials().glow );
		this.bestLine.castShadow = false;
		this.bestLine.visible = false;
		app.scene.add( this.bestLine );
		this.hitstop = 0;
		this.camRoll = 0;
		this.fireworks = [];
		// a humpback that surfaces off the beach now and then
		this.whale = new Mesh( hazardModels().humpback, hazardMats().paint );
		this.whale.castShadow = true;
		this.whale.visible = false;
		app.scene.add( this.whale );
		this.whaleT = 20 + Math.random() * 20;
		this.whaleRun = null;
		// the engine's glow on everything around it (burner, exhaust, drive)
		this.engineLight = app.lights.add( { position: new Vector3(), color: [ 1, 0.55, 0.2 ], intensity: 0, range: 40, flicker: 0.3 } );
		this.hazards.onEvent = ( e ) => {

			if ( e === 'thunder' ) this.sound.play( 'thunder' );

		};

		this.input = new Input( app.engine.canvas );
		this.sound = new Sound();
		this.music = new Music();
		this.sound.setMuted( this.save.muted );
		this.music.setMuted( this.save.muted );
		this.sound.setVolume( this.save.settings.sfx );
		this.music.setVolume( this.save.settings.music );
		this.sound.onUnlock = ( ctx, master ) => this.music.attach( ctx, master );

		const qs = app.qs;
		this.sandbox = qs.has( 'tier' ) || qs.has( 'cash' ) || qs.has( 'start' ) || qs.has( 'vehicle' );
		if ( qs.has( 'cash' ) ) this.save.cash = Number( qs.get( 'cash' ) );
		if ( qs.has( 'tier' ) ) {

			const t = Number( qs.get( 'tier' ) );
			for ( const v in UPGRADES ) for ( const u of UPGRADES[ v ] ) this.save.levels[ v ][ u.id ] = Math.min( t, u.levels.length - 1 );
			if ( t < 5 ) {

				this.save.levels.starship.improbability = 0;
				this.save.levels.ark.anchor = 0;

			}

			this.save.unlocked = VEHICLES.map( ( v ) => v.id );

		}

		if ( qs.has( 'vehicle' ) ) {

			const v = qs.get( 'vehicle' );
			if ( ! this.save.unlocked.includes( v ) ) this.save.unlocked.push( v );
			this.save.vehicle = v;

		}

		this.ui = new UI( this.root, this );
		app.setTimeOfDay( this.save.timeOfDay );
		// photo mode camera: drag to orbit, wheel to zoom
		this.photo = null;
		const canvas = app.engine.canvas;
		let drag = null;
		canvas.addEventListener( 'pointerdown', ( e ) => {

			if ( this.photo ) drag = { x: e.clientX, y: e.clientY };

		} );
		window.addEventListener( 'pointermove', ( e ) => {

			if ( ! this.photo || ! drag ) return;
			this.photo.yaw -= ( e.clientX - drag.x ) * 0.006;
			this.photo.pitch = MathUtils.clamp( this.photo.pitch + ( e.clientY - drag.y ) * 0.005, - 1.3, 1.4 );
			drag = { x: e.clientX, y: e.clientY };

		} );
		window.addEventListener( 'pointerup', () => {

			drag = null;

		} );
		canvas.addEventListener( 'wheel', ( e ) => {

			if ( ! this.photo ) return;
			e.preventDefault();
			this.photo.dist = MathUtils.clamp( this.photo.dist * Math.exp( e.deltaY * 0.001 ), 6, 600 );

		}, { passive: false } );
		window.addEventListener( 'blur', () => {

			if ( this.state === 'flight' && ! this.paused ) this.setPaused( true );

		} );
		this.toHangar( true );
		if ( this.save.migrated ) {

			this.save.migrated = false;
			this.persist();
			setTimeout( () => this.ui.toast( 'Welcome back! Your balloon progress carried over.', 4, 'good' ), 1200 );

		}

	}

	persist() {

		if ( this.sandbox ) return;
		try {

			localStorage.setItem( SAVE_KEY, JSON.stringify( this.save ) );

		} catch { /* private mode: progress lasts for the session */ }

	}

	get vehicle() {

		return this.save.vehicle;

	}

	stats( v = this.vehicle ) {

		return computeStats( this.save.levels, v );

	}

	get model() {

		return this.models[ this.vehicle ];

	}

	// ---------------------------------------------------------------- hangar

	buildModel( v = this.vehicle ) {

		const m = this.models[ v ];
		if ( v === 'balloon' ) m.build( this.save.levels.balloon );
		else m.build( this.save.levels[ v ], this.save.paints[ v ] );
		m.setBags( v === 'balloon' ? this.stats( 'balloon' ).bags : 0 );

	}

	padPosition( v = this.vehicle ) {

		return v === 'balloon' ? { x: LAUNCH.x, y: PAD_Y } : { x: BARGE.x, y: BARGE.deckY + this.app.island.barge.position.y };

	}

	resetVehicle() {

		const v = this.vehicle;
		const st = this.stats( v );
		const pad = this.padPosition( v );
		this.s = v === 'balloon' ? createState( st ) : v === 'rocket' ? createRocketState( st ) : createShipState( st, v );
		this.s.x = pad.x;
		this.s.y = pad.y;
		if ( v === 'balloon' ) this.s.heat = 0.35;
		this.lp = { x: pad.x, y: pad.y, vx: 0, vy: 0 };
		for ( const k in this.models ) this.models[ k ].group.visible = k === v;
		this.buildModel( v );
		if ( v === 'rocket' ) this.models.rocket.clearDropped();

	}

	missionContext( v = this.vehicle ) {

		const lv = this.save.levels[ v ];
		const ids = Object.keys( lv );
		const tier = Math.round( ids.reduce( ( a, k ) => a + lv[ k ], 0 ) / Math.max( 1, ids.length ) * 1.6 );
		const st = this.stats( v );
		return { v, best: this.save.bestBy[ v ] || 0, tier, bags: st.bags || 0, shield: st.shield || 0, jumps: st.jumps || 0 };

	}

	get missions() {

		return refreshMissions( this.save, this.missionContext() );

	}

	toHangar( instant = false ) {

		this.state = 'hangar';
		this.paused = false;
		this.mode = 'earth';
		this.warp = 1;
		this.coastTime = 0;
		this.app.originY = 0;
		this.app.originX = 0;
		this.app.space = null;
		this.space = null;
		this.app.worldVisible = true;
		this.hazards.reset();
		this.particles.clear();
		this.resetVehicle();
		this.orbit = 0;
		this.bestLine.visible = false;
		this.bestLineInfo = null;
		this.app.post.params.cloudFog.value = 0;
		if ( instant ) this._camSnap = true;
		this.nextEvent = rollEvent( this.vehicle, this.save.stats.runs );
		this.ui.show( 'hangar' );
		this.music.setMood( 'hangar' );

	}

	selectVehicle( id ) {

		if ( ! this.save.unlocked.includes( id ) || this.state !== 'hangar' || id === this.vehicle ) return;
		this.save.vehicle = id;
		this.persist();
		this.resetVehicle();
		this.sound.play( 'select' );
		if ( this.nextEvent && ! this.nextEvent.vehicles.includes( id ) ) this.nextEvent = rollEvent( id, this.save.stats.runs );
		this.ui.show( 'hangar' );

	}

	canUnlock( id ) {

		const u = VEHICLE_BY_ID[ id ].unlock;
		return !! u && this.save.zones.includes( u.zone ) && this.save.cash >= u.cost;

	}

	unlockVehicle( id ) {

		const u = VEHICLE_BY_ID[ id ].unlock;
		if ( ! u || this.save.unlocked.includes( id ) || ! this.canUnlock( id ) ) return;
		this.save.cash -= u.cost;
		this.save.unlocked.push( id );
		this.save.vehicle = id;
		this.persist();
		this.resetVehicle();
		this.sound.play( 'unlock' );
		this.particles.confetti( this.lp.x, this.lp.y + this.model.height * 0.6 );
		this.celebrate( 10 );
		this.ui.toast( `${ VEHICLE_BY_ID[ id ].name } unlocked!`, 3, 'record' );
		this.checkAchievements();
		this.ui.show( 'hangar' );

	}

	setTimeOfDay( id ) {

		if ( ! TIMES_OF_DAY[ id ] ) return;
		this.save.timeOfDay = id;
		this.app.setTimeOfDay( id );
		this.persist();
		if ( this.state === 'hangar' ) this.ui.renderTimeOfDay();

	}

	openShop() {

		this.state = 'shop';
		this.ui.show( 'shop' );

	}

	closeShop() {

		this.state = 'hangar';
		this.ui.show( 'hangar' );

	}

	buy( id ) {

		const v = this.vehicle;
		const u = UPGRADES[ v ].find( ( x ) => x.id === id );
		const cur = this.save.levels[ v ][ id ] || 0;
		const next = u.levels[ cur + 1 ];
		if ( ! next || this.save.cash < next.cost ) return false;
		this.save.cash -= next.cost;
		this.save.levels[ v ][ id ] = cur + 1;
		this.persist();
		this.buildModel( v );
		this.sound.play( 'buy' );
		this.particles.burst( 30, { x: this.lp.x, y: this.lp.y + this.model.height * 0.5, speed: 14, life: 0.9, size: 0.5, colors: [ [ 6, 4.5, 1 ], [ 3, 5, 6 ] ], drag: 2 } );
		this.checkAchievements();
		return true;

	}

	buyPaint( v, id ) {

		const key = v + ':' + id;
		const cost = paintCost( v, id );
		if ( ! this.save.ownedPaints.includes( key ) ) {

			if ( this.save.cash < cost ) return false;
			this.save.cash -= cost;
			this.save.ownedPaints.push( key );
			this.sound.play( 'buy' );

		} else this.sound.play( 'select' );

		this.save.paints[ v ] = id;
		this.persist();
		this.buildModel( v );
		return true;

	}

	maxedVehicles() {

		const out = {};
		for ( const v in UPGRADES ) out[ v ] = UPGRADES[ v ].every( ( u ) => ( this.save.levels[ v ][ u.id ] || 0 ) >= u.levels.length - 1 );
		return out;

	}

	checkAchievements( run = null ) {

		const ctx = { maxed: this.maxedVehicles() };
		for ( const a of ACHIEVEMENTS ) {

			if ( this.save.achievements[ a.id ] ) continue;
			let ok = false;
			try {

				ok = a.test( this.save, run, ctx );

			} catch {

				ok = false;

			}

			if ( ok ) {

				this.save.achievements[ a.id ] = Date.now();
				this.save.cash += a.reward;
				this.save.stats.earned = ( this.save.stats.earned || 0 ) + a.reward;
				this.ui.achievement( a );
				this.sound.play( 'achievement' );
				if ( this.run && this.state === 'flight' ) this.run.achievements.push( a );

			}

		}

		this.persist();

	}

	resetProgress() {

		localStorage.removeItem( SAVE_KEY );
		localStorage.removeItem( OLD_KEY );
		this.save = freshSave();
		this.app.setTimeOfDay( this.save.timeOfDay );
		this.toHangar( true );

	}

	setPaused( p ) {

		this.paused = p;
		this.ui.setPaused( p );

	}

	// ---------------------------------------------------------------- launch

	launch() {

		if ( this.state !== 'hangar' ) return;
		if ( this.photo ) this.togglePhoto();
		this.sound.unlock();
		const v = this.vehicle;
		this.resetVehicle();
		const st = this.stats( v );
		this.shield = st.shield;
		this.shieldRegen = 0;
		this.invuln = 0;
		this.buffs = { magnet: 0, boost: 0 };
		this.run = {
			vehicle: v, coins: 0, coinCount: 0, fuelCans: 0, stars: 0, hits: 0, blocked: 0, orbs: 0, astronauts: 0, probes: 0, crystals: 0,
			zonesNew: [], zones: [], zone: 'shore', endTimer: - 1, endReason: '', recordBroken: false, maxH: 0, overheated: false,
			achievements: [], time: 0, timeOfDay: this.app.timeOfDay,
			nearMisses: 0, combo: 0, bestCombo: 0, lastCoin: - 10, bags: 0, maxHBeforeHit: 0, missionsDone: [],
			event: this.nextEvent && this.nextEvent.vehicles.includes( v ) ? this.nextEvent : null,
		};
		this.nextEvent = null;
		void this.missions; // make sure this vehicle has its three missions
		this.hazards.reset();
		this.particles.clear();
		this.ui.show( 'hud' );
		this.save.stats.runs ++;
		if ( v === 'balloon' ) this._beginFlight();
		else {

			this.state = 'countdown';
			this.countdown = 3.2;
			this.ui.countdown( 3 );
			this.sound.play( 'tick' );

		}

		this.music.setMood( v === 'starship' ? 'space' : isShip( v ) ? 'cosmic' : 'flight' );

	}

	_beginFlight() {

		this.state = 'flight';
		const v = this.vehicle;
		this.sound.play( v === 'balloon' ? 'launch' : 'ignition' );
		this.app.island.cheer( 3.5 );
		if ( this.run.event ) this.ui.eventBanner( this.run.event );
		this._help( v );
		const qs = this.app.qs;
		if ( this.sandbox && qs.has( 'start' ) && ! isShip( v ) ) {

			const h = Number( qs.get( 'start' ) );
			this.s.y = h; this.s.maxY = h; this.s.vy = 40;
			if ( v === 'balloon' ) this.s.heat = 1;
			// the drawn position stays low; the floating origin carries the rest
			this.lp.y = Math.min( h, 200 );
			this.app.originY = h - this.lp.y;
			this.run.zone = zoneAt( h ).id;
			this.hazards.reset( undefined, this.lp.y );
			this._camSnap = true;

		}

	}

	// the controls, the first time each vehicle flies
	_help( v ) {

		const help = {
			balloon: 'Hold SPACE to fire the burner · A / D to steer · SHIFT drops a sandbag', rocket: 'Hold SPACE for thrust · A / D to tilt · SHIFT fires an afterburner', starship: 'Hold SPACE to burn: every second multiplies your speed · fly through rings for a kick',
			warpship: 'Hold SPACE to burn · SHIFT to hyperjump (you pass through anything) · rings refill jumps', ark: 'Hold SPACE to burn · SHIFT to hyperjump · chain the rings!',
		};
		if ( ! this.save.seen[ v ] ) this.ui.toast( help[ v ], 5 );
		this.save.seen[ v ] = true;

	}

	// upgrades the player can buy right now for vehicle v
	affordable( v = this.vehicle ) {

		let n = 0;
		for ( const u of UPGRADES[ v ] ) {

			const next = u.levels[ ( this.save.levels[ v ][ u.id ] || 0 ) + 1 ];
			if ( next && next.cost <= this.save.cash ) n ++;

		}

		return n;

	}

	// the Starship's cinematic ascent: lift off the barge, then cut to orbit
	_starshipToOrbit() {

		this.state = 'ascent';
		this.ascent = 0;
		this.sound.play( 'ignition' );
		this.app.island.cheer( 4 );
		if ( this.run.event ) this.ui.eventBanner( this.run.event );

	}

	_enterOrbit() {

		this.ui.fade( () => {

			const s = this.s;
			const v = this.vehicle;
			const start = SHIP_START[ v ];
			s.d = ORBIT_START;
			const qs = this.app.qs;
			let to = start.d;
			if ( this.sandbox && qs.has( 'start' ) ) to = Math.max( ORBIT_START, Number( qs.get( 'start' ) ) );
			if ( v === 'starship' ) s.d = to;
			s.maxY = s.d;
			s.u = Math.log( 7800 );
			s.v = 7800;
			s.x = 0; s.vx = 0; s.y = 0; s.vy = 0;
			this.lp = { x: 0, y: 0, vx: 0, vy: 60 };
			this.mode = 'space';
			this.run.zone = zoneAt( s.d ).id;
			this.hazards.reset( undefined, 0 );
			this.particles.clear();
			this.app.worldVisible = false;
			this._camSnap = true;
			this.app.post.cut();
			if ( v === 'starship' ) {

				this.state = 'flight';
				this.updateSpace( 0 );
				this.ui.zoneBanner( { name: 'Low Orbit', from: s.d, color: '#141a3c', tagline: 'Burn for the Moon!' }, false );
				this._help( v );

			} else {

				// the jump out: the route streams by (log distance) inside a warp tunnel
				this.state = 'jump';
				this.jump = { t: 0, dur: v === 'ark' ? 5.5 : 3.6, from: s.d, to, v0: start.v };
				this.sound.play( 'jump' );
				this.updateSpace( 0 );

			}

		} );

	}

	updateJump( dt ) {

		const j = this.jump, s = this.s;
		j.t += dt;
		const k = Math.min( 1, j.t / j.dur );
		const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow( - 2 * k + 2, 3 ) / 2;
		const prev = s.d;
		s.d = Math.exp( Math.log( j.from ) + ( Math.log( j.to ) - Math.log( j.from ) ) * e );
		s.v = Math.max( 7800, ( s.d - prev ) / Math.max( dt, 1e-3 ) );
		s.maxY = s.d;
		s.burning = true;
		this.lp.y += 170 * dt;
		this.lp.vy = 170;
		this.shake = Math.max( this.shake, 0.25 + Math.sin( k * Math.PI ) * 0.3 );
		this.jumpFx = Math.sin( Math.min( 1, k * 1.15 ) * Math.PI ) * 0.9 + ( k > 0.95 ? 0 : 0.1 );
		// the Ark dives through the black hole at the end: a flash as it comes out the other side
		if ( this.vehicle === 'ark' && ! j.flashed && k > 0.9 ) {

			j.flashed = true;
			this.app.flash = 1;
			this.sound.play( 'warpin' );

		}

		if ( k >= 1 ) {

			s.d = j.to;
			s.maxY = s.d;
			s.u = Math.log( j.v0 );
			s.v = j.v0;
			this.jump = null;
			this.jumpFx = 0;
			this.state = 'flight';
			this.run.zone = zoneAt( s.d ).id;
			this.hazards.reset( undefined, this.lp.y );
			if ( this.vehicle === 'warpship' ) this.app.flash = 0.6;
			this.sound.play( 'warpin' );
			const z = zoneAt( s.d );
			this.ui.zoneBanner( { ...z, tagline: this.vehicle === 'ark' ? 'Out the far side of the black hole!' : 'Past the heliopause. Burn for Alpha Centauri!' }, false );
			this._help( this.vehicle );

		}

	}

	endRun( reason ) {

		if ( this.state !== 'flight' ) return;
		this.state = 'results';
		const r = this.run;
		r.endReason = reason;
		r.maxH = Math.max( r.maxH, this.realH() );
		// missions: pay out the ones this run completed
		let missionPay = 0;
		for ( const m of this.save.missions[ r.vehicle ] || [] ) {

			if ( m.done ) continue;
			m.progress = Math.max( m.progress || 0, missionProgress( m, r ) );
			if ( m.progress >= m.target ) {

				m.done = true;
				missionPay += m.reward;
				r.missionsDone.push( m );

			}

		}
		const maxH = Math.max( r.maxH, this.realH() );
		const tod = TIMES_OF_DAY[ r.timeOfDay ] || TIMES_OF_DAY.afternoon;
		const pay = Math.round( altitudePay( maxH ) );
		const zoneBonus = r.zonesNew.reduce( ( a, id ) => a + zoneById( id ).bonus, 0 );
		const prevBest = this.save.bestBy[ r.vehicle ] || 0;
		const record = maxH > prevBest;
		const recordBonus = record && prevBest > 0 ? Math.round( Math.max( 0, pay - altitudePay( prevBest ) ) * 0.25 ) : 0;
		const sub = pay + r.coins + zoneBonus + recordBonus;
		const todBonus = Math.round( sub * ( tod.bonus - 1 ) );
		const eventBonus = r.event && r.event.pay ? Math.round( sub * ( r.event.pay - 1 ) ) : 0;
		// the balloon set down on the pad: a bullseye bonus
		let landBonus = 0, landText = '';
		if ( reason === 'landed' && r.vehicle === 'balloon' ) {

			const off = Math.abs( this.s.x - LAUNCH.x );
			if ( off < 2.6 ) {

				landBonus = Math.max( 150, Math.round( pay * 0.35 ) );
				landText = 'BULLSEYE landing!';
				this.save.stats.bullseyes = ( this.save.stats.bullseyes || 0 ) + 1;

			} else if ( off < 6.5 ) {

				landBonus = Math.max( 60, Math.round( pay * 0.12 ) );
				landText = 'Landed on the pad';

			}

		}

		const total = sub + todBonus + eventBonus + landBonus + missionPay;
		this.save.cash += total;
		this.save.bestBy[ r.vehicle ] = Math.max( prevBest, maxH );
		this.save.best = Math.max( this.save.best, maxH );
		const st = this.save.stats;
		st.coins += r.coinCount;
		st.earned = ( st.earned || 0 ) + total;
		st.flightTime = ( st.flightTime || 0 ) + r.time;
		if ( reason === 'splash' ) st.splashes ++;
		if ( reason === 'pop' ) st.pops ++;
		if ( r.timeOfDay === 'night' ) st.nightRuns ++;
		if ( ! st.times.includes( r.timeOfDay ) ) st.times.push( r.timeOfDay );
		this.persist();
		const before = r.achievements.length;
		this.checkAchievements( r );
		void before;
		this.sound.play( reason === 'pop' || reason === 'destroyed' ? 'pop' : reason === 'victory' ? 'record' : 'end' );
		if ( record ) this.particles.confetti( this.lp.x, this.lp.y + this.model.height * 0.5, 160 );
		if ( landBonus && landText.startsWith( 'BULL' ) ) {

			this.particles.confetti( this.lp.x, this.lp.y + 4, 120 );
			this.sound.play( 'chain' );

		}

		this.ui.showResults( {
			reason, vehicle: r.vehicle, altitude: maxH, prevBest, record, fact: funFact( maxH ),
			lines: [
				[ isShip( r.vehicle ) ? 'Distance' : 'Altitude', pay ],
				[ `Coins ×${ r.coinCount }`, r.coins ],
				...r.zonesNew.map( ( id ) => [ `New zone: ${ zoneById( id ).name }`, zoneById( id ).bonus ] ),
				...( recordBonus ? [ [ 'New record bonus', recordBonus ] ] : [] ),
				...( todBonus ? [ [ `${ tod.name } flight bonus`, todBonus ] ] : [] ),
				...( eventBonus ? [ [ `${ r.event.name } bonus`, eventBonus ] ] : [] ),
				...( landBonus ? [ [ landText, landBonus ] ] : [] ),
				...r.missionsDone.map( ( m ) => [ `✔ ${ m.text }`, m.reward ] ),
			],
			achievements: r.achievements,
			total,
		} );
		this.music.setMood( 'results' );
		if ( reason === 'victory' && ! this.save.won ) {

			this.save.won = true;
			this.persist();
			setTimeout( () => this.ui.showCredits(), 2600 );

		}

	}

	// back to the pad after a run; then: 'launch' (fly again) or 'shop' (straight to the workshop)
	returnToPad( then = null ) {

		if ( this._returning ) return;
		this._returning = true;
		if ( this.photo ) this.togglePhoto();
		const r = this.run;
		const party = r && ( r.recordBroken || r.zonesNew.length || r.endReason === 'victory' || r.missionsDone.length );

		this.ui.fade( () => {

			this._returning = false;
			this.toHangar( true );
			if ( party ) this.celebrate( r.recordBroken || r.endReason === 'victory' ? 9 : 5 );
			this.app.post.cut();
			if ( this.app.clouds ) this.app.clouds.resetHistory();
			if ( then === 'launch' ) this.launch();
			else if ( then === 'shop' ) this.openShop();

		} );

	}

	// real altitude / route distance of the player
	realH() {

		return isShip( this.vehicle ) && this.mode === 'space' ? this.s.d : Math.max( 0, this.s.y );

	}

	// ---------------------------------------------------------------- per frame

	update( dt ) {

		dt = Math.min( dt, 0.05 );
		// hit-stop: a beat of slow motion on big moments
		if ( this.hitstop > 0 && this.state === 'flight' ) {

			this.hitstop = Math.max( 0, this.hitstop - dt );
			dt *= 0.18;

		}

		this.time += dt;
		const input = this.input;
		if ( input.hit( 'KeyM' ) ) this.toggleMute();
		if ( input.hit( 'KeyC' ) && ( this.state !== 'flight' || this.paused ) && this.state !== 'countdown' && this.state !== 'ascent' ) this.togglePhoto();

		switch ( this.state ) {

			case 'hangar':
				if ( this.ui.modalOpen ) break;
				if ( input.hit( 'Space', 'Enter' ) ) this.launch();
				else if ( input.hit( 'KeyU' ) ) this.openShop();
				else if ( input.hit( 'Digit1' ) ) this.selectVehicle( 'balloon' );
				else if ( input.hit( 'Digit2' ) ) this.selectVehicle( 'rocket' );
				else if ( input.hit( 'Digit3' ) ) this.selectVehicle( 'starship' );
				else if ( input.hit( 'Digit4' ) ) this.selectVehicle( 'warpship' );
				else if ( input.hit( 'Digit5' ) ) this.selectVehicle( 'ark' );
				break;
			case 'shop':
				if ( input.hit( 'Escape', 'KeyU' ) ) this.closeShop();
				break;
			case 'countdown':
				// a tap skips to ignition
				if ( input.hit( 'Space', 'Enter' ) && this.countdown > 1.0 ) this.countdown = 1.0;
				this.updateCountdown( dt );
				break;
			case 'ascent':
				// the cinematics are skippable once seen
				if ( input.hit( 'Space', 'Enter' ) && this.save.seen[ this.vehicle ] ) this.ascent = Math.max( this.ascent, 3.2 );
				this.updateAscent( dt );
				break;
			case 'jump':
				if ( input.hit( 'Space', 'Enter' ) && this.save.seen[ this.vehicle ] ) this.jump.t = Math.max( this.jump.t, this.jump.dur * 0.86 );
				this.updateJump( dt );
				break;
			case 'flight':
				if ( input.hit( 'Escape', 'KeyP' ) ) this.setPaused( ! this.paused );
				if ( ! this.paused ) this.updateFlight( dt );
				break;
			case 'results':
				if ( ! this.ui.creditsOpen ) {

					if ( input.hit( 'Space', 'Enter' ) ) this.returnToPad();
					else if ( input.hit( 'KeyR' ) ) this.returnToPad( 'launch' );
					else if ( input.hit( 'KeyU' ) ) this.returnToPad( 'shop' );

				}

				this.s.vy *= 1 - dt;
				break;

		}

		const frozen = this.state === 'flight' && this.paused;
		this.updateModel( frozen ? 0 : dt );
		if ( this.fireworks.length ) this.updateFireworks( dt );
		this.updateSea( dt );
		// how hard the music drives: combos, the engine, hyperjumps, afterburners, speed
		if ( this.state === 'flight' || this.state === 'jump' || this.state === 'ascent' ) {

			const r = this.run, s = this.s;
			const combo = r && r.time - r.lastCoin < 1.4 ? r.combo : 0;
			this.musicDrive = Math.min( 1, 0.3 + ( s.burning ? 0.15 : 0 ) + combo / 40 + ( this.jumpFx || 0 ) * 0.5 + ( s.burstT > 0 ? 0.4 : 0 ) + ( this.state === 'jump' ? 0.5 : 0 ) + this.app.post.params.speed.value * 0.4 );

		} else this.musicDrive = 0;
		this.updateEffects( frozen ? 0 : dt );
		this.updateCamera( dt );
		if ( this.mode === 'space' ) this.updateSpace( frozen ? 0 : dt );
		else this.app.space = null;
		this.app.island.update( dt, this.time, { x: windAt( 0, this.time ) } );
		this.sound.update( dt, this );
		this.music.update( dt, this );
		this.ui.update( dt );
		input.endFrame();

	}

	updateCountdown( dt ) {

		const before = Math.ceil( this.countdown );
		this.countdown -= dt;
		const now = Math.ceil( this.countdown );
		// the engines light in the last second: smoke billows
		this.s.burning = this.countdown < 1.2;
		if ( now !== before && now > 0 ) {

			this.ui.countdown( now );
			this.sound.play( 'tick' );

		}

		if ( this.countdown <= 0 ) {

			this.ui.countdown( 0 );
			if ( isShip( this.vehicle ) ) this._starshipToOrbit();
			else this._beginFlight();

		}

	}

	updateAscent( dt ) {

		const s = this.s;
		this.ascent += dt;
		s.burning = true;
		s.vy += ( 8 + this.ascent * 14 ) * dt;
		s.y += s.vy * dt;
		this.lp.y = s.y;
		this.lp.vy = s.vy;
		this.shake = Math.max( this.shake, 0.35 );
		if ( this.ascent > 3.2 && ! this._orbitQueued ) {

			this._orbitQueued = true;
			this._enterOrbit();
			setTimeout( () => {

				this._orbitQueued = false;

			}, 600 );

		}

	}

	updateFlight( dt ) {

		const v = this.vehicle, s = this.s, st = this.stats( v ), input = this.input, r = this.run;
		r.time += dt;
		const inp = { burn: input.burn, steer: input.steer };
		const bag = input.bag;

		// ---- physics
		if ( v === 'balloon' ) {

			if ( bag && dropBag( s ) ) {

				this.models.balloon.setBags( s.bags );
				this.sound.play( 'bag' );
				this.save.stats.bags ++;
				r.bags ++;
				this.particles.burst( 12, { soft: true, x: s.x, y: s.y + 0.5, speed: 3, life: 1.2, size: 0.8, grow: 2, color: [ 0.8, 0.7, 0.5 ], alpha: 0.7, gravity: - 4 } );

			}

			if ( this.buffs.boost > 0 ) s.kick += 18 * dt;
			// riding a thermal: rising air lifts the balloon
			const th = this.hazards.thermalAt( this.lp.x, this.lp.y + this.model.height * 0.4 );
			if ( th > 0 ) {

				s.kick += 9 * th * dt;
				if ( ! this.inThermal ) {

					this.inThermal = true;
					r.thermals = ( r.thermals || 0 ) + 1;
					this.ui.toast( 'Thermal! Ride it up', 1.2, 'good' );
					this.sound.play( 'whoosh' );

				}

				if ( Math.random() < 0.5 ) this.particles.emit( { soft: true, x: this.lp.x + ( Math.random() - 0.5 ) * 10, y: this.lp.y - 4, z: ( Math.random() - 0.5 ) * 6, vy: 16, life: 1.6, size: 0.4, grow: 1, color: [ 0.95, 0.92, 0.85 ], alpha: 0.35, drag: 0.4 } );

			} else this.inThermal = false;
			const onPad = Math.abs( s.x - LAUNCH.x ) < 6.2;
			const ground = onPad ? PAD_Y : Math.max( 0, islandHeight( s.x, 0 ) );
			for ( let i = 0; i < 2; i ++ ) step( s, st, inp, dt / 2, ground );
			this.followLocal( dt, false );
			this.ground = ground;

		} else if ( v === 'rocket' ) {

			// coasting above the air: time warp to apogee
			const coasting = s.fuel <= 0 && ! s.boosters && s.vy > 60 && s.y > 30000 && ! s.popped;
			const targetWarp = coasting ? MathUtils.clamp( s.vy / 50, 1, 40 ) : 1;
			this.warp += ( targetWarp - this.warp ) * Math.min( 1, dt * 1.5 );
			if ( this.buffs.boost > 0 ) s.vy += 25 * dt;
			// afterburner: SHIFT / E spends a charge
			if ( bag && s.charges > 0 && s.burstT <= 0 && ! s.popped ) this.afterburner();
			const onBarge = Math.abs( s.x - BARGE.x ) < 18;
			const ground = onBarge ? BARGE.deckY + this.app.island.barge.position.y : Math.max( 0, islandHeight( s.x, 0 ) );
			const total = dt * this.warp;
			const n = Math.max( 1, Math.ceil( total / ( 1 / 60 ) ) );
			for ( let i = 0; i < n; i ++ ) stepRocket( s, st, inp, total / n, ground );
			if ( s.separated ) {

				s.separated = false;
				this.models.rocket.separate( { x: this.lp.x, y: this.lp.y, vx: this.lp.vx, vy: this.lp.vy } );
				this.sound.play( 'separation' );
				this.ui.toast( 'Booster separation!', 1.4 );
				this.particles.burst( 30, { soft: true, x: this.lp.x, y: this.lp.y + 2, speed: 8, life: 2, size: 3, grow: 3, color: [ 0.85, 0.85, 0.85 ], alpha: 0.7, drag: 1.5 } );

			}

			this.followLocal( dt, true );
			this.ground = ground;

		} else {

			// space vehicles: route distance + sideways dodging; heat from nearby stars
			const sunFlux = this.space ? this.space.sunHeat : 0;
			if ( this.buffs.boost > 0 ) s.kick = Math.max( s.kick, 0.5 );
			// flybys in slow motion: near a flyby point the route advances at most `rate` radii per
			// second, so every world, nebula and galaxy gets a few seconds on screen
			const fb = flybyAt( s.d / 1000 );
			const R = fb.body.R;
			const [ win, rate ] = fb.body.slow || [ 24, 3.2 ];
			const cap = Math.abs( fb.offset ) < win * R ? rate * R * 1000 : Infinity;
			if ( cap < Infinity && ! this.flybyShown ) {

				this.flybyShown = fb.body.id;
				if ( s.v > cap * 1.5 && fb.body.id !== 'edge' ) this.ui.toast( `${ fb.body.name } flyby!`, 2, 'record' );

			} else if ( cap === Infinity ) this.flybyShown = null;

			this.flyby = cap < Infinity && s.v > cap;
			// hyperjump: SHIFT / E spends a charge
			if ( bag && s.jumps > 0 && s.jumpT <= 0 && ! s.popped ) this.hyperjump();
			stepShip( s, st, inp, dt, sunFlux, cap );
			// the end of the road: the route's end, and Sagittarius A* for the Warpship
			s.d = Math.min( s.d, ROUTE_LENGTH * 1000, r.endReason === 'horizon' ? BODY_BY_ID.blackhole.at * 1000 : Infinity );
			s.maxY = Math.min( s.maxY, ROUTE_LENGTH * 1000 );
			// the Ark without its Reality Anchor is held back at the Edge
			const gate = zoneById( 'edge' ).from;
			if ( v === 'ark' && ! st.anchor && s.d > gate ) {

				s.d = gate;
				s.u = Math.min( s.u, Math.log( 1e25 ) );
				if ( ! r.gated ) {

					r.gated = true;
					this.ui.toast( 'The wall of light pushes back! You need the Reality Anchor.', 3.5, 'bad' );
					this.shake = 1;

				}

			}
			this.jumpFx = s.jumpT > 0 ? Math.sin( ( 1 - s.jumpT / JUMP_TIME ) * Math.PI ) : 0;
			const vis = MathUtils.clamp( 60 + 14 * Math.log10( Math.max( 1, s.v / 7800 ) ), 60, 170 ) * ( 1 + this.jumpFx * 1.6 );
			this.lp.vy = vis;
			this.lp.vx = s.vx;
			this.lp.y += vis * dt;
			this.lp.x = s.x;
			if ( s.heat > 1 ) {

				r.overheated = true;
				this.heatDamage = ( this.heatDamage || 0 ) + dt;
				if ( this.heatDamage > 1.2 ) {

					this.heatDamage = 0;
					this.damage( 1, 'heat' );

				}

			}

			if ( v === 'warpship' && s.d >= BODY_BY_ID.blackhole.at * 1000 && r.endTimer < 0 ) {

				// the Warpship can't escape Sagittarius A*: the end of its road
				s.d = BODY_BY_ID.blackhole.at * 1000;
				r.endReason = 'horizon';
				r.endTimer = 2.5;
				this.app.flash = 0.8;

			}

			if ( s.d >= ROUTE_LENGTH * 1000 * 0.999 && r.endTimer < 0 ) {

				s.d = ROUTE_LENGTH * 1000;
				r.endReason = 'victory';
				r.endTimer = 3;
				this.app.flash = 2.5;
				this.sound.play( 'warpin' );

			}

		}

		// Tailwind: propellant lasts longer
		if ( r.event && r.event.fuelMul && s.burning && s.fuel > 0 ) s.fuel = Math.min( st.fuel, s.fuel + dt * ( 1 - r.event.fuelMul ) );
		const h = this.realH();
		r.maxH = Math.max( r.maxH, h );
		const speed = isShip( v ) ? s.v : Math.hypot( s.vx, s.vy );
		// breaking the sound barrier in the thick air: a vapour cone and a boom
		if ( v === 'rocket' && ! r.boom && speed > 343 && s.y < 18000 ) {

			r.boom = true;
			this.sound.play( 'boom' );
			this.shake = Math.max( this.shake, 0.6 );
			this.ui.toast( 'Sonic boom!', 1.2 );
			const m = this.model;
			for ( let i = 0; i < 48; i ++ ) {

				const a = i / 48 * Math.PI * 2;
				this.particles.emit( { soft: true, x: this.lp.x + Math.cos( a ) * m.radius * 2.2, y: this.lp.y + m.height * 0.55, z: Math.sin( a ) * m.radius * 2.2, vx: Math.cos( a ) * 6, vy: - 30, vz: Math.sin( a ) * 6, life: 1.1, size: 2.2, grow: 3, color: [ 0.95, 0.97, 1 ], alpha: 0.75, drag: 2 } );

			}

		}
		this.save.stats.maxSpeed = Math.max( this.save.stats.maxSpeed || 0, speed );
		this.buffs.magnet = Math.max( 0, this.buffs.magnet - dt );
		this.buffs.boost = Math.max( 0, this.buffs.boost - dt );

		// ---- hazards and pickups (paused while time-warping)
		const view = this.view;
		const local = v !== 'balloon';
		const ctx = {
			h, local, night: this.app.timeOfDay === 'night' || this.app.timeOfDay === 'dawn',
			hRate: Math.max( 1, ( isShip( v ) ? s.v : Math.abs( s.vy ) ) / Math.max( 1, Math.abs( this.lp.vy ) ) ),
			localSpeed: Math.abs( this.lp.vy ),
			ship: isShip( v ), vehicle: v, event: r.event,
		};
		if ( this.warp < 1.5 ) this.hazards.spawnAhead( this.lp, view, ctx );
		// the line of the best height ahead (balloon and rocket)
		const bestH = this.save.bestBy[ v ] || 0;
		const bl = this.bestLine;
		bl.visible = false;
		if ( ! isShip( v ) && bestH > 50 && h < bestH && ! r.recordBroken ) {

			const y = this.lp.y + ( bestH - h ) / ctx.hRate;
			if ( y - this.lp.y < view.halfH * 1.4 ) {

				bl.visible = true;
				bl.position.set( this.lp.x, y, - 1 );
				bl.scale.set( view.halfW * 2.6, 1 + view.halfH * 0.004, 1 );
				this.bestLineInfo = { x: this.lp.x - view.halfW * 0.92, y, text: `BEST ${ formatAltitude( bestH ) }` };

			}

		}

		if ( ! bl.visible ) this.bestLineInfo = null;
		this.hazards.update( dt, this.lp, view, this.time, ctx );
		const m = this.model;
		const c = Math.cos( s.angle || 0 ), sn = Math.sin( s.angle || 0 );
		const circles = m.colliders.map( ( q ) => ( { x: this.lp.x + q.x * c + q.y * sn, y: this.lp.y - q.x * sn + q.y * c, r: q.r } ) );
		this.invuln = Math.max( 0, this.invuln - dt );
		if ( this.invuln <= 0 && ! s.popped && this.warp < 1.5 && ! ( s.jumpT > 0 ) ) {

			const hit = this.hazards.hitTest( circles );
			if ( hit ) this.onHit( hit );
			else for ( const hz of this.hazards.nearTest( circles, 3.5 ) ) this.onNearMiss( hz );

		}

		if ( st.shield > 0 && this.shield < st.shield ) {

			this.shieldRegen += dt;
			if ( this.shieldRegen > 14 ) {

				this.shield ++;
				this.shieldRegen = 0;

			}

		}

		const center = { x: this.lp.x, y: this.lp.y + m.height * 0.5 };
		const magnet = Math.max( st.magnet, this.buffs.magnet > 0 ? 40 : 0 );
		for ( const p of this.hazards.collect( circles.map( ( q ) => ( { ...q, r: q.r + 0.6 } ) ), center, magnet ) ) this.onPickup( p );

		// ---- zones
		const z = zoneAt( h );
		if ( z.id !== r.zone && zoneIndex( h ) > ZONES.findIndex( ( q ) => q.id === r.zone ) ) {

			r.zone = z.id;
			if ( ! r.zones.includes( z.id ) ) r.zones.push( z.id );
			const fresh = ! this.save.zones.includes( z.id );
			if ( fresh ) {

				this.save.zones.push( z.id );
				r.zonesNew.push( z.id );

			}

			this.ui.zoneBanner( z, fresh );
			this.sound.play( fresh ? 'zoneNew' : 'zone' );
			if ( fresh ) this.chromaPulse = 0.5;
			if ( fresh ) this.checkAchievements( r );

		}

		const best = this.save.bestBy[ v ] || 0;
		if ( ! r.recordBroken && best > 50 && h > best ) {

			r.recordBroken = true;
			if ( this.model.cheer ) this.model.cheer( 2.5 );
			this.chromaPulse = 0.5;
			this.ui.toast( 'NEW RECORD!', 2.5, 'record' );
			this.sound.play( 'record' );
			this.particles.confetti( this.lp.x, this.lp.y + m.height * 0.8, 80 );

		}

		// ---- end conditions
		if ( r.endTimer < 0 ) {

			if ( isShip( v ) ) {

				// (a coasting ship still faster than a flyby's slow motion carries on through it; the
				// Ark with its anchor coasts on to the wall at the Edge)
				const final = v === 'ark' && st.anchor && s.d > zoneById( 'edge' ).from;
				if ( s.popped ) {

					r.endReason = 'destroyed';
					r.endTimer = 1.8;

				} else if ( s.fuel <= 0 && ! s.burning && ! this.flyby && ! final && ! ( s.jumpT > 0 ) ) {

					this.coastTime = ( this.coastTime || 0 ) + dt;
					if ( this.coastTime > 2.5 ) {

						r.endReason = 'drift';
						r.endTimer = 0.5;

					}

				} else this.coastTime = 0;

			} else {

				const left = s.maxY > this.padPosition().y + 6;
				if ( left && s.y <= this.ground + 0.05 && s.vy <= 0.5 ) {

					r.endReason = this.ground <= 0.01 ? 'splash' : 'landed';
					r.endTimer = 0.8;
					if ( r.endReason === 'splash' ) {

						this.sound.play( 'splash' );
						this.app.post.params.droplets.value = 1;
						this.particles.burst( 40, { soft: true, x: this.lp.x, y: 0.5, speed: 12, life: 1.4, size: 1.2, grow: 1.5, color: [ 0.9, 0.95, 1 ], alpha: 0.9, gravity: - 14, drag: 0.8 } );

					}

				} else if ( s.popped ) {

					r.endReason = v === 'rocket' ? 'destroyed' : 'pop';
					r.endTimer = 1.6;

				} else if ( v === 'balloon' && s.fuel <= 0 && s.vy < - 3 && s.maxY - s.y > 25 ) {

					r.endReason = 'fuel';
					r.endTimer = 1.4;
					this.ui.toast( 'Out of fuel', 1.5 );

				} else if ( v === 'rocket' && s.fuel <= 0 && ! s.boosters && s.vy < 0 && s.y > 50 ) {

					r.endReason = 'apogee';
					r.endTimer = 1.2;
					this.ui.toast( 'Apogee!', 1.5 );

				}

			}

		} else {

			r.endTimer -= dt;
			if ( r.endTimer <= 0 ) this.endRun( r.endReason );

		}

	}

	// the drawn vehicle follows its real position at up to 130 m/s (45 m/s sideways for the rocket);
	// the difference goes into the app's floating origin so the world stays where it really is
	followLocal( dt, lateral ) {

		const s = this.s, lp = this.lp, app = this.app;
		// within the cap the drawn position tracks the real one exactly (the origin holds still)
		if ( Math.abs( s.vy ) <= 130 ) {

			lp.vy = s.vy;
			lp.y = s.y - app.originY;

		} else {

			lp.vy = Math.sign( s.vy ) * 130;
			lp.y += lp.vy * dt;
			app.originY = s.y - lp.y;

		}

		if ( lateral && Math.abs( s.vx ) > 45 ) {

			lp.vx = Math.sign( s.vx ) * 45;
			lp.x += lp.vx * dt;
			app.originX = s.x - lp.x;

		} else {

			lp.vx = s.vx;
			lp.x = s.x - app.originX;

		}

	}

	// life on the sea near the camera: spray off the breaking waves, a whale now and then
	updateSea( dt ) {

		const app = this.app, P = this.particles;
		const low = this.mode !== 'space' && app.worldVisible && app.camera.position.y + app.originY < 450;
		if ( low && dt > 0 ) {

			// spray where the crests are breaking (the same waves as the ocean shader's)
			const t = G.time.value, cam = app.camera;
			for ( let i = 0; i < 26; i ++ ) {

				const x = cam.position.x + app.originX + ( Math.random() * 2 - 1 ) * 170;
				const z = cam.position.z + 40 - Math.random() * 280;
				const d = - islandHeight( x, z );
				if ( d < 0.9 || d > 2.7 ) continue;
				const wob = Math.sin( x * 0.011 + z * 0.007 ) * 2.6 + Math.sin( x * 0.031 - z * 0.023 ) * 1.1;
				const ph = ( d * 0.85 + t * 0.9 + wob ) / 6.2832;
				const w = ph - Math.floor( ph );
				if ( w < 0.73 || w > 0.79 ) continue;
				P.emit( { soft: true, x: x - app.originX, y: 0.6 - app.originY, z, vx: ( Math.random() - 0.5 ) * 2, vy: 3 + Math.random() * 4, vz: 1.5 + Math.random() * 2, life: 1.1 + Math.random() * 0.6, size: 0.9, grow: 3, color: [ 0.95, 0.97, 1 ], alpha: 0.45, gravity: - 5, drag: 0.8 } );

			}

		}

		// the whale: a spout, then a breach and a big splash
		const wr = this.whaleRun;
		if ( ! wr ) {

			this.whaleT -= dt;
			if ( this.whaleT <= 0 && low ) {

				const x = 90 + Math.random() * 300, z = - 60 + Math.random() * 150;
				if ( - islandHeight( x, z ) > 9 ) this.whaleRun = { x, z, t: 0, dir: Math.random() < 0.5 ? 1 : - 1 };
				this.whaleT = 35 + Math.random() * 40;

			}

			return;

		}

		wr.t += dt;
		const w = this.whale;
		const X = wr.x - app.originX, Y0 = - app.originY;
		if ( wr.t < 2.2 ) {

			// the spout before it dives
			if ( wr.t < 1.4 && Math.random() < 0.9 ) P.emit( { soft: true, x: X + ( Math.random() - 0.5 ), y: Y0 + 1, z: wr.z, vx: ( Math.random() - 0.5 ) * 2, vy: 9 + Math.random() * 4, life: 1.4, size: 0.8, grow: 2.5, color: [ 0.95, 0.97, 1 ], alpha: 0.5, gravity: - 6, drag: 0.6 } );
			w.visible = false;

		} else if ( wr.t < 5.2 ) {

			// the breach: up out of the sea, a twist, and back down
			const k = ( wr.t - 2.2 ) / 3;
			w.visible = true;
			w.position.set( X + wr.dir * ( k - 0.5 ) * 16, Y0 - 7 + Math.sin( k * Math.PI ) * 15, wr.z );
			// nose up out of the water, a slow roll onto its back, a nose-down fall
			w.rotation.set( k * 2.2, wr.dir > 0 ? 0 : Math.PI, 1.25 - k * 2.4 );
			if ( ! wr.out && k > 0.12 ) {

				wr.out = true;
				this.whaleSplash( X - wr.dir * 5, Y0, wr.z, 70 );

			}

			if ( ! wr.in && k > 0.85 ) {

				wr.in = true;
				this.whaleSplash( X + wr.dir * 6, Y0, wr.z, 160 );

			}

		} else {

			w.visible = false;
			this.whaleRun = null;

		}

	}

	whaleSplash( x, y, z, n ) {

		for ( let i = 0; i < n; i ++ ) {

			// a white column up the middle, a crown thrown out around it, mist hanging over the top
			const a = Math.random() * Math.PI * 2, r = Math.random(), sp = 2 + r * 10;
			this.particles.emit( { soft: true, x: x + Math.cos( a ) * 4 * r, y: y + 0.5, z: z + Math.sin( a ) * 4 * r, vx: Math.cos( a ) * sp, vy: 5 + ( 1 - r ) * 16 + Math.random() * 5, vz: Math.sin( a ) * sp, life: 1.8 + Math.random() * 1.2, size: 1.4 + Math.random(), grow: 3.5, color: [ 0.95, 0.97, 1 ], alpha: 0.6, gravity: - 11, drag: 0.5 } );

		}

		if ( Math.hypot( this.app.camera.position.x - x, this.app.camera.position.z - z ) < 700 ) this.sound.play( 'splash' );

	}

	// fireworks over the pad and a cheering crowd
	celebrate( n = 6 ) {

		this.app.island.cheer( 5 );
		if ( this.model.cheer ) this.model.cheer( 3 );
		const cols = [ [ 12, 4, 3 ], [ 4, 8, 14 ], [ 12, 10, 3 ], [ 5, 12, 5 ], [ 11, 5, 13 ], [ 14, 14, 14 ] ];
		for ( let i = 0; i < n; i ++ ) {

			this.fireworks.push( { x: this.lp.x + ( Math.random() - 0.5 ) * 60, y: this.lp.y + 2, z: - 20 - Math.random() * 40, vy: 38 + Math.random() * 14, t: - i * 0.45 - Math.random() * 0.3, fuse: 1.2 + Math.random() * 0.5, color: cols[ Math.floor( Math.random() * cols.length ) ] } );

		}

	}

	updateFireworks( dt ) {

		const P = this.particles;
		this.fireworks = this.fireworks.filter( ( f ) => {

			f.t += dt;
			if ( f.t < 0 ) return true;
			if ( ! f.lit ) {

				f.lit = true;
				this.sound.play( 'whoosh' );

			}

			f.vy -= 14 * dt;
			f.y += f.vy * dt;
			P.emit( { x: f.x, y: f.y, z: f.z, vy: - 4, life: 0.5, size: 0.35, color: [ 10, 7, 3 ], drag: 1 } );
			if ( f.t < f.fuse ) return true;
			// burst: a sphere of sparks, a flash of glitter
			for ( let i = 0; i < 70; i ++ ) {

				const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt( 1 - u * u );
				const sp = 16 + Math.random() * 6;
				P.emit( { x: f.x, y: f.y, z: f.z, vx: r * Math.cos( a ) * sp, vy: u * sp, vz: r * Math.sin( a ) * sp, life: 1.4 + Math.random() * 0.6, size: 0.5, color: f.color, gravity: - 6, drag: 1.4, fade: 0.8 } );

			}

			this.sound.play( 'firework' );
			return false;

		} );

	}

	// SHIFT in the rocket: a blast of extra thrust
	afterburner() {

		const s = this.s, r = this.run;
		s.charges --;
		s.burstT = AFTERBURNER_TIME;
		r.afterburns = ( r.afterburns || 0 ) + 1;
		this.shake = Math.max( this.shake, 0.8 );
		this.chromaPulse = 0.45;
		this.sound.play( 'boost' );
		this.sound.play( 'boom' );
		this.ui.toast( 'AFTERBURNER!', 1.1, 'record' );
		const y = this.lp.y - 1;
		for ( let i = 0; i < 36; i ++ ) {

			const a = i / 36 * Math.PI * 2;
			this.particles.emit( { soft: true, x: this.lp.x + Math.cos( a ) * 2, y, z: Math.sin( a ) * 2, vx: Math.cos( a ) * 26, vy: - 6, vz: Math.sin( a ) * 26, life: 1.2, size: 2, grow: 3, color: [ 0.92, 0.92, 0.95 ], alpha: 0.6, drag: 2.5 } );

		}

	}

	// SHIFT in a Warpship or the Ark: a burst of speed inside a warp tunnel, hazards pass through
	hyperjump() {

		const s = this.s, r = this.run, m = this.model;
		s.jumps --;
		s.jumpT = JUMP_TIME;
		r.jumps = ( r.jumps || 0 ) + 1;
		this.save.stats.jumps = ( this.save.stats.jumps || 0 ) + 1;
		this.shake = Math.max( this.shake, 0.9 );
		this.app.flash = Math.max( this.app.flash || 0, 0.35 );
		this.sound.play( 'jump' );
		this.ui.toast( 'HYPERJUMP!', 1.1, 'record' );
		const cy = this.lp.y + m.height * 0.5;
		for ( let i = 0; i < 40; i ++ ) {

			const a = i / 40 * Math.PI * 2;
			this.particles.emit( { x: this.lp.x + Math.cos( a ) * 3, y: cy, z: Math.sin( a ) * 3, vx: Math.cos( a ) * 40, vy: - 20, vz: Math.sin( a ) * 40, life: 0.6, size: 0.8, grow: 2, color: [ 3, 4, 12 ], drag: 2, kind: 2 } );

		}

		if ( r.jumps >= 3 ) this.checkAchievements( r );

	}

	damage( n, kind ) {

		const s = this.s;
		if ( this.run.hits === 0 ) this.run.maxHBeforeHit = this.run.maxH;
		s.hull = Math.max( 0, s.hull - n );
		s.leak += 0.05 * n;
		this.run.hits ++;
		this.hitFlash = 1;
		this.shake = Math.max( this.shake, 0.8 );
		if ( s.hull <= 0 && ! s.popped ) {

			s.popped = true;
			const m = this.model;
			if ( this.vehicle === 'balloon' ) {

				this.ui.toast( 'POP!', 1.5, 'bad' );
				this.sound.play( 'pop' );
				this.particles.burst( 60, { soft: true, x: this.lp.x, y: this.lp.y + m.mouthY + m.envelopeH * 0.5, speed: 16, life: 2, size: 0.6, colors: [ [ 0.9, 0.3, 0.2 ], [ 0.95, 0.9, 0.8 ], [ 0.9, 0.7, 0.2 ] ], gravity: - 5, drag: 1.5, kind: 1, spin: 8 } );

			} else {

				this.ui.toast( kind === 'heat' ? 'Burned up!' : 'KABOOM!', 1.5, 'bad' );
				this.sound.play( 'explosion' );
				this.particles.explosion( this.lp.x, this.lp.y + m.height * 0.5, 1.6 );

			}

		}

	}

	onHit( { hazard, x, y } ) {

		const s = this.s, m = this.model;
		hazard.spent = ! LASTING.includes( hazard.type );
		this.hitstop = 0.12;
		this.invuln = 1.1;
		this.shake = 1;
		const cx = this.lp.x, cy = this.lp.y + m.height * 0.5;
		const dx = cx - x, dy = cy - y, d = Math.hypot( dx, dy ) || 1;
		s.vx += dx / d * 9;
		if ( this.vehicle === 'balloon' ) s.vy += dy / d * 5;
		if ( hazard.vx ) s.vx += hazard.vx * 0.12;
		this.particles.burst( 16, { x, y, speed: 12, life: 0.5, size: 0.4, color: [ 8, 6, 3 ], drag: 2, kind: 2 } );
		if ( this.shield > 0 ) {

			this.shield --;
			this.shieldRegen = 0;
			this.shieldHit = 1;
			this.run.blocked ++;
			this.save.stats.blocked ++;
			this.sound.play( 'shield' );
			this.ui.toast( 'Bubble popped!', 1 );
			return;

		}

		if ( hazard.type === 'storm' ) this.save.stats.zaps ++;
		const zap = [ 'storm', 'beam', 'jetburst', 'cstring' ].includes( hazard.type );
		this.sound.play( zap ? 'zap' : 'hit' );
		if ( s.hull > hazard.damage ) this.ui.toast( HIT_TEXT[ hazard.type ] || 'Ouch!', 1.2, 'bad' );
		this.damage( hazard.damage, hazard.type );

	}

	onNearMiss( h ) {

		const r = this.run;
		r.nearMisses ++;
		this.hitstop = Math.max( this.hitstop, 0.05 );
		const bonus = zoneAt( this.realH() ).coin * 4 * ( ( r.event && r.event.nearMul ) || 1 );
		r.coins += bonus;
		this.ui.toast( `Close call! +${ fmtMoney( bonus ) }`, 1.1, 'good' );
		this.sound.play( 'whoosh' );
		this.particles.burst( 10, { x: h.x, y: h.y, speed: 8, life: 0.4, size: 0.35, color: [ 4, 6, 8 ], kind: 2, drag: 2 } );

	}

	onPickup( p ) {

		const s = this.s, st = this.stats(), r = this.run, S = this.save.stats;
		const burst = ( colors, n = 14 ) => this.particles.burst( n, { x: p.x, y: p.y, speed: 10, life: 0.6, size: 0.45, colors, drag: 2 } );
		switch ( p.kind ) {

			case 'coin': {

				// combo: coins in quick succession multiply their value
				r.combo = r.time - r.lastCoin < 1.4 ? r.combo + 1 : 1;
				r.lastCoin = r.time;
				r.bestCombo = Math.max( r.bestCombo, r.combo );
				const mult = ( r.combo >= 50 ? 3 : r.combo >= 25 ? 2 : r.combo >= 10 ? 1.5 : 1 ) * ( ( r.event && r.event.coinMul ) || 1 );
				p.value = Math.round( p.value * mult );
				r.coins += p.value; r.coinCount ++;
				this.sound.play( 'coin', Math.min( 12, r.combo ) );
				burst( [ [ 8, 6, 1.5 ] ], 6 );
				break;

			}
			case 'fuel':
				s.fuel = Math.min( st.fuel, s.fuel + ( isShip( this.vehicle ) ? 5 : 6 ) );
				r.fuelCans ++;
				this.sound.play( 'fuel' );
				this.ui.toast( '+Fuel', 0.9, 'good' );
				break;
			case 'star':
				r.coins += p.value; r.stars ++; S.stars ++;
				s.kick = ( s.kick || 0 ) + ( this.vehicle === 'balloon' ? 10 : 0.6 );
				if ( this.vehicle === 'rocket' ) s.vy += 60;
				this.sound.play( 'star' );
				burst( [ [ 4, 1.5, 7 ], [ 7, 5, 8 ] ], 30 );
				this.ui.toast( `Lucky star! +${ fmtMoney( p.value ) }`, 1.4, 'good' );
				break;
			case 'shieldOrb':
				this.shield = Math.min( Math.max( 1, st.shield ), ( this.shield || 0 ) + 1 );
				r.orbs ++; S.orbs ++;
				this.sound.play( 'orb' );
				this.ui.toast( 'Bubble shield!', 1.2, 'good' );
				break;
			case 'magnetOrb':
				this.buffs.magnet = 10;
				r.orbs ++; S.orbs ++;
				this.sound.play( 'orb' );
				this.ui.toast( 'Coin magnet!', 1.2, 'good' );
				break;
			case 'boostOrb':
				this.buffs.boost = 3;
				r.orbs ++; S.orbs ++;
				this.sound.play( 'boost' );
				this.ui.toast( 'Turbo!', 1.2, 'good' );
				break;
			case 'astronaut':
				r.coins += p.value; r.astronauts ++; S.astronauts ++;
				this.sound.play( 'rescue' );
				this.ui.toast( `Astronaut rescued! +${ fmtMoney( p.value ) }`, 2, 'good' );
				break;
			case 'probe':
				r.coins += p.value; r.probes ++; S.probes ++;
				this.sound.play( 'rescue' );
				this.ui.toast( `Lost probe recovered! +${ fmtMoney( p.value ) }`, 2, 'good' );
				break;
			case 'crystal':
				p.value *= ( r.event && r.event.specialMul ) || 1;
				r.coins += p.value; r.crystals ++; S.crystals ++;
				this.sound.play( 'star' );
				burst( [ [ 1, 5, 7 ] ], 20 );
				break;
			case 'ring': {

				// warp rings: a kick of speed each; the whole chain earns a bonus and a hyperjump charge
				const chain = p.chain;
				chain.got ++;
				r.rings = ( r.rings || 0 ) + 1;
				S.rings = ( S.rings || 0 ) + 1;
				// a kick: speed for the ships, a surge of lift for the balloon, thrust for the rocket
				if ( isShip( this.vehicle ) ) s.kick = ( s.kick || 0 ) + RING_KICK * ( st.ring || 1 );
				else if ( this.vehicle === 'balloon' ) s.kick = ( s.kick || 0 ) + 4;
				else s.vy += 22;
				r.coins += p.value;
				this.sound.play( 'ring', chain.got );
				this.shake = Math.max( this.shake, 0.3 );
				this.particles.burst( 24, { x: p.x, y: p.y, speed: 16, life: 0.5, size: 0.5, colors: [ [ 2, 6, 12 ], [ 8, 4, 12 ] ], drag: 2, kind: 2 } );
				if ( chain.got === chain.n ) {

					const bonus = p.value * chain.n;
					r.coins += bonus;
					r.chains = ( r.chains || 0 ) + 1;
					this.hitstop = Math.max( this.hitstop, 0.08 );
					this.chromaPulse = 0.6;
					if ( st.jumps > 0 && s.jumps < st.jumps ) s.jumps ++;
					this.ui.toast( `PERFECT CHAIN! +${ fmtMoney( bonus ) }${ st.jumps > 0 ? ' · +1 jump' : '' }`, 1.8, 'record' );
					this.sound.play( 'chain' );
					this.checkAchievements( r );

				}

				break;

			}

		}

		if ( p.kind !== 'ring' ) this.ui.popText( p );

	}

	// ---------------------------------------------------------------- models + effects

	updateModel( dt ) {

		this.shieldHit = Math.max( 0, this.shieldHit - dt * 2.5 );
		this.hitFlash = Math.max( 0, this.hitFlash - dt * 1.8 );
		const flying = this.state === 'flight';
		const shield = flying ? ( this.shield > 0 ? 0.6 + 0.4 * Math.min( 1, this.shield ) : 0 ) : 0;
		const s = this.s, m = this.model;
		if ( this.state === 'hangar' || this.state === 'shop' ) {

			// on the pad: the balloon's idle flame, the barge bobbing under the rocket
			if ( this.vehicle === 'balloon' ) s.burning = Math.sin( this.time * 0.9 ) > 0.93;
			else {

				const pad = this.padPosition();
				s.y = pad.y; this.lp.y = pad.y; s.burning = false;

			}

		}

		const extra = { steer: flying ? this.input.steer : 0, shield, shieldHit: this.shieldHit, time: this.time, heat: s.heat || 0 };
		if ( this.vehicle === 'balloon' ) m.update( s, dt, extra );
		else m.update( { ...s, x: this.lp.x, lx: this.lp.x }, dt, { ...extra, visualY: this.lp.y } );
		m.group.visible = ! ( this.invuln > 0 && Math.floor( this.time * 20 ) % 2 === 0 && flying );
		const pp = this.app.post.params;
		pp.damage.value = this.hitFlash * 0.8;
		// speed lines and chromatic pulses: raw speed, turbo, hyperjumps, big moments
		let spd = 0;
		const v = this.vehicle;
		if ( flying || this.state === 'jump' ) {

			if ( v === 'rocket' ) spd = MathUtils.clamp( ( Math.abs( s.vy ) - 250 ) / 1200, 0, 0.7 );
			else if ( isShip( v ) ) spd = 0.2 + ( this.jumpFx || 0 ) * 0.9 + ( this.state === 'jump' ? 0.7 : 0 );
			if ( this.buffs.boost > 0 ) spd = Math.max( spd, 0.55 );

		}

		pp.speed.value += ( spd - pp.speed.value ) * Math.min( 1, dt * 4 );
		this.chromaPulse = Math.max( 0, ( this.chromaPulse || 0 ) - dt * 1.8 );
		pp.chroma.value = Math.max( this.hitFlash * 0.7, ( this.jumpFx || 0 ) * 0.9, this.chromaPulse, this.state === 'jump' ? 0.6 : 0 );

	}

	updateEffects( dt ) {

		const P = this.particles, s = this.s, v = this.vehicle, m = this.model, lp = this.lp;
		const burning = s.burning && ! s.popped;
		// the engine light follows the flame
		const el = this.engineLight;
		const lit = burning || ( v === 'rocket' && s.boosterLit && s.boosters );
		this.engineGlow = ( this.engineGlow || 0 ) + ( ( lit ? 1 : isShip( v ) ? 0.15 : 0 ) - ( this.engineGlow || 0 ) ) * Math.min( 1, dt * 12 );
		if ( v === 'balloon' ) {

			el.position.set( lp.x, lp.y + ( m.basketTop || 2 ) + 2.4, 0 );
			el.color = [ 1, 0.62, 0.28 ];
			el.intensity = 70 * this.engineGlow;
			el.range = 18;

		} else if ( v === 'rocket' ) {

			el.position.set( lp.x, lp.y - 2.5, 0 );
			el.color = s.burstT > 0 ? [ 0.75, 0.8, 1 ] : [ 1, 0.55, 0.22 ];
			el.intensity = ( s.burstT > 0 ? 2600 : 1400 ) * this.engineGlow;
			el.range = 80;

		} else {

			const dc = m.driveColor || [ 0.4, 0.7, 1 ];
			el.position.set( lp.x, lp.y - 2, 0 );
			el.color = dc;
			el.intensity = 700 * this.engineGlow;
			el.range = 50;

		}

		if ( dt <= 0 ) return;
		if ( v === 'balloon' ) {

			if ( burning && Math.random() < 0.6 ) P.emit( { x: lp.x + ( Math.random() - 0.5 ) * 0.4, y: lp.y + m.basketTop + 2.2, z: 0, vy: 6 + Math.random() * 4, vx: ( Math.random() - 0.5 ) * 2, life: 0.5, size: 0.25, color: [ 12, 6, 1.5 ], drag: 1 } );

		} else if ( v === 'rocket' ) {

			const thin = MathUtils.smoothstep( s.y, 20000, 60000 );
			const pts = m.exhaustPoints( { ...s, lx: lp.x }, lp.y );
			// the world moves by ( lp.vy - s.vy ) in drawn coordinates: smoke stays where it was puffed
			const frameVy = lp.vy - s.vy;
			const lit = burning || ( s.boosterLit && s.boosters ) || s.burstT > 0;
			// the afterburner's blue-white core and shock diamonds
			if ( s.burstT > 0 ) for ( const p of pts ) for ( let i = 0; i < 3; i ++ ) P.emit( { x: p.x + ( Math.random() - 0.5 ) * 0.4, y: p.y - 1 - i * 2.2, z: ( Math.random() - 0.5 ) * 0.4, vx: p.dx * 40, vy: p.dy * 55 + frameVy * 0.1, life: 0.12, size: 1.6 - i * 0.3, grow: 0.5, color: [ 8, 10, 16 ], drag: 1 } );
			if ( lit ) {

				for ( const p of pts ) {

					for ( let i = 0; i < 2; i ++ ) P.emit( { x: p.x + ( Math.random() - 0.5 ), y: p.y - 1, z: ( Math.random() - 0.5 ), vx: p.dx * 30 + ( Math.random() - 0.5 ) * 6 + lp.vx * 0.5, vy: p.dy * 30 + frameVy * 0.12, life: 0.16 + thin * 0.1, size: 1.4 + thin * 2.5, grow: 2, color: [ 14, 6, 1.5 ], cool: [ 1, 0.4, 0.2 ], drag: 2 } );
					if ( thin < 0.95 ) P.emit( { soft: true, x: p.x + ( Math.random() - 0.5 ) * 1.5, y: p.y - 3, z: ( Math.random() - 0.5 ) * 2, vx: p.dx * 12 + ( Math.random() - 0.5 ) * 5, vy: p.dy * 12 + frameVy, life: 3 + Math.random() * 2, size: 2.2, grow: 5 + ( s.y < 50 ? 6 : 0 ), color: [ 0.9, 0.88, 0.86 ], alpha: 0.55 * ( 1 - thin ), drag: 0.9, fade: 1.2 } );

				}

				if ( s.boosterLit && s.boosters ) for ( const b of m.boosterMeshes ) {

					const a = b.userData.angle;
					P.emit( { soft: true, x: lp.x + Math.cos( a ) * b.userData.dist, y: lp.y - 2, z: Math.sin( a ) * b.userData.dist, vx: ( Math.random() - 0.5 ) * 4, vy: - 14 + frameVy, life: 3.5, size: 2.5, grow: 5, color: [ 0.95, 0.93, 0.9 ], alpha: 0.6 * ( 1 - thin ), drag: 0.8 } );

				}

			}

		} else {

			const dc = m.driveColor || [ 0.4, 0.7, 1 ];
			const pts = m.exhaustPoints( { x: lp.x }, lp.y );
			const k = burning ? 1 : 0.15;
			for ( const p of pts ) if ( Math.random() < 0.3 + k ) P.emit( { x: p.x + ( Math.random() - 0.5 ) * 0.6, y: p.y, z: p.z, vx: ( Math.random() - 0.5 ) * 3, vy: - 25 - 30 * k + lp.vy * 0.6, life: 0.6, size: 0.9 + k, grow: 1.5, color: [ dc[ 0 ] * 12, dc[ 1 ] * 12, dc[ 2 ] * 12 ], drag: 1.5 } );
			if ( this.state === 'ascent' ) for ( let i = 0; i < 3; i ++ ) P.emit( { soft: true, x: lp.x + ( Math.random() - 0.5 ) * 4, y: lp.y - 2, z: ( Math.random() - 0.5 ) * 4, vx: ( Math.random() - 0.5 ) * 10, vy: - 12, life: 4, size: 3, grow: 6, color: [ 0.92, 0.9, 0.88 ], alpha: 0.7, drag: 0.8 } );

		}

		// speed streaks: space dust / air rushing past, relative to the local frame
		const ship = isShip( v );
		const real = ship ? s.v : Math.hypot( s.vx || 0, s.vy || 0 );
		if ( ( this.state === 'flight' || this.state === 'jump' ) && ( real > 400 || ship ) ) {

			const jf = this.jumpFx || 0;
			const n = ( ship ? 2 + Math.min( 6, Math.log10( Math.max( 1, real / 7800 ) ) * 0.5 ) : Math.min( 4, real / 400 ) ) + jf * 10;
			const h = this.view.halfH, w = this.view.halfW;
			const col = jf > 0.2 ? [ 2, 2.5, 6 ] : ship ? [ 1.4, 1.6, 2.2 ] : [ 1.2, 1.3, 1.5 ];
			for ( let i = 0; i < n; i ++ ) {

				if ( Math.random() > 0.7 ) continue;
				P.emit( { x: lp.x + ( Math.random() * 2 - 1 ) * w * 1.1, y: lp.y + h * ( 0.8 + Math.random() * 0.6 ), z: ( Math.random() - 0.5 ) * 30, vy: - ( Math.abs( lp.vy ) * 2.5 + 60 ) * ( 1 + this.warp * 0.2 ), life: 1.2, size: 0.12, color: col, kind: 2, fade: 0.5, alpha: 0.9 } );

			}

		}

	}

	// ---------------------------------------------------------------- space backdrop

	updateSpace( dt ) {

		const s = this.s;
		const km = s.d / 1000;
		const r = routeAt( km );
		const pos = r.pos;
		const alt = km;
		const t = this.time;
		const nearEarth = r.leg === 0 && alt < 60000;
		const spaceMix = r.leg === 0 ? MathUtils.smoothstep( alt, 40000, 60000 ) : 1;
		const W = ( v ) => toWorld( v, r );
		const V3 = ( a ) => ( { x: a[ 0 ], y: a[ 1 ], z: a[ 2 ] } );

		// inside the Milky Way's disc its stars are all around; outside it, the galaxy itself
		const mw = BODY_BY_ID.milkyway;
		const rel = sub( pos, GC );
		const hgt = dot( rel, mw.normal );
		const rad = len( sub( rel, mul( mw.normal, hgt ) ) );
		const starField = ( 1 - MathUtils.smoothstep( Math.abs( hgt ), 2500 * LY, 14000 * LY ) ) * ( 1 - MathUtils.smoothstep( rad, 60000 * LY, 95000 * LY ) );
		const inGalaxy = starField > 0.3;

		// the brightest star is the key light (drawn as the sun disc); nearby stars heat the hull
		let key = null, keyFlux = 0, heat = 0;
		for ( const b of STARS ) {

			const dist = Math.max( len( sub( b.pos, pos ) ), b.R * 1.0001 );
			b._flux = b.lum * ( AU / dist ) ** 2;
			if ( b.heat ) heat += b.heat * ( 4 * b.R / dist ) ** 2;
			if ( b._flux > keyFlux ) {

				keyFlux = b._flux;
				key = b;

			}

		}

		if ( ! inGalaxy ) key = null;

		const cand = [];
		let quasarK = 0;
		for ( const b of BODIES ) {

			if ( b === key || b.type === BT.edge ) continue;
			if ( b.type === BT.earth && spaceMix <= 0 ) continue;
			const d = sub( b.pos, pos );
			const dist = len( d );
			const q = dist / b.R;
			const angle = Math.asin( Math.min( 1, b.R / Math.max( dist, b.R * 1.0001 ) ) );
			let prio = angle, k = 1, extra = [ 1, 1, 1, 0 ], light = null, style = b.style || 0;
			let spin = t * 0.02 + b.R * 1e-4;
			switch ( b.type ) {

				case BT.star: {

					if ( ! inGalaxy ) continue;
					const I = Math.min( 80, 6 * Math.pow( b._flux / 1e-11, 0.25 ) );
					if ( I < 1.2 && angle < 0.0004 ) continue;
					extra = [ ...b.color, I ];
					k = b.surf ?? 1;
					prio = Math.max( angle * 2, I * 0.002 );
					break;

				}

				case BT.nebula:
					k = 1 - MathUtils.smoothstep( q, 25, 60 );
					if ( k <= 0 ) continue;
					extra = [ ...b.color, q ];
					spin = hashOf( b.id ) * 20;
					break;
				case BT.pulsar: {

					k = 1 - MathUtils.smoothstep( q, 15, 40 );
					if ( k <= 0 ) continue;
					// a lighthouse: the beam axis sweeps round a tilted spin axis
					const ph = t * Math.PI * 2 / 1.3;
					const a = [ 0.5 * PULSAR_AXIS[ 0 ] + 0.866 * ( PULSAR_U[ 0 ] * Math.cos( ph ) + PULSAR_V[ 0 ] * Math.sin( ph ) ), 0.5 * PULSAR_AXIS[ 1 ] + 0.866 * ( PULSAR_U[ 1 ] * Math.cos( ph ) + PULSAR_V[ 1 ] * Math.sin( ph ) ), 0.5 * PULSAR_AXIS[ 2 ] + 0.866 * ( PULSAR_U[ 2 ] * Math.cos( ph ) + PULSAR_V[ 2 ] * Math.sin( ph ) ) ];
					light = V3( W( a ) );
					extra = [ ...b.color, q ];
					prio = 1;
					break;

				}

				case BT.galaxy:
					if ( b.outside ) k = 1 - starField;
					if ( k <= 0.01 || angle < 0.002 ) continue;
					light = V3( W( b.normal || [ 0, 0, 1 ] ) );
					extra = [ ...b.color, q ];
					spin = hashOf( b.id ) * 6.28;
					break;
				case BT.cluster:
					k = 1 - MathUtils.smoothstep( q, 2.2, 4 );
					if ( k <= 0 ) continue;
					extra = [ ...b.color, q ];
					spin = hashOf( b.id ) * 40;
					prio = angle * k;
					break;
				case BT.quasar:
					k = 1 - MathUtils.smoothstep( q, 6, 20 );
					if ( k <= 0 ) continue;
					if ( style === 0 ) quasarK = Math.max( quasarK, 1 - MathUtils.smoothstep( q, 2.5, 8 ) );
					light = V3( W( b.normal ) );
					extra = [ ...b.color, q ];
					prio = Math.max( angle, 0.05 ) * k;
					break;
				default: {

					// planets and moons, lit by their star (the Sun unless they say otherwise)
					if ( angle < 0.0015 && b.type !== BT.blackhole ) continue;
					const star = BODY_BY_ID[ b.sun || 'sun' ];
					const toStar = sub( star.pos, b.pos );
					// (artistic: the light leans toward the camera side so the planets show their day side)
					const lr = W( norm( toStar ) );
					light = V3( norm( [ lr[ 0 ] * 0.6 + 0.35, lr[ 1 ] * 0.6 + 0.45, lr[ 2 ] * 0.6 + 0.75 ] ) );
					k = b.type === BT.earth ? spaceMix : b.type === BT.blackhole ? 1 : MathUtils.clamp( Math.sqrt( star.lum ) * AU / Math.max( len( toStar ), 1 ), 0.25, 2.5 );
					if ( b.type === BT.planet ) extra = [ ...star.color, 0 ];
					if ( b.type === BT.saturn ) style = b.tilt;
					if ( b.type === BT.blackhole ) prio = angle * 4;
					if ( ! inGalaxy && b.type !== BT.blackhole ) continue;

				}

			}

			cand.push( { prio, body: { type: b.type, dir: V3( W( norm( d ) ) ), angle, spin, tilt: style, light: light || { x: 0, y: 1, z: 0 }, distance: dist, brightness: k, extra } } );

		}

		cand.sort( ( a, b ) => b.prio - a.prio );
		// far to near: the shader composites them in order
		const bodies = cand.slice( 0, MAX_BODIES ).map( ( c ) => c.body ).sort( ( a, b ) => b.distance - a.distance );

		let sunDir, sunR = 0.0005, sunTint = [ 1, 1, 1 ], sunGlow = 0, flux = 0.35, sunDisk = 1;
		if ( key ) {

			const d = sub( key.pos, pos );
			const dist = len( d );
			sunDir = W( norm( d ) );
			sunR = Math.asin( Math.min( 0.9, key.R / Math.max( dist, key.R * 1.01 ) ) );
			sunTint = key.color;
			sunDisk = key.surf ?? 1;
			sunGlow = MathUtils.clamp( keyFlux * 0.01, 0, 0.6 ) * Math.min( 1, Math.sqrt( sunDisk ) * 2 );
			flux = MathUtils.clamp( Math.sqrt( keyFlux ), 0.3, 3 );

		} else {

			// between the galaxies: light from the biggest one in view (no disc)
			const g = bodies.filter( ( b ) => b.type === BT.galaxy || b.type === BT.quasar || b.type === BT.cluster ).sort( ( a, b ) => b.angle - a.angle )[ 0 ];
			sunDir = g ? [ g.dir.x, g.dir.y, g.dir.z ] : [ 0.3, 0.5, - 0.8 ];
			sunDisk = 0;
			sunTint = [ 0.85, 0.88, 1 ];
			flux = 0.35 + quasarK * 0.5;

		}

		const lg = Math.log10( Math.max( km, 1 ) );
		const cmb = MathUtils.smoothstep( km, 1.8e23, 4.45e23 );
		const web = MathUtils.smoothstep( lg, 21.2, 21.6 ) * ( 1 - cmb * 0.6 );
		const core = r.leg === BODY_BY_ID.blackhole.leg || zoneAt( s.d ).id === 'blackhole';
		// the hull heats near stars, in a quasar's glare and against the wall of light at the Edge
		this.space = { sunHeat: heat + quasarK * 1.2 + cmb * 0.9 };
		const cell = 3e8 * LY;
		const sd = sunDir;
		this.app.space = {
			key: key ? { dir: V3( sunDir ), angle: sunR, type: 10 } : null,
			altitude: Math.min( alt * 1000, 6e7 ),
			spaceMix: nearEarth ? spaceMix : 1,
			bodies,
			sunDir: new Vector3( sd[ 0 ], sd[ 1 ], sd[ 2 ] ),
			// key light for the ship and the obstacles, pulled toward the camera for readability
			keyDir: new Vector3( sd[ 0 ] * 0.4 + 0.3, sd[ 1 ] * 0.4 + 0.55, sd[ 2 ] * 0.4 + 0.75 ).normalize(),
			sunRadius: Math.max( sunR, 0.0005 ),
			sunGlow, sunTint, sunDisk,
			flux,
			earthShine: nearEarth ? 1 - spaceMix : 0,
			nebula: core ? [ 0.9, 0.3, 0.8, starField ] : [ 0.5, 0.2, 0.7, MathUtils.smoothstep( km, 4e9, 2e10 ) * 0.5 * starField ],
			starField,
			deepField: 1 - starField,
			web, cmb,
			webOffset: [ pos[ 0 ] / cell, pos[ 1 ] / cell, pos[ 2 ] / cell ],
			frame: r,
			tunnel: this.jumpFx || 0,
		};
		void dt;

	}

	// ---------------------------------------------------------------- camera

	updateCamera( dt ) {

		const app = this.app, cam = app.camera, m = this.model, lp = this.lp;
		const tgt = _v;
		let pos;
		let fov = 50;
		const st = this.state;
		if ( st === 'hangar' || st === 'shop' ) {

			this.orbit += dt * 0.05;
			const shop = st === 'shop';
			const a = - 0.5 + Math.sin( this.orbit ) * 0.25;
			const big = this.vehicle !== 'balloon';
			const d = ( shop ? 30 : 36 ) * ( big ? 1.35 : 1 );
			tgt.set( lp.x + ( shop ? 7 * ( big ? 1.4 : 1 ) : 0 ), lp.y + m.height * ( shop ? 0.5 : 0.62 ), 0 );
			pos = new Vector3( tgt.x + Math.sin( a ) * d, lp.y + ( shop ? 8 : 5 ) * ( big ? 1.5 : 1 ), Math.cos( a ) * d );
			this.camDist = 34;

		} else if ( st === 'countdown' || st === 'ascent' ) {

			const d = 60 + ( this.ascent || 0 ) * 10;
			tgt.set( lp.x, lp.y + m.height * 0.6, 0 );
			pos = new Vector3( lp.x - d * 0.35, lp.y + 6, d );

		} else if ( this.mode === 'space' ) {

			const D = MathUtils.clamp( 42 + Math.abs( lp.vx ) * 0.5, 42, 70 );
			this.camDist += ( D - this.camDist ) * Math.min( 1, dt * 1.5 );
			// near the Earth look down at it; further out, up the route toward what's coming; during a
			// flyby, turn toward the planet
			const near = MathUtils.smoothstep( this.s.d, 1.5e6, 3e7 );
			let pitch = - 0.22 + near * 0.82;
			// (the black hole looks ~4x its horizon with the disk)
			// (the black hole looks ~4x its horizon with the disk; things all around don't count)
			const size = ( b ) => b.type === 14 && b.angle < 1.35 ? b.angle * 0.7 : b.angle > 0.75 || b.type === 7 || b.type === 13 ? 0 : b.angle * ( b.type === 8 ? 4 : b.type === 10 ? 2 : 1 );
			const sp = this.app.space;
			const big = sp && [ ...sp.bodies, ...( sp.key ? [ sp.key ] : [] ) ].reduce( ( a, b ) => ( size( b ) > ( a ? size( a ) : 0.01 ) ? b : a ), null );
			if ( big ) {

				const want = MathUtils.clamp( Math.atan2( big.dir.y, - big.dir.z ) - 0.1, - 0.55, 0.85 );
				const w = MathUtils.smoothstep( size( big ), 0.01, 0.08 );
				pitch += ( want - pitch ) * w;

			}

			this.spacePitch = this.spacePitch === undefined ? pitch : this.spacePitch + ( pitch - this.spacePitch ) * Math.min( 1, dt * 1.5 );
			pitch = this.spacePitch;
			tgt.set( lp.x, lp.y + m.height * 0.5 + this.camDist * Math.sin( pitch ) * 0.8, 0 );
			pos = new Vector3( lp.x, lp.y - this.camDist * Math.sin( pitch ) * 0.5, this.camDist * Math.cos( pitch ) );
			fov = 55 + ( this.jumpFx || 0 ) * 22;

		} else {

			const speed = Math.hypot( lp.vx, lp.vy );
			const want = MathUtils.clamp( 30 + m.height * 0.9 + speed * 1.05, 34, 240 );
			this.camDist += ( want - this.camDist ) * Math.min( 1, dt * 1.2 );
			const D = this.camDist;
			const look = MathUtils.clamp( lp.vy * 0.35, - D * 0.15, D * 0.28 );
			tgt.set( lp.x + lp.vx * 0.25, lp.y + m.height * 0.55 + look, 0 );
			// high up, tilt down a little to see the planet's curve
			const tilt = MathUtils.smoothstep( this.realH(), 20000, 200000 ) * D * 0.25;
			pos = new Vector3( tgt.x, tgt.y + D * 0.08 + tilt, D );
			fov = 50 + MathUtils.clamp( speed * 0.04, 0, 8 ) + ( this.warp - 1 ) * 0.4;

		}

		if ( this.photo ) {

			// free orbit around the vehicle
			const p = this.photo;
			tgt.set( lp.x, lp.y + m.height * 0.5, 0 );
			pos = new Vector3( tgt.x + Math.sin( p.yaw ) * Math.cos( p.pitch ) * p.dist, tgt.y + Math.sin( p.pitch ) * p.dist, Math.cos( p.yaw ) * Math.cos( p.pitch ) * p.dist );
			this._camSnap = true;

		}

		if ( this.shake > 0 ) {

			this.shake = Math.max( 0, this.shake - dt * 2.5 );
			const k = this.shake * this.shake * 0.8;
			pos.x += ( Math.random() - 0.5 ) * k;
			pos.y += ( Math.random() - 0.5 ) * k;

		}

		if ( this._camSnap ) {

			this.camPos.copy( pos );
			this.camTarget.copy( tgt );
			this._camSnap = false;

		} else {

			const k = 1 - Math.exp( - dt * ( st === 'flight' ? 6 : 2.5 ) );
			this.camPos.lerp( pos, k );
			this.camTarget.lerp( tgt, k );

		}

		// a little roll into the turns
		const rollWant = st === 'flight' && ! this.photo ? - ( this.input.steer || 0 ) * 0.045 - ( this.jumpFx || 0 ) * 0.02 * Math.sin( this.time * 3 ) : 0;
		this.camRoll += ( rollWant - this.camRoll ) * Math.min( 1, dt * 3 );
		cam.up.set( Math.sin( this.camRoll ), Math.cos( this.camRoll ), 0 );
		cam.position.copy( this.camPos );
		cam.lookAt( this.camTarget.x, this.camTarget.y, this.camTarget.z );
		if ( Math.abs( cam.fov - fov ) > 0.01 ) {

			cam.fov += ( fov - cam.fov ) * Math.min( 1, dt * 2 );
			cam.updateProjectionMatrix();

		}

		this.view.halfH = Math.max( 20, Math.abs( this.camPos.z ) * Math.tan( MathUtils.degToRad( cam.fov / 2 ) ) );
		this.view.halfW = this.view.halfH * cam.aspect;

		// white-out inside the cloud layer
		const cy = cam.position.y + app.originY;
		const inLayer = MathUtils.smoothstep( cy, 1450, 1800 ) * ( 1 - MathUtils.smoothstep( cy, 4200, 4900 ) );
		const puff = 0.5 + 0.5 * Math.sin( cy * 0.004 + Math.sin( cam.position.x * 0.002 ) * 3 );
		const fogNow = this.mode === 'space' ? 0 : inLayer * MathUtils.smoothstep( puff, 0.35, 0.9 ) * 0.55;
		app.post.params.cloudFog.value = fogNow;
		// out of a cloud: water on the lens for a few seconds
		if ( this.inCloudFog && fogNow < 0.05 ) app.post.params.droplets.value = 1;
		this.inCloudFog = fogNow > 0.25 || ( this.inCloudFog && fogNow > 0.05 );
		app.post.params.droplets.value = Math.max( 0, app.post.params.droplets.value - dt * 0.28 );

	}

	// ---------------------------------------------------------------- settings

	togglePhoto() {

		if ( this.photo ) {

			this.photo = null;
			this.root.classList.remove( 'photo' );
			return;

		}

		const cam = this.app.camera;
		const t = this.camTarget;
		const d = cam.position.clone().sub( t );
		this.photo = { yaw: Math.atan2( d.x, d.z ), pitch: Math.asin( MathUtils.clamp( d.y / d.length(), - 1, 1 ) ), dist: d.length(), spin: 0 };
		this.root.classList.add( 'photo' );
		this.ui.toast( 'Photo mode · drag to orbit · scroll to zoom · C to exit', 3 );

	}

	toggleMute() {

		this.save.muted = ! this.save.muted;
		this.sound.setMuted( this.save.muted );
		this.music.setMuted( this.save.muted );
		this.persist();
		this.ui.toast( this.save.muted ? 'Sound off' : 'Sound on', 1 );

	}

	setVolume( kind, v ) {

		this.save.settings[ kind ] = v;
		if ( kind === 'music' ) this.music.setVolume( v );
		else this.sound.setVolume( v );
		this.persist();

	}

}

export function paintCost( v, id ) {

	if ( id === 'classic' ) return 0;
	const list = Object.keys( v === 'rocket' ? ROCKET_LIVERIES : SHIP_LIVERIES );
	return ( { rocket: 15000, starship: 250000, warpship: 8e6, ark: 600e6 }[ v ] || 0 ) * list.indexOf( id );

}

function fmtMoney( v ) {

	return '$' + Math.round( v ).toLocaleString( 'en-US' );

}

export { ROCKET_LIVERIES, SHIP_LIVERIES, VEHICLES };
