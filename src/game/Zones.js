// The altitude ladder. The balloon era reaches the stratosphere; the zones past it are teasers for
// the vehicles to come (rockets, landers, sails) and show on the ladder as locked.

export const ZONES = [
	{ id: 'shore', name: 'Island Shores', from: 0, to: 300, bonus: 0, color: '#6fd3c1', tagline: 'Gulls, kites and a sea breeze' },
	{ id: 'low', name: 'Low Skies', from: 300, to: 1500, bonus: 150, color: '#7cc4ff', tagline: 'Drones, gliders and seaplanes' },
	{ id: 'clouds', name: 'Cloud Deck', from: 1500, to: 5000, bonus: 600, color: '#e8eef6', tagline: 'Punch through the cumulus' },
	{ id: 'high', name: 'High Skies', from: 5000, to: 12000, bonus: 2500, color: '#4f8fe6', tagline: 'Airliners and the jet stream' },
	{ id: 'strato', name: 'Stratosphere', from: 12000, to: 50000, bonus: 8000, color: '#2a3f8f', tagline: 'Where the sky turns black' },
	{ id: 'space', name: 'Edge of Space', from: 50000, to: 100000, bonus: 20000, color: '#1a1f45', tagline: 'Needs rocket parts', locked: true },
	{ id: 'orbit', name: 'Orbit', from: 100000, to: 384000000, bonus: 50000, color: '#10132b', tagline: 'Satellites and space junk', locked: true },
	{ id: 'moon', name: 'The Moon', from: 384000000, to: 2.25e11, bonus: 1e5, color: '#bfc2c8', tagline: 'Coming soon', locked: true },
	{ id: 'mars', name: 'Mars', from: 2.25e11, to: 7.8e11, bonus: 2e5, color: '#d9763f', tagline: 'Coming soon', locked: true },
	{ id: 'jupiter', name: 'Jupiter', from: 7.8e11, to: 1.5e12, bonus: 5e5, color: '#d8b48a', tagline: 'Coming soon', locked: true },
	{ id: 'sun', name: 'The Sun', from: 1.5e12, to: Infinity, bonus: 1e6, color: '#ffcf3f', tagline: 'Bring sunscreen', locked: true },
];

export function zoneAt( y ) {

	for ( let i = ZONES.length - 1; i >= 0; i -- ) if ( y >= ZONES[ i ].from ) return ZONES[ i ];
	return ZONES[ 0 ];

}

export function zoneIndex( y ) {

	return ZONES.indexOf( zoneAt( y ) );

}

export function formatAltitude( y ) {

	if ( y < 10000 ) return Math.round( y ).toLocaleString( 'en-US' ) + ' m';
	if ( y < 1e6 ) return ( y / 1000 ).toFixed( y < 100000 ? 2 : 1 ) + ' km';
	if ( y < 1e9 ) return Math.round( y / 1000 ).toLocaleString( 'en-US' ) + ' km';
	if ( y < 1e12 ) return ( y / 1e9 ).toFixed( 0 ) + ' M km';
	return ( y / 1e12 ).toFixed( 1 ) + ' B km';

}

export function formatMoney( v ) {

	return '$' + Math.round( v ).toLocaleString( 'en-US' );

}
