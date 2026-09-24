// The Starship's route through the solar system and out to the centre of the galaxy.
//
// Positions are in km in a heliocentric-ish frame whose axes match the game world at the start (the
// launch island's up is +y, the camera looks toward -z). The route is a polyline of flyby points:
// the ship travels up the screen (+y of the game world) along the current leg, and the backdrop is
// the solar system seen from its position in that leg's frame (+y = the leg's direction, +z = from
// the next body toward its flyby point, so each body passes behind the gameplay plane, in view).
// Frames blend at each flyby like a slingshot turn.

const AU = 1.496e8; // km

// the fixed sun direction of the ground scenes (elevation 24°, azimuth -52°) at 1 AU from the Earth
const SUN_DIR = ( () => {

	const el = 24 * Math.PI / 180, az = - 52 * Math.PI / 180;
	return [ Math.sin( az ) * Math.cos( el ), Math.sin( el ), - Math.cos( az ) * Math.cos( el ) ];

} )();

const add = ( a, b ) => [ a[ 0 ] + b[ 0 ], a[ 1 ] + b[ 1 ], a[ 2 ] + b[ 2 ] ];
const sub = ( a, b ) => [ a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] ];
const mul = ( a, s ) => [ a[ 0 ] * s, a[ 1 ] * s, a[ 2 ] * s ];
const dot = ( a, b ) => a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ];
const len = ( a ) => Math.sqrt( dot( a, a ) );
const norm = ( a ) => mul( a, 1 / ( len( a ) || 1 ) );
const cross = ( a, b ) => [ a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ] ];

export const SUN = { id: 'sun', R: 696000, pos: mul( SUN_DIR, AU ) };

// type ids match Sky.js BODY
export const BODIES = [
	{ id: 'earth', name: 'Earth', type: 7, R: 6371, pos: [ 0, 0, 0 ] },
	{ id: 'moon', name: 'The Moon', type: 1, R: 1737, pos: [ 0, 390771, - 8 * 1737 ], flyby: 8 },
	{ id: 'mars', name: 'Mars', type: 2, R: 3390, pos: [ 1.5e7, 7.6e7, - 1.0e7 ], flyby: 8 },
	{ id: 'sun', name: 'The Sun', type: 6, R: 696000, pos: SUN.pos, flyby: 5 },
	{ id: 'jupiter', name: 'Jupiter', type: 3, R: 69911, pos: add( SUN.pos, [ 4.0e8, 6.0e8, 1.0e8 ] ), flyby: 5 },
	{ id: 'saturn', name: 'Saturn', type: 4, R: 58232, pos: add( SUN.pos, [ 2.0e8, 1.2e9, - 0.5e8 ] ), flyby: 6, tilt: 0.45 },
	{ id: 'neptune', name: 'Neptune', type: 5, R: 24622, pos: add( SUN.pos, [ 8.0e8, 4.1e9, 2.5e8 ] ), flyby: 7 },
	{ id: 'kuiper', name: 'Pluto', type: 9, R: 1188, pos: add( SUN.pos, [ 1.2e9, 5.5e9, 0.5e8 ] ), flyby: 8 },
	{ id: 'blackhole', name: 'Sagittarius A*', type: 8, R: 1.2e7, pos: add( SUN.pos, [ 3e15, 2.6e17, - 1e15 ] ), flyby: 24 },
];

// flyby points: the body plus flyby × R, perpendicular to the incoming leg, toward the camera side
const START = [ 0, 6371, 0 ];
const POINTS = [ START ];
for ( let i = 1; i < BODIES.length; i ++ ) {

	const b = BODIES[ i ];
	const prev = POINTS[ i - 1 ];
	const inDir = norm( sub( b.pos, prev ) );
	// a side vector: toward +z of the previous frame, made perpendicular to the incoming direction
	let side = sub( [ 0, 0, 1 ], mul( inDir, inDir[ 2 ] ) );
	if ( len( side ) < 1e-3 ) side = [ 1, 0, 0 ];
	side = norm( side );
	POINTS.push( add( b.pos, mul( side, b.flyby * b.R ) ) );

}

// legs: from POINTS[ i ] to POINTS[ i + 1 ], cumulative path length (km) from the Earth's surface
export const LEGS = [];
let acc = 0;
for ( let i = 0; i < POINTS.length - 1; i ++ ) {

	const a = POINTS[ i ], b = POINTS[ i + 1 ];
	const d = sub( b, a );
	const L = len( d );
	const ey = norm( d );
	const body = BODIES[ i + 1 ];
	let ez = sub( b, body.pos );
	ez = norm( sub( ez, mul( ey, dot( ez, ey ) ) ) );
	const ex = cross( ey, ez );
	LEGS.push( { from: a, to: b, start: acc, length: L, ex, ey, ez, body } );
	acc += L;

}

export const ROUTE_LENGTH = acc;

// space zones: each body's zone starts on the last fifth of the approach
const Z = ( id, name, i, bonus, coin, color, tagline ) => {

	const leg = LEGS[ i ];
	return { id, name, from: ( leg.start + leg.length * ( i === 0 ? 0.8 : 0.75 ) ) * 1000, bonus, coin, color, tagline, body: leg.body.id, space: true };

};

export const ROUTE_ZONES = [
	Z( 'moon', 'The Moon', 0, 400000, 2000, '#bfc2c8', 'Grey dust and a long way home' ),
	Z( 'mars', 'Mars', 1, 700000, 3500, '#d9763f', 'Rust, dust storms and two tiny moons' ),
	Z( 'sun', 'The Sun', 2, 1200000, 6000, '#ffcf3f', 'Solar flares! Mind the heat' ),
	Z( 'jupiter', 'Jupiter', 3, 1800000, 9000, '#d8b48a', 'The king of planets' ),
	Z( 'saturn', 'Saturn', 4, 2500000, 12000, '#e6d2a0', 'Thread the rings' ),
	Z( 'neptune', 'Neptune', 5, 3500000, 16000, '#4e6fe0', 'Supersonic winds, ice giants' ),
	Z( 'kuiper', 'Kuiper Belt', 6, 5000000, 22000, '#a89a8a', 'Frozen worlds at the edge' ),
	{ id: 'interstellar', name: 'Interstellar Space', from: ( LEGS[ 7 ].start + 1.5e10 ) * 1000, bonus: 8000000, coin: 30000, color: '#2a1a4a', tagline: 'Needs the Improbability Drive', space: true },
	Z( 'blackhole', 'Sagittarius A*', 7, 25000000, 50000, '#ff9a3c', 'The heart of the galaxy' ),
];

// leg index for a path distance (km)
export function legAt( s ) {

	for ( let i = LEGS.length - 1; i >= 0; i -- ) if ( s >= LEGS[ i ].start ) return i;
	return 0;

}

// position (km) and view frame at path distance s (km). The frame blends from the previous leg's over
// the first 4% of a leg.
export function routeAt( s ) {

	s = Math.max( 0, Math.min( ROUTE_LENGTH, s ) );
	const i = legAt( s );
	const leg = LEGS[ i ];
	const t = ( s - leg.start ) / leg.length;
	const pos = add( leg.from, mul( sub( leg.to, leg.from ), t ) );
	let { ex, ey, ez } = leg;
	if ( i > 0 && t < 0.04 ) {

		const k = t / 0.04, w = k * k * ( 3 - 2 * k );
		const p = LEGS[ i - 1 ];
		const mix = ( a, b ) => norm( add( mul( a, 1 - w ), mul( b, w ) ) );
		ey = mix( p.ey, ey );
		ez = norm( sub( mix( p.ez, ez ), mul( ey, dot( mix( p.ez, ez ), ey ) ) ) );
		ex = cross( ey, ez );

	}

	return { pos, ex, ey, ez, leg: i, t };

}

// the flyby nearest to path distance s (km): the body and how far (km) from its flyby point, along
// the route, the ship is (negative: still approaching)
export function flybyAt( s ) {

	let best = null;
	for ( let i = 0; i < LEGS.length; i ++ ) {

		const at = LEGS[ i ].start + LEGS[ i ].length;
		const d = s - at;
		if ( ! best || Math.abs( d ) < Math.abs( best.offset ) ) best = { body: LEGS[ i ].body, offset: d };

	}

	return best;

}

// a world direction (game axes) from a route-frame vector
export function toWorld( v, frame ) {

	return [ dot( v, frame.ex ), dot( v, frame.ey ), dot( v, frame.ez ) ];

}

export { SUN_DIR, AU, norm, sub, len, dot };
