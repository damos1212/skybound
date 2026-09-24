// Upgrade tree for the balloon era. Every line has levels 0..n; level 0 is what you start with.
// Stats are derived from the owned levels by computeStats(); the visual parts read the same levels.

export const UPGRADES = [
	{
		id: 'envelope', name: 'Envelope', icon: 'envelope',
		blurb: 'Bigger, tougher envelopes hold more hot air: more lift, higher ceiling.',
		levels: [
			{ name: 'Patchwork Quilt', cost: 0, lift: 1.0, size: 1.0 },
			{ name: 'Nylon Stripes', cost: 150, lift: 1.3, size: 1.08 },
			{ name: 'Rip-Stop Racer', cost: 600, lift: 1.7, size: 1.16 },
			{ name: 'Mylar Mirror', cost: 2200, lift: 2.7, size: 1.26 },
			{ name: 'Stratos Hybrid', cost: 8000, lift: 4.4, size: 1.4 },
		],
	},
	{
		id: 'burner', name: 'Burner', icon: 'flame',
		blurb: 'Heats the envelope faster: quicker climbs and punchier bursts.',
		levels: [
			{ name: 'Camp Stove', cost: 0, heat: 0.9 },
			{ name: 'Propane Single', cost: 120, heat: 1.3 },
			{ name: 'Twin Blast', cost: 500, heat: 1.9 },
			{ name: 'Jet Coil', cost: 1900, heat: 2.8 },
			{ name: 'Plasma Torch', cost: 7000, heat: 4.0 },
		],
	},
	{
		id: 'tank', name: 'Fuel Tanks', icon: 'tank',
		blurb: 'More propane on board: burn for longer.',
		levels: [
			{ name: 'One Bottle', cost: 0, fuel: 16 },
			{ name: 'Two Bottles', cost: 100, fuel: 26 },
			{ name: 'Three Bottles', cost: 420, fuel: 38 },
			{ name: 'Racing Cylinders', cost: 1500, fuel: 58 },
			{ name: 'Cryo Tanks', cost: 5200, fuel: 85 },
		],
	},
	{
		id: 'basket', name: 'Gondola', icon: 'basket',
		blurb: 'Tougher gondolas shrug off hits. Lighter frames climb better.',
		levels: [
			{ name: 'Wicker Basket', cost: 0, hull: 3, mass: 1.0 },
			{ name: 'Braced Wicker', cost: 180, hull: 4, mass: 0.96 },
			{ name: 'Aluminium Cage', cost: 800, hull: 5, mass: 0.9 },
			{ name: 'Carbon Pod', cost: 2800, hull: 6, mass: 0.84 },
			{ name: 'Pressure Capsule', cost: 9000, hull: 8, mass: 0.8 },
		],
	},
	{
		id: 'fans', name: 'Steering Fans', icon: 'fan',
		blurb: 'Side propellers to dodge birds, planes and storms.',
		levels: [
			{ name: 'Hand Paddle', cost: 0, fan: 5 },
			{ name: 'Desk Fans', cost: 140, fan: 9 },
			{ name: 'Ducted Props', cost: 650, fan: 14 },
			{ name: 'Turbofans', cost: 2400, fan: 21 },
		],
	},
	{
		id: 'ballast', name: 'Sandbags', icon: 'sandbag',
		blurb: 'Drop a sandbag (Shift) for an instant upward kick.',
		levels: [
			{ name: 'None', cost: 0, bags: 0 },
			{ name: 'One Bag', cost: 90, bags: 1 },
			{ name: 'Three Bags', cost: 450, bags: 3 },
			{ name: 'Five Bags', cost: 1600, bags: 5 },
		],
	},
	{
		id: 'magnet', name: 'Coin Magnet', icon: 'magnet',
		blurb: 'Pulls nearby coins and fuel toward you.',
		levels: [
			{ name: 'None', cost: 0, magnet: 0 },
			{ name: 'Fridge Magnet', cost: 260, magnet: 14 },
			{ name: 'Horseshoe', cost: 1100, magnet: 28 },
			{ name: 'Electro Coil', cost: 3800, magnet: 48 },
		],
	},
	{
		id: 'shield', name: 'Bumper Bubble', icon: 'shield',
		blurb: 'A soap-film bubble that absorbs a hit, then slowly regrows.',
		levels: [
			{ name: 'None', cost: 0, shield: 0 },
			{ name: 'Bubble', cost: 1200, shield: 1 },
			{ name: 'Double Bubble', cost: 5000, shield: 2 },
		],
	},
];

export const UPGRADE_BY_ID = Object.fromEntries( UPGRADES.map( ( u ) => [ u.id, u ] ) );

export function defaultLevels() {

	return Object.fromEntries( UPGRADES.map( ( u ) => [ u.id, 0 ] ) );

}

export function level( levels, id ) {

	const u = UPGRADE_BY_ID[ id ];
	return u.levels[ Math.min( levels[ id ] || 0, u.levels.length - 1 ) ];

}

// Flight stats (see Balloon.step for how they are used)
export function computeStats( levels ) {

	const env = level( levels, 'envelope' ), bur = level( levels, 'burner' ), tank = level( levels, 'tank' );
	const bas = level( levels, 'basket' ), fan = level( levels, 'fans' );
	return {
		// buoyant acceleration at full heat at sea level (m/s²); gravity is 9.81
		lift: 17.7 * env.lift / bas.mass,
		size: env.size,
		// heat gained per second of burning (0..1 scale)
		heatRate: bur.heat,
		fuel: tank.fuel,
		hull: bas.hull,
		fan: fan.fan,
		bags: level( levels, 'ballast' ).bags,
		magnet: level( levels, 'magnet' ).magnet,
		shield: level( levels, 'shield' ).shield,
		// quadratic air drag (per metre), lower for sleeker envelopes
		drag: 0.0125 / Math.sqrt( env.lift ),
	};

}
