// Flight model for the balloon, in the gameplay plane (x right, y up, metres, seconds). Pure
// functions of plain objects so the balance can be simulated outside the browser (tools/balance.mjs).
//
// Hot air: the burner raises the envelope's heat (0..1), which cools toward ambient. Lift is the
// buoyant acceleration at full heat scaled by the heat and by the air density, which halves every
// ~5.5 km: every envelope has a ceiling where lift equals gravity. Quadratic drag (thinner up high)
// sets the climb rate; the envelope acts as a parachute on the way down.

import { LEGS, BODY_BY_ID } from './Route.js';

export const G = 9.81;
export const SCALE_HEIGHT = 8000;
const LIFT_EXP = 0.62;
const DRAG_EXP = 1.6;
const COOL = 0.3;

export function airDensity( y ) {

	return Math.exp( - Math.max( 0, y ) / SCALE_HEIGHT );

}

// wind (m/s, +x) at altitude y: a sea breeze, calmer air above, the jet stream around 10 km
export function windAt( y, t = 0 ) {

	const breeze = 3.5 * Math.exp( - y / 900 );
	const mid = 6 * smooth( 800, 3000, y ) * ( 1 - smooth( 6000, 8000, y ) );
	const jet = 42 * Math.exp( - Math.pow( ( y - 10500 ) / 1800, 2 ) );
	const gust = Math.sin( t * 0.37 + y * 0.002 ) * 1.2 + Math.sin( t * 0.91 + y * 0.0071 ) * 0.6;
	return breeze + mid + jet + gust * ( 0.4 + 0.6 * smooth( 200, 2000, y ) );

}

function smooth( e0, e1, x ) {

	const t = Math.min( 1, Math.max( 0, ( x - e0 ) / ( e1 - e0 ) ) );
	return t * t * ( 3 - 2 * t );

}

export function createState( stats ) {

	return {
		x: 0, y: 0, vx: 0, vy: 0,
		heat: 0.5, // pre-heated on the pad
		fuel: stats.fuel,
		hull: stats.hull,
		leak: 0, // extra cooling from envelope damage (per second)
		bags: stats.bags,
		kick: 0, // sandbag impulse left to apply (m/s)
		burning: false,
		popped: false,
		grounded: true,
		time: 0,
		maxY: 0,
	};

}

// input: { burn: bool, steer: -1..1 }
export function step( s, stats, input, dt, groundY = 0 ) {

	s.time += dt;
	const rho = airDensity( s.y );
	s.burning = !! input.burn && s.fuel > 0 && ! s.popped;
	// heat: first order toward the burner's equilibrium P / ( P + c ) while it burns, cooling
	// toward ambient otherwise; fuel drains while the burner is lit
	if ( s.burning ) {

		s.heat += stats.heatRate * ( 1 - s.heat ) * dt;
		s.fuel = Math.max( 0, s.fuel - dt );

	}

	const cool = COOL + s.leak + ( s.popped ? 1.5 : 0 );
	s.heat = Math.max( 0, s.heat - s.heat * cool * dt );

	// vertical
	// (gamified: lift thins out slower than the air, and drag faster, so upgraded balloons keep
	// climbing briskly instead of crawling the last kilometres)
	const lift = s.popped ? 0 : stats.lift * s.heat * Math.pow( rho, LIFT_EXP );
	let ay = lift - G;
	const k = stats.drag * Math.pow( rho, DRAG_EXP );
	ay -= k * s.vy * Math.abs( s.vy ) * ( s.vy < 0 ? ( s.popped ? 0.6 : 3.0 ) : 1 );
	if ( s.kick > 0 ) {

		const k2 = Math.min( s.kick, 60 * dt );
		s.vy += k2;
		s.kick -= k2;

	}

	s.vy += ay * dt;

	// horizontal: fans against the air, which moves with the wind
	const wind = windAt( s.y, s.time );
	const ax = stats.fan * ( input.steer || 0 ) * ( s.popped ? 0.2 : 1 ) - 0.45 * ( s.vx - wind );
	s.vx += ax * dt;

	s.x += s.vx * dt;
	s.y += s.vy * dt;

	// resting on the pad / ground
	if ( s.y <= groundY ) {

		s.y = groundY;
		if ( s.vy < 0 ) s.vy = 0;
		s.grounded = true;
		s.vx *= Math.max( 0, 1 - 6 * dt );

	} else s.grounded = false;

	s.maxY = Math.max( s.maxY, s.y );
	return s;

}

export function dropBag( s ) {

	if ( s.bags <= 0 || s.popped ) return false;
	s.bags --;
	s.kick += 14;
	return true;

}

// ------------------------------------------------------------------------------------------ rocket
// Thrust along the rocket's axis (tilted by steering), gravity falling off with altitude, quadratic
// drag in the air. Solid boosters light with the main engine, burn out and drop away.

export const EARTH_R = 6371000;

export function gravityAt( y ) {

	const k = EARTH_R / ( EARTH_R + Math.max( 0, y ) );
	return G * k * k;

}

export function createRocketState( stats ) {

	return {
		x: 0, y: 0, vx: 0, vy: 0, angle: 0,
		fuel: stats.fuel, boosterFuel: stats.boosterTime, boosters: stats.boosters > 0, boosterLit: false, separated: false,
		hull: stats.hull, leak: 0, burning: false, popped: false, grounded: true, time: 0, maxY: 0, kick: 0, bags: 0,
		throttle: 0,
	};

}

export function stepRocket( s, stats, input, dt, groundY = 0 ) {

	s.time += dt;
	const rho = airDensity( s.y );
	s.burning = !! input.burn && s.fuel > 0 && ! s.popped;
	let thrust = 0;
	if ( s.burning ) {

		thrust += stats.thrust;
		s.fuel = Math.max( 0, s.fuel - dt );

	}

	// solids can't be throttled: once lit they burn out
	if ( s.boosters && s.boosterFuel > 0 && ( s.boosterLit || s.burning ) && ! s.popped ) {

		s.boosterLit = true;
		thrust += stats.boosterThrust;
		s.boosterFuel -= dt;
		if ( s.boosterFuel <= 0 ) {

			s.boosters = false;
			s.separated = true;

		}

	}

	s.throttle = thrust;
	// steering tilts the rocket (up to ~35°), it weathervanes back upright in the air
	const target = ( input.steer || 0 ) * 0.62;
	const rate = stats.steer * 1.2;
	s.angle += MathClamp( target - s.angle, - rate * dt, rate * dt );
	const g = gravityAt( s.y );
	let ax = Math.sin( s.angle ) * thrust;
	let ay = Math.cos( s.angle ) * thrust - g;
	// reaction control: a little sideways push even when coasting
	ax += ( input.steer || 0 ) * 2.5 * stats.steer * ( s.popped ? 0 : 1 );
	const sp = Math.hypot( s.vx, s.vy );
	const k = stats.drag * rho * ( s.popped ? 3 : 1 );
	ax -= k * sp * s.vx;
	ay -= k * sp * s.vy;
	s.vx += ax * dt;
	s.vy += ay * dt;
	s.x += s.vx * dt;
	s.y += s.vy * dt;
	if ( s.y <= groundY ) {

		s.y = groundY;
		if ( s.vy < 0 ) s.vy = 0;
		s.vx *= Math.max( 0, 1 - 6 * dt );
		s.grounded = true;

	} else s.grounded = false;

	s.maxY = Math.max( s.maxY, s.y );
	return s;

}

function MathClamp( v, a, b ) {

	return v < a ? a : v > b ? b : v;

}

// ---------------------------------------------------------------------------------------- ships
// Exponential flight: every second of burn multiplies the speed by e^boost, so the route's
// astronomical distances fit in a minute of play. `d` is the path distance from the Earth's surface
// (m); `x` the sideways position in the gameplay plane (dodging). The Starship starts in low orbit;
// the Warpship jumps out past the heliopause and the Infinity Ark through Sagittarius A* before
// their runs begin. A hyperjump (`jumpT`) adds JUMP_EFOLDS of speed over JUMP_TIME seconds.

export const ORBIT_START = 400000;
export const ORBIT_SPEED = 7800;
export const WARP_FROM = 6.0e12;
export const IMPROBABILITY = 1.35;
export const JUMP_EFOLDS = 1.2;
export const JUMP_TIME = 1.2;

const bh = BODY_BY_ID.blackhole;
export const SHIP_START = {
	starship: { d: ORBIT_START, v: ORBIT_SPEED },
	warpship: { d: ( LEGS[ BODY_BY_ID.alphacen.leg ].start + 1.52e10 ) * 1000, v: 1.5e10 },
	ark: { d: ( bh.at + 3 * bh.R ) * 1000, v: 4e14 },
};

export function createShipState( stats, vehicle = 'starship' ) {

	const st = SHIP_START[ vehicle ] || SHIP_START.starship;
	return {
		x: 0, y: 0, vx: 0, vy: 0,
		d: st.d, u: Math.log( st.v ), v: st.v,
		fuel: stats.fuel, hull: stats.hull, heat: 0, leak: 0, jumps: stats.jumps || 0, jumpT: 0,
		burning: false, popped: false, time: 0, maxY: st.d, kick: 0, bags: 0,
	};

}

// sunFlux: 0.. (1 at the Sun flyby distance), from the route
// maxAdvance (m/s): caps how fast the route distance grows (flybys play out in slow motion)
export function stepShip( s, stats, input, dt, sunFlux = 0, maxAdvance = Infinity ) {

	s.time += dt;
	s.burning = !! input.burn && s.fuel > 0 && ! s.popped;
	let boost = stats.boost;
	if ( stats.warp && s.d > WARP_FROM ) boost *= IMPROBABILITY;
	if ( s.burning ) {

		s.u += boost * dt;
		s.fuel = Math.max( 0, s.fuel - dt );

	} else {

		s.u -= 0.004 * dt;
		if ( stats.regen > 0 && ! s.popped ) s.fuel = Math.min( stats.fuel, s.fuel + stats.regen * dt );

	}

	if ( s.kick > 0 ) {

		s.u += Math.min( s.kick, dt * 2 ) * 0.15;
		s.kick = Math.max( 0, s.kick - dt * 2 );

	}

	if ( s.jumpT > 0 ) {

		s.u += JUMP_EFOLDS * Math.min( s.jumpT, dt ) / JUMP_TIME;
		s.jumpT = Math.max( 0, s.jumpT - dt );

	}

	s.v = Math.exp( s.u );
	s.d += Math.min( s.v, maxAdvance ) * dt;
	s.maxY = Math.max( s.maxY, s.d );
	// heat from the Sun (1 unit per second at the flyby with no shield), radiated away slowly
	s.heat = Math.max( 0, s.heat + ( sunFlux * 0.9 * stats.heat - 0.25 ) * dt );
	// sideways thrusters
	const target = ( input.steer || 0 ) * stats.steer * ( s.popped ? 0.2 : 1 );
	s.vx += ( target - s.vx ) * Math.min( 1, dt * 3 );
	s.x += s.vx * dt;
	return s;

}
