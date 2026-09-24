import { Vector3, MathUtils } from '../engine/math/index.js';
import { Balloon } from './Balloon.js';
import { Hazards } from './Hazards.js';
import { Input } from './Input.js';
import { createState, step, dropBag, windAt } from './Physics.js';
import { computeStats, defaultLevels, UPGRADES, UPGRADE_BY_ID } from './Upgrades.js';
import { ZONES, zoneAt, zoneIndex } from './Zones.js';
import { LAUNCH, islandHeight } from '../world/Island.js';
import { UI } from '../ui/UI.js';
import { Sound } from '../audio/Sound.js';

// The game loop on top of App: hangar (on the pad, workshop), flight, results. Keeps the save
// (cash, upgrade levels, records) in localStorage.

const SAVE_KEY = 'skybound.save.v1';

function loadSave() {

	const fresh = { cash: 0, levels: defaultLevels(), best: 0, bestDistance: 0, zones: [ 'shore' ], runs: 0, coins: 0, muted: false, seenHelp: false };
	try {

		const raw = localStorage.getItem( SAVE_KEY );
		if ( ! raw ) return fresh;
		const s = JSON.parse( raw );
		return { ...fresh, ...s, levels: { ...fresh.levels, ...( s.levels || {} ) } };

	} catch {

		return fresh;

	}

}

const PAD_Y = LAUNCH.deckY + 0.16;
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
		this.slowmo = 1;
		this.view = { halfW: 30, halfH: 17 };

	}

	async init( progress = () => {} ) {

		progress( 0.6, 'Stitching the balloon' );
		const app = this.app;
		this.balloon = new Balloon( app.scene );
		this.balloon.build( this.save.levels );
		this.hazards = new Hazards( app.scene );
		this.input = new Input( app.engine.canvas );
		this.sound = new Sound();
		this.sound.setMuted( this.save.muted );
		this.ui = new UI( this.root, this );
		this.debug = app.qs.has( 'debug' );
		// ?tier=n / ?cash=n: a sandbox for testing that never touches the saved progress
		this.sandbox = app.qs.has( 'tier' ) || app.qs.has( 'cash' ) || app.qs.has( 'start' );
		if ( app.qs.has( 'cash' ) ) this.save.cash = Number( app.qs.get( 'cash' ) );
		if ( app.qs.has( 'tier' ) ) {

			const t = Number( app.qs.get( 'tier' ) );
			for ( const u of UPGRADES ) this.save.levels[ u.id ] = Math.min( t, u.levels.length - 1 );
			this.balloon.build( this.save.levels );

		}

		// losing focus mid-flight pauses the run
		window.addEventListener( 'blur', () => {

			if ( this.state === 'flight' && ! this.paused ) {

				this.paused = true;
				this.ui.setPaused( true );

			}

		} );

		this.toHangar( true );

	}

	persist() {

		if ( this.sandbox ) return;
		try {

			localStorage.setItem( SAVE_KEY, JSON.stringify( this.save ) );

		} catch { /* private mode: progress lasts for the session */ }

	}

	get stats() {

		return computeStats( this.save.levels );

	}

	// ---------------------------------------------------------------- states

	toHangar( instant = false ) {

		this.state = 'hangar';
		this.hazards.reset();
		this.flight = createState( this.stats );
		this.flight.x = LAUNCH.x;
		this.flight.y = PAD_Y;
		this.flight.heat = 0.35;
		this.balloon.build( this.save.levels );
		this.balloon.setBags( this.stats.bags );
		this.orbit = 0;
		this.app.post.params.cloudFog.value = 0;
		if ( instant ) this._snapCamera();
		this.ui.show( 'hangar' );

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

		const u = UPGRADE_BY_ID[ id ];
		const cur = this.save.levels[ id ] || 0;
		const next = u.levels[ cur + 1 ];
		if ( ! next || this.save.cash < next.cost ) return false;
		this.save.cash -= next.cost;
		this.save.levels[ id ] = cur + 1;
		this.persist();
		this.balloon.build( this.save.levels );
		this.balloon.setBags( this.stats.bags );
		this.sound.play( 'buy' );
		this.buyPulse = 1;
		return true;

	}

	launch() {

		if ( this.state !== 'hangar' ) return;
		this.state = 'flight';
		this.sound.unlock();
		const st = this.stats;
		this.flight = createState( st );
		this.flight.x = LAUNCH.x;
		this.flight.y = PAD_Y;
		this.shield = st.shield;
		this.shieldRegen = 0;
		this.invuln = 0;
		this.run = {
			coins: 0, coinCount: 0, fuelCans: 0, stars: 0, hits: 0,
			zonesNew: [], startZones: [ ...this.save.zones ], zone: 'shore',
			endTimer: - 1, endReason: '', recordBroken: false,
		};
		this.hazards.reset();
		if ( this.sandbox && this.app.qs.has( 'start' ) ) {

			// test launches from altitude (?start=metres)
			this.flight.y = Number( this.app.qs.get( 'start' ) );
			this.flight.maxY = this.flight.y;
			this.flight.vy = 40;
			this.flight.heat = 1;
			this.run.zone = zoneAt( this.flight.y ).id;
			this.hazards.nextHazardY = this.hazards.nextCoinY = this.hazards.nextFuelY = this.flight.y + 60;
			this._snapCamera();

		}

		this.ui.show( 'hud' );
		this.sound.play( 'launch' );
		this.save.runs ++;
		if ( ! this.save.seenHelp ) this.ui.toast( 'Hold SPACE to fire the burner · A / D to steer', 5 );

	}

	endRun( reason ) {

		if ( this.state !== 'flight' ) return;
		this.state = 'results';
		const r = this.run, s = this.flight;
		const alt = s.maxY;
		const altitudePay = Math.round( alt * 0.4 );
		const distancePay = Math.round( Math.abs( s.x - LAUNCH.x ) * 0.05 );
		const zoneBonus = r.zonesNew.reduce( ( a, id ) => a + ZONES.find( ( z ) => z.id === id ).bonus, 0 );
		const record = alt > this.save.best;
		const recordBonus = record && this.save.best > 0 ? Math.round( ( alt - this.save.best ) * 0.25 ) : 0;
		const total = altitudePay + distancePay + r.coins + zoneBonus + recordBonus;
		const prevBest = this.save.best;
		this.save.cash += total;
		this.save.best = Math.max( this.save.best, alt );
		this.save.bestDistance = Math.max( this.save.bestDistance, Math.abs( s.x ) );
		this.save.coins += r.coinCount;
		this.save.seenHelp = true;
		this.persist();
		this.sound.play( reason === 'pop' ? 'pop' : 'end' );
		this.ui.showResults( {
			reason, altitude: alt, prevBest, record, distance: Math.abs( s.x - LAUNCH.x ),
			lines: [
				[ 'Altitude', altitudePay ],
				[ 'Distance', distancePay ],
				[ `Coins ×${ r.coinCount }`, r.coins ],
				...r.zonesNew.map( ( id ) => [ `New zone: ${ ZONES.find( ( z ) => z.id === id ).name }`, ZONES.find( ( z ) => z.id === id ).bonus ] ),
				...( recordBonus ? [ [ 'New record bonus', recordBonus ] ] : [] ),
			],
			total,
		} );

	}

	// back to the pad (after the results)
	returnToPad() {

		this.ui.fade( () => {

			this.toHangar( true );
			this.app.post.cut();
			if ( this.app.clouds ) this.app.clouds.resetHistory();

		} );

	}

	// ---------------------------------------------------------------- per frame

	update( dt ) {

		dt = Math.min( dt, 0.05 );
		this.time += dt;
		const input = this.input;
		if ( input.hit( 'KeyM' ) ) this.toggleMute();

		switch ( this.state ) {

			case 'hangar':
				if ( input.hit( 'Space', 'Enter' ) ) this.launch();
				else if ( input.hit( 'KeyU', 'KeyS' ) ) this.openShop();
				break;
			case 'shop':
				if ( input.hit( 'Escape', 'KeyU' ) ) this.closeShop();
				break;
			case 'flight':
				if ( input.hit( 'Escape', 'KeyP' ) ) {

					this.paused = ! this.paused;
					this.ui.setPaused( this.paused );

				}

				if ( ! this.paused ) this.updateFlight( dt * this.slowmo );
				break;
			case 'results':
				if ( input.hit( 'Space', 'Enter' ) ) this.returnToPad();
				// keep the world moving behind the results
				this.flight.vy *= 1 - dt;
				break;

		}

		this.updateBalloon( this.state === 'flight' && this.paused ? 0 : dt );
		this.updateCamera( dt );
		this.app.island.update( dt, this.time, { x: windAt( 0, this.time ) } );
		this.sound.update( dt, this );
		this.ui.update( dt );
		input.endFrame();

	}

	updateFlight( dt ) {

		const s = this.flight, st = this.stats, input = this.input;
		const inp = { burn: input.burn, steer: input.steer };
		if ( input.bag && dropBag( s ) ) {

			this.balloon.setBags( s.bags );
			this.sound.play( 'bag' );
			this.ui.toast( 'Sandbag away!', 1 );

		}

		// ground under the balloon: the pad, the island, or the sea
		const onPad = Math.abs( s.x - LAUNCH.x ) < 6.2;
		const ground = onPad ? PAD_Y : Math.max( 0, islandHeight( s.x, 0 ) );
		const sub = 2;
		for ( let i = 0; i < sub; i ++ ) step( s, st, inp, dt / sub, ground );

		// ---- hazards and pickups
		const view = this.view;
		this.hazards.spawnAhead( s, view, dt );
		this.hazards.update( dt, s, view, this.time );
		const b = this.balloon;
		const circles = b.colliders.map( ( c ) => ( { x: s.x + c.x, y: s.y + c.y, r: c.r } ) );
		this.invuln = Math.max( 0, this.invuln - dt );
		if ( this.invuln <= 0 && ! s.popped ) {

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

		const center = { x: s.x, y: s.y + b.mouthY + b.envelopeH * 0.4 };
		const got = this.hazards.collect( circles.map( ( c ) => ( { ...c, r: c.r + 0.6 } ) ), center, st.magnet );
		for ( const p of got ) this.onPickup( p );

		// ---- zones
		const z = zoneAt( s.y );
		if ( z.id !== this.run.zone && zoneIndex( s.y ) > ZONES.findIndex( ( q ) => q.id === this.run.zone ) ) {

			this.run.zone = z.id;
			const fresh = ! this.save.zones.includes( z.id );
			if ( fresh ) {

				this.save.zones.push( z.id );
				this.run.zonesNew.push( z.id );

			}

			this.ui.zoneBanner( z, fresh );
			this.sound.play( fresh ? 'zoneNew' : 'zone' );

		}

		if ( ! this.run.recordBroken && this.save.best > 50 && s.y > this.save.best ) {

			this.run.recordBroken = true;
			this.ui.toast( 'NEW RECORD!', 2.5, 'record' );
			this.sound.play( 'record' );

		}

		// ---- end conditions
		const r = this.run;
		if ( r.endTimer < 0 ) {

			const left = s.maxY > PAD_Y + 6;
			if ( left && s.y <= ground + 0.05 && s.vy <= 0.5 ) {

				r.endReason = ground <= 0.01 ? 'splash' : 'landed';
				r.endTimer = 0.8;
				if ( r.endReason === 'splash' ) this.sound.play( 'splash' );

			} else if ( s.popped ) {

				r.endReason = 'pop';
				r.endTimer = 1.6;

			} else if ( s.fuel <= 0 && s.vy < - 3 && s.maxY - s.y > 25 ) {

				r.endReason = 'fuel';
				r.endTimer = 1.4;
				this.ui.toast( 'Out of fuel', 1.5 );

			}

		} else {

			r.endTimer -= dt;
			if ( r.endTimer <= 0 ) this.endRun( r.endReason );

		}

	}

	onHit( { hazard, x, y } ) {

		const s = this.flight;
		hazard.spent = hazard.type !== 'storm';
		this.invuln = 1.1;
		this.shake = 1;
		// knock the balloon away from the impact
		const cx = s.x, cy = s.y + this.balloon.mouthY + this.balloon.envelopeH * 0.4;
		const dx = cx - x, dy = cy - y, d = Math.hypot( dx, dy ) || 1;
		s.vx += dx / d * 9;
		s.vy += dy / d * 5;
		if ( hazard.vx ) s.vx += hazard.vx * 0.12;
		if ( this.shield > 0 ) {

			this.shield --;
			this.shieldRegen = 0;
			this.shieldHit = 1;
			this.sound.play( 'shield' );
			this.ui.toast( 'Bubble popped!', 1 );
			return;

		}

		s.hull = Math.max( 0, s.hull - hazard.damage );
		s.leak += 0.05 * hazard.damage;
		this.run.hits ++;
		this.hitFlash = 1;
		this.sound.play( hazard.type === 'storm' ? 'zap' : 'hit' );
		if ( s.hull <= 0 ) {

			s.popped = true;
			this.ui.toast( 'POP!', 1.5, 'bad' );
			this.sound.play( 'pop' );

		} else this.ui.toast( hazard.type === 'storm' ? 'Zapped!' : 'Ouch! Envelope torn', 1.2, 'bad' );

	}

	onPickup( p ) {

		const s = this.flight;
		if ( p.kind === 'coin' ) {

			this.run.coins += p.value;
			this.run.coinCount ++;
			this.sound.play( 'coin' );

		} else if ( p.kind === 'fuel' ) {

			// a fixed top-up: a lifesaver early on, a small bonus for big tanks
			s.fuel = Math.min( this.stats.fuel, s.fuel + 6 );
			this.run.fuelCans ++;
			this.sound.play( 'fuel' );
			this.ui.toast( '+Fuel', 0.9, 'good' );

		} else {

			this.run.coins += p.value;
			this.run.stars ++;
			s.kick += 10;
			this.sound.play( 'star' );
			this.ui.toast( `Lucky star! +$${ p.value }`, 1.4, 'good' );

		}

		this.ui.popText( p );

	}

	updateBalloon( dt ) {

		this.shieldHit = Math.max( 0, this.shieldHit - dt * 2.5 );
		this.hitFlash = Math.max( 0, this.hitFlash - dt * 1.8 );
		const shield = this.state === 'flight' ? ( this.shield > 0 ? 0.6 + 0.4 * Math.min( 1, this.shield ) : 0 ) : 0;
		this.balloon.update( this.flight, dt, { steer: this.state === 'flight' ? this.input.steer : 0, shield, shieldHit: this.shieldHit, time: this.time } );
		// flicker while invulnerable
		this.balloon.group.visible = ! ( this.invuln > 0 && Math.floor( this.time * 20 ) % 2 === 0 && this.state === 'flight' );
		// hangar: idle flame bursts
		if ( this.state === 'hangar' || this.state === 'shop' ) this.flight.burning = Math.sin( this.time * 0.9 ) > 0.93;
		this.app.post.params.damage.value = this.hitFlash * 0.8;

	}

	// ---------------------------------------------------------------- camera

	_snapCamera() {

		this._camSnap = true;

	}

	updateCamera( dt ) {

		const app = this.app, cam = app.camera, s = this.flight, b = this.balloon;
		const tgt = _v;
		let pos;
		let fov = 50;
		if ( this.state === 'hangar' || this.state === 'shop' ) {

			// beauty orbit around the pad; the workshop frames the balloon on the left
			this.orbit += dt * 0.05;
			const shop = this.state === 'shop';
			const a = - 0.5 + Math.sin( this.orbit ) * 0.25;
			const d = shop ? 30 : 36;
			tgt.set( s.x + ( shop ? 7 : 0 ), s.y + b.height * ( shop ? 0.5 : 0.62 ), 0 );
			pos = new Vector3( tgt.x + Math.sin( a ) * d, s.y + ( shop ? 8 : 5 ), Math.cos( a ) * d );
			this.camDist = 34;

		} else {

			const speed = Math.hypot( s.vx, s.vy );
			const want = MathUtils.clamp( 30 + b.height * 0.9 + speed * 1.05, 34, 260 );
			this.camDist += ( want - this.camDist ) * Math.min( 1, dt * 1.2 );
			const D = this.camDist;
			const look = MathUtils.clamp( s.vy * 0.35, - D * 0.15, D * 0.28 );
			tgt.set( s.x + s.vx * 0.25, s.y + b.height * 0.55 + look, 0 );
			pos = new Vector3( tgt.x, tgt.y + D * 0.08, D );
			fov = 50 + MathUtils.clamp( speed * 0.04, 0, 8 );

		}

		// shake
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

			const k = 1 - Math.exp( - dt * ( this.state === 'flight' ? 6 : 2.5 ) );
			this.camPos.lerp( pos, k );
			this.camTarget.lerp( tgt, k );

		}

		cam.position.copy( this.camPos );
		cam.lookAt( this.camTarget.x, this.camTarget.y, this.camTarget.z );
		if ( Math.abs( cam.fov - fov ) > 0.01 ) {

			cam.fov += ( fov - cam.fov ) * Math.min( 1, dt * 2 );
			cam.updateProjectionMatrix();

		}

		// the visible part of the gameplay plane (for spawning and the HUD)
		const D = Math.abs( this.camPos.z );
		this.view.halfH = D * Math.tan( MathUtils.degToRad( cam.fov / 2 ) );
		this.view.halfW = this.view.halfH * cam.aspect;

		// inside a cloud: fade toward white (from the cloud layer's density near the camera)
		const cy = cam.position.y;
		const inLayer = MathUtils.smoothstep( cy, 1450, 1800 ) * ( 1 - MathUtils.smoothstep( cy, 4200, 4900 ) );
		const puff = 0.5 + 0.5 * Math.sin( cy * 0.004 + Math.sin( cam.position.x * 0.002 ) * 3 );
		app.post.params.cloudFog.value = inLayer * MathUtils.smoothstep( puff, 0.35, 0.9 ) * 0.55;

	}

	toggleMute() {

		this.save.muted = ! this.save.muted;
		this.sound.setMuted( this.save.muted );
		this.persist();
		this.ui.toast( this.save.muted ? 'Sound off' : 'Sound on', 1 );

	}

	resetProgress() {

		localStorage.removeItem( SAVE_KEY );
		this.save = loadSave();
		this.toHangar( true );

	}

}
