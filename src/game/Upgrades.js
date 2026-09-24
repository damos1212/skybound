// Upgrade trees, one per vehicle. Every line has levels 0..n; level 0 is what the vehicle comes with.
// Stats are derived from the owned levels (computeStats); the models read the same levels.

export const VEHICLES = [
	{
		id: 'balloon', name: 'Hot-Air Balloon', blurb: 'Wicker, propane and optimism. From the beach to the stratosphere.',
		unlock: null,
	},
	{
		id: 'rocket', name: 'Sounding Rocket', blurb: 'Real engines. Staged boosters. Aim for the edge of space.',
		unlock: { zone: 'strato', cost: 10000, text: 'Reach the Stratosphere' },
	},
	{
		id: 'starship', name: 'Starship', blurb: 'Leave orbit behind: the Moon, Mars, the Sun, and beyond.',
		unlock: { zone: 'leo', cost: 260000, text: 'Reach Low Orbit' },
	},
	{
		id: 'warpship', name: 'Warpship', blurb: 'Fold space. Jump past the planets to other stars, nebulae and the heart of the galaxy.',
		unlock: { zone: 'alphacen', cost: 30000000, text: 'Reach Alpha Centauri' },
	},
	{
		id: 'ark', name: 'Infinity Ark', blurb: 'A captive black hole for an engine. Dive through Sagittarius A* and cross the universe.',
		unlock: { zone: 'blackhole', cost: 750000000, text: 'Reach Sagittarius A*' },
	},
];

// the space vehicles (route distance instead of altitude)
export const SHIPS = [ 'starship', 'warpship', 'ark' ];
export const isShip = ( v ) => SHIPS.includes( v );

export const VEHICLE_BY_ID = Object.fromEntries( VEHICLES.map( ( v ) => [ v.id, v ] ) );

const shared = ( costs ) => [
	{
		id: 'magnet', name: 'Coin Magnet', icon: 'magnet',
		blurb: 'Pulls nearby coins and fuel toward you.',
		levels: [ { name: 'None', cost: 0, magnet: 0 }, { name: 'Fridge Magnet', cost: costs[ 0 ], magnet: 14 }, { name: 'Horseshoe', cost: costs[ 1 ], magnet: 28 }, { name: 'Electro Coil', cost: costs[ 2 ], magnet: 48 } ],
	},
	{
		id: 'shield', name: 'Bumper Bubble', icon: 'shield',
		blurb: 'A soap-film bubble that absorbs a hit, then slowly regrows.',
		levels: [ { name: 'None', cost: 0, shield: 0 }, { name: 'Bubble', cost: costs[ 3 ], shield: 1 }, { name: 'Double Bubble', cost: costs[ 4 ], shield: 2 } ],
	},
];

export const UPGRADES = {
	balloon: [
		{
			id: 'envelope', name: 'Envelope', icon: 'envelope',
			blurb: 'Bigger, tougher envelopes hold more hot air: more lift, higher ceiling.',
			levels: [
				{ name: 'Patchwork Quilt', cost: 0, lift: 1.0, size: 1.0 },
				{ name: 'Nylon Stripes', cost: 150, lift: 1.3, size: 1.08 },
				{ name: 'Rip-Stop Racer', cost: 600, lift: 1.7, size: 1.16 },
				{ name: 'Mylar Mirror', cost: 1700, lift: 2.7, size: 1.26 },
				{ name: 'Stratos Hybrid', cost: 6000, lift: 4.4, size: 1.4 },
			],
		},
		{
			id: 'burner', name: 'Burner', icon: 'flame',
			blurb: 'Heats the envelope faster: quicker climbs and punchier bursts.',
			levels: [
				{ name: 'Camp Stove', cost: 0, heat: 0.9 },
				{ name: 'Propane Single', cost: 120, heat: 1.3 },
				{ name: 'Twin Blast', cost: 500, heat: 1.9 },
				{ name: 'Jet Coil', cost: 1500, heat: 2.8 },
				{ name: 'Plasma Torch', cost: 5200, heat: 4.0 },
			],
		},
		{
			id: 'tank', name: 'Fuel Tanks', icon: 'tank',
			blurb: 'More propane on board: burn for longer.',
			levels: [
				{ name: 'One Bottle', cost: 0, fuel: 16 },
				{ name: 'Two Bottles', cost: 100, fuel: 26 },
				{ name: 'Three Bottles', cost: 420, fuel: 38 },
				{ name: 'Racing Cylinders', cost: 1200, fuel: 58 },
				{ name: 'Cryo Tanks', cost: 4000, fuel: 85 },
			],
		},
		{
			id: 'basket', name: 'Gondola', icon: 'basket',
			blurb: 'Tougher gondolas shrug off hits. Lighter frames climb better.',
			levels: [
				{ name: 'Wicker Basket', cost: 0, hull: 3, mass: 1.0 },
				{ name: 'Braced Wicker', cost: 180, hull: 4, mass: 0.96 },
				{ name: 'Aluminium Cage', cost: 800, hull: 5, mass: 0.9 },
				{ name: 'Carbon Pod', cost: 2100, hull: 6, mass: 0.84 },
				{ name: 'Pressure Capsule', cost: 6800, hull: 8, mass: 0.8 },
			],
		},
		{
			id: 'fans', name: 'Steering Fans', icon: 'fan',
			blurb: 'Side propellers to dodge birds, planes and storms.',
			levels: [
				{ name: 'Hand Paddle', cost: 0, fan: 5 },
				{ name: 'Desk Fans', cost: 140, fan: 9 },
				{ name: 'Ducted Props', cost: 650, fan: 14 },
				{ name: 'Turbofans', cost: 1800, fan: 21 },
			],
		},
		{
			id: 'ballast', name: 'Sandbags', icon: 'sandbag',
			blurb: 'Drop a sandbag (Shift) for an instant upward kick.',
			levels: [ { name: 'None', cost: 0, bags: 0 }, { name: 'One Bag', cost: 90, bags: 1 }, { name: 'Three Bags', cost: 450, bags: 3 }, { name: 'Five Bags', cost: 1600, bags: 5 } ],
		},
		...shared( [ 260, 1100, 3800, 1200, 5000 ] ),
	],

	rocket: [
		{
			id: 'engine', name: 'Main Engine', icon: 'nozzle',
			blurb: 'More thrust: a harder kick off the pad and a faster climb.',
			levels: [
				{ name: 'Hobby Motor', cost: 0, thrust: 34 },
				{ name: 'Kerosene Kicker', cost: 14000, thrust: 38 },
				{ name: 'Twin Nozzle', cost: 40000, thrust: 48 },
				{ name: 'Cryo Thunder', cost: 95000, thrust: 62 },
				{ name: 'Fusion Spike', cost: 190000, thrust: 80 },
			],
		},
		{
			id: 'fuel', name: 'Propellant', icon: 'tank',
			blurb: 'Longer tanks: burn for longer.',
			levels: [
				{ name: 'Soda Bottle', cost: 0, fuel: 30 },
				{ name: 'Stretched Tank', cost: 12000, fuel: 36 },
				{ name: 'Balloon Tank', cost: 36000, fuel: 44 },
				{ name: 'Composite Tank', cost: 85000, fuel: 54 },
				{ name: 'Slush Hydrogen', cost: 170000, fuel: 66 },
			],
		},
		{
			id: 'boosters', name: 'Boosters', icon: 'booster',
			blurb: 'Strap-on solid boosters: a huge push for the first seconds, then they drop away.',
			levels: [
				{ name: 'None', cost: 0, boosters: 0, bthrust: 0, btime: 0 },
				{ name: 'Twin Solids', cost: 20000, boosters: 2, bthrust: 22, btime: 9 },
				{ name: 'Quad Solids', cost: 60000, boosters: 4, bthrust: 38, btime: 11 },
				{ name: 'Heavy Side Cores', cost: 140000, boosters: 2, bthrust: 60, btime: 14, heavy: true },
			],
		},
		{
			id: 'nose', name: 'Nose Cone', icon: 'nose',
			blurb: 'Sleeker noses cut drag in the thick lower air.',
			levels: [
				{ name: 'Blunt Cap', cost: 0, drag: 1.0 },
				{ name: 'Ogive', cost: 10000, drag: 0.78 },
				{ name: 'Von Kármán', cost: 32000, drag: 0.6 },
				{ name: 'Aerospike Shroud', cost: 80000, drag: 0.45 },
			],
		},
		{
			id: 'fins', name: 'Fins & Gimbal', icon: 'fins',
			blurb: 'Steer harder to dodge satellites and meteors.',
			levels: [
				{ name: 'Cardboard Fins', cost: 0, steer: 1.0 },
				{ name: 'Alloy Fins', cost: 9000, steer: 1.5 },
				{ name: 'Gimballed Nozzle', cost: 30000, steer: 2.1 },
				{ name: 'Grid Fins + RCS', cost: 75000, steer: 2.9 },
			],
		},
		{
			id: 'hull', name: 'Airframe', icon: 'hull',
			blurb: 'Stringers and shields: take more hits.',
			levels: [
				{ name: 'Cardboard Tube', cost: 0, hull: 3 },
				{ name: 'Aluminium Skin', cost: 11000, hull: 4 },
				{ name: 'Stainless Steel', cost: 34000, hull: 5 },
				{ name: 'Whipple Shield', cost: 90000, hull: 7 },
			],
		},
		{
			id: 'afterburner', name: 'Afterburner', icon: 'flame',
			blurb: 'Press SHIFT for a blast of extra thrust that burns no propellant.',
			levels: [
				{ name: 'None', cost: 0, charges: 0 },
				{ name: 'Single Shot', cost: 14000, charges: 1 },
				{ name: 'Double Tap', cost: 45000, charges: 2 },
				{ name: 'Triple Threat', cost: 120000, charges: 3 },
			],
		},
		...shared( [ 8000, 26000, 70000, 30000, 110000 ] ),
	],

	starship: [
		{
			id: 'drive', name: 'Drive', icon: 'nozzle',
			blurb: 'Every second of burn multiplies your speed. Better drives multiply more.',
			levels: [
				{ name: 'Ion Drive', cost: 0, boost: 0.16 },
				{ name: 'Plasma Drive', cost: 220000, boost: 0.2 },
				{ name: 'Fusion Torch', cost: 520000, boost: 0.225 },
				{ name: 'Antimatter Engine', cost: 1100000, boost: 0.25 },
				{ name: 'Warp Coil', cost: 2400000, boost: 0.28 },
			],
		},
		{
			id: 'cells', name: 'Fuel Cells', icon: 'cell',
			blurb: 'More reaction mass: burn for longer.',
			levels: [
				{ name: 'Starter Cells', cost: 0, fuel: 56 },
				{ name: 'Deep Cells', cost: 180000, fuel: 62 },
				{ name: 'Fusion Pellets', cost: 450000, fuel: 66 },
				{ name: 'Antimatter Traps', cost: 950000, fuel: 68 },
				{ name: 'Vacuum Tap', cost: 2000000, fuel: 70 },
			],
		},
		{
			id: 'thrusters', name: 'RCS Thrusters', icon: 'fins',
			blurb: 'Side thrusters to dodge debris and asteroids.',
			levels: [
				{ name: 'Cold Gas', cost: 0, steer: 9 },
				{ name: 'Hypergolic', cost: 150000, steer: 14 },
				{ name: 'Plasma Jets', cost: 400000, steer: 20 },
				{ name: 'Gravitic Vanes', cost: 900000, steer: 28 },
			],
		},
		{
			id: 'armor', name: 'Hull Plating', icon: 'hull',
			blurb: 'Tougher plating for the asteroid belts.',
			levels: [
				{ name: 'Honeycomb', cost: 0, hull: 4 },
				{ name: 'Titanium', cost: 170000, hull: 5 },
				{ name: 'Carbon Nanotube', cost: 420000, hull: 6 },
				{ name: 'Neutronium Weave', cost: 1000000, hull: 8 },
			],
		},
		{
			id: 'heatshield', name: 'Heat Shield', icon: 'heatshield',
			blurb: 'Survive the Sun flyby. Without it the ship cooks.',
			levels: [
				{ name: 'Foil Wrap', cost: 0, heat: 1.0 },
				{ name: 'Ceramic Tiles', cost: 260000, heat: 0.6 },
				{ name: 'Ablative Cone', cost: 600000, heat: 0.35 },
				{ name: 'Sunshade Mirror', cost: 1400000, heat: 0.15 },
			],
		},
		{
			id: 'sails', name: 'Solar Sails', icon: 'sail',
			blurb: 'Gossamer sails that trickle fuel back while you coast.',
			levels: [
				{ name: 'None', cost: 0, regen: 0 },
				{ name: 'Mylar Kite', cost: 240000, regen: 0.12 },
				{ name: 'Graphene Sail', cost: 700000, regen: 0.22 },
			],
		},
		{
			id: 'improbability', name: 'Improbability Drive', icon: 'infinity',
			blurb: 'Technically impossible. Past Pluto every burn counts double: the way to another star.',
			levels: [ { name: 'Not installed', cost: 0 }, { name: 'Installed', cost: 9000000 } ],
		},
		...shared( [ 120000, 360000, 800000, 300000, 1200000 ] ),
	],

	warpship: [
		{
			id: 'core', name: 'Warp Core', icon: 'core',
			blurb: 'Folds space harder: every second of burn multiplies your speed more.',
			levels: [
				{ name: 'Dilithium Spark', cost: 0, boost: 0.26 },
				{ name: 'Twin Coil', cost: 25e6, boost: 0.28 },
				{ name: 'Tachyon Loop', cost: 60e6, boost: 0.3 },
				{ name: 'Folded Lattice', cost: 140e6, boost: 0.32 },
				{ name: 'Hawking Heart', cost: 320e6, boost: 0.34 },
			],
		},
		{
			id: 'pods', name: 'Antimatter Pods', icon: 'cell',
			blurb: 'More antimatter: burn for longer.',
			levels: [
				{ name: 'Magnetic Bottle', cost: 0, fuel: 42 },
				{ name: 'Penning Trap', cost: 20e6, fuel: 44 },
				{ name: 'Positron Vault', cost: 50e6, fuel: 46 },
				{ name: 'Mirror Tanks', cost: 120e6, fuel: 48 },
				{ name: 'Vacuum Well', cost: 280e6, fuel: 50 },
			],
		},
		{
			id: 'capacitor', name: 'Jump Capacitor', icon: 'jump',
			blurb: 'Hyperjump charges: press SHIFT to leap ahead, passing through anything.',
			levels: [
				{ name: 'Single Charge', cost: 0, jumps: 1 },
				{ name: 'Twin Bank', cost: 45e6, jumps: 2 },
				{ name: 'Triple Stack', cost: 180e6, jumps: 3 },
			],
		},
		{
			id: 'gravitic', name: 'Gravitic Thrusters', icon: 'fins',
			blurb: 'Snappier sideways dodging.',
			levels: [
				{ name: 'Vector Vanes', cost: 0, steer: 26 },
				{ name: 'Graviton Fins', cost: 18e6, steer: 34 },
				{ name: 'Inertia Skates', cost: 55e6, steer: 44 },
			],
		},
		{
			id: 'deflector', name: 'Deflector Dish', icon: 'hull',
			blurb: 'A glowing dish that shrugs off impacts.',
			levels: [
				{ name: 'Navigational', cost: 0, hull: 4 },
				{ name: 'Particle Screen', cost: 22e6, hull: 5 },
				{ name: 'Graviton Wall', cost: 70e6, hull: 6 },
				{ name: 'Phase Barrier', cost: 200e6, hull: 8 },
			],
		},
		{
			id: 'screen', name: 'Radiation Screen', icon: 'heatshield',
			blurb: 'Keeps the heat of giant stars out. Betelgeuse will cook an unscreened ship.',
			levels: [
				{ name: 'Lead Paint', cost: 0, heat: 1.0 },
				{ name: 'Magnetosphere', cost: 28e6, heat: 0.6 },
				{ name: 'Plasma Mirror', cost: 85e6, heat: 0.35 },
				{ name: 'Starlight Diverter', cost: 220e6, heat: 0.15 },
			],
		},
		{
			id: 'tuner', name: 'Ring Tuner', icon: 'ring',
			blurb: 'Warp rings give a bigger kick.',
			levels: [
				{ name: 'Stock', cost: 0, ring: 1 },
				{ name: 'Resonant', cost: 20e6, ring: 1.5 },
				{ name: 'Harmonic', cost: 90e6, ring: 2 },
			],
		},
		...shared( [ 15e6, 45e6, 120e6, 35e6, 140e6 ] ),
	],

	ark: [
		{
			id: 'singularity', name: 'Singularity Core', icon: 'core',
			blurb: 'Feed the captive black hole: every second of burn multiplies your speed more.',
			levels: [
				{ name: 'Kugelblitz', cost: 0, boost: 0.28 },
				{ name: 'Spinning Kerr', cost: 3e9, boost: 0.3 },
				{ name: 'Twin Horizons', cost: 8e9, boost: 0.32 },
				{ name: 'Naked Singularity', cost: 20e9, boost: 0.34 },
				{ name: 'Baby Universe', cost: 50e9, boost: 0.36 },
			],
		},
		{
			id: 'darktanks', name: 'Dark Energy Tanks', icon: 'cell',
			blurb: 'Bottled dark energy: burn for longer.',
			levels: [
				{ name: 'Vacuum Flask', cost: 0, fuel: 46 },
				{ name: 'Casimir Stack', cost: 2.5e9, fuel: 49 },
				{ name: 'False Vacuum', cost: 6e9, fuel: 52 },
				{ name: 'Brane Reservoir', cost: 16e9, fuel: 55 },
				{ name: 'Big Bang Bottle', cost: 40e9, fuel: 58 },
			],
		},
		{
			id: 'capacitor', name: 'Wormhole Bank', icon: 'jump',
			blurb: 'Hyperjump charges: press SHIFT to leap ahead, passing through anything.',
			levels: [
				{ name: 'One Wormhole', cost: 0, jumps: 1 },
				{ name: 'Two Wormholes', cost: 5e9, jumps: 2 },
				{ name: 'Three Wormholes', cost: 18e9, jumps: 3 },
			],
		},
		{
			id: 'dampers', name: 'Inertial Dampers', icon: 'fins',
			blurb: 'Turn on a dime at a trillion times light speed.',
			levels: [
				{ name: 'Gyro Rings', cost: 0, steer: 30 },
				{ name: 'Gravity Keel', cost: 2e9, steer: 40 },
				{ name: 'Frame Dragger', cost: 7e9, steer: 50 },
			],
		},
		{
			id: 'hullark', name: 'Neutronium Hull', icon: 'hull',
			blurb: 'Plating made of star cores.',
			levels: [
				{ name: 'Starsteel', cost: 0, hull: 5 },
				{ name: 'Neutronium', cost: 3e9, hull: 6 },
				{ name: 'Quark Weave', cost: 9e9, hull: 7 },
				{ name: 'Cosmic String', cost: 24e9, hull: 9 },
			],
		},
		{
			id: 'lens', name: 'Lens Shield', icon: 'heatshield',
			blurb: 'Bends away quasar light and the glare of the Big Bang.',
			levels: [
				{ name: 'Sunglasses', cost: 0, heat: 1.0 },
				{ name: 'Gravity Lens', cost: 3.5e9, heat: 0.55 },
				{ name: 'Einstein Ring', cost: 11e9, heat: 0.3 },
				{ name: 'Event Veil', cost: 28e9, heat: 0.12 },
			],
		},
		{
			id: 'anchor', name: 'Reality Anchor', icon: 'infinity',
			blurb: 'Keeps you in one piece at the edge of everything. Needed to cross the Edge.',
			levels: [ { name: 'Not installed', cost: 0 }, { name: 'Installed', cost: 150e9 } ],
		},
		...shared( [ 2e9, 6e9, 15e9, 4e9, 16e9 ] ),
	],
};

// pacing: every price of a vehicle's workshop times this (tuned with tools/economy.mjs so a run
// usually buys an upgrade or two and no era drags), rounded to two significant digits
export const COST_SCALE = { balloon: 0.8, rocket: 0.9, starship: 0.85, warpship: 0.65, ark: 0.45 };
const nice = ( c ) => {

	if ( c < 100 ) return Math.round( c );
	const p = Math.pow( 10, Math.floor( Math.log10( c ) ) - 1 );
	return Math.round( c / p ) * p;

};

for ( const v in UPGRADES ) for ( const u of UPGRADES[ v ] ) for ( const l of u.levels ) if ( l.cost ) l.cost = nice( l.cost * COST_SCALE[ v ] );

export function upgradesFor( vehicle ) {

	return UPGRADES[ vehicle ];

}

export function defaultLevels() {

	const out = {};
	for ( const v in UPGRADES ) out[ v ] = Object.fromEntries( UPGRADES[ v ].map( ( u ) => [ u.id, 0 ] ) );
	return out;

}

export function level( levels, vehicle, id ) {

	const u = UPGRADES[ vehicle ].find( ( x ) => x.id === id );
	return u.levels[ Math.min( ( levels[ vehicle ] || {} )[ id ] || 0, u.levels.length - 1 ) ];

}

export function computeStats( levels, vehicle ) {

	const L = ( id ) => level( levels, vehicle, id );
	const common = { magnet: L( 'magnet' ).magnet, shield: L( 'shield' ).shield };
	if ( vehicle === 'balloon' ) {

		const env = L( 'envelope' ), bas = L( 'basket' );
		return {
			...common,
			lift: 17.7 * env.lift / bas.mass,
			size: env.size,
			heatRate: L( 'burner' ).heat,
			fuel: L( 'tank' ).fuel,
			hull: bas.hull,
			fan: L( 'fans' ).fan,
			bags: L( 'ballast' ).bags,
			drag: 0.0125 / Math.sqrt( env.lift ),
		};

	}

	if ( vehicle === 'rocket' ) {

		const b = L( 'boosters' );
		return {
			...common,
			thrust: L( 'engine' ).thrust,
			fuel: L( 'fuel' ).fuel,
			boosters: b.boosters, boosterThrust: b.bthrust, boosterTime: b.btime, heavyBoosters: !! b.heavy,
			drag: 0.00012 * L( 'nose' ).drag,
			steer: L( 'fins' ).steer,
			hull: L( 'hull' ).hull,
			afterburners: L( 'afterburner' ).charges,
		};

	}

	if ( vehicle === 'warpship' ) {

		return {
			...common,
			boost: L( 'core' ).boost,
			fuel: L( 'pods' ).fuel,
			steer: L( 'gravitic' ).steer,
			hull: L( 'deflector' ).hull,
			heat: L( 'screen' ).heat,
			jumps: L( 'capacitor' ).jumps,
			ring: L( 'tuner' ).ring,
			regen: 0,
		};

	}

	if ( vehicle === 'ark' ) {

		return {
			...common,
			boost: L( 'singularity' ).boost,
			fuel: L( 'darktanks' ).fuel,
			steer: L( 'dampers' ).steer,
			hull: L( 'hullark' ).hull,
			heat: L( 'lens' ).heat,
			jumps: L( 'capacitor' ).jumps,
			ring: 1.5,
			regen: 0,
			anchor: ( ( levels.ark || {} ).anchor || 0 ) > 0,
		};

	}

	return {
		...common,
		boost: L( 'drive' ).boost,
		fuel: L( 'cells' ).fuel + ( ( ( levels.starship || {} ).improbability || 0 ) > 0 ? 15 : 0 ),
		steer: L( 'thrusters' ).steer,
		hull: L( 'armor' ).hull,
		heat: L( 'heatshield' ).heat,
		regen: L( 'sails' ).regen,
		warp: ( ( levels.starship || {} ).improbability || 0 ) > 0,
		jumps: 0,
		ring: 1,
	};

}
