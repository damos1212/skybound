// Simulates a run per upgrade tier for each vehicle (hold the throttle until empty, then coast)
// and prints how far it gets. The game adds pickups on top of this.
import { computeStats, UPGRADES, defaultLevels } from '../src/game/Upgrades.js';
import { createState, step, createRocketState, stepRocket, createShipState, stepShip } from '../src/game/Physics.js';
import { formatAltitude, formatSpeed, zoneAt } from '../src/game/Zones.js';

function levelsAt( tier ) {

	const L = defaultLevels();
	for ( const v in UPGRADES ) for ( const u of UPGRADES[ v ] ) L[ v ][ u.id ] = Math.min( tier, u.levels.length - 1 );
	L.starship.improbability = tier >= 5 ? 1 : 0;
	return L;

}

function simBalloon( L ) {

	const st = computeStats( L, 'balloon' ), s = createState( st );
	s.y = 3; let t = 0;
	while ( t < 900 ) {

		step( s, st, { burn: true }, 1 / 60, 3 ); t += 1 / 60;
		if ( s.fuel <= 0 && s.vy < - 1 && t > 3 ) break;

	}

	return { peak: s.maxY, time: t };

}

function simRocket( L ) {

	const st = computeStats( L, 'rocket' ), s = createRocketState( st );
	let t = 0, vmax = 0;
	while ( t < 4000 ) {

		stepRocket( s, st, { burn: true }, 1 / 30, 0 ); t += 1 / 30;
		vmax = Math.max( vmax, s.vy );
		if ( s.fuel <= 0 && s.vy < 0 && t > 2 ) break;

	}

	return { peak: s.maxY, time: t, vmax };

}

function simShip( L ) {

	const st = computeStats( L, 'starship' ), s = createShipState( st );
	let t = 0;
	while ( t < 400 ) {

		stepShip( s, st, { burn: true }, 1 / 30, 0 ); t += 1 / 30;
		if ( s.fuel <= 0 ) break;

	}

	return { peak: s.d * 1.02, time: t, vmax: s.v };

}

for ( let tier = 0; tier <= 5; tier ++ ) {

	const L = levelsAt( tier );
	const b = simBalloon( L ), r = simRocket( L ), s = simShip( L );
	console.log( `tier ${ tier }  balloon ${ formatAltitude( b.peak ).padEnd( 10 ) } ${ Math.round( b.time ) }s | rocket ${ formatAltitude( r.peak ).padEnd( 10 ) } ${ Math.round( r.time ) }s ${ formatSpeed( r.vmax ) } (${ zoneAt( r.peak ).id }) | ship ${ formatAltitude( s.peak ).padEnd( 10 ) } ${ Math.round( s.time ) }s ${ formatSpeed( s.vmax ) } (${ zoneAt( s.peak ).id })` );

}
