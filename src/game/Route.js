// The route of the space vehicles: from low Earth orbit through the solar system, out to other
// stars and nebulae, the heart of the Milky Way, and on across the Local Group, the great clusters
// and the cosmic web to the edge of the observable universe.
//
// Positions are in km in a heliocentric-ish frame whose axes match the game world at the start (the
// launch island's up is +y, the camera looks toward -z). The route is a polyline of flyby points:
// the ship travels up the screen (+y of the game world) along the current leg, and the backdrop is
// the universe seen from its position in that leg's frame (+y = the leg's direction, +z = from the
// next body toward its flyby point, so each body passes behind the gameplay plane, in view).
// Frames blend at each flyby like a slingshot turn.
//
// Bodies on the route have a `flyby` distance (in their radii) and a slow-motion window `slow`
// ([ half width, rate ] in radii and radii per second). Other bodies (companion stars, sibling
// planets, satellite galaxies) sit near a route body: `near: [ id, along, side, back ]` places them in
// that flyby's frame, in the route body's radii.

const AU = 1.496e8; // km
const LY = 9.4607e12; // km

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

const S = mul( SUN_DIR, AU );
const ly = ( x, y, z ) => add( S, [ x * LY, y * LY, z * LY ] );

export const SUN = { id: 'sun', R: 696000, pos: S };

// Sky.js body types
export const T = { moon: 1, mars: 2, jupiter: 3, saturn: 4, neptune: 5, earth: 7, blackhole: 8, kuiper: 9, star: 10, planet: 11, nebula: 12, pulsar: 13, galaxy: 14, cluster: 15, quasar: 16, edge: 18 };

// the galactic centre and the Milky Way's disc
const GC = add( S, [ 3e15, 2.6e17, - 1e15 ] );
const MW_NORMAL = norm( [ 1, 0.05, 0.45 ] );
const MW_T = norm( sub( [ 0, 1, 0 ], mul( MW_NORMAL, MW_NORMAL[ 1 ] ) ) );
const gc = ( x, y, z ) => add( GC, [ x * LY, y * LY, z * LY ] );
// above the Milky Way's disc (n light years) and along it (t)
const halo = ( n, t ) => add( GC, add( mul( MW_NORMAL, n * LY ), mul( MW_T, t * LY ) ) );

// colours are linear rgb; stars carry a luminosity and a surface brightness (Sun = 1) and a heat factor
// for the ship
export const BODIES = [
	// ---- the solar system (the Sun is a star: the key light while it is the brightest)
	{ id: 'earth', name: 'Earth', type: T.earth, R: 6371, pos: [ 0, 0, 0 ] },
	{ id: 'moon', name: 'The Moon', type: T.moon, R: 1737, pos: [ 0, 390771, - 8 * 1737 ], flyby: 8 },
	{ id: 'mars', name: 'Mars', type: T.mars, R: 3390, pos: [ 1.5e7, 7.6e7, - 1.0e7 ], flyby: 8 },
	{ id: 'sun', name: 'The Sun', type: T.star, R: 696000, pos: S, flyby: 5, star: true, lum: 1, surf: 1, color: [ 1, 0.96, 0.9 ], heat: 1 },
	{ id: 'jupiter', name: 'Jupiter', type: T.jupiter, R: 69911, pos: add( S, [ 4.0e8, 6.0e8, 1.0e8 ] ), flyby: 5 },
	{ id: 'saturn', name: 'Saturn', type: T.saturn, R: 58232, pos: add( S, [ 2.0e8, 1.2e9, - 0.5e8 ] ), flyby: 6, tilt: 0.45 },
	{ id: 'neptune', name: 'Neptune', type: T.neptune, R: 24622, pos: add( S, [ 8.0e8, 4.1e9, 2.5e8 ] ), flyby: 7 },
	{ id: 'kuiper', name: 'Pluto', type: T.kuiper, R: 1188, pos: add( S, [ 1.2e9, 5.5e9, 0.5e8 ] ), flyby: 8 },

	// ---- the neighbourhood: other stars
	{ id: 'alphacen', name: 'Alpha Centauri', type: T.star, R: 8.5e5, pos: ly( 0.4, 4.3, - 0.5 ), flyby: 6, slow: [ 14, 3 ], star: true, lum: 1.5, surf: 1, color: [ 1, 0.93, 0.8 ], heat: 0.8 },
	{ id: 'alphacenB', name: 'Alpha Centauri B', type: T.star, R: 6e5, near: [ 'alphacen', - 4000, 1500, 2500 ], star: true, lum: 0.5, surf: 0.5, color: [ 1, 0.78, 0.5 ], heat: 0.8 },
	{ id: 'proxima', name: 'Proxima Centauri', type: T.star, R: 1.07e5, near: [ 'alphacen', 1.2e6, - 8e5, 1.6e6 ], star: true, lum: 0.0017, surf: 0.04, color: [ 1, 0.42, 0.22 ] },
	{ id: 'trappist', name: 'TRAPPIST-1e', type: T.planet, style: 0, R: 5850, pos: ly( - 2, 40, 1.5 ), flyby: 5, slow: [ 16, 3.2 ], sun: 'trappistStar', color: [ 0.3, 0.55, 0.9 ] },
	{ id: 'trappistStar', name: 'TRAPPIST-1', type: T.star, R: 8.4e4, near: [ 'trappist', 22, - 8, 420 ], star: true, lum: 0.0006, surf: 0.03, color: [ 1, 0.38, 0.16 ], heat: 0 },
	{ id: 'trappistB', name: 'TRAPPIST-1b', type: T.planet, style: 1, R: 7100, near: [ 'trappist', - 14, 2.5, 4 ], sun: 'trappistStar' },
	{ id: 'trappistC', name: 'TRAPPIST-1c', type: T.planet, style: 3, R: 7000, near: [ 'trappist', - 9, - 3.2, 6 ], sun: 'trappistStar' },
	{ id: 'trappistD', name: 'TRAPPIST-1d', type: T.planet, style: 4, R: 5000, near: [ 'trappist', - 4.5, 3.5, 3 ], sun: 'trappistStar' },
	{ id: 'trappistF', name: 'TRAPPIST-1f', type: T.planet, style: 2, R: 6700, near: [ 'trappist', 5, - 3, 5 ], sun: 'trappistStar' },
	{ id: 'trappistG', name: 'TRAPPIST-1g', type: T.planet, style: 2, R: 7300, near: [ 'trappist', 10, 3.8, 7 ], sun: 'trappistStar' },
	{ id: 'trappistH', name: 'TRAPPIST-1h', type: T.planet, style: 5, R: 4900, near: [ 'trappist', 15, - 2, 4 ], sun: 'trappistStar' },
	{ id: 'betelgeuse', name: 'Betelgeuse', type: T.star, style: 1, R: 5.3e8, pos: ly( 15, 548, - 20 ), flyby: 2.6, slow: [ 7, 1.3 ], star: true, lum: 90000, surf: 0.025, color: [ 1, 0.45, 0.2 ], heat: 0.55 },
	{ id: 'orion', name: 'Orion Nebula', type: T.nebula, style: 0, R: 12 * LY, pos: ly( - 40, 1340, 60 ), flyby: 0.45, slow: [ 1.6, 0.42 ], color: [ 1, 0.16, 0.4 ] },
	{ id: 'trapezium1', name: 'Theta-1 Orionis C', type: T.star, R: 7e6, near: [ 'orion', 0.02, - 0.06, 0.42 ], star: true, lum: 2e5, surf: 2, color: [ 0.7, 0.8, 1 ] },
	{ id: 'trapezium2', name: 'Theta-1 Orionis A', type: T.star, R: 4e6, near: [ 'orion', - 0.01, - 0.03, 0.46 ], star: true, lum: 4e4, surf: 2, color: [ 0.75, 0.85, 1 ] },
	{ id: 'trapezium3', name: 'Theta-1 Orionis D', type: T.star, R: 4e6, near: [ 'orion', 0.03, - 0.02, 0.4 ], star: true, lum: 3e4, surf: 2, color: [ 0.78, 0.86, 1 ] },
	{ id: 'crab', name: 'Crab Nebula', type: T.nebula, style: 1, R: 5.5 * LY, pos: ly( 120, 6500, - 300 ), flyby: 0.42, slow: [ 1.5, 0.4 ], color: [ 1, 0.5, 0.2 ] },
	{ id: 'pulsar', name: 'Crab Pulsar', type: T.pulsar, R: 0.9 * LY, near: [ 'crab', 0, 0, 0.42 ], color: [ 0.7, 0.85, 1 ] },
	{ id: 'blackhole', name: 'Sagittarius A*', type: T.blackhole, R: 1.2e7, pos: GC, flyby: 24, slow: [ 16, 3.2 ] },

	// ---- beyond the Milky Way
	{ id: 'milkyway', name: 'The Milky Way', type: T.galaxy, style: 1, R: 52000 * LY, pos: GC, normal: MW_NORMAL, color: [ 1, 0.85, 0.65 ], outside: true },
	{ id: 'omegacen', name: 'Omega Centauri', type: T.cluster, style: 1, R: 90 * LY, pos: halo( 40000, 0 ), flyby: 0.7, slow: [ 2.2, 0.6 ], color: [ 1, 0.85, 0.6 ] },
	{ id: 'lmc', name: 'Large Magellanic Cloud', type: T.galaxy, style: 2, R: 7000 * LY, pos: halo( 40000, 120000 ), flyby: 1.6, slow: [ 3.2, 0.9 ], side: MW_NORMAL, normal: norm( [ 0.2, 0.6, 0.77 ] ), color: [ 0.8, 0.85, 1 ] },
	{ id: 'smc', name: 'Small Magellanic Cloud', type: T.galaxy, style: 2, R: 3500 * LY, near: [ 'lmc', 3, 2.5, 4 ], normal: norm( [ 0.5, 0.2, 0.84 ] ), color: [ 0.8, 0.85, 1 ] },
	{ id: 'andromeda', name: 'Andromeda', type: T.galaxy, style: 0, R: 110000 * LY, pos: gc( 900000, 2200000, 800000 ), flyby: 2.4, slow: [ 3.5, 0.9 ], normal: norm( [ 0.25, 0.55, 0.8 ] ), color: [ 1, 0.85, 0.7 ] },
	{ id: 'm32', name: 'M32', type: T.galaxy, style: 3, R: 4000 * LY, near: [ 'andromeda', 0.3, 0.4, 0.2 ], color: [ 1, 0.85, 0.65 ] },
	{ id: 'm110', name: 'M110', type: T.galaxy, style: 3, R: 9000 * LY, near: [ 'andromeda', - 0.6, - 0.7, 0.4 ], color: [ 1, 0.87, 0.7 ] },
	{ id: 'triangulum', name: 'Triangulum', type: T.galaxy, style: 0, R: 30000 * LY, near: [ 'andromeda', - 5, 3.5, 3 ], normal: norm( [ - 0.3, 0.2, 0.93 ] ), color: [ 0.85, 0.9, 1 ] },
	{ id: 'virgo', name: 'Virgo Cluster', type: T.cluster, style: 0, R: 7e6 * LY, pos: gc( 12e6, 50e6, - 15e6 ), flyby: 0.55, slow: [ 1.4, 0.4 ], color: [ 1, 0.9, 0.75 ] },
	{ id: 'm87', name: 'M87', type: T.quasar, style: 1, R: 1.2e6 * LY, near: [ 'virgo', 0.05, - 0.08, 0.55 ], normal: norm( [ 0.7, 0.5, 0.2 ] ), color: [ 0.7, 0.8, 1 ] },
	{ id: 'laniakea', name: 'The Great Attractor', type: T.cluster, style: 2, R: 60e6 * LY, pos: gc( - 60e6, 240e6, 40e6 ), flyby: 0.5, slow: [ 1.3, 0.38 ], color: [ 0.85, 0.75, 1 ] },
	{ id: 'quasar', name: '3C 273', type: T.quasar, style: 0, R: 1.5e6 * LY, pos: gc( 0.5e9, 2.3e9, - 0.4e9 ), flyby: 2.2, slow: [ 3.5, 0.9 ], normal: norm( [ 0.9, 0.25, 0.3 ] ), color: [ 0.65, 0.75, 1 ] },
	{ id: 'elgordo', name: 'El Gordo', type: T.cluster, style: 0, R: 12e6 * LY, pos: gc( - 1.5e9, 6.8e9, 1e9 ), flyby: 0.6, slow: [ 1.4, 0.42 ], color: [ 1, 0.8, 0.7 ] },
	{ id: 'edge', name: 'The Edge', type: T.edge, R: 1e8 * LY, pos: gc( 3e9, 46.3e9, - 2e9 ), flyby: 0, slow: [ 40, 12 ] },
];

export const BODY_BY_ID = Object.fromEntries( BODIES.map( ( b ) => [ b.id, b ] ) );
const ROUTE = BODIES.filter( ( b ) => b.id === 'earth' || b.flyby !== undefined );

// flyby points: the body plus flyby × R, perpendicular to the incoming leg, toward the camera side
const START = [ 0, 6371, 0 ];
const POINTS = [ START ];
for ( let i = 1; i < ROUTE.length; i ++ ) {

	const b = ROUTE[ i ];
	const prev = POINTS[ i - 1 ];
	const inDir = norm( sub( b.pos, prev ) );
	// a side vector: toward +z (or the body's own `side`), made perpendicular to the incoming direction
	const want = b.side || [ 0, 0, 1 ];
	let side = sub( want, mul( inDir, dot( want, inDir ) ) );
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
	const body = ROUTE[ i + 1 ];
	let ez = sub( b, body.pos );
	if ( len( ez ) < 1e-9 ) ez = [ 0, 0, 1 ];
	ez = norm( sub( ez, mul( ey, dot( ez, ey ) ) ) );
	const ex = cross( ey, ez );
	LEGS.push( { from: a, to: b, start: acc, length: L, ex, ey, ez, body } );
	body.leg = i;
	body.at = acc + L;
	acc += L;

}

export const ROUTE_LENGTH = acc;

// place the companions in their route body's flyby frame
for ( const b of BODIES ) {

	if ( ! b.near ) continue;
	const [ id, along, side, back ] = b.near;
	const p = BODY_BY_ID[ id ];
	const leg = LEGS[ p.leg ];
	b.pos = add( add( add( p.pos, mul( leg.ey, along * p.R ) ), mul( leg.ex, side * p.R ) ), mul( leg.ez, - back * p.R ) );

}

// zones: each route body's zone starts on the last quarter of its approach
const Z = ( id, name, bonus, coin, color, tagline, frac = 0.75 ) => {

	const b = BODY_BY_ID[ id ];
	const leg = LEGS[ b.leg ];
	return { id, name, from: ( leg.start + leg.length * ( b.leg === 0 ? 0.8 : frac ) ) * 1000, bonus, coin, color, tagline, body: id, space: true };

};

// a zone that starts partway along a leg (km past its start)
const ZA = ( id, name, legOf, km, bonus, coin, color, tagline ) => {

	const leg = LEGS[ BODY_BY_ID[ legOf ].leg ];
	return { id, name, from: ( leg.start + km ) * 1000, bonus, coin, color, tagline, space: true };

};

export const ROUTE_ZONES = [
	Z( 'moon', 'The Moon', 150000, 800, '#bfc2c8', 'Grey dust and a long way home' ),
	Z( 'mars', 'Mars', 300000, 1200, '#d9763f', 'Rust, dust storms and two tiny moons' ),
	Z( 'sun', 'The Sun', 500000, 1800, '#ffcf3f', 'Solar flares! Mind the heat' ),
	Z( 'jupiter', 'Jupiter', 700000, 2500, '#d8b48a', 'The king of planets' ),
	Z( 'saturn', 'Saturn', 900000, 3000, '#e6d2a0', 'Thread the rings' ),
	Z( 'neptune', 'Neptune', 1200000, 3600, '#4e6fe0', 'Supersonic winds, ice giants' ),
	Z( 'kuiper', 'Kuiper Belt', 1600000, 4200, '#a89a8a', 'Frozen worlds at the edge' ),
	ZA( 'interstellar', 'Interstellar Space', 'alphacen', 1.5e10, 2000000, 5000, '#2a1a4a', 'Past the heliopause, into the dark' ),
	Z( 'alphacen', 'Alpha Centauri', 3500000, 9000, '#ffe3a8', 'Two suns and a red dwarf' ),
	Z( 'trappist', 'TRAPPIST-1', 5000000, 13000, '#ff7a4a', 'Seven worlds around a red ember' ),
	Z( 'betelgeuse', 'Betelgeuse', 7500000, 18000, '#ff5a2a', 'A red supergiant about to blow' ),
	Z( 'orion', 'Orion Nebula', 11000000, 24000, '#ff5fa0', 'A stellar nursery of glowing gas' ),
	Z( 'crab', 'Crab Pulsar', 16000000, 32000, '#7fb8ff', 'Dodge the lighthouse beams' ),
	Z( 'blackhole', 'Sagittarius A*', 25000000, 42000, '#ff9a3c', 'The heart of the galaxy' ),
	ZA( 'halo', 'Galactic Halo', 'omegacen', 3000 * LY, 35000000, 55000, '#5a4a8a', 'Look back: the whole Milky Way' ),
	Z( 'omegacen', 'Omega Centauri', 45000000, 65000, '#ffd98a', 'Ten million stars in a ball' ),
	Z( 'lmc', 'Magellanic Clouds', 60000000, 80000, '#9fc4ff', 'Our galaxy\'s little neighbours' ),
	Z( 'andromeda', 'Andromeda', 90000000, 110000, '#ffcfa0', 'A trillion stars, on a collision course' ),
	Z( 'virgo', 'Virgo Cluster', 140000000, 150000, '#ffe8c0', 'A thousand galaxies and M87\'s jet' ),
	Z( 'laniakea', 'Laniakea', 210000000, 200000, '#b89aff', 'The Great Attractor pulls everything in' ),
	Z( 'quasar', 'Quasar 3C 273', 320000000, 270000, '#8fb0ff', 'Brighter than a trillion suns' ),
	Z( 'elgordo', 'The Cosmic Web', 480000000, 360000, '#7a5aff', 'Filaments of galaxies across the void' ),
	Z( 'edge', 'The Edge', 1000000000, 500000, '#ff8a3a', 'The oldest light there is', 0.8 ),
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

// route distance (m) of a body's flyby point
export function flybyDistance( id ) {

	return BODY_BY_ID[ id ].at * 1000;

}

// a world direction (game axes) from a route-frame vector
export function toWorld( v, frame ) {

	return [ dot( v, frame.ex ), dot( v, frame.ey ), dot( v, frame.ez ) ];

}

export { SUN_DIR, AU, LY, GC, norm, sub, add, mul, len, dot, cross };
