// A space run simulated the way the game plays it: burn until the tanks are dry, flybys in slow
// motion, hyperjumps spent as soon as sensible, a warp ring every few seconds, the Warpship's run
// ending at Sagittarius A*, the Ark held back at the Edge without its Reality Anchor.
import { computeStats } from '../src/game/Upgrades.js';
import { createShipState, stepShip, JUMP_TIME } from '../src/game/Physics.js';
import { flybyAt, BODY_BY_ID, ROUTE_LENGTH } from '../src/game/Route.js';
import { zoneById } from '../src/game/Zones.js';

export const RING_KICK = 0.8;
export const EDGE_GATE = () => zoneById( 'edge' ).from;

export function flyShip( levels, v, { ringsPerSecond = 0.2, useJumps = true, onStep = null, gates = true } = {} ) {

	const st = computeStats( levels, v );
	const s = createShipState( st, v );
	const dt = 1 / 30;
	let t = 0, coast = 0, rings = 0, jumpsUsed = 0, nextRing = 3, end = 'drift';
	while ( t < 600 ) {

		const fb = flybyAt( s.d / 1000 );
		const [ win, rate ] = fb.body.slow || [ 24, 3.2 ];
		const cap = Math.abs( fb.offset ) < win * fb.body.R ? rate * fb.body.R * 1000 : Infinity;
		if ( useJumps && s.jumps > 0 && s.jumpT <= 0 && t > 4 + jumpsUsed * 9 ) {

			s.jumps --;
			s.jumpT = JUMP_TIME;
			jumpsUsed ++;

		}

		if ( t > nextRing ) {

			s.kick += RING_KICK * st.ring;
			rings ++;
			nextRing += 1 / ringsPerSecond;

		}

		stepShip( s, st, { burn: true }, dt, 0, cap );
		t += dt;
		if ( onStep ) onStep( s, t );
		if ( gates && v === 'warpship' && s.d >= BODY_BY_ID.blackhole.at * 1000 ) {

			s.d = BODY_BY_ID.blackhole.at * 1000;
			end = 'horizon';
			break;

		}

		if ( v === 'ark' && ! st.anchor && s.d > EDGE_GATE() ) s.d = EDGE_GATE();
		if ( s.d >= ROUTE_LENGTH * 1000 * 0.999 ) {

			end = 'victory';
			break;

		}

		// (the last approach to the Edge coasts on to the wall)
		// (a coasting ship still going faster than a flyby's slow motion carries on through it)
		const final = v === 'ark' && st.anchor && s.d > EDGE_GATE();
		if ( s.fuel <= 0 && ! final && s.v <= cap ) {

			coast += dt;
			if ( coast > 2.5 ) break;

		}

	}

	s.maxY = Math.max( s.maxY, s.d );
	return { h: s.maxY, t, v: s.v, rings, jumpsUsed, end };

}
