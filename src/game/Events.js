// Sky events: now and then a run comes with a twist, rolled when the player is back on the pad (so
// it is announced before the launch). Each changes what spawns or what things are worth.
//   coinMul / nearMul / specialMul: value multipliers; coinRate / ringRate / starRate / specialRate /
//   hazardRate: spawn rate multipliers; hazardBias: { type: weight multiplier }; fuelMul: propellant
//   used per second; pay: multiplier on the whole run's pay (an extra line on the results)

const ALL = [ 'balloon', 'rocket', 'starship', 'warpship', 'ark' ];
const LOW = [ 'balloon', 'rocket' ];
const SPACE = [ 'starship', 'warpship', 'ark' ];

export const EVENTS = [
	{ id: 'goldrush', name: 'Gold Rush', desc: 'More coins, worth double', icon: '💰', vehicles: ALL, coinMul: 2, coinRate: 1.4 },
	{ id: 'ringrush', name: 'Ring Rush', desc: 'Twice the ring chains', icon: '◎', vehicles: ALL, ringRate: 2.2 },
	{ id: 'lucky', name: 'Lucky Skies', desc: 'Lucky stars and power orbs everywhere', icon: '✨', vehicles: ALL, starRate: 3, orbRate: 2 },
	{ id: 'tailwind', name: 'Tailwind', desc: 'Propellant lasts 30% longer', icon: '🌬️', vehicles: ALL, fuelMul: 0.7 },
	{ id: 'rushhour', name: 'Rush Hour', desc: 'Twice the traffic · +50% pay', icon: '🚦', vehicles: ALL, hazardRate: 1.7, pay: 1.5 },
	{ id: 'storm', name: 'Storm Front', desc: 'Storm cells and lightning · +35% pay', icon: '⛈️', vehicles: LOW, hazardBias: { storm: 5, weather: 2 }, pay: 1.35 },
	{ id: 'migration', name: 'Great Migration', desc: 'Flocks everywhere · close calls pay ×3', icon: '🪿', vehicles: LOW, hazardBias: { geese: 5, gulls: 4 }, nearMul: 3 },
	{ id: 'airshow', name: 'Air Show', desc: 'Jets, blimps and rivals · close calls pay ×3', icon: '✈️', vehicles: LOW, hazardBias: { jet: 4, blimp: 3, rival: 3, heli: 3 }, nearMul: 3 },
	{ id: 'meteors', name: 'Meteor Shower', desc: 'Falling stars · crystals worth double', icon: '☄️', vehicles: [ 'rocket', 'starship' ], hazardBias: { meteor: 5, asteroid: 3, comet: 3 }, specialMul: 2, specialRate: 1.6 },
	{ id: 'solar', name: 'Solar Storm', desc: 'Plasma and flares · +40% pay', icon: '🌞', vehicles: SPACE, hazardBias: { flare: 4, plasmoid: 5 }, pay: 1.4 },
	{ id: 'rescue', name: 'Rescue Mission', desc: 'Stranded astronauts and lost probes to find', icon: '🧑‍🚀', vehicles: [ 'rocket', 'starship', 'warpship', 'ark' ], specialRate: 3 },
	{ id: 'darkfleet', name: 'Visitors', desc: 'UFOs and motherships · close calls pay ×3', icon: '🛸', vehicles: SPACE, hazardBias: { spaceufo: 5, mothership: 4, ufo: 5 }, nearMul: 3 },
];

export const EVENT_BY_ID = Object.fromEntries( EVENTS.map( ( e ) => [ e.id, e ] ) );

// an event for the next run of vehicle v (none for the first few runs, then about one run in three)
export function rollEvent( v, runs ) {

	if ( runs < 3 || Math.random() > 0.36 ) return null;
	const opts = EVENTS.filter( ( e ) => e.vehicles.includes( v ) );
	return opts[ Math.floor( Math.random() * opts.length ) ] || null;

}
