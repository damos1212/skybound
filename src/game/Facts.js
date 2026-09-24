// A line for the results screen that puts the run's height or distance in perspective.

const LANDMARKS = [
	[ 50, 'a ten-storey building', 'up' ],
	[ 93, 'the Statue of Liberty', 'up' ],
	[ 330, 'the Eiffel Tower', 'up' ],
	[ 828, 'the Burj Khalifa', 'up' ],
	[ 8849, 'Mount Everest', 'up' ],
	[ 11000, 'an airliner at cruising height', 'up' ],
	[ 18300, 'Concorde\'s cruising height', 'up' ],
	[ 39000, 'Felix Baumgartner\'s record jump', 'up' ],
	[ 100000, 'the Kármán line, where space begins', 'up' ],
	[ 408000, 'the International Space Station', 'up' ],
	[ 35786000, 'the geostationary satellites', 'far' ],
	[ 384400000, 'the Moon', 'far' ],
	[ 1.496e11, 'the Sun', 'far' ],
	[ 7.78e11, 'Jupiter', 'far' ],
	[ 5.9e12, 'Pluto', 'far' ],
	[ 2.4e13, 'Voyager 1', 'far' ],
	[ 9.4607e15, 'a light year', 'far' ],
	[ 4.13e16, 'Alpha Centauri', 'far' ],
	[ 2.46e20, 'the centre of the Milky Way', 'far' ],
	[ 2.4e22, 'Andromeda', 'far' ],
	[ 5.1e23, 'the Virgo Cluster', 'far' ],
	[ 4.4e26, 'the edge of the observable universe', 'far' ],
];

export function funFact( h ) {

	if ( h < 30 ) return 'Barely off the ground. Everyone starts somewhere!';
	let best = null;
	for ( const l of LANDMARKS ) if ( h >= l[ 0 ] ) best = l;
	if ( ! best ) return 'Higher than the palm trees!';
	const [ d, name, kind ] = best;
	const k = h / d;
	if ( k < 1.6 ) return `${ kind === 'up' ? 'Higher' : 'Farther' } than ${ name }!`;
	const n = k < 10 ? k.toFixed( 1 ) : Math.round( k ).toLocaleString( 'en-US' );
	return kind === 'up' ? `${ n } times the height of ${ name }` : `${ n } times as far as ${ name }`;

}
