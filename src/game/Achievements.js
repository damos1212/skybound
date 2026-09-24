// Achievements: checked on game events (zone reached, run ended, pickups, hits, purchases). Each has a
// cash reward. `test( save, run )` sees the save (with its lifetime `stats`) and the current run.

import { altitudePay } from './Zones.js';

// what a good run pays at the player's progress: skill and collection achievements (not tied to a
// zone or a vehicle) pay `pay` times this, so they are worth the same at every stage of the game
export function runPay( save ) {

	return altitudePay( Math.max( save.best || 0, 100 ) );

}

export function achievementReward( a, save ) {

	return a.pay ? Math.max( a.reward, Math.round( a.pay * runPay( save ) / 10 ) * 10 ) : a.reward;

}

const zone = ( id, name, desc, reward ) => ( { id: 'zone_' + id, name, desc, reward, test: ( s ) => s.zones.includes( id ) } );
const stat = ( id, name, desc, key, n, pay ) => ( { id, name, desc, reward: 50, pay, test: ( s ) => ( s.stats[ key ] || 0 ) >= n } );

export const ACHIEVEMENTS = [
	{ id: 'first_flight', name: 'First Flight', desc: 'Complete your first run', reward: 50, test: ( s ) => s.stats.runs >= 1 },
	{ id: 'hundred', name: 'Up, Up', desc: 'Climb 100 m', reward: 50, test: ( s ) => s.best >= 100 },
	zone( 'low', 'Above the Gulls', 'Reach the Low Skies', 150 ),
	zone( 'clouds', 'Head in the Clouds', 'Reach the Cloud Deck', 400 ),
	zone( 'high', 'Cruising Altitude', 'Reach the High Skies', 1000 ),
	zone( 'strato', 'Blue Turns Black', 'Reach the Stratosphere', 3000 ),
	zone( 'meso', 'Edge of the World', 'Reach the Edge of Space', 8000 ),
	zone( 'leo', 'In Orbit', 'Reach Low Orbit', 20000 ),
	zone( 'meo', 'Navigator', 'Reach High Orbit', 40000 ),
	zone( 'moon', 'One Small Step', 'Reach the Moon', 100000 ),
	zone( 'mars', 'Red Planet', 'Reach Mars', 200000 ),
	zone( 'sun', 'Icarus', 'Fly past the Sun', 350000 ),
	zone( 'jupiter', 'King of Planets', 'Reach Jupiter', 500000 ),
	zone( 'saturn', 'Lord of the Rings', 'Reach Saturn', 700000 ),
	zone( 'neptune', 'Ice Giant', 'Reach Neptune', 1000000 ),
	zone( 'kuiper', 'Frontier', 'Reach the Kuiper Belt', 1500000 ),
	zone( 'interstellar', 'Between the Stars', 'Reach interstellar space', 3000000 ),
	zone( 'alphacen', 'Two Suns', 'Reach Alpha Centauri', 5000000 ),
	zone( 'trappist', 'Seven Sisters', 'Reach TRAPPIST-1', 8000000 ),
	zone( 'betelgeuse', 'Red Giant', 'Fly past Betelgeuse', 12000000 ),
	zone( 'orion', 'Stellar Nursery', 'Fly through the Orion Nebula', 18000000 ),
	zone( 'crab', 'Lighthouse Keeper', 'Survive the Crab Pulsar', 26000000 ),
	zone( 'blackhole', 'Event Horizon', 'Reach the centre of the galaxy', 40000000 ),
	zone( 'halo', 'The View From Above', 'See the whole Milky Way', 60000000 ),
	zone( 'lmc', 'Small Neighbours', 'Reach the Magellanic Clouds', 100000000 ),
	zone( 'andromeda', 'Collision Course', 'Reach Andromeda', 180000000 ),
	zone( 'virgo', 'A Thousand Galaxies', 'Reach the Virgo Cluster', 300000000 ),
	zone( 'laniakea', 'Immeasurable Heaven', 'Reach the Great Attractor', 500000000 ),
	zone( 'quasar', 'Blinded', 'Reach the quasar 3C 273', 800000000 ),
	zone( 'elgordo', 'Web Walker', 'Reach the cosmic web', 1200000000 ),
	zone( 'edge', 'Last Light', 'Reach the edge of the observable universe', 2000000000 ),
	{ id: 'beyond', name: 'Beyond', desc: 'Fly out through the Edge', reward: 5000000000, test: ( s ) => !! s.won },
	stat( 'coins_100', 'Pocket Change', 'Collect 100 coins', 'coins', 100, 0.4 ),
	stat( 'coins_1000', 'Piggy Bank', 'Collect 1,000 coins', 'coins', 1000, 1 ),
	stat( 'coins_10000', 'Dragon Hoard', 'Collect 10,000 coins', 'coins', 10000, 2 ),
	stat( 'runs_10', 'Frequent Flyer', 'Fly 10 runs', 'runs', 10, 0.5 ),
	stat( 'runs_50', 'Dedicated', 'Fly 50 runs', 'runs', 50, 1.5 ),
	stat( 'runs_150', 'Lifer', 'Fly 150 runs', 'runs', 150, 3 ),
	stat( 'splash_10', 'Frequent Swimmer', 'Splash down 10 times', 'splashes', 10, 0.4 ),
	stat( 'pop_1', 'Pop Goes the Balloon', 'Get popped', 'pops', 1, 0.3 ),
	stat( 'zap_1', 'Lightning Rod', 'Get struck by lightning', 'zaps', 1, 0.4 ),
	stat( 'shield_10', 'Bubble Wrap', 'Block 10 hits with a bubble', 'blocked', 10, 1 ),
	stat( 'orbs_20', 'Power Up', 'Collect 20 power orbs', 'orbs', 20, 1 ),
	stat( 'stars_10', 'Lucky Star', 'Collect 10 lucky stars', 'stars', 10, 1 ),
	stat( 'astro_5', 'Rescue Ranger', 'Rescue 5 stranded astronauts', 'astronauts', 5, 1.5 ),
	stat( 'probe_1', 'Voyager', 'Recover a lost probe', 'probes', 1, 1 ),
	stat( 'crystal_10', 'Shiny', 'Collect 10 space crystals', 'crystals', 10, 1.5 ),
	stat( 'bags_20', 'Ballast Master', 'Drop 20 sandbags', 'bags', 20, 0.6 ),
	stat( 'bullseye', 'Bullseye', 'Land the balloon right on the pad', 'bullseyes', 1, 1 ),
	{ id: 'afterburner', name: 'Punch It', desc: 'Fire three afterburners in one rocket run', reward: 25000, test: ( s, r ) => !! r && ( r.afterburns || 0 ) >= 3 },
	{ id: 'untouchable', name: 'Untouchable', desc: 'Climb past 1 km without a scratch', reward: 50, pay: 0.6, test: ( s, r ) => !! r && r.hits === 0 && r.maxH >= 1000 },
	{ id: 'untouchable_space', name: 'Flawless Flight', desc: 'Reach Mars without taking a hit', reward: 150000, test: ( s, r ) => !! r && r.hits === 0 && r.zones.includes( 'mars' ) },
	{ id: 'night_owl', name: 'Night Owl', desc: 'Fly a run at night', reward: 50, pay: 0.4, test: ( s ) => ( s.stats.nightRuns || 0 ) >= 1 },
	{ id: 'all_times', name: 'Around the Clock', desc: 'Fly at every time of day', reward: 50, pay: 1, test: ( s ) => ( s.stats.times || [] ).length >= 5 },
	{ id: 'rocketeer', name: 'Rocketeer', desc: 'Unlock the rocket', reward: 5000, test: ( s ) => s.unlocked.includes( 'rocket' ) },
	{ id: 'starfarer', name: 'Starfarer', desc: 'Unlock the Starship', reward: 50000, test: ( s ) => s.unlocked.includes( 'starship' ) },
	{ id: 'warp', name: 'Engage', desc: 'Unlock the Warpship', reward: 3000000, test: ( s ) => s.unlocked.includes( 'warpship' ) },
	{ id: 'ark', name: 'All Aboard', desc: 'Unlock the Infinity Ark', reward: 250000000, test: ( s ) => s.unlocked.includes( 'ark' ) },
	{ id: 'triple_jump', name: 'Triple Jump', desc: 'Hyperjump three times in one run', reward: 20000000, test: ( s, r ) => !! r && ( r.jumps || 0 ) >= 3 },
	{ id: 'chain', name: 'Threading the Needle', desc: 'Fly through a whole ring chain', reward: 50, pay: 0.8, test: ( s, r ) => !! r && ( r.chains || 0 ) >= 1 },
	{ id: 'chain_5', name: 'Ringmaster', desc: 'Complete 5 ring chains in one run', reward: 50, pay: 2.5, test: ( s, r ) => !! r && ( r.chains || 0 ) >= 5 },
	{ id: 'rings_200', name: 'Ring Runner', desc: 'Fly through 200 rings', reward: 50, pay: 2, test: ( s ) => ( s.stats.rings || 0 ) >= 200 },
	{ id: 'lightyear', name: 'Light Year', desc: 'Travel a light year', reward: 2000000, test: ( s ) => s.best >= 9.4607e15 },
	{ id: 'megaparsec', name: 'Megaparsec', desc: 'Travel 3.26 million light years', reward: 400000000, test: ( s ) => s.best >= 3.086e22 },
	{ id: 'warp_factor', name: 'Warp Factor Ludicrous', desc: 'Go a trillion times faster than light', reward: 300000000, test: ( s ) => ( s.stats.maxSpeed || 0 ) > 2.998e20 },
	{ id: 'mach', name: 'Supersonic', desc: 'Go faster than sound', reward: 3000, test: ( s ) => ( s.stats.maxSpeed || 0 ) > 343 },
	{ id: 'escape', name: 'Escape Velocity', desc: 'Go faster than 11.2 km/s', reward: 30000, test: ( s ) => ( s.stats.maxSpeed || 0 ) > 11200 },
	{ id: 'ftl', name: 'Faster Than Light', desc: 'Outrun a sunbeam', reward: 300000, test: ( s ) => ( s.stats.maxSpeed || 0 ) > 299792458 },
	{ id: 'millionaire', name: 'Millionaire', desc: 'Earn $1,000,000 in total', reward: 100000, test: ( s ) => ( s.stats.earned || 0 ) >= 1e6 },
	{ id: 'billionaire', name: 'Billionaire', desc: 'Earn $1,000,000,000 in total', reward: 50000000, test: ( s ) => ( s.stats.earned || 0 ) >= 1e9 },
	{ id: 'trillionaire', name: 'Trillionaire', desc: 'Earn $1,000,000,000,000 in total', reward: 20000000000, test: ( s ) => ( s.stats.earned || 0 ) >= 1e12 },
	{ id: 'fully_loaded', name: 'Fully Loaded', desc: 'Max out every balloon upgrade', reward: 5000, test: ( s, r, ctx ) => !! ctx && ctx.maxed && ctx.maxed.balloon },
	{ id: 'rocket_maxed', name: 'Heavy Lift', desc: 'Max out every rocket upgrade', reward: 80000, test: ( s, r, ctx ) => !! ctx && ctx.maxed && ctx.maxed.rocket },
	{ id: 'ship_maxed', name: 'Flagship', desc: 'Max out every Starship upgrade', reward: 2000000, test: ( s, r, ctx ) => !! ctx && ctx.maxed && ctx.maxed.starship },
	{ id: 'warp_maxed', name: 'Maximum Warp', desc: 'Max out every Warpship upgrade', reward: 400000000, test: ( s, r, ctx ) => !! ctx && ctx.maxed && ctx.maxed.warpship },
	{ id: 'ark_maxed', name: 'Omnipotent', desc: 'Max out every Infinity Ark upgrade', reward: 30000000000, test: ( s, r, ctx ) => !! ctx && ctx.maxed && ctx.maxed.ark },
	{ id: 'screened', name: 'Sunblock 1,000,000', desc: 'Pass Betelgeuse without overheating', reward: 30000000, test: ( s, r ) => !! r && r.zones.includes( 'orion' ) && ! r.overheated },
	{ id: 'untouchable_galaxy', name: 'Ghost Ship', desc: 'Reach Andromeda without taking a hit', reward: 400000000, test: ( s, r ) => !! r && r.hits === 0 && r.zones.includes( 'andromeda' ) },
	{ id: 'sunscreen', name: 'Sunscreen', desc: 'Pass the Sun without overheating', reward: 250000, test: ( s, r ) => !! r && r.zones.includes( 'jupiter' ) && ! r.overheated },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries( ACHIEVEMENTS.map( ( a ) => [ a.id, a ] ) );
