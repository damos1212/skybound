// Missions: three standing objectives for the current vehicle, Jetpack Joyride style. Completed ones
// pay out on the results screen and are replaced back on the pad. Targets scale with the player's
// best for the vehicle; rewards scale with what a good run of that vehicle pays.

import { altitudePay, formatAltitude } from './Zones.js';

const TEMPLATES = [
	{ type: 'reach', weight: 3, make: ( ctx ) => {

		const t = niceNumber( Math.max( ctx.v === 'starship' ? 1e9 : ctx.v === 'rocket' ? 30000 : 150, ctx.best * ( ctx.v === 'starship' ? 4 : 1.25 ) ) );
		return { target: t, text: `Reach ${ formatAltitude( t ) } in one run`, k: 1.2 };

	} },
	{ type: 'coins', weight: 3, make: ( ctx ) => {

		const n = [ 15, 25, 40, 60, 90 ][ Math.min( 4, ctx.tier ) ];
		return { target: n, text: `Collect ${ n } coins in one run`, k: 0.8 };

	} },
	{ type: 'nohit', weight: 2, make: ( ctx ) => {

		const t = niceNumber( Math.max( ctx.v === 'starship' ? 1e8 : ctx.v === 'rocket' ? 20000 : 100, ctx.best * 0.6 ) );
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
	{ type: 'shieldblock', weight: 1, need: ( ctx ) => ctx.shield > 0, make: () => ( { target: 1, text: 'Let your bubble absorb a hit', k: 0.5 } ) },
];

function niceNumber( x ) {

	const p = Math.pow( 10, Math.floor( Math.log10( x ) ) );
	const m = x / p;
	return ( m < 1.5 ? 1.5 : m < 2 ? 2 : m < 2.5 ? 2.5 : m < 3 ? 3 : m < 5 ? 5 : m < 7.5 ? 7.5 : 10 ) * p;

}

function payOf( ctx ) {

	return Math.max( ctx.v === 'starship' ? 60000 : ctx.v === 'rocket' ? 3000 : 60, altitudePay( Math.max( ctx.best, 100 ) ) );

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

	}

	return 0;

}
