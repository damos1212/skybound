// In-browser playtest harness (dev only). With the game loaded:
//   const P = await import( '/tools/playtest.js' );
//   await P.run( 'rocket', 2, { dodge: true } )
// flies a run with an autopilot (full burn, optional dodging) outside the render loop and reports
// how far it got, the pay, hits, close calls, and whether the vehicle ever left the frame. Big
// single-frame jumps in the run's cash are listed to catch money bugs.

import { UPGRADES } from '../src/game/Upgrades.js';

const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

export function setTier( t ) {

	const g = window.__game;
	for ( const v in UPGRADES ) if ( ! g.save.unlocked.includes( v ) ) g.save.unlocked.push( v );
	for ( const v in UPGRADES ) for ( const u of UPGRADES[ v ] ) g.save.levels[ v ][ u.id ] = Math.min( t, u.levels.length - 1 );
	if ( t < 5 ) {

		g.save.levels.starship.improbability = 0;
		g.save.levels.ark.anchor = 0;

	}

}

// steer away from the nearest hazard ahead (a rough human)
function dodge( g ) {

	const lp = g.lp;
	let best = null, bd = Infinity;
	for ( const h of g.hazards.items ) {

		if ( h.spent ) continue;
		const dy = h.y - lp.y, dx = h.x - lp.x;
		if ( dy < - 10 || dy > 140 || Math.abs( dx ) > 40 ) continue;
		const d = Math.hypot( dx, dy );
		if ( d < bd ) {

			bd = d;
			best = h;

		}

	}

	g.input.touchSteer = best ? ( best.x > lp.x ? - 1 : 1 ) : 0;

}

export async function run( v, tier, { dodge: doDodge = false, maxSec = 240, event = null, dt = 1 / 30, renderEvery = 4 } = {} ) {

	const g = window.__game, app = window.__app;
	if ( g.state !== 'hangar' ) {

		g.toHangar( true );
		await wait( 50 );

	}

	app.engine.stop();
	setTier( tier );
	g.selectVehicle( v );
	if ( g.vehicle !== v ) throw new Error( 'could not select ' + v );
	g.nextEvent = event;
	g.save.seen[ v ] = true;
	let res = null;
	const show = g.ui.showResults;
	g.ui.showResults = ( x ) => {

		res = x;
		show.call( g.ui, x );

	};
	g.launch();
	g.input.keys.add( 'Space' );
	const cam = app.camera;
	const P = cam.position.clone();
	let t = 0, off = 0, frames = 0, maxOff = 0, lastCoins = 0;
	const jumps = [];
	while ( t < maxSec && g.state !== 'results' ) {

		for ( let i = 0; i < 30 && g.state !== 'results'; i ++ ) {

			if ( doDodge && g.state === 'flight' ) dodge( g );
			g.update( dt );
			// (rendering every frame is slow in a hidden tab; the camera still updates every frame)
			if ( i % renderEvery === 0 ) app.frame( dt * renderEvery );
			else cam.updateMatrixWorld();
			t += dt;
			if ( g.state === 'flight' && ! g.photo ) {

				const lp = g.lp;
				P.set( lp.x, lp.y + g.model.height * 0.5, 0 ).project( cam );
				const o = Math.max( Math.abs( P.x ), Math.abs( P.y ) );
				maxOff = Math.max( maxOff, o );
				if ( o > 0.95 ) off ++;
				frames ++;
				const r = g.run;
				if ( r.coins - lastCoins > 0 ) jumps.push( [ r.coins - lastCoins, Math.round( r.time ), r.zone ] );
				lastCoins = r.coins;

			}

		}

		await wait( 0 ); // fades and timers

	}

	g.input.keys.delete( 'Space' );
	g.input.touchSteer = 0;
	const r = g.run;
	if ( g.state === 'flight' ) g.endRun( 'fuel' );
	g.ui.showResults = show;
	jumps.sort( ( a, b ) => b[ 0 ] - a[ 0 ] );
	const out = {
		v, tier, state: g.state, end: r.endReason, h: g.realH(), maxH: r.maxH, time: Math.round( r.time ), pay: res ? res.total : 0, lines: res ? res.lines.map( ( [ k, x ] ) => k.slice( 0, 18 ) + ' ' + Math.round( x ) ).join( ' | ' ) : '',
		coins: r.coins, coinCount: r.coinCount, hits: r.hits, hull: Math.round( g.s.hull ), near: r.nearMisses, rings: r.rings || 0, chains: r.chains || 0,
		offscreen: frames ? ( off / frames ).toFixed( 3 ) : '-', maxOff: maxOff.toFixed( 2 ), biggest: jumps.slice( 0, 4 ),
	};
	await wait( 0 );
	g.toHangar( true );
	return out;

}
