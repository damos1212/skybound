import { Group } from '../engine/scene/Group.js';
import { Mesh } from '../engine/scene/Mesh.js';
import { Material } from '../engine/render/Material.js';
import { CylinderGeometry, ConeGeometry, SphereGeometry, BoxGeometry, TorusGeometry, LatheGeometry, RoundedBoxGeometry, Float32BufferAttribute } from '../engine/geometry/index.js';
import { Vector2, Color, MathUtils } from '../engine/math/index.js';
import { ToyBuilder, toyMaterials } from '../world/Toy.js';

// The Starship: a chunky toy spaceplane assembled from its upgrades (drive, cells, thrusters, plating,
// heat shield, solar sails, the improbability drive's glowing ring). Local frame: origin at the
// engine, +y forward (up the screen). The drive plume's colour follows the drive level.

const DRIVE_COLORS = [ [ 0.35, 0.65, 1.0 ], [ 0.75, 0.35, 1.0 ], [ 1.0, 0.85, 0.5 ], [ 1.0, 0.3, 0.75 ], [ 0.3, 1.0, 0.95 ] ];

export const SHIP_LIVERIES = {
	classic: { name: 'Explorer', hull: 0xf4efe6, trim: 0x2f6fde, accent: 0xff5a36 },
	sunset: { name: 'Sunset', hull: 0xffcf3f, trim: 0xff5a36, accent: 0x2b2f36 },
	void: { name: 'Void', hull: 0x2b2f36, trim: 0x7fe3ff, accent: 0xb070ff },
	mint: { name: 'Mint', hull: 0xd8f5e6, trim: 0x3ccf6e, accent: 0x1d2433 },
	royal: { name: 'Royal', hull: 0x2a3f8f, trim: 0xffc93c, accent: 0xf4efe6 },
};

export class Starship {

	constructor( scene ) {

		this.group = new Group();
		this.group.name = 'starship';
		scene.add( this.group );
		this.mats = toyMaterials();
		this.plumeMat = new Material( {
			name: 'drive-plume', lit: false, transparent: true, blending: 'additive', depthWrite: false, side: 'double',
			uniforms: { power: [ 'f32', 1 ], tint: [ 'vec3f', [ 0.35, 0.65, 1.0 ] ] },
			surface: /* wgsl */`
	let along = sat( in.uv.y );
	let core = pow( sat( abs( dot( in.N, in.V ) ) ), 2.5 );
	let ring = 0.8 + 0.2 * sin( along * 30.0 - frame.time * 25.0 );
	s.emissive = mix( vec3f( 1.0 ), mat.tint, sat( along * 1.5 ) ) * 16.0 * mat.power * core * ring * ( 1.0 - along );
	s.albedo = vec3f( 0.0 );
	s.alpha = sat( core * 1.5 ) * ( 1.0 - along ) * mat.power;
`,
		} );
		this.glowMat = new Material( {
			name: 'ship-glow', lit: false, vertexColors: true, uniforms: { k: [ 'f32', 1 ] },
			surface: 's.emissive = s.albedo * 8.0 * mat.k; s.albedo = vec3f( 0.0 );',
		} );
		this.sailMat = new Material( {
			name: 'solar-sail', side: 'double', vertexColors: true, roughness: 0.15, metalness: 1,
			surface: 's.albedo = mix( s.albedo, vec3f( 0.9, 0.75, 0.4 ), 0.3 );',
		} );
		this.shieldMat = new Material( {
			name: 'ship-bubble', lit: false, transparent: true, depthWrite: false,
			uniforms: { strength: [ 'f32', 0 ], hit: [ 'f32', 0 ] },
			surface: /* wgsl */`
	let f = pow( 1.0 - sat( dot( in.N, in.V ) ), 3.0 );
	s.emissive = vec3f( 0.4, 0.8, 1.0 ) * ( f * 3.0 + 0.05 ) * mat.strength + vec3f( 1.0, 0.9, 0.6 ) * mat.hit * 4.0;
	s.albedo = vec3f( 0.0 );
	s.alpha = ( f * 0.8 + 0.04 ) * mat.strength + mat.hit * 0.5;
`,
		} );
		this.burn = 0;

	}

	build( levels, livery = 'classic' ) {

		this.levels = { ...levels };
		for ( const c of [ ...this.group.children ] ) this.group.remove( c );
		const L = ( id ) => levels[ id ] || 0;
		const liv = SHIP_LIVERIES[ livery ] || SHIP_LIVERIES.classic;
		const b = new ToyBuilder();
		const armor = L( 'armor' );

		// fuselage: a lathe from the engine block to the nose
		const len = 13 + L( 'cells' ) * 0.6;
		const R = 1.6;
		const prof = [];
		for ( let i = 0; i <= 20; i ++ ) {

			const t = i / 20;
			const r = t < 0.15 ? R * ( 0.8 + t / 0.15 * 0.2 ) : t < 0.7 ? R : R * Math.sqrt( Math.max( 0, 1 - Math.pow( ( t - 0.7 ) / 0.3, 2 ) ) );
			prof.push( new Vector2( Math.max( 0.001, r ), 1.0 + t * len ) );

		}

		b.add( new LatheGeometry( prof, 28 ), { color: liv.hull } );
		// trim bands, cockpit canopy
		for ( const t of [ 0.25, 0.55 ] ) b.add( new CylinderGeometry( R + 0.03, R + 0.03, 0.5, 28 ), { position: [ 0, 1 + t * len, 0 ], color: liv.trim } );
		b.add( new SphereGeometry( 0.95, 20, 12 ), { position: [ 0, 1 + len * 0.78, R * 0.62 ], scale: [ 0.9, 1.7, 0.7 ], color: 0x7fc7ff } );
		// armour plates
		if ( armor >= 1 ) for ( let i = 0; i < 6; i ++ ) {

			const a = i / 6 * Math.PI * 2;
			b.add( new RoundedBoxGeometry( 1.0, len * 0.35, 0.18, 1, 0.06 ), { position: [ Math.cos( a ) * ( R + 0.05 ), 1 + len * 0.42, Math.sin( a ) * ( R + 0.05 ) ], rotation: [ 0, - a + Math.PI / 2, 0 ], color: armor >= 3 ? 0x3b3f48 : 0xb8c2cc } );

		}

		// swept wings + tail fins
		for ( const sx of [ - 1, 1 ] ) {

			b.add( new BoxGeometry( 4.2, 3.4, 0.28 ), { position: [ sx * ( R + 1.7 ), 3.6, 0 ], rotation: [ 0, 0, sx * - 0.45 ], color: liv.hull, flat: true } );
			b.add( new BoxGeometry( 1.4, 1.2, 0.3 ), { position: [ sx * ( R + 3.4 ), 2.4, 0 ], rotation: [ 0, 0, sx * - 0.45 ], color: liv.accent, flat: true } );

		}

		b.add( new BoxGeometry( 0.3, 3.2, 2.6 ), { position: [ 0, 3.0, - R - 0.9 ], rotation: [ - 0.35, 0, 0 ], color: liv.trim, flat: true } );

		// engine block + nozzle(s) by drive level
		const drive = L( 'drive' );
		b.add( new CylinderGeometry( R * 0.95, R * 1.05, 1.4, 24 ), { position: [ 0, 0.8, 0 ], color: 0x3b3f48 } );
		const nozzles = drive >= 3 ? 3 : drive >= 1 ? 2 : 1;
		this.nozzles = [];
		for ( let i = 0; i < nozzles; i ++ ) {

			const a = nozzles === 1 ? 0 : i / nozzles * Math.PI * 2;
			const ox = nozzles === 1 ? 0 : Math.cos( a ) * 0.75, oz = nozzles === 1 ? 0 : Math.sin( a ) * 0.75;
			const nr = nozzles === 1 ? 0.9 : 0.55;
			b.add( new CylinderGeometry( nr * 0.55, nr, 1.2, 18, 1, true ), { position: [ ox, - 0.3, oz ], color: 0x8f9aa6 } );
			this.nozzles.push( { x: ox, z: oz, r: nr } );

		}

		// heat shield: a dish on the nose
		const hs = L( 'heatshield' );
		if ( hs >= 1 ) b.add( new SphereGeometry( R * 1.12, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2 ), { position: [ 0, 1 + len * 0.94, 0 ], scale: [ 1, 0.45, 1 ], color: hs >= 3 ? 0xe8eef2 : hs >= 2 ? 0x2b2f36 : 0x6b4b3a } );

		// RCS quads
		const rcs = L( 'thrusters' );
		for ( const sx of [ - 1, 1 ] ) for ( const y of [ 4, len * 0.7 ] ) b.add( new BoxGeometry( 0.35 + rcs * 0.08, 0.5, 0.5 ), { position: [ sx * ( R + 0.12 ), y, 0 ], color: 0x3b3b44 } );

		// the hull has its own copy of the paint so it can glow when it overheats
		this.hullMat = this.hullMat || this.mats.paint.clone();
		this.hull = new Mesh( b.build(), this.hullMat );
		this.hull.castShadow = true;
		this.hull.receiveShadow = true;
		this.group.add( this.hull );

		// glowing bits: drive rings, improbability ring, running lights
		const gb = new ToyBuilder();
		const dc = DRIVE_COLORS[ drive ];
		const dcHex = new Color().setRGB( dc[ 0 ], dc[ 1 ], dc[ 2 ] );
		for ( const n of this.nozzles ) gb.add( new TorusGeometry( n.r * 0.95, 0.07, 6, 18 ), { position: [ n.x, - 0.85, n.z ], rotation: [ Math.PI / 2, 0, 0 ], color: dcHex } );
		gb.add( new SphereGeometry( 0.14, 8, 6 ), { position: [ - R - 5.1, 2.1, 0 ], color: 0xff2020 } );
		gb.add( new SphereGeometry( 0.14, 8, 6 ), { position: [ R + 5.1, 2.1, 0 ], color: 0x20ff40 } );
		if ( L( 'improbability' ) > 0 ) {

			gb.add( new TorusGeometry( R * 2.2, 0.16, 8, 40 ), { position: [ 0, 1 + len * 0.45, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xff7ad9 } );
			gb.add( new TorusGeometry( R * 2.6, 0.08, 8, 40 ), { position: [ 0, 1 + len * 0.45, 0 ], rotation: [ Math.PI / 2 + 0.3, 0, 0 ], color: 0x7fe3ff } );

		}

		this.glow = new Mesh( gb.build(), this.glowMat );
		this.group.add( this.glow );

		// solar sails on booms
		const sails = L( 'sails' );
		this.sails = null;
		if ( sails > 0 ) {

			const sb = new ToyBuilder();
			const S = sails === 1 ? 5 : 7.5;
			for ( const sx of [ - 1, 1 ] ) {

				sb.add( new BoxGeometry( S * 1.4, 0.06, 0.06 ), { position: [ sx * ( R + S * 0.7 ), len * 0.55, 0 ], color: 0x8f9aa6 } );
				sb.add( new BoxGeometry( S, S * 1.3, 0.04 ), { position: [ sx * ( R + S * 0.75 ), len * 0.55, - 0.4 ], color: sails === 1 ? 0xd8c07a : 0x2b2f48, flat: true } );

			}

			this.sails = new Mesh( sb.build(), this.sailMat );
			this.sails.castShadow = true;
			this.group.add( this.sails );

		}

		this._addPlumes( dc );
		this._addBubble( len * 0.5 + 1, R * 4.5, len * 0.75 );

		this.height = len + 1.5;
		this.colliders = [ { x: 0, y: 2.5, r: 2.2 }, { x: 0, y: len * 0.5, r: R * 1.2 }, { x: 0, y: len * 0.85, r: R }, { x: - R - 2.8, y: 3.2, r: 1.6 }, { x: R + 2.8, y: 3.2, r: 1.6 } ];
		this.mouthY = len * 0.3;
		this.envelopeH = len * 0.4;
		this.bagSlots = [];

	}

	// drive plumes out of every nozzle ( { x, z, r } ), in the drive's colour
	_addPlumes( dc, y = - 0.9, length = 10 ) {

		this.plumeMat.set( 'tint', dc );
		this.plumes = this.nozzles.map( ( n ) => {

			const g = new ConeGeometry( n.r * 0.9, length, 18, 1, true ).rotateX( Math.PI ).translate( 0, - length / 2, 0 );
			const P = g.getAttribute( 'position' );
			const uv = new Float32Array( P.count * 2 );
			for ( let i = 0; i < P.count; i ++ ) uv[ i * 2 + 1 ] = - P.getY( i ) / length;
			g.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );
			const m = new Mesh( g, this.plumeMat );
			m.position.set( n.x, y, n.z );
			m.layers.set( 2 );
			this.group.add( m );
			return m;

		} );
		this.driveColor = dc;

	}

	// the bumper bubble around the hull
	_addBubble( cy, rx, ry ) {

		this.bubble = new Mesh( new SphereGeometry( 1, 32, 20 ), this.shieldMat );
		this.bubble.position.set( 0, cy, 0 );
		this.bubble.scale.set( rx, ry, rx );
		this.bubble.layers.set( 2 );
		this.bubble.visible = false;
		this.group.add( this.bubble );

	}

	setBags() {}

	update( state, dt, { shield = 0, shieldHit = 0, time = 0, visualY = null, heat = 0 } = {} ) {

		this.group.position.set( state.x, visualY ?? state.y, 0 );
		this.group.rotation.set( 0, Math.sin( time * 0.4 ) * 0.12, - ( state.vx || 0 ) * 0.012 );
		const target = state.burning ? 1 : 0;
		this.burn += ( target - this.burn ) * Math.min( 1, dt * ( target ? 12 : 6 ) );
		const fl = 0.9 + Math.sin( time * 47 ) * 0.06 + Math.sin( time * 83 ) * 0.04;
		this.plumeMat.set( 'power', Math.max( 0.08, this.burn ) * fl );
		for ( const p of this.plumes ) {

			p.visible = ! state.popped;
			p.scale.set( 1, 0.25 + this.burn * 0.75 * fl, 1 );

		}

		this.glowMat.set( 'k', 0.6 + this.burn * 0.8 + Math.sin( time * 3 ) * 0.1 );
		// overheating: the hull glows red-hot
		const k = MathUtils.clamp( ( heat - 0.3 ) / 0.8, 0, 1.2 );
		this.hullMat.emissive = [ 1.6 * k * k, 0.35 * k * k * k, 0.05 * k ];
		this.bubble.visible = shield > 0.01 || shieldHit > 0.01;
		this.shieldMat.set( 'strength', shield );
		this.shieldMat.set( 'hit', shieldHit );
		void heat;

	}

	exhaustPoints( state, visualY ) {

		const x0 = state.x, y0 = visualY ?? state.y;
		return this.nozzles.map( ( n ) => ( { x: x0 + n.x, y: y0 - 1.2, z: n.z, dx: 0, dy: - 1 } ) );

	}

}

export { MathUtils };
