import { Vector3 } from '../engine/math/index.js';
import { UPGRADES, VEHICLES, VEHICLE_BY_ID } from '../game/Upgrades.js';
import { ZONES, zoneAt, formatAltitude, formatSpeed, formatMoney } from '../game/Zones.js';
import { ACHIEVEMENTS } from '../game/Achievements.js';
import { TIMES_OF_DAY } from '../App.js';
import { paintCost, ROCKET_LIVERIES, SHIP_LIVERIES } from '../game/Game.js';

// DOM overlay: the hangar (garage, time of day, journey ladder), the workshop and paint shop, the
// flight HUD, results, modals (achievements, stats, settings), the ending credits, banners, toasts.

const ICONS = {
	envelope: '<path d="M32 6c-12 0-20 9-20 20 0 9 7 16 13 22h14c6-6 13-13 13-22 0-11-8-20-20-20z" fill="#ff5a36"/><path d="M32 6c-5 0-8 9-8 20 0 9 3 16 4 22h8c1-6 4-13 4-22 0-11-3-20-8-20z" fill="#ffc93c"/><rect x="26" y="50" width="12" height="9" rx="2" fill="#a87650"/>',
	flame: '<path d="M32 58c-11 0-17-8-17-17 0-10 8-15 10-25 5 5 6 10 6 13 3-3 5-8 5-14 9 7 13 16 13 26 0 9-6 17-17 17z" fill="#ff7a1f"/><path d="M32 58c-5 0-8-4-8-8 0-5 4-8 5-12 3 3 3 5 3 7 2-1 3-4 3-6 3 3 5 7 5 11 0 5-3 8-8 8z" fill="#ffd23f"/>',
	tank: '<rect x="20" y="16" width="24" height="40" rx="10" fill="#e2463a"/><rect x="27" y="8" width="10" height="9" rx="2" fill="#3b3b44"/><rect x="20" y="30" width="24" height="7" fill="#ffc93c"/>',
	basket: '<path d="M14 26h36l-4 28H18z" fill="#b98a4e"/><path d="M14 26h36v6H14z" fill="#6b3f22"/><path d="M22 32v20M30 32v21M38 32v21M44 32v19" stroke="#8f6636" stroke-width="2"/>',
	fan: '<circle cx="32" cy="32" r="24" fill="none" stroke="#ffc93c" stroke-width="5"/><path d="M32 32c-2-10 2-16 8-16 2 6-2 12-8 16zM32 32c10-2 16 2 16 8-6 2-12-2-16-8zM32 32c2 10-2 16-8 16-2-6 2-12 8-16zM32 32c-10 2-16-2-16-8 6-2 12 2 16 8z" fill="#3b3b44"/>',
	sandbag: '<path d="M18 30c0-8 6-12 14-12s14 4 14 12v14c0 8-6 12-14 12S18 52 18 44z" fill="#c9a66b"/><path d="M24 20c2-4 5-6 8-6s6 2 8 6" stroke="#6b3f22" stroke-width="4" fill="none"/>',
	magnet: '<path d="M14 12h12v22a6 6 0 0 0 12 0V12h12v22a18 18 0 0 1-36 0z" fill="#e2463a"/><rect x="14" y="12" width="12" height="8" fill="#e8eef2"/><rect x="38" y="12" width="12" height="8" fill="#e8eef2"/>',
	shield: '<circle cx="32" cy="32" r="22" fill="#9fdcff" opacity="0.55"/><circle cx="32" cy="32" r="22" fill="none" stroke="#7fc7ff" stroke-width="3"/><path d="M22 22a14 14 0 0 1 12-6" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>',
	nozzle: '<path d="M22 8h20v14l8 26H14l8-26z" fill="#8f9aa6"/><path d="M18 48h28l-4 10H22z" fill="#ff7a1f"/><rect x="22" y="8" width="20" height="6" fill="#3b3b44"/>',
	booster: '<rect x="12" y="14" width="12" height="38" rx="3" fill="#f4efe6"/><rect x="40" y="14" width="12" height="38" rx="3" fill="#f4efe6"/><path d="M12 14l6-8 6 8zM40 14l6-8 6 8z" fill="#e2463a"/><rect x="26" y="8" width="12" height="46" rx="4" fill="#2f6fde"/>',
	nose: '<path d="M32 4c10 10 14 24 14 40H18c0-16 4-30 14-40z" fill="#e2463a"/><rect x="18" y="44" width="28" height="14" fill="#f4efe6"/>',
	fins: '<rect x="26" y="6" width="12" height="44" rx="5" fill="#f4efe6"/><path d="M26 34L12 52h14zM38 34l14 18H38z" fill="#2f6fde"/>',
	hull: '<path d="M32 6l22 8v16c0 14-10 24-22 28C20 54 10 44 10 30V14z" fill="#8f9aa6"/><path d="M32 12l16 6v12c0 10-7 18-16 21z" fill="#c9d3dc"/>',
	cell: '<rect x="16" y="12" width="32" height="44" rx="6" fill="#2b2f36"/><rect x="21" y="18" width="22" height="32" rx="3" fill="#7fe3ff"/><rect x="26" y="6" width="12" height="7" rx="2" fill="#8f9aa6"/>',
	heatshield: '<path d="M8 38c0-14 11-26 24-26s24 12 24 26z" fill="#6b4b3a"/><path d="M14 38c0-10 8-19 18-19s18 9 18 19z" fill="#ff7a1f"/><rect x="8" y="38" width="48" height="6" rx="2" fill="#3b3b44"/>',
	sail: '<path d="M8 10h22v44H8zM34 10h22v44H34z" fill="#d8c07a"/><path d="M8 32h48" stroke="#8f9aa6" stroke-width="3"/><circle cx="32" cy="32" r="5" fill="#f4efe6"/>',
	infinity: '<path d="M20 22c-6 0-10 4-10 10s4 10 10 10c10 0 14-20 24-20 6 0 10 4 10 10s-4 10-10 10c-10 0-14-20-24-20z" fill="none" stroke="#ff7ad9" stroke-width="6"/>',
	balloonV: '<path d="M32 4c-13 0-21 10-21 21 0 10 8 17 14 23h14c6-6 14-13 14-23 0-11-8-21-21-21z" fill="#ff5a36"/><path d="M32 4c-5 0-9 10-9 21 0 10 3 17 5 23h8c2-6 5-13 5-23 0-11-4-21-9-21z" fill="#fff4dc"/><rect x="26" y="52" width="12" height="9" rx="2" fill="#a87650"/>',
	rocketV: '<path d="M32 3c8 8 11 18 11 30v14H21V33c0-12 3-22 11-30z" fill="#f4efe6"/><circle cx="32" cy="24" r="5" fill="#7fc7ff"/><path d="M21 38l-9 12h9zM43 38l9 12h-9z" fill="#e2463a"/><path d="M24 47h16l-3 12h-10z" fill="#ff7a1f"/>',
	shipV: '<path d="M32 4c7 6 10 16 10 28v16H22V32c0-12 3-22 10-28z" fill="#f4efe6"/><path d="M22 34L6 48l16 2zM42 34l16 14-16 2z" fill="#2f6fde"/><circle cx="32" cy="22" r="4.5" fill="#7fe3ff"/><path d="M25 50h14l-2 10H27z" fill="#7fe3ff"/>',
};

const VEHICLE_ICON = { balloon: 'balloonV', rocket: 'rocketV', starship: 'shipV' };

const REASONS = {
	splash: [ 'Splashdown!', 'Back in the sea. The gulls are laughing.' ],
	landed: [ 'Touchdown', 'A gentle landing on the island.' ],
	pop: [ 'POP!', 'The envelope gave out.' ],
	fuel: [ 'Out of fuel', 'The burner sputtered out. Down you drift.' ],
	apogee: [ 'Apogee!', 'The top of the arc. Gravity takes it from here.' ],
	destroyed: [ 'Kaboom!', 'That did not buff out.' ],
	drift: [ 'Adrift', 'Tanks dry. The stars wheel slowly by.' ],
	victory: [ 'Event Horizon!', 'You flew a hot-air balloon\'s grandchild to the centre of the galaxy.' ],
};

function el( tag, cls, html ) {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

}

function icon( name, size = 40 ) {

	return `<svg viewBox="0 0 64 64" width="${ size }" height="${ size }" aria-hidden="true">${ ICONS[ name ] || '' }</svg>`;

}

const _p = new Vector3();

// the altitude meter's range per vehicle (log scale)
const METER = {
	balloon: { from: 0, to: 30000, zones: [ 'shore', 'low', 'clouds', 'high', 'strato' ] },
	rocket: { from: 0, to: 2500000, zones: [ 'low', 'clouds', 'high', 'strato', 'meso', 'leo', 'meo' ] },
	starship: { from: 4e5, to: 2.6e20, zones: [ 'leo', 'moon', 'mars', 'sun', 'jupiter', 'saturn', 'neptune', 'kuiper', 'interstellar', 'blackhole' ] },
};

export class UI {

	constructor( root, game ) {

		this.root = root;
		this.game = game;
		this.screens = {};
		this.pops = [];
		this.modalOpen = false;
		this.creditsOpen = false;
		this._build();

	}

	_build() {

		const g = this.game, root = this.root;
		const click = ( node, fn ) => node.addEventListener( 'click', ( e ) => {

			g.sound.unlock();
			g.sound.play( 'click' );
			fn( e );

		} );
		this.click = click;

		// ---------------- hangar
		const h = this.screens.hangar = el( 'div', 'screen hangar' );
		h.innerHTML = `
			<div class="brand">
				<div class="logo">SKYBOUND</div>
				<div class="tagline">From the beach to the black hole.</div>
			</div>
			<div class="topbar">
				<div class="pill cash"><span class="k">Cash</span><span class="v" data-bind="cash"></span></div>
				<div class="pill best"><span class="k">Best</span><span class="v" data-bind="best"></span></div>
				<button class="icon-btn" data-act="achievements" title="Achievements">🏆<span class="badge-count" data-bind="achCount"></span></button>
				<button class="icon-btn" data-act="stats" title="Stats">📊</button>
				<button class="icon-btn" data-act="settings" title="Settings">⚙️</button>
				<button class="icon-btn mute" data-act="mute" title="Sound (M)"></button>
			</div>
			<div class="garage" data-bind="garage"></div>
			<div class="menu">
				<button class="btn big primary" data-act="launch">LAUNCH <kbd>Space</kbd></button>
				<button class="btn big" data-act="shop">WORKSHOP <kbd>U</kbd></button>
			</div>
			<div class="tod" data-bind="tod"></div>
		`;
		click( h.querySelector( '[data-act=launch]' ), () => g.launch() );
		click( h.querySelector( '[data-act=shop]' ), () => g.openShop() );
		click( h.querySelector( '[data-act=mute]' ), () => g.toggleMute() );
		click( h.querySelector( '[data-act=achievements]' ), () => this.openModal( 'achievements' ) );
		click( h.querySelector( '[data-act=stats]' ), () => this.openModal( 'stats' ) );
		click( h.querySelector( '[data-act=settings]' ), () => this.openModal( 'settings' ) );
		root.appendChild( h );

		const ladder = this.ladder = el( 'div', 'ladder' );
		ladder.innerHTML = '<div class="ladder-title">The journey</div><div class="ladder-list"></div>';
		const list = ladder.querySelector( '.ladder-list' );
		for ( const z of [ ...ZONES ].reverse() ) {

			const row = el( 'div', 'ladder-row' );
			row.dataset.zone = z.id;
			row.innerHTML = `<span class="swatch" style="background:${ z.color }"></span><span class="zname">${ z.name }</span><span class="zalt">${ formatAltitude( z.from ) }</span><span class="ztag">${ z.tagline }</span>`;
			list.appendChild( row );

		}

		root.appendChild( ladder );

		// ---------------- shop
		const s = this.screens.shop = el( 'div', 'screen shop' );
		s.innerHTML = `
			<div class="shop-panel">
				<div class="shop-head">
					<button class="btn small back" data-act="back">← Back <kbd>Esc</kbd></button>
					<div class="shop-title" data-bind="shopTitle">Workshop</div>
					<div class="pill cash"><span class="k">Cash</span><span class="v" data-bind="cash"></span></div>
				</div>
				<div class="stat-row" data-bind="stats"></div>
				<div class="cards"></div>
			</div>
		`;
		click( s.querySelector( '[data-act=back]' ), () => g.closeShop() );
		this.cards = s.querySelector( '.cards' );
		this.statRow = s.querySelector( '[data-bind=stats]' );
		root.appendChild( s );

		// ---------------- HUD
		const hud = this.screens.hud = el( 'div', 'screen hud' );
		hud.innerHTML = `
			<div class="alt-box">
				<div class="alt" data-bind="alt">0 m</div>
				<div class="zone" data-bind="zone"></div>
				<div class="vs" data-bind="vs"></div>
				<div class="warp hidden" data-bind="warp"></div>
			</div>
			<div class="gauges">
				<div class="gauge fuel"><span class="gicon">${ icon( 'tank', 22 ) }</span><div class="bar"><div class="fill" data-bind="fuel"></div></div></div>
				<div class="gauge heat" data-bind="heatRow"><span class="gicon" data-bind="heatIcon">${ icon( 'flame', 22 ) }</span><div class="bar"><div class="fill" data-bind="heat"></div></div></div>
				<div class="hull" data-bind="hull"></div>
				<div class="bags" data-bind="bags"></div>
				<div class="buffs" data-bind="buffs"></div>
			</div>
			<div class="run-cash"><span data-bind="runcash">$0</span></div>
			<div class="meter"><div class="meter-track" data-bind="track"></div><div class="meter-best" data-bind="mbest"></div><div class="meter-you" data-bind="myou"></div></div>
			<div class="warns" data-bind="warns"></div>
			<div class="countdown" data-bind="countdown"></div>
			<div class="pause-card hidden" data-bind="pause"><div class="pause-title">Paused</div><button class="btn" data-act="resume">Resume</button><button class="btn small" data-act="abort">End run</button></div>
			<div class="touch-controls">
				<button class="touch-btn bag" data-act="bag">BAG</button>
				<div class="touch-hint">Hold right side: thrust · drag left side: steer</div>
			</div>
		`;
		click( hud.querySelector( '[data-act=resume]' ), () => g.setPaused( false ) );
		click( hud.querySelector( '[data-act=abort]' ), () => {

			g.setPaused( false );
			g.endRun( g.vehicle === 'starship' ? 'drift' : g.vehicle === 'rocket' ? 'apogee' : 'fuel' );

		} );
		hud.querySelector( '[data-act=bag]' ).addEventListener( 'touchstart', ( e ) => {

			e.preventDefault();
			g.input.buttons.bag = true;

		} );
		root.appendChild( hud );
		this.meterTrack = hud.querySelector( '[data-bind=track]' );

		// ---------------- results
		const r = this.screens.results = el( 'div', 'screen results' );
		r.innerHTML = `
			<div class="card">
				<div class="res-title" data-bind="rtitle"></div>
				<div class="res-sub" data-bind="rsub"></div>
				<div class="res-alt"><span data-bind="ralt"></span><span class="badge hidden" data-bind="rbadge">NEW RECORD</span></div>
				<div class="res-lines" data-bind="rlines"></div>
				<div class="res-ach" data-bind="rach"></div>
				<div class="res-total"><span>Total</span><span data-bind="rtotal"></span></div>
				<button class="btn big primary" data-act="continue">Continue <kbd>Space</kbd></button>
			</div>
		`;
		click( r.querySelector( '[data-act=continue]' ), () => g.returnToPad() );
		root.appendChild( r );

		// ---------------- modal
		this.modal = el( 'div', 'modal' );
		this.modal.innerHTML = '<div class="modal-card"><button class="modal-close" data-act="close">✕</button><div class="modal-body"></div></div>';
		click( this.modal.querySelector( '[data-act=close]' ), () => this.closeModal() );
		this.modal.addEventListener( 'click', ( e ) => {

			if ( e.target === this.modal ) this.closeModal();

		} );
		root.appendChild( this.modal );

		// ---------------- credits
		this.credits = el( 'div', 'credits' );
		root.appendChild( this.credits );

		// ---------------- overlays
		this.banner = el( 'div', 'zone-banner' );
		root.appendChild( this.banner );
		this.achBox = el( 'div', 'ach-pops' );
		root.appendChild( this.achBox );
		this.toastBox = el( 'div', 'toasts' );
		root.appendChild( this.toastBox );
		this.popLayer = el( 'div', 'pops' );
		root.appendChild( this.popLayer );
		this.fader = el( 'div', 'fader' );
		root.appendChild( this.fader );

		this.binds = {};
		for ( const n of root.querySelectorAll( '[data-bind]' ) ) ( this.binds[ n.dataset.bind ] ||= [] ).push( n );
		this.isTouch = matchMedia( '(pointer: coarse)' ).matches;
		root.classList.toggle( 'touch', this.isTouch );
		window.addEventListener( 'keydown', ( e ) => {

			if ( e.code === 'Escape' && this.modalOpen ) this.closeModal();

		} );

	}

	set( name, value, html = false ) {

		for ( const n of this.binds[ name ] || [] ) {

			if ( n._v === value ) continue;
			if ( html ) n.innerHTML = value;
			else n.textContent = value;
			n._v = value;

		}

	}

	show( name ) {

		this.current = name;
		for ( const k in this.screens ) this.screens[ k ].classList.toggle( 'on', k === name );
		this.ladder.classList.toggle( 'on', name === 'hangar' );
		if ( name === 'shop' ) this.renderShop();
		if ( name === 'hangar' ) {

			this.renderLadder();
			this.renderGarage();
			this.renderTimeOfDay();

		}

		if ( name === 'hud' ) this.renderMeter();
		this.root.classList.toggle( 'in-flight', name === 'hud' );

	}

	// ---------------------------------------------------------------- hangar

	renderGarage() {

		const g = this.game, box = this.binds.garage[ 0 ];
		box.innerHTML = '';
		for ( const v of VEHICLES ) {

			const owned = g.save.unlocked.includes( v.id );
			const sel = g.vehicle === v.id;
			const u = v.unlock;
			const reqMet = ! u || g.save.zones.includes( u.zone );
			const card = el( 'div', 'vcard' + ( sel ? ' sel' : '' ) + ( owned ? '' : ' locked' ) );
			card.innerHTML = `
				<div class="vicon">${ icon( VEHICLE_ICON[ v.id ], 46 ) }</div>
				<div class="vbody">
					<div class="vname">${ v.name }</div>
					<div class="vsub">${ owned ? `Best: ${ g.save.bestBy[ v.id ] ? formatAltitude( g.save.bestBy[ v.id ] ) : '—' }` : reqMet ? `Unlock for ${ formatMoney( u.cost ) }` : `🔒 ${ u.text }` }</div>
				</div>
				${ ! owned && reqMet ? `<button class="btn small unlock" ${ g.save.cash < u.cost ? 'disabled' : '' }>Unlock</button>` : '' }
			`;
			if ( owned ) this.click( card, () => g.selectVehicle( v.id ) );
			const ub = card.querySelector( '.unlock' );
			if ( ub ) this.click( ub, ( e ) => {

				e.stopPropagation();
				g.unlockVehicle( v.id );

			} );
			box.appendChild( card );

		}

	}

	renderTimeOfDay() {

		const g = this.game, box = this.binds.tod[ 0 ];
		box.innerHTML = '<span class="tod-label">Launch at</span>';
		for ( const id in TIMES_OF_DAY ) {

			const t = TIMES_OF_DAY[ id ];
			const b = el( 'button', 'chip' + ( g.app.timeOfDay === id ? ' on' : '' ), `${ t.name }${ t.bonus > 1 ? ` <em>+${ Math.round( ( t.bonus - 1 ) * 100 ) }%</em>` : '' }` );
			this.click( b, () => {

				g.setTimeOfDay( id );
				this.renderTimeOfDay();

			} );
			box.appendChild( b );

		}

	}

	renderLadder() {

		const reached = new Set( this.game.save.zones );
		let last = null;
		for ( const row of this.ladder.querySelectorAll( '.ladder-row' ) ) {

			const id = row.dataset.zone;
			row.classList.toggle( 'reached', reached.has( id ) );
			if ( reached.has( id ) && ! last ) last = row;

		}

		if ( last ) last.scrollIntoView( { block: 'center' } );

	}

	// ---------------------------------------------------------------- shop

	renderShop() {

		const g = this.game, v = g.vehicle;
		this.set( 'shopTitle', `${ VEHICLE_BY_ID[ v ].name } workshop` );
		this.cards.innerHTML = '';
		for ( const u of UPGRADES[ v ] ) {

			const lv = g.save.levels[ v ][ u.id ] || 0;
			const cur = u.levels[ lv ], next = u.levels[ lv + 1 ];
			const card = el( 'div', 'ucard' + ( next ? '' : ' maxed' ) );
			const pips = u.levels.slice( 1 ).map( ( _, i ) => `<span class="pip ${ i < lv ? 'on' : '' }"></span>` ).join( '' );
			card.innerHTML = `
				<div class="uicon">${ icon( u.icon, 44 ) }</div>
				<div class="ubody">
					<div class="uname">${ u.name }</div>
					<div class="ucur">${ cur.name }${ next ? ` → <b>${ next.name }</b>` : ' · <b>MAX</b>' }</div>
					<div class="ublurb">${ u.blurb }</div>
					<div class="pips">${ pips }</div>
				</div>
				<button class="btn buy" ${ ! next || g.save.cash < next.cost ? 'disabled' : '' }>${ next ? formatMoney( next.cost ) : '✓' }</button>
			`;
			const b = card.querySelector( '.buy' );
			if ( next ) this.click( b, () => {

				if ( g.buy( u.id ) ) {

					this.renderShop();
					const nc = this.cards.children[ UPGRADES[ v ].indexOf( u ) ];
					if ( nc ) nc.classList.add( 'bought' );

				}

			} );
			this.cards.appendChild( card );

		}

		// paint shop for the rocket and the Starship
		if ( v !== 'balloon' ) {

			const liveries = v === 'rocket' ? ROCKET_LIVERIES : SHIP_LIVERIES;
			const box = el( 'div', 'paints' );
			box.innerHTML = '<div class="paints-title">Paint shop</div>';
			const row = el( 'div', 'paint-row' );
			for ( const id in liveries ) {

				const L = liveries[ id ];
				const owned = g.save.ownedPaints.includes( v + ':' + id );
				const on = g.save.paints[ v ] === id;
				const cols = v === 'rocket' ? [ L.body, L.band, L.accent ] : [ L.hull, L.trim, L.accent ];
				const sw = cols.map( ( c ) => `<span style="background:#${ c.toString( 16 ).padStart( 6, '0' ) }"></span>` ).join( '' );
				const cost = paintCost( v, id );
				const b = el( 'button', 'paint' + ( on ? ' on' : '' ), `<span class="sw">${ sw }</span><span class="pn">${ L.name }</span><span class="pc">${ on ? 'Equipped' : owned ? 'Owned' : formatMoney( cost ) }</span>` );
				if ( ! owned && g.save.cash < cost ) b.disabled = true;
				this.click( b, () => {

					if ( g.buyPaint( v, id ) ) this.renderShop();

				} );
				row.appendChild( b );

			}

			box.appendChild( row );
			this.cards.appendChild( box );

		}

		const st = g.stats();
		let html = '';
		if ( v === 'balloon' ) html = `<span><b>${ ( st.lift / 9.81 ).toFixed( 2 ) }g</b> lift</span><span><b>${ st.fuel }s</b> fuel</span><span><b>${ st.hull }</b> hull</span><span><b>${ st.fan }</b> steer</span>`;
		else if ( v === 'rocket' ) html = `<span><b>${ ( st.thrust / 9.81 ).toFixed( 1 ) }g</b> thrust</span><span><b>${ st.fuel }s</b> burn</span><span><b>${ st.boosters }</b> boosters</span><span><b>${ st.hull }</b> hull</span>`;
		else html = `<span><b>×${ Math.exp( st.boost ).toFixed( 2 ) }</b>/s speed</span><span><b>${ st.fuel }s</b> burn</span><span><b>${ st.hull }</b> hull</span><span><b>${ Math.round( ( 1 - st.heat ) * 100 ) }%</b> heat shield</span>`;
		this.statRow.innerHTML = html;

	}

	// ---------------------------------------------------------------- modals

	openModal( kind ) {

		const g = this.game, body = this.modal.querySelector( '.modal-body' );
		this.modalOpen = true;
		this.modal.classList.add( 'on' );
		if ( kind === 'achievements' ) {

			const got = ACHIEVEMENTS.filter( ( a ) => g.save.achievements[ a.id ] ).length;
			body.innerHTML = `<div class="modal-title">Achievements <span class="muted">${ got } / ${ ACHIEVEMENTS.length }</span></div><div class="ach-grid">${ ACHIEVEMENTS.map( ( a ) => `
				<div class="ach ${ g.save.achievements[ a.id ] ? 'got' : '' }">
					<div class="ach-medal">${ g.save.achievements[ a.id ] ? '🏅' : '🔒' }</div>
					<div><div class="ach-name">${ a.name }</div><div class="ach-desc">${ a.desc }</div></div>
					<div class="ach-reward">${ formatMoney( a.reward ) }</div>
				</div>` ).join( '' ) }</div>`;

		} else if ( kind === 'stats' ) {

			const S = g.save.stats;
			const rows = [
				[ 'Runs flown', S.runs ], [ 'Time in the air', `${ Math.floor( ( S.flightTime || 0 ) / 60 ) } min` ],
				[ 'Best (balloon)', g.save.bestBy.balloon ? formatAltitude( g.save.bestBy.balloon ) : '—' ],
				[ 'Best (rocket)', g.save.bestBy.rocket ? formatAltitude( g.save.bestBy.rocket ) : '—' ],
				[ 'Best (Starship)', g.save.bestBy.starship ? formatAltitude( g.save.bestBy.starship ) : '—' ],
				[ 'Top speed', formatSpeed( S.maxSpeed || 0 ) ], [ 'Coins collected', ( S.coins || 0 ).toLocaleString( 'en-US' ) ],
				[ 'Total earned', formatMoney( S.earned || 0 ) ], [ 'Zones discovered', `${ g.save.zones.length } / ${ ZONES.length }` ],
				[ 'Splashdowns', S.splashes ], [ 'Pops', S.pops ], [ 'Hits blocked', S.blocked ], [ 'Astronauts rescued', S.astronauts ],
				[ 'Probes recovered', S.probes ], [ 'Crystals', S.crystals ], [ 'Sandbags dropped', S.bags ],
			];
			body.innerHTML = `<div class="modal-title">Flight log</div><div class="stats-grid">${ rows.map( ( [ k, v ] ) => `<div class="st"><span>${ k }</span><b>${ v }</b></div>` ).join( '' ) }</div>`;

		} else if ( kind === 'settings' ) {

			const q = g.app.settings.quality;
			body.innerHTML = `<div class="modal-title">Settings</div>
				<label class="set"><span>Music</span><input type="range" min="0" max="1" step="0.05" value="${ g.save.settings.music }" data-k="music"></label>
				<label class="set"><span>Sound effects</span><input type="range" min="0" max="1" step="0.05" value="${ g.save.settings.sfx }" data-k="sfx"></label>
				<div class="set"><span>Graphics</span><div class="seg">${ [ 'low', 'medium', 'high' ].map( ( k ) => `<button class="chip ${ q === k ? 'on' : '' }" data-q="${ k }">${ k[ 0 ].toUpperCase() + k.slice( 1 ) }</button>` ).join( '' ) }</div></div>
				<div class="set-note">Changing graphics reloads the game (progress is saved).</div>
				<div class="set danger"><span>Start over</span><button class="btn small" data-act="reset">Reset progress</button></div>
				<div class="set-note">Controls: Space / hold click to thrust · A D to steer · Shift for a sandbag · Esc to pause · M to mute · 1 2 3 to pick a vehicle.</div>`;
			for ( const inp of body.querySelectorAll( 'input[type=range]' ) ) inp.addEventListener( 'input', () => g.setVolume( inp.dataset.k, Number( inp.value ) ) );
			for ( const b of body.querySelectorAll( '[data-q]' ) ) this.click( b, () => {

				try {

					localStorage.setItem( 'skybound.quality', b.dataset.q );

				} catch { /* ignore */ }

				const u = new URL( location.href );
				u.searchParams.delete( 'quality' );
				location.href = u.toString();

			} );
			this.click( body.querySelector( '[data-act=reset]' ), ( e ) => {

				const btn = e.currentTarget;
				if ( btn.dataset.armed ) {

					g.resetProgress();
					this.closeModal();
					this.toast( 'Progress reset', 2 );

				} else {

					btn.dataset.armed = '1';
					btn.textContent = 'Click again to confirm';

				}

			} );

		}

	}

	closeModal() {

		this.modalOpen = false;
		this.modal.classList.remove( 'on' );
		if ( this.current === 'hangar' ) this.show( 'hangar' );

	}

	// ---------------------------------------------------------------- flight

	renderMeter() {

		const g = this.game, M = METER[ g.vehicle ];
		this.meterTrack.innerHTML = '';
		this.meterMarks = [];
		for ( const id of M.zones ) {

			const z = ZONES.find( ( q ) => q.id === id );
			const m = el( 'div', 'meter-mark', `<span>${ z.name }</span>` );
			m.dataset.alt = z.from;
			this.meterTrack.appendChild( m );
			this.meterMarks.push( m );

		}

	}

	meterPos( h ) {

		const M = METER[ this.game.vehicle ];
		const a = Math.log( 1 + Math.max( 0, h - M.from ) / 150 ), b = Math.log( 1 + ( M.to - M.from ) / 150 );
		return Math.min( 1, a / b );

	}

	setPaused( p ) {

		for ( const n of this.binds.pause ) n.classList.toggle( 'hidden', ! p );

	}

	countdown( n ) {

		const c = this.binds.countdown[ 0 ];
		c.textContent = n > 0 ? String( n ) : 'LIFTOFF!';
		c.classList.remove( 'go' );
		void c.offsetWidth;
		c.classList.add( 'go' );

	}

	showResults( res ) {

		this.show( 'results' );
		const [ title, sub ] = REASONS[ res.reason ] || REASONS.fuel;
		this.set( 'rtitle', title );
		this.set( 'rsub', sub );
		this.set( 'ralt', formatAltitude( res.altitude ) );
		for ( const n of this.binds.rbadge ) n.classList.toggle( 'hidden', ! res.record );
		const box = this.binds.rlines[ 0 ];
		box.innerHTML = '';
		res.lines.forEach( ( [ label, v ], i ) => {

			const row = el( 'div', 'res-line', `<span>${ label }</span><span class="amt">${ formatMoney( 0 ) }</span>` );
			row.style.animationDelay = ( i * 0.12 ) + 's';
			box.appendChild( row );
			this._countUp( row.querySelector( '.amt' ), v, 0.5 + i * 0.12 );

		} );
		const ach = this.binds.rach[ 0 ];
		ach.innerHTML = ( res.achievements || [] ).map( ( a ) => `<div class="res-achv">🏅 ${ a.name } <span>+${ formatMoney( a.reward ) }</span></div>` ).join( '' );
		this._countUp( this.binds.rtotal[ 0 ], res.total, 0.5 + res.lines.length * 0.12, 1.1 );

	}

	_countUp( node, target, delay, dur = 0.7 ) {

		const t0 = performance.now() + delay * 1000;
		const tick = ( t ) => {

			const k = Math.min( 1, Math.max( 0, ( t - t0 ) / ( dur * 1000 ) ) );
			node.textContent = formatMoney( target * ( 1 - Math.pow( 1 - k, 3 ) ) );
			if ( k < 1 ) requestAnimationFrame( tick );

		};

		requestAnimationFrame( tick );

	}

	zoneBanner( zone, fresh ) {

		const b = this.banner;
		b.innerHTML = `<div class="zb-alt">${ formatAltitude( zone.from ) }</div><div class="zb-name">${ zone.name }</div><div class="zb-tag">${ fresh && zone.bonus ? `New zone! +${ formatMoney( zone.bonus ) }` : zone.tagline }</div>`;
		b.style.setProperty( '--zc', zone.color );
		b.classList.remove( 'go' );
		void b.offsetWidth;
		b.classList.add( 'go' );

	}

	toast( text, seconds = 1.5, kind = '' ) {

		const t = el( 'div', 'toast ' + kind, text );
		this.toastBox.appendChild( t );
		while ( this.toastBox.children.length > 4 ) this.toastBox.firstChild.remove();
		setTimeout( () => t.classList.add( 'out' ), seconds * 1000 );
		setTimeout( () => t.remove(), seconds * 1000 + 400 );

	}

	achievement( a ) {

		const n = el( 'div', 'ach-pop', `<div class="ap-medal">🏅</div><div><div class="ap-k">Achievement</div><div class="ap-name">${ a.name }</div><div class="ap-desc">${ a.desc } · +${ formatMoney( a.reward ) }</div></div>` );
		this.achBox.appendChild( n );
		setTimeout( () => n.classList.add( 'out' ), 3800 );
		setTimeout( () => n.remove(), 4300 );

	}

	popText( p ) {

		const txt = p.kind === 'fuel' ? '+FUEL' : p.value ? '+' + formatMoney( p.value ) : '';
		if ( ! txt ) return;
		const n = el( 'div', 'pop ' + p.kind, txt );
		this.popLayer.appendChild( n );
		this.pops.push( { n, x: p.x, y: p.y, t: 0 } );

	}

	fade( mid ) {

		this.fader.classList.add( 'on' );
		setTimeout( () => {

			mid();
			setTimeout( () => this.fader.classList.remove( 'on' ), 120 );

		}, 380 );

	}

	showCredits() {

		this.creditsOpen = true;
		const c = this.credits;
		c.innerHTML = `
			<div class="credits-roll">
				<div class="cr-big">SKYBOUND</div>
				<p>You went from a patchwork balloon on a wooden pier to the heart of the Milky Way.</p>
				<p>The gulls will never believe it.</p>
				<h3>Flown by</h3><p>You</p>
				<h3>Engine</h3><p>A home-grown WebGPU renderer built on Tidewater's engine core</p>
				<h3>Sky</h3><p>Physically based atmosphere · volumetric clouds · an FFT ocean</p>
				<h3>Music & sound</h3><p>Synthesized live in your browser</p>
				<h3>Thanks for playing</h3>
				<button class="btn big primary" data-act="done">Keep flying</button>
			</div>`;
		c.classList.add( 'on' );
		this.click( c.querySelector( '[data-act=done]' ), () => {

			c.classList.remove( 'on' );
			this.creditsOpen = false;

		} );

	}

	// ---------------------------------------------------------------- per frame

	update( dt ) {

		const g = this.game, s = g.s, save = g.save;
		this.set( 'cash', formatMoney( save.cash ) );
		this.set( 'best', save.best > 0 ? formatAltitude( save.best ) : '—' );
		const got = Object.keys( save.achievements ).length;
		this.set( 'achCount', got ? String( got ) : '' );
		for ( const n of this.root.querySelectorAll( '.mute' ) ) {

			const want = save.muted ? '🔇' : '🔊';
			if ( n._v !== want ) {

				n.innerHTML = want;
				n._v = want;

			}

		}

		if ( this.current === 'hud' && s ) {

			const st = g.stats();
			const v = g.vehicle;
			const h = g.realH();
			this.set( 'alt', formatAltitude( h ) );
			this.set( 'zone', zoneAt( h ).name );
			const speed = v === 'starship' && g.mode === 'space' ? s.v : Math.hypot( s.vx, s.vy );
			const vs = v === 'starship' ? '▲ ' + formatSpeed( speed ) : ( s.vy >= 0 ? '▲ ' : '▼ ' ) + formatSpeed( Math.abs( s.vy ) );
			this.set( 'vs', vs );
			const warp = g.warp > 1.5 ? `⏩ Coasting ×${ Math.round( g.warp ) }` : '';
			this.set( 'warp', warp );
			for ( const n of this.binds.warp ) n.classList.toggle( 'hidden', ! warp );
			this._width( 'fuel', s.fuel / st.fuel );
			for ( const n of this.binds.fuel ) n.classList.toggle( 'low', s.fuel / st.fuel < 0.2 );
			// second gauge: envelope heat / booster burn / solar heat
			let heat = 0, show = true, hot = false;
			if ( v === 'balloon' ) heat = s.heat;
			else if ( v === 'rocket' ) {

				show = st.boosters > 0;
				heat = s.boosters ? Math.max( 0, s.boosterFuel ) / Math.max( 1, st.boosterTime ) : 0;

			} else {

				heat = Math.min( 1, s.heat || 0 );
				show = ( s.heat || 0 ) > 0.01;
				hot = ( s.heat || 0 ) > 0.75;

			}

			this._width( 'heat', heat );
			for ( const n of this.binds.heatRow ) {

				n.classList.toggle( 'hidden', ! show );
				n.classList.toggle( 'hot', hot );

			}

			this.set( 'heatIcon', icon( v === 'rocket' ? 'booster' : v === 'starship' ? 'heatshield' : 'flame', 22 ), true );
			let hull = '';
			for ( let i = 0; i < st.hull; i ++ ) hull += `<span class="hp ${ i < s.hull ? 'on' : '' }"></span>`;
			if ( g.shield > 0 ) hull += `<span class="sh">${ '◯'.repeat( g.shield ) }</span>`;
			this.set( 'hull', hull, true );
			this.set( 'bags', s.bags > 0 ? `${ icon( 'sandbag', 18 ) }×${ s.bags }` : '', true );
			const buffs = ( g.buffs.magnet > 0 ? `<span class="buff mag">🧲 ${ Math.ceil( g.buffs.magnet ) }</span>` : '' ) + ( g.buffs.boost > 0 ? '<span class="buff boost">⚡ TURBO</span>' : '' );
			this.set( 'buffs', buffs, true );
			this.set( 'runcash', '+' + formatMoney( g.run ? g.run.coins : 0 ) );

			for ( const n of this.binds.myou ) n.style.bottom = ( this.meterPos( h ) * 100 ).toFixed( 2 ) + '%';
			const best = save.bestBy[ v ] || 0;
			for ( const n of this.binds.mbest ) {

				n.style.bottom = ( this.meterPos( best ) * 100 ).toFixed( 2 ) + '%';
				n.style.display = best > 0 ? '' : 'none';

			}

			for ( const m of this.meterMarks || [] ) m.style.bottom = ( this.meterPos( Number( m.dataset.alt ) ) * 100 ).toFixed( 2 ) + '%';
			this._warnings();

		}

		const cam = g.app.camera;
		this.pops = this.pops.filter( ( p ) => {

			p.t += dt;
			_p.set( p.x, p.y + p.t * 6, 0 ).project( cam );
			p.n.style.transform = `translate(${ ( _p.x * 0.5 + 0.5 ) * innerWidth }px, ${ ( 0.5 - _p.y * 0.5 ) * innerHeight }px) translate(-50%, -50%) scale(${ 1 + p.t * 0.3 })`;
			p.n.style.opacity = String( Math.max( 0, 1 - p.t / 0.9 ) );
			if ( p.t > 0.9 ) {

				p.n.remove();
				return false;

			}

			return true;

		} );

	}

	_width( name, f ) {

		for ( const n of this.binds[ name ] || [] ) n.style.width = ( Math.max( 0, Math.min( 1, f ) ) * 100 ).toFixed( 1 ) + '%';

	}

	_warnings() {

		const g = this.game, cam = g.app.camera, box = this.binds.warns[ 0 ];
		const list = [];
		for ( const h of g.hazards.items ) {

			if ( ! h.warn || h.spent ) continue;
			_p.set( h.x, h.y, 0 ).project( cam );
			const onScreen = Math.abs( _p.x ) < 1 && Math.abs( _p.y ) < 1;
			const approaching = Math.sign( h.vx ) !== Math.sign( _p.x );
			if ( onScreen || ! approaching || Math.abs( _p.y ) > 1.1 || Math.abs( _p.x ) > 6 ) continue;
			list.push( { side: _p.x < 0 ? 'left' : 'right', y: ( 0.5 - Math.max( - 0.9, Math.min( 0.9, _p.y ) ) * 0.5 ) * 100, urgency: 1 - Math.min( 1, ( Math.abs( _p.x ) - 1 ) / 4 ) } );

		}

		let html = '';
		for ( const w of list ) html += `<div class="warn ${ w.side }" style="top:${ w.y.toFixed( 1 ) }%;opacity:${ ( 0.4 + w.urgency * 0.6 ).toFixed( 2 ) }">!</div>`;
		if ( box._v !== html ) {

			box.innerHTML = html;
			box._v = html;

		}

	}

}
