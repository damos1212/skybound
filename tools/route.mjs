// Prints the route: legs, zones, and what is on screen (angular radius and direction in the view
// frame: +x right, +y up the screen, -z into the screen) at points along each approach.
// node tools/route.mjs [firstLeg]
import { LEGS, BODIES, ROUTE_LENGTH, routeAt, toWorld, sub, norm, len } from '../src/game/Route.js';
import { ZONES, formatAltitude } from '../src/game/Zones.js';

const first = Number( process.argv[ 2 ] || 0 );
const deg = ( r ) => ( r * 180 / Math.PI ).toFixed( 1 );
if ( ! first ) {

	console.log( 'route length', formatAltitude( ROUTE_LENGTH * 1000 ) );
	console.log( ZONES.map( ( z ) => `${ z.id } ${ formatAltitude( z.from ) }` ).join( ' | ' ) );

}

for ( let i = first; i < LEGS.length; i ++ ) {

	const leg = LEGS[ i ];
	console.log( `\n== ${ i } ${ leg.body.name }: leg ${ formatAltitude( leg.length * 1000 ) }` );
	const R = leg.body.R;
	const win = ( leg.body.slow || [ 24, 3.2 ] )[ 0 ];
	for ( const off of [ - win * 4, - win, 0, win ] ) {

		const s = leg.start + leg.length + off * R;
		const r = routeAt( s );
		const vis = [];
		for ( const b of BODIES ) {

			const d = sub( b.pos, r.pos );
			const dist = len( d );
			const ang = Math.asin( Math.min( 1, b.R / Math.max( dist, b.R ) ) );
			if ( ang < 0.005 ) continue;
			const w = toWorld( norm( d ), r );
			vis.push( { ang, t: `${ b.id } ${ deg( ang ) }° [${ w.map( ( x ) => x.toFixed( 2 ) ).join( ' ' ) }]` } );

		}

		vis.sort( ( a, b ) => b.ang - a.ang );
		console.log( `  ${ String( off ).padStart( 6 ) }R: ${ vis.slice( 0, 5 ).map( ( v ) => v.t ).join( ' | ' ) }` );

	}

}
