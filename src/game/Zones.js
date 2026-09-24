// The ladder from the beach to the edge of the observable universe. `from` is the distance travelled
// from the Earth's surface (m): straight up for the balloon and the rocket, along the space route (see
// Route.js) past the planets, other stars, the heart of the galaxy and the galaxies beyond.

import { ROUTE_ZONES } from './Route.js';

export const ZONES = [
	{ id: 'shore', name: 'Island Shores', from: 0, bonus: 0, coin: 2, color: '#6fd3c1', tagline: 'Gulls, kites and a sea breeze' },
	{ id: 'low', name: 'Low Skies', from: 300, bonus: 150, coin: 5, color: '#7cc4ff', tagline: 'Drones, gliders and seaplanes' },
	{ id: 'clouds', name: 'Cloud Deck', from: 1500, bonus: 600, coin: 10, color: '#e8eef6', tagline: 'Punch through the cumulus' },
	{ id: 'high', name: 'High Skies', from: 5000, bonus: 2500, coin: 25, color: '#4f8fe6', tagline: 'Airliners and the jet stream' },
	{ id: 'strato', name: 'Stratosphere', from: 12000, bonus: 8000, coin: 60, color: '#2a3f8f', tagline: 'Where the sky turns black' },
	{ id: 'meso', name: 'Edge of Space', from: 50000, bonus: 12000, coin: 120, color: '#1a1f45', tagline: 'Meteors and the aurora' },
	{ id: 'leo', name: 'Low Orbit', from: 100000, bonus: 30000, coin: 220, color: '#141a3c', tagline: 'Satellites and the space station' },
	{ id: 'meo', name: 'High Orbit', from: 2000000, bonus: 80000, coin: 400, color: '#10142f', tagline: 'Space junk and navigation satellites' },
	{ id: 'cislunar', name: 'Cislunar Space', from: 40000000, bonus: 100000, coin: 600, color: '#0d1026', tagline: 'Deep, quiet dark' },
	...ROUTE_ZONES,
];

export function zoneAt( h ) {

	for ( let i = ZONES.length - 1; i >= 0; i -- ) if ( h >= ZONES[ i ].from ) return ZONES[ i ];
	return ZONES[ 0 ];

}

export function zoneIndex( h ) {

	return ZONES.indexOf( zoneAt( h ) );

}

export function zoneById( id ) {

	return ZONES.find( ( z ) => z.id === id );

}

const LY = 9.4607e15;
const AU = 1.496e11;

export function formatAltitude( y ) {

	if ( y < 10000 ) return Math.round( y ).toLocaleString( 'en-US' ) + ' m';
	if ( y < 1e6 ) return ( y / 1000 ).toFixed( y < 100000 ? 2 : 1 ) + ' km';
	if ( y < 1e9 ) return Math.round( y / 1000 ).toLocaleString( 'en-US' ) + ' km';
	if ( y < 0.2 * AU ) return ( y / 1e9 ).toFixed( 1 ) + 'M km';
	if ( y < 0.1 * LY ) return ( y / AU ).toFixed( y < 10 * AU ? 2 : 1 ) + ' AU';
	if ( y < 1e7 * LY ) return ( y / LY ).toLocaleString( 'en-US', { maximumFractionDigits: y < 100 * LY ? 2 : 0 } ) + ' ly';
	if ( y < 1e9 * LY ) return ( y / LY / 1e6 ).toFixed( y < 1e8 * LY ? 1 : 0 ) + 'M ly';
	return ( y / LY / 1e9 ).toFixed( 2 ) + 'B ly';

}

export function formatSpeed( v ) {

	const c = 299792458;
	if ( v < 1000 ) return Math.round( v ) + ' m/s';
	if ( v < c * 0.01 ) return ( v / 1000 ).toFixed( v < 1e5 ? 1 : 0 ) + ' km/s';
	if ( v < c * 1000 ) return ( v / c ).toFixed( v < c ? 3 : 1 ) + ' c';
	return ( v / c ).toExponential( 1 ).replace( 'e+', '×10^' ) + ' c';

}

export function formatMoney( v ) {

	if ( v >= 1e12 ) return '$' + ( v / 1e12 ).toFixed( 2 ) + 'T';
	if ( v >= 1e9 ) return '$' + ( v / 1e9 ).toFixed( 2 ) + 'B';
	if ( v >= 1e7 ) return '$' + ( v / 1e6 ).toFixed( 1 ) + 'M';
	return '$' + Math.round( v ).toLocaleString( 'en-US' );

}

// cash for reaching h (m): linear low down, logarithmic once the numbers get astronomical, and
// growing again (x2.2 per factor of ten) beyond the solar system
const PAY_13 = 8000 + 90000 * Math.log10( 1e13 / 20000 );
export function altitudePay( h ) {

	if ( h <= 20000 ) return h * 0.4;
	if ( h <= 1e13 ) return 8000 + 90000 * Math.log10( h / 20000 );
	return PAY_13 * Math.pow( 2.2, Math.log10( h / 1e13 ) );

}
