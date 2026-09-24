// Flight model for the balloon, in the gameplay plane (x right, y up, metres, seconds). Pure
// functions of plain objects so the balance can be simulated outside the browser (tools/balance.mjs).
//
// Hot air: the burner raises the envelope's heat (0..1), which cools toward ambient. Lift is the
// buoyant acceleration at full heat scaled by the heat and by the air density, which halves every
// ~5.5 km: every envelope has a ceiling where lift equals gravity. Quadratic drag (thinner up high)
// sets the climb rate; the envelope acts as a parachute on the way down.

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
