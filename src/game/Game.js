import { Vector3, MathUtils } from '../engine/math/index.js';
import { Balloon } from './Balloon.js';
import { Rocket, ROCKET_LIVERIES } from './Rocket.js';
import { Starship, SHIP_LIVERIES } from './Starship.js';
import { Hazards } from './Hazards.js';
import { Input } from './Input.js';
import { createState, step, dropBag, windAt, createRocketState, stepRocket, createShipState, stepShip, ORBIT_START } from './Physics.js';
import { computeStats, defaultLevels, UPGRADES, VEHICLES, VEHICLE_BY_ID } from './Upgrades.js';
import { ZONES, zoneAt, zoneIndex, zoneById, altitudePay } from './Zones.js';
import { ACHIEVEMENTS } from './Achievements.js';
import { routeAt, flybyAt, toWorld, BODIES, SUN, AU, ROUTE_LENGTH, norm, sub, len } from './Route.js';
import { LAUNCH, BARGE, islandHeight } from '../world/Island.js';
import { TIMES_OF_DAY } from '../App.js';
import { UI } from '../ui/UI.js';
import { Sound } from '../audio/Sound.js';
import { Music } from '../audio/Music.js';

// The game loop on top of App: hangar (vehicle select, workshop, paint shop, time of day), a launch
// countdown, flight for the three vehicles, results. Keeps the save in localStorage.
//
// Flight coordinates: the physics state `s` is real (metres; the Starship's `d` is its route
// distance). The drawn "local" position `lp` follows it at a capped speed (followLocal), the lag goes
// into App.originX / originY so the world stays put; in space App.space carries the route to the sky.
// Hazards live in the local frame, so they always come at a dodgeable pace.

const SAVE_KEY = 'skybound.save.v2';
const OLD_KEY = 'skybound.save.v1';
const PAD_Y = LAUNCH.deckY + 0.16;

function freshSave() {

	return {
		version: 2, cash: 0, vehicle: 'balloon', unlocked: [ 'balloon' ], levels: defaultLevels(),
		best: 0, bestBy: { balloon: 0, rocket: 0, starship: 0 }, zones: [ 'shore' ], achievements: {},
		paints: { rocket: 'classic', starship: 'classic' }, ownedPaints: [ 'rocket:classic', 'starship:classic' ],
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
			return { ...fresh, ...s, levels, stats: { ...fresh.stats, ...( s.stats || {} ) }, settings: { ...fresh.settings, ...( s.settings || {} ) }, bestBy: { ...fresh.bestBy, ...( s.bestBy || {} ) }, paints: { ...fresh.paints, ...( s.paints || {} ) } };

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
		};
		this.hazards = new Hazards( app.scene, this.particles );
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
			if ( t < 5 ) this.save.levels.starship.improbability = 0;
			this.save.unlocked = [ 'balloon', 'rocket', 'starship' ];

		}

		if ( qs.has( 'vehicle' ) ) {

			const v = qs.get( 'vehicle' );
			if ( ! this.save.unlocked.includes( v ) ) this.save.unlocked.push( v );
			this.save.vehicle = v;

		}

		this.ui = new UI( this.root, this );
		app.setTimeOfDay( this.save.timeOfDay );
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
		this.s = v === 'balloon' ? createState( st ) : v === 'rocket' ? createRocketState( st ) : createShipState( st );
		this.s.x = pad.x;
		this.s.y = pad.y;
		if ( v === 'balloon' ) this.s.heat = 0.35;
		this.lp = { x: pad.x, y: pad.y, vx: 0, vy: 0 };
		for ( const k in this.models ) this.models[ k ].group.visible = k === v;
		this.buildModel( v );
		if ( v === 'rocket' ) this.models.rocket.clearDropped();

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
		this.app.post.params.cloudFog.value = 0;
		if ( instant ) this._camSnap = true;
		this.ui.show( 'hangar' );
		this.music.setMood( 'hangar' );

	}

	selectVehicle( id ) {

		if ( ! this.save.unlocked.includes( id ) || this.state !== 'hangar' || id === this.vehicle ) return;
		this.save.vehicle = id;
		this.persist();
		this.resetVehicle();
		this.sound.play( 'select' );
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
		this.ui.toast( `${ VEHICLE_BY_ID[ id ].name } unlocked!`, 3, 'record' );
		this.checkAchievements();
		this.ui.show( 'hangar' );

	}

	setTimeOfDay( id ) {

		if ( ! TIMES_OF_DAY[ id ] ) return;
		this.save.timeOfDay = id;
		this.app.setTimeOfDay( id );
		this.persist();

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
		};
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

		this.music.setMood( v === 'starship' ? 'space' : 'flight' );

	}

	_beginFlight() {

		this.state = 'flight';
		const v = this.vehicle;
		this.sound.play( v === 'balloon' ? 'launch' : 'ignition' );
		const help = { balloon: 'Hold SPACE to fire the burner · A / D to steer', rocket: 'Hold SPACE for thrust · A / D to tilt · boosters light with the engine', starship: 'Hold SPACE to burn: every second multiplies your speed' };
		if ( ! this.save.seen[ v ] ) this.ui.toast( help[ v ], 5 );
		this.save.seen[ v ] = true;
		const qs = this.app.qs;
		if ( this.sandbox && qs.has( 'start' ) && v !== 'starship' ) {

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

	// the Starship's cinematic ascent: lift off the barge, then cut to orbit
	_starshipToOrbit() {

		this.state = 'ascent';
		this.ascent = 0;
		this.sound.play( 'ignition' );

	}

	_enterOrbit() {

		this.ui.fade( () => {

			const s = this.s;
			s.d = ORBIT_START;
			const qs = this.app.qs;
			if ( this.sandbox && qs.has( 'start' ) ) s.d = Math.max( ORBIT_START, Number( qs.get( 'start' ) ) );
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
			this.state = 'flight';
			this.updateSpace( 0 );
			this.ui.zoneBanner( { name: 'Low Orbit', from: s.d, color: '#141a3c', tagline: 'Burn for the Moon!' }, false );

		} );

	}

	endRun( reason ) {

		if ( this.state !== 'flight' ) return;
		this.state = 'results';
		const r = this.run;
		const maxH = Math.max( r.maxH, this.realH() );
		const tod = TIMES_OF_DAY[ r.timeOfDay ] || TIMES_OF_DAY.afternoon;
		const pay = Math.round( altitudePay( maxH ) );
		const zoneBonus = r.zonesNew.reduce( ( a, id ) => a + zoneById( id ).bonus, 0 );
		const prevBest = this.save.bestBy[ r.vehicle ] || 0;
		const record = maxH > prevBest;
		const recordBonus = record && prevBest > 0 ? Math.round( Math.max( 0, pay - altitudePay( prevBest ) ) * 0.25 ) : 0;
		const sub = pay + r.coins + zoneBonus + recordBonus;
		const todBonus = Math.round( sub * ( tod.bonus - 1 ) );
		const total = sub + todBonus;
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
		this.ui.showResults( {
			reason, vehicle: r.vehicle, altitude: maxH, prevBest, record,
			lines: [
				[ r.vehicle === 'starship' ? 'Distance' : 'Altitude', pay ],
				[ `Coins ×${ r.coinCount }`, r.coins ],
				...r.zonesNew.map( ( id ) => [ `New zone: ${ zoneById( id ).name }`, zoneById( id ).bonus ] ),
				...( recordBonus ? [ [ 'New record bonus', recordBonus ] ] : [] ),
				...( todBonus ? [ [ `${ tod.name } flight bonus`, todBonus ] ] : [] ),
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

	returnToPad() {

		this.ui.fade( () => {

			this.toHangar( true );
			this.app.post.cut();
			if ( this.app.clouds ) this.app.clouds.resetHistory();

		} );

	}

	// real altitude / route distance of the player
	realH() {

		return this.vehicle === 'starship' && this.mode === 'space' ? this.s.d : Math.max( 0, this.s.y );

	}

	// ---------------------------------------------------------------- per frame

	update( dt ) {

		dt = Math.min( dt, 0.05 );
		this.time += dt;
		const input = this.input;
		if ( input.hit( 'KeyM' ) ) this.toggleMute();

		switch ( this.state ) {

			case 'hangar':
				if ( this.ui.modalOpen ) break;
				if ( input.hit( 'Space', 'Enter' ) ) this.launch();
				else if ( input.hit( 'KeyU' ) ) this.openShop();
				else if ( input.hit( 'Digit1' ) ) this.selectVehicle( 'balloon' );
				else if ( input.hit( 'Digit2' ) ) this.selectVehicle( 'rocket' );
				else if ( input.hit( 'Digit3' ) ) this.selectVehicle( 'starship' );
				break;
			case 'shop':
				if ( input.hit( 'Escape', 'KeyU' ) ) this.closeShop();
				break;
			case 'countdown':
				this.updateCountdown( dt );
				break;
			case 'ascent':
				this.updateAscent( dt );
				break;
			case 'flight':
				if ( input.hit( 'Escape', 'KeyP' ) ) this.setPaused( ! this.paused );
				if ( ! this.paused ) this.updateFlight( dt );
				break;
			case 'results':
				if ( input.hit( 'Space', 'Enter' ) && ! this.ui.creditsOpen ) this.returnToPad();
				this.s.vy *= 1 - dt;
				break;

		}

		const frozen = this.state === 'flight' && this.paused;
		this.updateModel( frozen ? 0 : dt );
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
			if ( this.vehicle === 'starship' ) this._starshipToOrbit();
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
				this.particles.burst( 12, { soft: true, x: s.x, y: s.y + 0.5, speed: 3, life: 1.2, size: 0.8, grow: 2, color: [ 0.8, 0.7, 0.5 ], alpha: 0.7, gravity: - 4 } );

			}

			if ( this.buffs.boost > 0 ) s.kick += 18 * dt;
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

			// starship: route distance + sideways dodging; heat from the Sun
			const sunFlux = this.space ? this.space.sunHeat : 0;
			if ( this.buffs.boost > 0 ) s.kick = Math.max( s.kick, 0.5 );
			// flybys in slow motion: within 22 radii of a flyby point the route advances at most
			// 5 radii per second, so every planet gets a few seconds on screen
			const fb = flybyAt( s.d / 1000 );
			const R = fb.body.R;
			const cap = Math.abs( fb.offset ) < 24 * R ? 3.2 * R * 1000 : Infinity;
			if ( cap < Infinity && ! this.flybyShown ) {

				this.flybyShown = fb.body.id;
				if ( s.v > cap * 1.5 ) this.ui.toast( `${ fb.body.name } flyby!`, 2, 'record' );

			} else if ( cap === Infinity ) this.flybyShown = null;

			this.flyby = cap < Infinity && s.v > cap;
			stepShip( s, st, inp, dt, sunFlux, cap );
			const vis = MathUtils.clamp( 60 + 14 * Math.log10( Math.max( 1, s.v / 7800 ) ), 60, 170 );
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

			if ( s.d >= ROUTE_LENGTH * 1000 * 0.999 && r.endTimer < 0 ) {

				r.endReason = 'victory';
				r.endTimer = 2.5;

			}

		}

		const h = this.realH();
		r.maxH = Math.max( r.maxH, h );
		const speed = v === 'starship' ? s.v : Math.hypot( s.vx, s.vy );
		this.save.stats.maxSpeed = Math.max( this.save.stats.maxSpeed || 0, speed );
		this.buffs.magnet = Math.max( 0, this.buffs.magnet - dt );
		this.buffs.boost = Math.max( 0, this.buffs.boost - dt );

		// ---- hazards and pickups (paused while time-warping)
		const view = this.view;
		const local = v !== 'balloon';
		const ctx = {
			h, local, night: this.app.timeOfDay === 'night' || this.app.timeOfDay === 'dawn',
			hRate: Math.max( 1, ( v === 'starship' ? s.v : Math.abs( s.vy ) ) / Math.max( 1, Math.abs( this.lp.vy ) ) ),
			localSpeed: Math.abs( this.lp.vy ),
		};
		if ( this.warp < 1.5 ) this.hazards.spawnAhead( this.lp, view, ctx );
		this.hazards.update( dt, this.lp, view, this.time, ctx );
		const m = this.model;
		const c = Math.cos( s.angle || 0 ), sn = Math.sin( s.angle || 0 );
		const circles = m.colliders.map( ( q ) => ( { x: this.lp.x + q.x * c + q.y * sn, y: this.lp.y - q.x * sn + q.y * c, r: q.r } ) );
		this.invuln = Math.max( 0, this.invuln - dt );
		if ( this.invuln <= 0 && ! s.popped && this.warp < 1.5 ) {

			const hit = this.hazards.hitTest( circles );
			if ( hit ) this.onHit( hit );

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
			if ( fresh ) this.checkAchievements( r );

		}

		const best = this.save.bestBy[ v ] || 0;
		if ( ! r.recordBroken && best > 50 && h > best ) {

			r.recordBroken = true;
			this.ui.toast( 'NEW RECORD!', 2.5, 'record' );
			this.sound.play( 'record' );
			this.particles.confetti( this.lp.x, this.lp.y + m.height * 0.8, 80 );

		}

		// ---- end conditions
		if ( r.endTimer < 0 ) {

			if ( v === 'starship' ) {

				if ( s.popped ) {

					r.endReason = 'destroyed';
					r.endTimer = 1.8;

				} else if ( s.fuel <= 0 && ! s.burning ) {

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

		const s = this.s, lp = this.lp;
		lp.vy = MathUtils.clamp( s.vy, - 130, 130 );
		lp.y += lp.vy * dt;
		if ( lateral ) {

			lp.vx = MathUtils.clamp( s.vx, - 45, 45 );
			lp.x += lp.vx * dt;

		} else {

			lp.vx = s.vx;
			lp.x = s.x;

		}

		this.app.originY = s.y - lp.y;
		this.app.originX = s.x - lp.x;

	}

	damage( n, kind ) {

		const s = this.s;
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
		hazard.spent = hazard.type !== 'storm' && hazard.type !== 'flare';
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
		this.sound.play( hazard.type === 'storm' ? 'zap' : 'hit' );
		if ( s.hull > hazard.damage ) this.ui.toast( hazard.type === 'storm' ? 'Zapped!' : hazard.type === 'flare' ? 'Scorched!' : 'Ouch!', 1.2, 'bad' );
		this.damage( hazard.damage, hazard.type );

	}

	onPickup( p ) {

		const s = this.s, st = this.stats(), r = this.run, S = this.save.stats;
		const burst = ( colors, n = 14 ) => this.particles.burst( n, { x: p.x, y: p.y, speed: 10, life: 0.6, size: 0.45, colors, drag: 2 } );
		switch ( p.kind ) {

			case 'coin':
				r.coins += p.value; r.coinCount ++;
				this.sound.play( 'coin' );
				burst( [ [ 8, 6, 1.5 ] ], 6 );
				break;
			case 'fuel':
				s.fuel = Math.min( st.fuel, s.fuel + ( this.vehicle === 'starship' ? 5 : 6 ) );
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
				r.coins += p.value; r.crystals ++; S.crystals ++;
				this.sound.play( 'star' );
				burst( [ [ 1, 5, 7 ] ], 20 );
				break;

		}

		this.ui.popText( p );

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
		this.app.post.params.damage.value = this.hitFlash * 0.8;

	}

	updateEffects( dt ) {

		if ( dt <= 0 ) return;
		const P = this.particles, s = this.s, v = this.vehicle, m = this.model, lp = this.lp;
		const burning = s.burning && ! s.popped;
		if ( v === 'balloon' ) {

			if ( burning && Math.random() < 0.6 ) P.emit( { x: lp.x + ( Math.random() - 0.5 ) * 0.4, y: lp.y + m.basketTop + 2.2, z: 0, vy: 6 + Math.random() * 4, vx: ( Math.random() - 0.5 ) * 2, life: 0.5, size: 0.25, color: [ 12, 6, 1.5 ], drag: 1 } );

		} else if ( v === 'rocket' ) {

			const thin = MathUtils.smoothstep( s.y, 20000, 60000 );
			const pts = m.exhaustPoints( { ...s, lx: lp.x }, lp.y );
			// the world moves by ( lp.vy - s.vy ) in drawn coordinates: smoke stays where it was puffed
			const frameVy = lp.vy - s.vy;
			const lit = burning || ( s.boosterLit && s.boosters );
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
		const real = v === 'starship' ? s.v : Math.hypot( s.vx || 0, s.vy || 0 );
		if ( this.state === 'flight' && ( real > 400 || v === 'starship' ) ) {

			const n = v === 'starship' ? 2 + Math.min( 6, Math.log10( Math.max( 1, real / 7800 ) ) ) : Math.min( 4, real / 400 );
			const h = this.view.halfH, w = this.view.halfW;
			const col = v === 'starship' ? [ 1.4, 1.6, 2.2 ] : [ 1.2, 1.3, 1.5 ];
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
		const bodies = [];
		const alt = km;
		const nearEarth = r.leg === 0 && alt < 60000;
		const spaceMix = r.leg === 0 ? MathUtils.smoothstep( alt, 40000, 60000 ) : 1;
		const sunVec = sub( SUN.pos, pos );
		const sunDist = len( sunVec );
		const sunDirW = toWorld( norm( sunVec ), r );
		for ( const b of BODIES ) {

			if ( b.id === 'sun' ) continue;
			if ( b.id === 'earth' && spaceMix <= 0 ) continue;
			const d = sub( b.pos, pos );
			const dist = len( d );
			const dir = toWorld( norm( d ), r );
			const angle = Math.asin( Math.min( 1, b.R / Math.max( dist, b.R * 1.0001 ) ) );
			// (artistic: the light leans toward the camera side so the planets show their day side)
			const lr = toWorld( norm( sub( SUN.pos, b.pos ) ), r );
			const lightW = norm( [ lr[ 0 ] * 0.6 + 0.35, lr[ 1 ] * 0.6 + 0.45, lr[ 2 ] * 0.6 + 0.75 ] );
			const flux = AU / Math.max( len( sub( SUN.pos, b.pos ) ), 1 );
			bodies.push( {
				type: b.type, dir: { x: dir[ 0 ], y: dir[ 1 ], z: dir[ 2 ] }, angle, spin: this.time * 0.02 + b.R * 1e-4,
				tilt: b.tilt || 0, light: { x: lightW[ 0 ], y: lightW[ 1 ], z: lightW[ 2 ] }, distance: dist,
				brightness: b.id === 'earth' ? spaceMix : b.type === 8 ? 1 : MathUtils.clamp( flux, 0.25, 2.5 ),
			} );

		}

		// far to near: the shader composites them in order
		bodies.sort( ( a, b ) => b.distance - a.distance );
		const flux = ( AU / Math.max( sunDist, 1 ) ) ** 2;
		const sunR = Math.asin( Math.min( 0.9, SUN.R / Math.max( sunDist, SUN.R * 1.01 ) ) );
		// heat: 1 at the Sun flyby distance (4 solar radii)
		const sunHeat = ( 4 * SUN.R / Math.max( sunDist, SUN.R ) ) ** 2;
		const zone = zoneAt( s.d );
		const deep = [ 'interstellar', 'blackhole' ].includes( zone.id ) || r.leg >= 7;
		this.space = { sunHeat };
		this.app.space = {
			altitude: Math.min( alt * 1000, 6e7 ),
			spaceMix: nearEarth ? spaceMix : 1,
			bodies,
			sunDir: new Vector3( sunDirW[ 0 ], sunDirW[ 1 ], sunDirW[ 2 ] ),
			// key light for the ship and the obstacles: the Sun, pulled toward the camera for readability
			keyDir: new Vector3( sunDirW[ 0 ] * 0.4 + 0.3, sunDirW[ 1 ] * 0.4 + 0.55, sunDirW[ 2 ] * 0.4 + 0.75 ).normalize(),
			sunRadius: Math.max( sunR, 0.0005 ),
			sunGlow: MathUtils.clamp( flux * 0.01, 0, 0.6 ),
			flux: deep ? 0.35 : MathUtils.clamp( Math.sqrt( flux ), 0.2, 3 ),
			earthShine: nearEarth ? 1 - spaceMix : 0,
			nebula: deep ? [ 0.9, 0.3, 0.8, 1 ] : [ 0.5, 0.2, 0.7, MathUtils.smoothstep( km, 4e9, 2e10 ) * 0.6 ],
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
			const big = this.app.space && this.app.space.bodies.reduce( ( a, b ) => ( b.type !== 7 && b.type !== 8 && b.angle > ( a ? a.angle : 0.01 ) ? b : a ), null );
			if ( big ) {

				const want = MathUtils.clamp( Math.atan2( big.dir.y, - big.dir.z ) - 0.1, - 0.3, 1.1 );
				const w = MathUtils.smoothstep( big.angle, 0.01, 0.08 );
				pitch += ( want - pitch ) * w;

			}

			this.spacePitch = this.spacePitch === undefined ? pitch : this.spacePitch + ( pitch - this.spacePitch ) * Math.min( 1, dt * 1.5 );
			pitch = this.spacePitch;
			tgt.set( lp.x, lp.y + m.height * 0.5 + this.camDist * Math.sin( pitch ) * 0.8, 0 );
			pos = new Vector3( lp.x, lp.y - this.camDist * Math.sin( pitch ) * 0.5, this.camDist * Math.cos( pitch ) );
			fov = 55;

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
		app.post.params.cloudFog.value = this.mode === 'space' ? 0 : inLayer * MathUtils.smoothstep( puff, 0.35, 0.9 ) * 0.55;

	}

	// ---------------------------------------------------------------- settings

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
	return ( v === 'rocket' ? 15000 : 250000 ) * list.indexOf( id );

}

function fmtMoney( v ) {

	return '$' + Math.round( v ).toLocaleString( 'en-US' );

}

export { ROCKET_LIVERIES, SHIP_LIVERIES, VEHICLES };
