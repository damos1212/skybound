import { Group } from '../engine/scene/Group.js';
import { Mesh } from '../engine/scene/Mesh.js';
import { Material } from '../engine/render/Material.js';
import { CylinderGeometry, SphereGeometry, BoxGeometry, TorusGeometry, LatheGeometry, IcosahedronGeometry } from '../engine/geometry/index.js';
import { Vector2, MathUtils } from '../engine/math/index.js';
import { ToyBuilder } from '../world/Toy.js';
import { Starship, SHIP_LIVERIES } from './Starship.js';

// The Infinity Ark: a long spine with a prow, a spinning habitat ring on spokes, and at the stern a
// captive black hole in a cage of glowing orbits with its own little accretion disk, assembled from
// its upgrades (singularity core, dark energy tanks, wormhole bank, inertial dampers, neutronium hull,
// lens shield, the Reality Anchor). Local frame as the Starship's: origin at the engine, +y forward.

const CORE_COLORS = [ [ 1.0, 0.6, 0.25 ], [ 1.0, 0.45, 0.6 ], [ 0.75, 0.4, 1.0 ], [ 0.45, 0.6, 1.0 ], [ 1.0, 0.95, 0.85 ] ];

export class Ark extends Starship {

	constructor( scene ) {

		super( scene );
		this.group.name = 'ark';
		// the captive black hole: pure black
		this.voidMat = new Material( { name: 'ark-void', lit: false, surface: 's.albedo = vec3f( 0.0 ); s.emissive = vec3f( 0.0 );' } );
		this.spin = 0;

	}

	build( levels, livery = 'classic' ) {

		this.levels = { ...levels };
		for ( const c of [ ...this.group.children ] ) this.group.remove( c );
		const L = ( id ) => levels[ id ] || 0;
		const liv = SHIP_LIVERIES[ livery ] || SHIP_LIVERIES.classic;
		const b = new ToyBuilder();
		const core = L( 'singularity' );
		const dc = CORE_COLORS[ core ];
		const hullL = L( 'hullark' );

		// the spine and the prow
		const len = 18 + L( 'darktanks' ) * 0.5;
		const R = 1.5;
		b.add( new CylinderGeometry( R, R * 1.1, len * 0.62, 24 ), { position: [ 0, 3.2 + len * 0.31, 0 ], color: liv.hull } );
		const prof = [];
		for ( let i = 0; i <= 12; i ++ ) {

			const t = i / 12;
			prof.push( new Vector2( Math.max( 0.001, R * 1.35 * Math.pow( 1 - t, 0.8 ) ), t * len * 0.36 ) );

		}

		b.add( new LatheGeometry( prof, 6 ), { position: [ 0, 3.2 + len * 0.62, 0 ], color: liv.trim, flat: true } );
		b.add( new SphereGeometry( 0.9, 16, 10 ), { position: [ 0, 3.2 + len * 0.66, R * 0.95 ], scale: [ 0.9, 1.4, 0.6 ], color: 0x7fe3ff } );
		// hull plating
		for ( let i = 0; i < 3 + hullL; i ++ ) b.add( new CylinderGeometry( R + 0.14, R + 0.14, 0.5, 6 ), { position: [ 0, 4.5 + i * ( len * 0.5 / ( 3 + hullL ) ), 0 ], color: hullL >= 2 ? 0x3b3f48 : 0xb8c2cc } );

		// the habitat ring on four spokes (a separate mesh: it spins)
		const ringY = 3.2 + len * 0.36, ringR = 5.4 + L( 'dampers' ) * 0.3;
		const rb = new ToyBuilder();
		rb.add( new TorusGeometry( ringR, 0.75, 12, 56 ), { color: liv.hull } );
		for ( let i = 0; i < 16; i ++ ) {

			const a = i / 16 * Math.PI * 2;
			rb.add( new BoxGeometry( 0.5, 0.35, 1.0 ), { position: [ Math.cos( a ) * ( ringR + 0.55 ), Math.sin( a ) * ( ringR + 0.55 ), 0 ], rotation: [ 0, 0, a ], color: 0x7fe3ff } );

		}

		for ( let i = 0; i < 4; i ++ ) {

			const a = i / 4 * Math.PI * 2;
			rb.add( new BoxGeometry( ringR - R, 0.3, 0.4 ), { position: [ Math.cos( a ) * ( ringR + R ) / 2, Math.sin( a ) * ( ringR + R ) / 2, 0 ], rotation: [ 0, 0, a ], color: 0x8f9aa6 } );

		}

		this.habitat = new Mesh( rb.build(), this.mats.paint );
		this.habitat.castShadow = true;
		this.habitatPivot = new Group();
		this.habitatPivot.position.set( 0, ringY, 0 );
		this.habitatPivot.rotation.x = Math.PI / 2;
		this.habitatPivot.add( this.habitat );
		this.group.add( this.habitatPivot );

		// dark energy tanks: capsules on the flanks
		for ( let i = 0; i <= L( 'darktanks' ); i ++ ) for ( const sx of [ - 1, 1 ] ) b.add( new CylinderGeometry( 0.5, 0.5, 2.2, 14 ), { position: [ sx * ( R + 0.55 ), 5 + i * 2.4, 0 ], color: 0x2b2f48 } );

		// inertial damper vanes
		for ( const sx of [ - 1, 1 ] ) b.add( new BoxGeometry( 2.4, 3.6, 0.3 ), { position: [ sx * ( R + 1.6 ), len * 0.72, 0 ], rotation: [ 0, 0, sx * - 0.55 ], color: liv.accent, flat: true } );

		// the stern: the black hole's cage struts and three engine bells around it
		const bhY = 1.2;
		for ( let i = 0; i < 3; i ++ ) {

			const a = i / 3 * Math.PI * 2 + Math.PI / 2;
			b.add( new BoxGeometry( 0.3, 3.4, 0.3 ), { position: [ Math.cos( a ) * 2.3, bhY + 0.9, Math.sin( a ) * 2.3 ], color: 0x8f9aa6 } );

		}

		this.nozzles = [];
		for ( let i = 0; i < 3; i ++ ) {

			const a = i / 3 * Math.PI * 2 - Math.PI / 2;
			const x = Math.cos( a ) * 2.6, z = Math.sin( a ) * 2.6;
			b.add( new CylinderGeometry( 0.4, 0.75, 1.3, 16, 1, true ), { position: [ x, - 0.6, z ], color: 0x8f9aa6 } );
			this.nozzles.push( { x, z, r: 0.75 } );

		}

		// lens shield: a thin dish ahead of the prow
		const lens = L( 'lens' );
		if ( lens >= 1 ) b.add( new CylinderGeometry( 1.6 + lens * 0.5, 1.6 + lens * 0.5, 0.12, 32 ), { position: [ 0, 3.4 + len * 0.99, 0 ], color: lens >= 3 ? 0xf2f6fa : 0x8fa8c8 } );

		this.hullMat = this.hullMat || this.mats.paint.clone();
		this.hull = new Mesh( b.build(), this.hullMat );
		this.hull.castShadow = true;
		this.hull.receiveShadow = true;
		this.group.add( this.hull );

		// the captive black hole
		this.hole = new Mesh( new SphereGeometry( 1.25, 24, 16 ), this.voidMat );
		this.hole.position.set( 0, bhY + 0.9, 0 );
		this.group.add( this.hole );

		// glowing bits: accretion disk, cage orbits, tank lights, wormhole coils, the anchor
		const gb = new ToyBuilder();
		gb.add( new TorusGeometry( 1.9, 0.28, 6, 40 ), { position: [ 0, bhY + 0.9, 0 ], rotation: [ Math.PI / 2 + 0.25, 0, 0 ], scale: [ 1, 1, 0.35 ], color: [ dc[ 0 ], dc[ 1 ], dc[ 2 ] ] } );
		gb.add( new TorusGeometry( 1.45, 0.06, 6, 32 ), { position: [ 0, bhY + 0.9, 0 ], rotation: [ Math.PI / 2 + 0.25, 0, 0 ], color: 0xfff2d8 } );
		for ( let i = 0; i <= L( 'darktanks' ); i ++ ) for ( const sx of [ - 1, 1 ] ) gb.add( new BoxGeometry( 0.12, 1.6, 0.2 ), { position: [ sx * ( R + 1.06 ), 5 + i * 2.4, 0 ], color: 0xb070ff } );
		for ( let i = 0; i < L( 'capacitor' ) + 1; i ++ ) gb.add( new TorusGeometry( R + 0.2, 0.1, 6, 28 ), { position: [ 0, 3.6 + len * 0.55 + i * 0.6, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x7fe3ff } );
		if ( L( 'anchor' ) > 0 ) gb.add( new IcosahedronGeometry( 0.8, 0 ), { position: [ 0, 3.2 + len * 0.62 + len * 0.36 + 1.1, 0 ], color: 0xffd36a, flat: true } );
		gb.add( new SphereGeometry( 0.15, 8, 6 ), { position: [ - ringR - 0.9, ringY, 0 ], color: 0xff2020 } );
		gb.add( new SphereGeometry( 0.15, 8, 6 ), { position: [ ringR + 0.9, ringY, 0 ], color: 0x20ff40 } );
		this.glow = new Mesh( gb.build(), this.glowMat );
		this.group.add( this.glow );
		this.sails = null;

		this._addPlumes( dc, - 1.2, 11 );
		this._addBubble( len * 0.5 + 1.5, ringR * 1.5, len * 0.72 );
		this.height = len + 3.2;
		this.colliders = [ { x: 0, y: 1.8, r: 2.6 }, { x: 0, y: len * 0.45, r: R * 1.4 }, { x: 0, y: len * 0.8, r: R * 1.2 }, { x: - ringR, y: ringY, r: 1.3 }, { x: ringR, y: ringY, r: 1.3 } ];
		this.mouthY = len * 0.3;
		this.envelopeH = len * 0.4;
		this.bagSlots = [];

	}

	update( state, dt, extra = {} ) {

		super.update( state, dt, extra );
		const jump = state.jumpT > 0 ? 1 : 0;
		this.spin += dt * ( 0.6 + this.burn * 0.8 + jump * 6 );
		this.habitat.rotation.z = this.spin * 0.5;
		this.glowMat.set( 'k', 0.8 + this.burn * 0.9 + Math.sin( this.spin * 3 ) * 0.1 + jump * 2.5 );
		this.group.rotation.z = MathUtils.clamp( - ( state.vx || 0 ) * 0.008, - 0.3, 0.3 );

	}

}

