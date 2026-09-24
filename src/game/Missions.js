// Missions: three standing objectives for the current vehicle, Jetpack Joyride style. Completed ones
// pay out on the results screen and are replaced back on the pad. Targets scale with the player's
// best for the vehicle; rewards scale with what a good run of that vehicle pays.

import { altitudePay, formatAltitude } from './Zones.js';

// per vehicle: the smallest reach / no-hit targets, how far past the best a reach mission asks, the
// smallest reward
const V = {
	balloon: { reach: 150, nohit: 100, k: 1.25, pay: 60 },
	rocket: { reach: 30000, nohit: 20000, k: 1.25, pay: 3000 },
	starship: { reach: 1e9, nohit: 1e8, k: 4, pay: 60000 },
	warpship: { reach: 5e16, nohit: 3e16, k: 3, pay: 5e6 },
	ark: { reach: 3e21, nohit: 2e21, k: 3, pay: 3e8 },
};

const TEMPLATES = [
	{ type: 'reach', weight: 3, make: ( ctx ) => {

		const t = niceNumber( Math.max( V[ ctx.v ].reach, ctx.best * V[ ctx.v ].k ) );
		return { target: t, text: `Reach ${ formatAltitude( t ) } in one run`, k: 1.2 };

	} },
	{ type: 'coins', weight: 3, make: ( ctx ) => {

		const n = [ 15, 25, 40, 60, 90 ][ Math.min( 4, ctx.tier ) ];
		return { target: n, text: `Collect ${ n } coins in one run`, k: 0.8 };

	} },
	{ type: 'nohit', weight: 2, make: ( ctx ) => {

		const t = niceNumber( Math.max( V[ ctx.v ].nohit, ctx.best * 0.6 ) );
		return { target: t, text: `Reach ${ formatAltitude( t ) } without a scratch`, k: 1.1 };

	} },
	{ type: 'nearmiss', weight: 2, make: ( ctx ) => {

		const n = 2 + Math.min( 5, ctx.tier );
		return { target: n, text: `Pull off ${ n } close calls in one run`, k: 0.9 };

	} },
	{ type: 'combo', weight: 2, make: ( ctx ) => {

		const n = [ 8, 12, 18, 25, 32 ][ Math.min( 4, ctx.tier ) ];
		return { target: n, text: `Chain a ${ n }-coin combo`, k: 0.8 };

	} },
	{ type: 'orbs', weight: 1, make: () => ( { target: 2, text: 'Grab 2 power orbs in one run', k: 0.7 } ) },
	{ type: 'fuel', weight: 1, vehicles: [ 'balloon', 'rocket' ], make: () => ( { target: 2, text: 'Pick up 2 fuel cans in one run', k: 0.6 } ) },
	{ type: 'bags', weight: 1, vehicles: [ 'balloon' ], need: ( ctx ) => ctx.bags >= 2, make: ( ctx ) => ( { target: Math.min( 3, ctx.bags ), text: `Drop ${ Math.min( 3, ctx.bags ) } sandbags in one run`, k: 0.5 } ) },
	{ type: 'land', weight: 1, vehicles: [ 'balloon' ], make: () => ( { target: 1, text: 'Land on the island, not in the sea', k: 0.7 } ) },
	{ type: 'night', weight: 1, make: () => ( { target: 1, text: 'Fly a run at night', k: 0.6 } ) },
	{ type: 'rescue', weight: 2, vehicles: [ 'rocket', 'starship' ], make: () => ( { target: 1, text: 'Rescue a stranded astronaut', k: 1 } ) },
	{ type: 'rings', weight: 3, make: ( ctx ) => {

		const n = [ 6, 10, 15, 20, 26 ][ Math.min( 4, ctx.tier ) ];
		return { target: n, text: `Fly through ${ n } ${ [ 'balloon', 'rocket' ].includes( ctx.v ) ? 'sky hoops' : 'warp rings' } in one run`, k: 0.9 };

	} },
	{ type: 'chains', weight: 2, make: ( ctx ) => {

		const n = Math.min( 4, 1 + Math.floor( ctx.tier / 2 ) );
		return { target: n, text: n > 1 ? `Complete ${ n } ring chains in one run` : 'Complete a whole ring chain', k: 1 };

	} },
	{ type: 'jumps', weight: 2, vehicles: [ 'warpship', 'ark' ], need: ( ctx ) => ctx.jumps >= 2, make: ( ctx ) => ( { target: ctx.jumps, text: `Hyperjump ${ ctx.jumps } times in one run`, k: 0.7 } ) },
	{ type: 'shieldblock', weight: 1, need: ( ctx ) => ctx.shield > 0, make: () => ( { target: 1, text: 'Let your bubble absorb a hit', k: 0.5 } ) },
];

function niceNumber( x ) {

	const p = Math.pow( 10, Math.floor( Math.log10( x ) ) );
	const m = x / p;
	return ( m < 1.5 ? 1.5 : m < 2 ? 2 : m < 2.5 ? 2.5 : m < 3 ? 3 : m < 5 ? 5 : m < 7.5 ? 7.5 : 10 ) * p;

}

function payOf( ctx ) {

	return Math.max( V[ ctx.v ].pay, altitudePay( Math.max( ctx.best, 100 ) ) );

}

let _id = 1;

export function newMission( ctx, exclude = [] ) {

	const opts = TEMPLATES.filter( ( t ) => ! exclude.includes( t.type ) && ( ! t.vehicles || t.vehicles.includes( ctx.v ) ) && ( ! t.need || t.need( ctx ) ) );
	let total = opts.reduce( ( a, t ) => a + t.weight, 0 );
	let r = Math.random() * total;
	let tpl = opts[ 0 ];
	for ( const t of opts ) if ( ( r -= t.weight ) <= 0 ) {

		tpl = t;
		break;

	}

	const m = tpl.make( ctx );
	total = 0;
	return { id: Date.now() + '-' + ( _id ++ ), type: tpl.type, vehicle: ctx.v, target: m.target, text: m.text, reward: Math.round( payOf( ctx ) * m.k / 10 ) * 10, progress: 0, done: false };

}

// fill the vehicle's slate up to three (keeps unfinished ones)
export function refreshMissions( save, ctx ) {

	save.missions = save.missions || {};
	const list = ( save.missions[ ctx.v ] || [] ).filter( ( m ) => ! m.done );
	while ( list.length < 3 ) list.push( newMission( ctx, list.map( ( m ) => m.type ) ) );
	save.missions[ ctx.v ] = list;
	return list;

}

// progress of a mission from the finished (or ongoing) run
export function missionProgress( m, run ) {

	switch ( m.type ) {

		case 'reach': return run.maxH;
		case 'coins': return run.coinCount;
		case 'nohit': return run.hits === 0 ? run.maxH : run.maxHBeforeHit || 0;
		case 'nearmiss': return run.nearMisses;
		case 'combo': return run.bestCombo;
		case 'orbs': return run.orbs;
		case 'fuel': return run.fuelCans;
		case 'bags': return run.bags;
		case 'land': return run.endReason === 'landed' ? 1 : 0;
		case 'night': return run.timeOfDay === 'night' ? 1 : 0;
		case 'rescue': return run.astronauts;
		case 'shieldblock': return run.blocked;
		case 'rings': return run.rings || 0;
		case 'chains': return run.chains || 0;
		case 'jumps': return run.jumps || 0;

	}

	return 0;

}
