import { Mesh } from '../engine/scene/Mesh.js';
import { CylinderGeometry, SphereGeometry, BoxGeometry, TorusGeometry, LatheGeometry } from '../engine/geometry/index.js';
import { Vector2, Color, MathUtils } from '../engine/math/index.js';
import { ToyBuilder } from '../world/Toy.js';
import { Starship, SHIP_LIVERIES } from './Starship.js';

// The Warpship: a needle hull through a glowing warp ring, nacelles on pylons, a deflector dish,
// assembled from its upgrades (warp core, antimatter pods, jump capacitor coils, gravitic fins,
// deflector, radiation screen collar, ring tuner). Local frame as the Starship's: origin at the
// engine, +y forward. The warp ring's glow follows the core level and flares on a hyperjump.

const CORE_COLORS = [ [ 0.3, 0.7, 1.0 ], [ 0.45, 0.5, 1.0 ], [ 0.7, 0.35, 1.0 ], [ 1.0, 0.35, 0.8 ], [ 0.35, 1.0, 0.85 ] ];

export class Warpship extends Starship {

	constructor( scene ) {

		super( scene );
		this.group.name = 'warpship';
		this.spin = 0;

	}

	build( levels, livery = 'classic' ) {

		this.levels = { ...levels };
		for ( const c of [ ...this.group.children ] ) this.group.remove( c );
		const L = ( id ) => levels[ id ] || 0;
		const liv = SHIP_LIVERIES[ livery ] || SHIP_LIVERIES.classic;
		const b = new ToyBuilder();
		const core = L( 'core' );
		const dc = CORE_COLORS[ core ];
		const dcHex = new Color().setRGB( dc[ 0 ], dc[ 1 ], dc[ 2 ] );

		// the needle hull
		const len = 15 + L( 'pods' ) * 0.5;
		const R = 1.25;
		const prof = [];
		for ( let i = 0; i <= 24; i ++ ) {

			const t = i / 24;
			const r = t < 0.1 ? R * ( 0.75 + t / 0.1 * 0.25 ) : t < 0.62 ? R : R * Math.pow( Math.max( 0, 1 - ( t - 0.62 ) / 0.38 ), 0.7 );
			prof.push( new Vector2( Math.max( 0.001, r ), 1.0 + t * len ) );

		}

		b.add( new LatheGeometry( prof, 28 ), { color: liv.hull } );
		for ( const t of [ 0.18, 0.5 ] ) b.add( new CylinderGeometry( R + 0.04, R + 0.04, 0.45, 28 ), { position: [ 0, 1 + t * len, 0 ], color: liv.trim } );
		// canopy
		b.add( new SphereGeometry( 0.8, 18, 12 ), { position: [ 0, 1 + len * 0.72, R * 0.55 ], scale: [ 0.8, 1.8, 0.7 ], color: 0x7fe3ff } );

		// the warp ring's housing (the glow goes in the glow mesh)
		const ringY = 1 + len * 0.42, ringR = 4.6;
		b.add( new TorusGeometry( ringR, 0.42, 12, 48 ), { position: [ 0, ringY, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: liv.trim } );
		for ( let i = 0; i < 4; i ++ ) {

			const a = i / 4 * Math.PI * 2 + Math.PI / 4;
			b.add( new BoxGeometry( ringR - R, 0.22, 0.5 ), { position: [ Math.cos( a ) * ( ringR + R ) / 2, ringY, Math.sin( a ) * ( ringR + R ) / 2 ], rotation: [ 0, - a, 0 ], color: 0x8f9aa6 } );

		}

		// nacelles on swept pylons: two, four with a strong core
		const nac = core >= 3 ? [ [ - 1, - 0.6 ], [ 1, - 0.6 ], [ - 1, 0.6 ], [ 1, 0.6 ] ] : [ [ - 1, 0 ], [ 1, 0 ] ];
		this.nacelles = [];
		for ( const [ sx, sz ] of nac ) {

			const x = sx * ( ringR + 1.2 ), z = sz * 1.6, y = 2.2;
			b.add( new BoxGeometry( ringR - 0.4, 0.3, 0.8 ), { position: [ sx * ( R + ringR ) * 0.55, y + 1.8, z * 0.6 ], rotation: [ 0, 0, sx * 0.35 ], color: liv.hull, flat: true } );
			b.add( new CylinderGeometry( 0.62, 0.55, 8, 18 ), { position: [ x, y + 3.2, z ], color: liv.hull } );
			b.add( new SphereGeometry( 0.62, 14, 10 ), { position: [ x, y + 7.2, z ], scale: [ 1, 0.8, 1 ], color: 0xb33a2a } );
			this.nacelles.push( { x, y: y + 3.2, z } );

		}

		// gravitic fins
		const fins = L( 'gravitic' );
		for ( const sx of [ - 1, 1 ] ) b.add( new BoxGeometry( 1.6 + fins * 0.5, 2.8, 0.22 ), { position: [ sx * ( R + 0.9 + fins * 0.25 ), 2.2, 0 ], rotation: [ 0, 0, sx * - 0.5 ], color: liv.accent, flat: true } );
		b.add( new BoxGeometry( 0.25, 2.6, 2.2 ), { position: [ 0, 2.6, - R - 0.8 ], rotation: [ - 0.4, 0, 0 ], color: liv.accent, flat: true } );

		// antimatter pods: bulbs along the belly
		for ( let i = 0; i <= L( 'pods' ); i ++ ) b.add( new SphereGeometry( 0.42, 12, 8 ), { position: [ 0, 3.5 + i * 1.3, - R - 0.1 ], color: 0x3b3f48 } );

		// radiation screen: a gold foil collar
		const scr = L( 'screen' );
		if ( scr >= 1 ) b.add( new CylinderGeometry( R + 0.35 + scr * 0.1, R + 0.2, 1.2 + scr * 0.5, 28, 1, true ), { position: [ 0, 1 + len * 0.62, 0 ], color: scr >= 3 ? 0xf2f6fa : 0xd9a441 } );

		// engine block
		b.add( new CylinderGeometry( R * 0.95, R * 1.15, 1.6, 24 ), { position: [ 0, 0.8, 0 ], color: 0x3b3f48 } );
		b.add( new CylinderGeometry( 0.6, 1.0, 1.2, 18, 1, true ), { position: [ 0, - 0.3, 0 ], color: 0x8f9aa6 } );
		this.nozzles = [ { x: 0, z: 0, r: 1.0 } ];

		this.hullMat = this.hullMat || this.mats.paint.clone();
		this.hull = new Mesh( b.build(), this.hullMat );
		this.hull.castShadow = true;
		this.hull.receiveShadow = true;
		this.group.add( this.hull );

		// glowing bits: the warp ring, nacelle strips, the deflector, capacitor coils, tuner rings
		const gb = new ToyBuilder();
		gb.add( new TorusGeometry( ringR, 0.2, 8, 64 ), { position: [ 0, ringY, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: dcHex } );
		for ( const n of this.nacelles ) {

			gb.add( new BoxGeometry( 0.2, 6.2, 0.3 ), { position: [ n.x + Math.sign( n.x ) * 0.55, n.y, n.z ], color: dcHex } );
			gb.add( new SphereGeometry( 0.45, 12, 8 ), { position: [ n.x, n.y + 4.1, n.z + 0.1 ], color: 0xff5030 } );

		}

		const defl = L( 'deflector' );
		gb.add( new CylinderGeometry( 0.7 + defl * 0.15, 0.4, 0.3, 20 ), { position: [ 0, 1 + len * 0.3, R + 0.15 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x6fd8ff } );
		for ( let i = 0; i < L( 'capacitor' ) + 1; i ++ ) gb.add( new TorusGeometry( R + 0.12, 0.09, 6, 28 ), { position: [ 0, 2.0 + i * 0.55, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xb070ff } );
		for ( let i = 0; i < L( 'tuner' ); i ++ ) gb.add( new TorusGeometry( 0.45 - i * 0.12, 0.06, 6, 20 ), { position: [ 0, 1 + len * ( 0.95 - i * 0.05 ), 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xffd36a } );
		gb.add( new SphereGeometry( 0.13, 8, 6 ), { position: [ - ringR - 0.6, ringY, 0 ], color: 0xff2020 } );
		gb.add( new SphereGeometry( 0.13, 8, 6 ), { position: [ ringR + 0.6, ringY, 0 ], color: 0x20ff40 } );
		this.glow = new Mesh( gb.build(), this.glowMat );
		this.group.add( this.glow );
		this.sails = null;

		this._addPlumes( dc, - 0.9, 12 );
		this._addBubble( len * 0.5 + 1, ringR * 1.45, len * 0.72 );
		this.height = len + 1.5;
		this.colliders = [ { x: 0, y: 2.5, r: 2.2 }, { x: 0, y: len * 0.5, r: R * 1.3 }, { x: 0, y: len * 0.85, r: R }, { x: - ringR, y: ringY, r: 1.1 }, { x: ringR, y: ringY, r: 1.1 }, { x: - ringR - 1.2, y: 5.4, r: 1.3 }, { x: ringR + 1.2, y: 5.4, r: 1.3 } ];
		this.mouthY = len * 0.3;
		this.envelopeH = len * 0.4;
		this.bagSlots = [];

	}

	update( state, dt, extra = {} ) {

		super.update( state, dt, extra );
		// the warp ring pulses with the burn and blazes during a hyperjump
		const jump = state.jumpT > 0 ? 1 : 0;
		this.spin += dt * ( 1 + this.burn * 3 + jump * 12 );
		this.glowMat.set( 'k', 0.7 + this.burn * 0.9 + Math.sin( this.spin * 2 ) * 0.15 + jump * 2.5 );
		this.group.rotation.z = MathUtils.clamp( - ( state.vx || 0 ) * 0.01, - 0.35, 0.35 );

	}

}
