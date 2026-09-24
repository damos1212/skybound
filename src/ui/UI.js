import { Vector3 } from '../engine/math/index.js';
import { UPGRADES } from '../game/Upgrades.js';
import { ZONES, zoneAt, formatAltitude, formatMoney } from '../game/Zones.js';

// DOM overlay: hangar menu, workshop, flight HUD, results card, zone banners, toasts. Plain DOM +
// CSS (ui.css); `update()` refreshes the live numbers each frame.

const ICONS = {
	envelope: '<path d="M32 6c-12 0-20 9-20 20 0 9 7 16 13 22h14c6-6 13-13 13-22 0-11-8-20-20-20z" fill="#ff5a36"/><path d="M32 6c-5 0-8 9-8 20 0 9 3 16 4 22h8c1-6 4-13 4-22 0-11-3-20-8-20z" fill="#ffc93c"/><rect x="26" y="50" width="12" height="9" rx="2" fill="#a87650"/>',
	flame: '<path d="M32 58c-11 0-17-8-17-17 0-10 8-15 10-25 5 5 6 10 6 13 3-3 5-8 5-14 9 7 13 16 13 26 0 9-6 17-17 17z" fill="#ff7a1f"/><path d="M32 58c-5 0-8-4-8-8 0-5 4-8 5-12 3 3 3 5 3 7 2-1 3-4 3-6 3 3 5 7 5 11 0 5-3 8-8 8z" fill="#ffd23f"/>',
	tank: '<rect x="20" y="16" width="24" height="40" rx="10" fill="#e2463a"/><rect x="27" y="8" width="10" height="9" rx="2" fill="#3b3b44"/><rect x="20" y="30" width="24" height="7" fill="#ffc93c"/>',
	basket: '<path d="M14 26h36l-4 28H18z" fill="#b98a4e"/><path d="M14 26h36v6H14z" fill="#6b3f22"/><path d="M22 32v20M30 32v21M38 32v21M44 32v19" stroke="#8f6636" stroke-width="2"/>',
	fan: '<circle cx="32" cy="32" r="24" fill="none" stroke="#ffc93c" stroke-width="5"/><path d="M32 32c-2-10 2-16 8-16 2 6-2 12-8 16zM32 32c10-2 16 2 16 8-6 2-12-2-16-8zM32 32c2 10-2 16-8 16-2-6 2-12 8-16zM32 32c-10 2-16-2-16-8 6-2 12 2 16 8z" fill="#3b3b44"/>',
	sandbag: '<path d="M18 30c0-8 6-12 14-12s14 4 14 12v14c0 8-6 12-14 12S18 52 18 44z" fill="#c9a66b"/><path d="M24 20c2-4 5-6 8-6s6 2 8 6" stroke="#6b3f22" stroke-width="4" fill="none"/>',
	magnet: '<path d="M14 12h12v22a6 6 0 0 0 12 0V12h12v22a18 18 0 0 1-36 0z" fill="#e2463a"/><rect x="14" y="12" width="12" height="8" fill="#e8eef2"/><rect x="38" y="12" width="12" height="8" fill="#e8eef2"/>',
	shield: '<circle cx="32" cy="32" r="22" fill="#9fdcff" opacity="0.55"/><circle cx="32" cy="32" r="22" fill="none" stroke="#7fc7ff" stroke-width="3"/><path d="M22 22a14 14 0 0 1 12-6" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>',
};

const REASONS = {
	splash: [ 'Splashdown!', 'Back in the sea. The gulls are laughing.' ],
	landed: [ 'Touchdown', 'A gentle landing on the island.' ],
	pop: [ 'POP!', 'The envelope gave out.' ],
	fuel: [ 'Out of fuel', 'The burner sputtered out. Down you drift.' ],
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

export class UI {

	constructor( root, game ) {

		this.root = root;
		this.game = game;
		this.screens = {};
		this.toasts = [];
		this.pops = [];
		this._build();

	}

	_build() {

		const g = this.game, root = this.root;

		// ---------------- hangar
		const h = this.screens.hangar = el( 'div', 'screen hangar' );
		h.innerHTML = `
			<div class="brand">
				<div class="logo">SKYBOUND</div>
				<div class="tagline">How high can you go?</div>
			</div>
			<div class="topbar">
				<div class="pill cash"><span class="k">Cash</span><span class="v" data-bind="cash"></span></div>
				<div class="pill best"><span class="k">Best</span><span class="v" data-bind="best"></span></div>
				<button class="icon-btn mute" data-act="mute" title="Sound (M)"></button>
			</div>
			<div class="menu">
				<button class="btn big primary" data-act="launch">LAUNCH <kbd>Space</kbd></button>
				<button class="btn big" data-act="shop">WORKSHOP <kbd>U</kbd></button>
			</div>
			<div class="help">
				<div><kbd>Space</kbd> / hold click: burner</div>
				<div><kbd>A</kbd> <kbd>D</kbd>: steering fans</div>
				<div><kbd>Shift</kbd>: drop a sandbag</div>
			</div>
		`;
		h.querySelector( '[data-act=launch]' ).onclick = () => g.launch();
		h.querySelector( '[data-act=shop]' ).onclick = () => g.openShop();
		h.querySelector( '[data-act=mute]' ).onclick = () => g.toggleMute();
		root.appendChild( h );

		// zone ladder (hangar + shop)
		const ladder = this.ladder = el( 'div', 'ladder' );
		ladder.innerHTML = '<div class="ladder-title">The way up</div>';
		for ( const z of [ ...ZONES ].reverse() ) {

			const row = el( 'div', 'ladder-row' );
			row.dataset.zone = z.id;
			row.innerHTML = `<span class="swatch" style="background:${ z.color }"></span><span class="zname">${ z.name }</span><span class="zalt">${ formatAltitude( z.from ) }</span><span class="ztag">${ z.tagline }</span>`;
			ladder.appendChild( row );

		}

		root.appendChild( ladder );

		// ---------------- shop
		const s = this.screens.shop = el( 'div', 'screen shop' );
		s.innerHTML = `
			<div class="shop-panel">
				<div class="shop-head">
					<button class="btn small back" data-act="back">← Back <kbd>Esc</kbd></button>
					<div class="shop-title">Workshop</div>
					<div class="pill cash"><span class="k">Cash</span><span class="v" data-bind="cash"></span></div>
				</div>
				<div class="stat-row" data-bind="stats"></div>
				<div class="cards"></div>
			</div>
		`;
		s.querySelector( '[data-act=back]' ).onclick = () => g.closeShop();
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
			</div>
			<div class="gauges">
				<div class="gauge fuel"><span class="gicon">${ icon( 'tank', 22 ) }</span><div class="bar"><div class="fill" data-bind="fuel"></div></div></div>
				<div class="gauge heat"><span class="gicon">${ icon( 'flame', 22 ) }</span><div class="bar"><div class="fill" data-bind="heat"></div></div></div>
				<div class="hull" data-bind="hull"></div>
				<div class="bags" data-bind="bags"></div>
			</div>
			<div class="run-cash"><span data-bind="runcash">$0</span></div>
			<div class="meter"><div class="meter-track" data-bind="track"></div><div class="meter-best" data-bind="mbest"></div><div class="meter-you" data-bind="myou"></div></div>
			<div class="warns" data-bind="warns"></div>
			<div class="pause-card hidden" data-bind="pause"><div class="pause-title">Paused</div><button class="btn" data-act="resume">Resume</button><button class="btn small" data-act="abort">End run</button></div>
			<div class="touch-controls">
				<button class="touch-btn bag" data-act="bag">BAG</button>
				<div class="touch-hint">Hold right side: burner · drag left side: steer</div>
			</div>
		`;
		hud.querySelector( '[data-act=resume]' ).onclick = () => {

			g.paused = false;
			this.setPaused( false );

		};

		hud.querySelector( '[data-act=abort]' ).onclick = () => {

			g.paused = false;
			this.setPaused( false );
			g.endRun( 'fuel' );

		};

		hud.querySelector( '[data-act=bag]' ).addEventListener( 'touchstart', ( e ) => {

			e.preventDefault();
			g.input.buttons.bag = true;

		} );
		root.appendChild( hud );
		const track = hud.querySelector( '[data-bind=track]' );
		this.meterMarks = [];
		for ( const z of ZONES.slice( 0, 6 ) ) {

			const m = el( 'div', 'meter-mark', `<span>${ z.name }</span>` );
			m.dataset.alt = z.from;
			track.appendChild( m );
			this.meterMarks.push( m );

		}

		// ---------------- results
		const r = this.screens.results = el( 'div', 'screen results' );
		r.innerHTML = `
			<div class="card">
				<div class="res-title" data-bind="rtitle"></div>
				<div class="res-sub" data-bind="rsub"></div>
				<div class="res-alt"><span data-bind="ralt"></span><span class="badge hidden" data-bind="rbadge">NEW RECORD</span></div>
				<div class="res-lines" data-bind="rlines"></div>
				<div class="res-total"><span>Total</span><span data-bind="rtotal"></span></div>
				<button class="btn big primary" data-act="continue">Continue <kbd>Space</kbd></button>
			</div>
		`;
		r.querySelector( '[data-act=continue]' ).onclick = () => g.returnToPad();
		root.appendChild( r );

		// ---------------- overlays
		this.banner = el( 'div', 'zone-banner' );
		root.appendChild( this.banner );
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

	}

	set( name, value, html = false ) {

		for ( const n of this.binds[ name ] || [] ) {

			if ( html ) {

				if ( n._v !== value ) n.innerHTML = value;

			} else if ( n._v !== value ) n.textContent = value;
			n._v = value;

		}

	}

	show( name ) {

		this.current = name;
		for ( const k in this.screens ) this.screens[ k ].classList.toggle( 'on', k === name );
		this.ladder.classList.toggle( 'on', name === 'hangar' );
		if ( name === 'shop' ) this.renderShop();
		if ( name === 'hangar' ) this.renderLadder();
		this.root.classList.toggle( 'in-flight', name === 'hud' );

	}

	renderLadder() {

		const reached = new Set( this.game.save.zones );
		for ( const row of this.ladder.querySelectorAll( '.ladder-row' ) ) {

			const z = ZONES.find( ( q ) => q.id === row.dataset.zone );
			row.classList.toggle( 'reached', reached.has( z.id ) );
			row.classList.toggle( 'locked', !! z.locked );

		}

	}

	renderShop() {

		const g = this.game;
		this.cards.innerHTML = '';
		for ( const u of UPGRADES ) {

			const lv = g.save.levels[ u.id ] || 0;
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
			if ( next ) b.onclick = () => {

				if ( g.buy( u.id ) ) {

					this.renderShop();
					const nc = this.cards.children[ UPGRADES.indexOf( u ) ];
					nc && nc.classList.add( 'bought' );

				}

			};

			this.cards.appendChild( card );

		}

		const st = g.stats;
		this.statRow.innerHTML = `
			<span><b>${ ( st.lift / 9.81 ).toFixed( 2 ) }g</b> lift</span>
			<span><b>${ st.fuel }s</b> fuel</span>
			<span><b>${ st.hull }</b> hull</span>
			<span><b>${ st.fan }</b> steer</span>
		`;

	}

	setPaused( p ) {

		for ( const n of this.binds.pause ) n.classList.toggle( 'hidden', ! p );

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
		b.innerHTML = `<div class="zb-alt">${ formatAltitude( zone.from ) }</div><div class="zb-name">${ zone.name }</div><div class="zb-tag">${ fresh ? `New zone! +${ formatMoney( zone.bonus ) }` : zone.tagline }</div>`;
		b.style.setProperty( '--zc', zone.color );
		b.classList.remove( 'go' );
		void b.offsetWidth;
		b.classList.add( 'go' );

	}

	toast( text, seconds = 1.5, kind = '' ) {

		const t = el( 'div', 'toast ' + kind, text );
		this.toastBox.appendChild( t );
		setTimeout( () => t.classList.add( 'out' ), seconds * 1000 );
		setTimeout( () => t.remove(), seconds * 1000 + 400 );

	}

	popText( p ) {

		const txt = p.kind === 'fuel' ? '+FUEL' : '+' + formatMoney( p.value );
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

	// ---------------------------------------------------------------- per frame

	update( dt ) {

		const g = this.game, s = g.flight, save = g.save;
		this.set( 'cash', formatMoney( save.cash ) );
		this.set( 'best', save.best > 0 ? formatAltitude( save.best ) : '—' );
		for ( const n of this.root.querySelectorAll( '.mute' ) ) n.innerHTML = save.muted ? '🔇' : '🔊';

		if ( this.current === 'hud' && s ) {

			const st = g.stats;
			this.set( 'alt', formatAltitude( Math.max( 0, s.y ) ) );
			this.set( 'zone', zoneAt( s.y ).name );
			const vs = s.vy;
			this.set( 'vs', ( vs >= 0 ? '▲ ' : '▼ ' ) + Math.abs( vs ).toFixed( 0 ) + ' m/s' );
			this._width( 'fuel', s.fuel / st.fuel );
			this._width( 'heat', s.heat );
			let hull = '';
			for ( let i = 0; i < st.hull; i ++ ) hull += `<span class="hp ${ i < s.hull ? 'on' : '' }"></span>`;
			if ( g.shield > 0 ) hull += `<span class="sh">${ '◯'.repeat( g.shield ) }</span>`;
			this.set( 'hull', hull, true );
			this.set( 'bags', s.bags > 0 ? `${ icon( 'sandbag', 18 ) }×${ s.bags }` : '', true );
			this.set( 'runcash', '+' + formatMoney( g.run ? g.run.coins : 0 ) );
			for ( const n of this.binds.fuel ) n.classList.toggle( 'low', s.fuel / st.fuel < 0.2 );

			// altitude meter: log scale up to the edge of space
			const top = 60000;
			const f = ( y ) => Math.log( 1 + Math.max( 0, y ) / 150 ) / Math.log( 1 + top / 150 );
			for ( const n of this.binds.myou ) n.style.bottom = ( f( s.y ) * 100 ).toFixed( 2 ) + '%';
			for ( const n of this.binds.mbest ) {

				n.style.bottom = ( f( save.best ) * 100 ).toFixed( 2 ) + '%';
				n.style.display = save.best > 0 ? '' : 'none';

			}

			for ( const m of this.meterMarks ) m.style.bottom = ( f( Number( m.dataset.alt ) ) * 100 ).toFixed( 2 ) + '%';

			this._warnings();

		}

		// floating pickup texts
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

	// arrows at the screen edge for fast hazards about to cross the view
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
