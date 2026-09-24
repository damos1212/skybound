// Simulates runs for upgrade tiers: burn until empty, then coast; prints the peak altitude and time.
import { computeStats, UPGRADES } from '../src/game/Upgrades.js';
import { createState, step } from '../src/game/Physics.js';

function run( levels, policy = 'hold' ) {

	const stats = computeStats( levels );
	const s = createState( stats );
	s.y = 3;
	let t = 0;
	const dt = 1 / 60;
	while ( t < 900 ) {

		let burn = true;
		if ( policy === 'pulse' ) burn = s.heat < 0.98;
		step( s, stats, { burn, steer: 0 }, dt, 3 );
		t += dt;
		if ( s.fuel <= 0 && s.vy < -1 && t > 3 ) break;

	}

	return { peak: Math.round( s.maxY ), time: Math.round( t ), vmax: 0 };

}

const tiers = [ 0, 1, 2, 3, 4 ];
for ( const tier of tiers ) {

	const levels = Object.fromEntries( UPGRADES.map( ( u ) => [ u.id, Math.min( tier, u.levels.length - 1 ) ] ) );
	const cost = UPGRADES.reduce( ( a, u ) => a + u.levels.slice( 1, Math.min( tier, u.levels.length - 1 ) + 1 ).reduce( ( b, l ) => b + l.cost, 0 ), 0 );
	console.log( `tier ${ tier }: hold ${ JSON.stringify( run( levels ) ) } pulse ${ JSON.stringify( run( levels, 'pulse' ) ) }  cumulative cost $${ cost }` );

}
