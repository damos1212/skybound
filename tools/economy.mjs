// Simulates a whole playthrough with a simple player: fly the best unlocked vehicle, bank the pay,
// unlock the next vehicle as soon as allowed, otherwise buy the cheapest upgrade that fits. Prints
// when each milestone is reached (runs and play time). Pickups are approximated: a steady trickle
// of coins worth the current zone's coin value, and no fuel pickups (a conservative player).
import { computeStats, UPGRADES, VEHICLES, defaultLevels } from '../src/game/Upgrades.js';
import { createState, step, createRocketState, stepRocket } from '../src/game/Physics.js';
import { ZONES, zoneAt, altitudePay, formatAltitude, formatMoney } from '../src/game/Zones.js';
import { flyShip } from './shipsim.mjs';

const COINS_PER_SECOND = Number( process.argv[ 2 ] || 0.9 );

function fly( levels, v ) {

	const st = computeStats( levels, v );
	const dt = 1 / 30;
	let t = 0, coins = 0;
	const zonesSeen = new Set();
	const track = ( h ) => {

		const z = zoneAt( h );
		zonesSeen.add( z.id );
		coins += COINS_PER_SECOND * z.coin * dt;

	};

	if ( v === 'balloon' ) {

		const s = createState( st );
		s.y = 3;
		while ( t < 900 ) {

			step( s, st, { burn: true }, dt, 3 ); t += dt; track( s.y );
			if ( s.fuel <= 0 && s.vy < - 1 && t > 3 ) break;

		}

		return { h: s.maxY, t, coins, zones: zonesSeen };

	}

	if ( v === 'rocket' ) {

		const s = createRocketState( st );
		let real = 0;
		while ( t < 4000 ) {

			// coasting is time-warped in the game (x up to 40)
			const warp = s.fuel <= 0 && ! s.boosters && s.vy > 60 && s.y > 30000 ? Math.min( 40, s.vy / 50 ) : 1;
			stepRocket( s, st, { burn: true }, dt * warp, 0 ); t += dt * warp; real += dt; track( s.y );
			if ( s.fuel <= 0 && s.vy < 0 && t > 2 ) break;

		}

		return { h: s.maxY, t: real, coins, zones: zonesSeen };

	}

	void st;
	const r = flyShip( levels, v, { onStep: ( s ) => track( s.d ) } );
	return { h: r.h, t: r.t + 8, coins, zones: zonesSeen, end: r.end };

}

const save = { cash: 0, levels: defaultLevels(), unlocked: [ 'balloon' ], zones: new Set( [ 'shore' ] ), best: { balloon: 0, rocket: 0, starship: 0, warpship: 0, ark: 0 } };
let runs = 0, time = 0;
const milestones = [];
const seen = new Set();
const note = ( what ) => {

	if ( seen.has( what ) ) return;
	seen.add( what );
	milestones.push( `run ${ String( runs ).padStart( 3 ) }  ${ ( time / 60 ).toFixed( 0 ).padStart( 4 ) } min  ${ what }` );

};

while ( runs < 600 ) {

	const v = save.unlocked[ save.unlocked.length - 1 ];
	const r = fly( save.levels, v );
	runs ++;
	time += r.t + 25; // + time in menus
	let pay = altitudePay( r.h ) + r.coins;
	for ( const z of r.zones ) {

		if ( ! save.zones.has( z ) ) {

			save.zones.add( z );
			pay += ZONES.find( ( q ) => q.id === z ).bonus;
			note( `reached ${ ZONES.find( ( q ) => q.id === z ).name } (${ v })` );

		}

	}

	if ( r.h > save.best[ v ] && save.best[ v ] > 0 ) pay += Math.max( 0, altitudePay( r.h ) - altitudePay( save.best[ v ] ) ) * 0.25;
	save.best[ v ] = Math.max( save.best[ v ], r.h );
	save.cash += pay;
	if ( r.end === 'victory' ) {

		note( 'WON' );
		break;

	}

	// shopping
	for ( let guard = 0; guard < 50; guard ++ ) {

		const next = VEHICLES.find( ( x ) => ! save.unlocked.includes( x.id ) );
		if ( next && save.zones.has( next.unlock.zone ) ) {

			if ( save.cash >= next.unlock.cost ) {

				save.cash -= next.unlock.cost;
				save.unlocked.push( next.id );
				note( `unlocked ${ next.name }` );
				continue;

			}

			break; // saving up for it

		}

		const cur = save.unlocked[ save.unlocked.length - 1 ];
		let best = null;
		for ( const u of UPGRADES[ cur ] ) {

			const lv = save.levels[ cur ][ u.id ];
			const nx = u.levels[ lv + 1 ];
			if ( nx && ( ! best || nx.cost < best.cost ) ) best = { id: u.id, cost: nx.cost };

		}

		if ( ! best || best.cost > save.cash ) break;
		save.cash -= best.cost;
		save.levels[ cur ][ best.id ] ++;

	}

	if ( runs % 10 === 0 ) milestones.push( `         … run ${ runs }: ${ save.unlocked.at( -1 ) } best ${ formatAltitude( save.best[ save.unlocked.at( -1 ) ] ) }, cash ${ formatMoney( save.cash ) }` );

}

console.log( milestones.join( '\n' ) );
console.log( `\n${ runs } runs, ~${ ( time / 60 ).toFixed( 0 ) } min` );
