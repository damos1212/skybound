import { Group } from '../engine/scene/Group.js';
import { Mesh } from '../engine/scene/Mesh.js';
import { Material } from '../engine/render/Material.js';
import { LatheGeometry, CylinderGeometry, BoxGeometry, SphereGeometry, ConeGeometry, TorusGeometry, RoundedBoxGeometry } from '../engine/geometry/index.js';
import { Vector2, Vector3, Quaternion, Matrix4, MathUtils } from '../engine/math/index.js';
import { Float32BufferAttribute } from '../engine/geometry/index.js';
import { ToyBuilder, toyMaterials } from '../world/Toy.js';

// The player's balloon, assembled from the owned upgrade levels: envelope (lathe gores in the
// level's livery), gondola, burner with its flame, fuel bottles, side fans and sandbags. Local frame:
// origin at the bottom of the gondola, envelope above. `update()` animates it from the flight state.

const ENVELOPE_LIVERY = [
	// patchwork: muted mismatched patches
	{ gores: [ 0xd98a5f, 0xe9c46a, 0x8ab17d, 0xe76f51, 0xb5838d, 0xf4a261, 0x6d9dc5, 0xe9c46a ], bands: 3, patch: true },
	{ gores: [ 0xe2463a, 0xfaf3e3 ], bands: 1 },
	{ gores: [ 0x2f6fde, 0xffcf3f, 0x2f6fde, 0xfaf3e3 ], bands: 2 },
	{ gores: [ 0xc9d3dc, 0xe8eef2 ], bands: 1, metal: true },
	{ gores: [ 0x1d2433, 0xff5a36, 0x1d2433, 0xffc93c ], bands: 2, glow: true },
];

// classic balloon profile: ( radius, height ) fractions from the mouth to the crown
const PROFILE = [ [ 0.2, 0 ], [ 0.3, 0.07 ], [ 0.52, 0.2 ], [ 0.8, 0.38 ], [ 0.96, 0.54 ], [ 1.0, 0.64 ], [ 0.96, 0.75 ], [ 0.84, 0.86 ], [ 0.6, 0.95 ], [ 0.3, 0.995 ], [ 0.0, 1.0 ] ];

function smoothProfile( R, H, n = 28 ) {

	const pts = [];
	const P = PROFILE;
	for ( let i = 0; i <= n; i ++ ) {

		const t = i / n * ( P.length - 1 );
		const k = Math.min( P.length - 2, Math.floor( t ) ), f = t - k;
		const p0 = P[ Math.max( 0, k - 1 ) ], p1 = P[ k ], p2 = P[ k + 1 ], p3 = P[ Math.min( P.length - 1, k + 2 ) ];
		const cr = ( a, b, c, d ) => 0.5 * ( 2 * b + ( - a + c ) * f + ( 2 * a - 5 * b + 4 * c - d ) * f * f + ( - a + 3 * b - 3 * c + d ) * f * f * f );
		pts.push( new Vector2( Math.max( 0, cr( p0[ 0 ], p1[ 0 ], p2[ 0 ], p3[ 0 ] ) ) * R, cr( p0[ 1 ], p1[ 1 ], p2[ 1 ], p3[ 1 ] ) * H ) );

	}

	return pts;

}

export class Balloon {

	constructor( scene ) {

		this.group = new Group();
		this.group.name = 'balloon';
		scene.add( this.group );
		this.mats = toyMaterials();
		this.flameMat = new Material( {
			name: 'flame', lit: false, transparent: true, blending: 'additive', depthWrite: false, vertexColors: true,
			uniforms: { flicker: [ 'f32', 1 ] },
			surface: /* wgsl */`
	let up = sat( in.uv.y );
	let core = pow( sat( dot( in.N, in.V ) ), 1.5 );
	s.emissive = mix( vec3f( 1.0, 0.35, 0.05 ), vec3f( 0.6, 0.75, 1.0 ), core * ( 1.0 - up ) ) * ( 30.0 * mat.flicker ) * ( 0.3 + core );
	s.albedo = vec3f( 0.0 );
	s.alpha = sat( core * 1.6 ) * ( 1.0 - up * 0.7 );
`,
		} );
		this.shieldMat = new Material( {
			name: 'bubble', lit: false, transparent: true, depthWrite: false,
			uniforms: { strength: [ 'f32', 0 ], hit: [ 'f32', 0 ] },
			surface: /* wgsl */`
	let f = pow( 1.0 - sat( dot( in.N, in.V ) ), 3.0 );
	let swirl = sin( in.P.y * 0.7 + frame.time * 2.0 + in.P.x * 0.4 ) * 0.5 + 0.5;
	let tint = mix( vec3f( 0.4, 0.8, 1.0 ), vec3f( 1.0, 0.5, 0.9 ), swirl );
	s.emissive = tint * ( f * 3.0 + 0.05 ) * mat.strength + vec3f( 1.0, 0.9, 0.6 ) * mat.hit * 4.0;
	s.albedo = vec3f( 0.0 );
	s.alpha = ( f * 0.8 + 0.04 ) * mat.strength + mat.hit * 0.5;
`,
		} );
		this.levels = null;
		this.burn = 0;
		this.fanSpin = 0;
		this.sway = new Vector2();
		this.swayVel = new Vector2();

	}

	// (re)build every part for the given upgrade levels
	build( levels ) {

		this.levels = { ...levels };
		for ( const c of [ ...this.group.children ] ) this.group.remove( c );
		const lv = ( id ) => levels[ id ] || 0;
		const size = [ 1.0, 1.08, 1.16, 1.26, 1.4 ][ lv( 'envelope' ) ];
		const R = 5.4 * size, H = 12.5 * size;
		this.mouthY = 4.4;
		this.envelopeR = R;
		this.envelopeH = H;

		// ---- envelope
		const liv = ENVELOPE_LIVERY[ Math.min( lv( 'envelope' ), ENVELOPE_LIVERY.length - 1 ) ];
		const eb = new ToyBuilder();
		const pts = smoothProfile( R, H );
		const G = 16;
		for ( let i = 0; i < G; i ++ ) {

			// horizontal bands: split the profile
			const bands = liv.bands;
			for ( let b = 0; b < bands; b ++ ) {

				const i0 = Math.floor( b / bands * ( pts.length - 1 ) ), i1 = Math.floor( ( b + 1 ) / bands * ( pts.length - 1 ) );
				const seg = pts.slice( i0, i1 + 1 );
				let color = liv.gores[ ( i + b * ( liv.patch ? 3 : 1 ) ) % liv.gores.length ];
				if ( liv.patch ) color = liv.gores[ ( i * 5 + b * 3 + ( i * b ) % 4 ) % liv.gores.length ];
				eb.add( new LatheGeometry( seg, 3, i / G * Math.PI * 2, Math.PI * 2 / G ), { position: [ 0, this.mouthY, 0 ], color } );

			}

		}

		// load tapes along the seams
		for ( let i = 0; i < G; i ++ ) {

			const a = i / G * Math.PI * 2;
			const tape = pts.map( ( p ) => new Vector3( Math.cos( a ) * ( p.x + 0.03 ), this.mouthY + p.y, - Math.sin( a ) * ( p.x + 0.03 ) ) );
			for ( let k = 0; k < tape.length - 1; k ++ ) addRod( eb, tape[ k ], tape[ k + 1 ], 0.045, liv.metal ? 0x6f7a86 : 0x3b3b44, 4 );

		}

		const envMat = liv.metal ? this.mats.metal : this.mats.fabric;
		this.envelope = new Mesh( eb.build(), envMat );
		this.envelope.castShadow = true;
		this.envelope.receiveShadow = true;
		this.group.add( this.envelope );

		if ( liv.glow ) {

			const gb = new ToyBuilder();
			const k = Math.floor( pts.length * 0.5 );
			gb.add( new TorusGeometry( pts[ k ].x + 0.08, 0.12, 6, 48 ), { position: [ 0, this.mouthY + pts[ k ].y, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x7fe3ff } );
			this.envelope.add( new Mesh( gb.build(), this.mats.glow ) );

		}

		// skirt (scoop) below the mouth
		const skirt = new ToyBuilder().add( new CylinderGeometry( pts[ 0 ].x, pts[ 0 ].x * 0.8, 1.1, 16, 1, true ), { position: [ 0, this.mouthY - 0.5, 0 ], color: liv.metal ? 0x8f9aa6 : 0x2b2f36 } );
		const skirtMesh = new Mesh( skirt.build(), new Material( { name: 'skirt', vertexColors: true, roughness: 0.8, side: 'double' } ) );
		skirtMesh.castShadow = true;
		this.group.add( skirtMesh );

		// ---- gondola
		const basket = lv( 'basket' );
		const gb = new ToyBuilder();
		const w = 1.7 + basket * 0.08, h = 1.3;
		if ( basket <= 1 ) {

			// wicker: woven rounded box with a leather rim
			gb.add( new RoundedBoxGeometry( w, h, w, 2, 0.18 ), { position: [ 0, h / 2, 0 ], color: 0xb98a4e, jitter: 0.2 } );
			gb.add( new RoundedBoxGeometry( w + 0.16, 0.2, w + 0.16, 2, 0.08 ), { position: [ 0, h, 0 ], color: 0x6b3f22 } );
			if ( basket === 1 ) for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) gb.add( new BoxGeometry( 0.12, h + 0.1, 0.12 ), { position: [ sx * w / 2, h / 2, sz * w / 2 ], color: 0x4a4f57 } );

		} else if ( basket === 2 ) {

			gb.add( new RoundedBoxGeometry( w, h, w, 2, 0.1 ), { position: [ 0, h / 2, 0 ], color: 0xb8c2cc } );
			for ( let i = - 2; i <= 2; i ++ ) gb.add( new BoxGeometry( 0.06, h, w + 0.04 ), { position: [ i * w / 5, h / 2, 0 ], color: 0x8f9aa6 } );

		} else if ( basket === 3 ) {

			gb.add( new SphereGeometry( w * 0.62, 20, 12 ), { position: [ 0, h * 0.62, 0 ], scale: [ 1, 0.78, 1 ], color: 0x2b2f36 } );
			gb.add( new TorusGeometry( w * 0.62, 0.08, 8, 32 ), { position: [ 0, h * 0.75, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xff5a36 } );

		} else {

			gb.add( new SphereGeometry( w * 0.72, 24, 16 ), { position: [ 0, h * 0.72, 0 ], color: 0xf4efe6 } );
			gb.add( new TorusGeometry( w * 0.5, 0.1, 8, 32 ), { position: [ 0, h * 0.72, w * 0.5 ], color: 0x2b2f36 } );
			gb.add( new CylinderGeometry( w * 0.46, w * 0.46, 0.05, 24 ), { position: [ 0, h * 0.72, w * 0.52 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x7fb8d6 } );

		}

		this.basketTop = h;
		// the pilot: leather cap, goggles and a red scarf, arms free to wave (open baskets only)
		this.pilot = null;
		if ( basket <= 2 ) {

			const pb = new ToyBuilder();
			pb.add( new CylinderGeometry( 0.2, 0.24, 0.7, 12 ), { position: [ 0, 0.35, 0 ], color: 0x3a6ea5 } );
			pb.add( new SphereGeometry( 0.2, 14, 10 ), { position: [ 0, 0.9, 0 ], color: 0xf1c7a0 } );
			pb.add( new SphereGeometry( 0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55 ), { position: [ 0, 0.93, 0 ], color: 0x6b3f22 } );
			pb.add( new TorusGeometry( 0.07, 0.025, 6, 12 ), { position: [ - 0.08, 0.95, 0.17 ], color: 0x2b2f36 } );
			pb.add( new TorusGeometry( 0.07, 0.025, 6, 12 ), { position: [ 0.08, 0.95, 0.17 ], color: 0x2b2f36 } );
			pb.add( new CylinderGeometry( 0.06, 0.06, 0.02, 10 ), { position: [ - 0.08, 0.95, 0.18 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x9fd8ff } );
			pb.add( new CylinderGeometry( 0.06, 0.06, 0.02, 10 ), { position: [ 0.08, 0.95, 0.18 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x9fd8ff } );
			pb.add( new TorusGeometry( 0.2, 0.06, 6, 16 ), { position: [ 0, 0.68, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0xe2463a } );
			pb.add( new BoxGeometry( 0.1, 0.35, 0.04 ), { position: [ 0.12, 0.55, 0.2 ], rotation: [ 0.2, 0, 0.3 ], color: 0xe2463a } );
			this.pilot = new Group();
			const body = new Mesh( pb.build(), this.mats.paint );
			body.castShadow = true;
			this.pilot.add( body );
			this.pilotArms = [];
			for ( const sx of [ - 1, 1 ] ) {

				const arm = new Group();
				arm.position.set( sx * 0.22, 0.62, 0 );
				const am = new Mesh( new ToyBuilder().add( new CylinderGeometry( 0.06, 0.06, 0.45, 8 ), { position: [ 0, - 0.2, 0 ], color: 0x3a6ea5 } ).add( new SphereGeometry( 0.07, 8, 6 ), { position: [ 0, - 0.44, 0 ], color: 0xf1c7a0 } ).build(), this.mats.paint );
				arm.add( am );
				this.pilot.add( arm );
				this.pilotArms.push( arm );

			}

			this.pilot.position.set( w * 0.18, h - 0.55, w * 0.12 );
			this.group.add( this.pilot );

		}

		const gondola = new Mesh( gb.build(), basket === 3 || basket >= 4 ? this.mats.paint : this.mats.matte );
		gondola.castShadow = true;
		gondola.receiveShadow = true;
		this.group.add( gondola );

		// ---- rigging, burner frame, fuel bottles, fans, sandbags (metal + paint)
		const rb = new ToyBuilder();
		const mouthR = pts[ 0 ].x;
		const frameY = h + 1.6;
		for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

			const a = new Vector3( sx * w * 0.45, h, sz * w * 0.45 );
			const b = new Vector3( sx * mouthR * 0.72, this.mouthY - 0.2, sz * mouthR * 0.72 );
			addRod( rb, a, b, 0.04, 0x3b3b44 );

		}

		// burner frame
		rb.add( new TorusGeometry( 0.7, 0.05, 6, 20 ), { position: [ 0, frameY, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x3b3b44 } );
		const burner = lv( 'burner' );
		const nb = burner >= 2 ? 2 : 1;
		for ( let i = 0; i < nb; i ++ ) {

			const ox = nb === 2 ? ( i - 0.5 ) * 0.55 : 0;
			rb.add( new CylinderGeometry( 0.2, 0.26, 0.5, 12 ), { position: [ ox, frameY + 0.1, 0 ], color: burner >= 3 ? 0x2b2f36 : 0x9aa4ad } );
			if ( burner >= 3 ) rb.add( new TorusGeometry( 0.24, 0.05, 6, 16 ), { position: [ ox, frameY + 0.32, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: burner >= 4 ? 0x7fe3ff : 0xff5a36 } );

		}

		// bottles standing in the corners of the gondola
		const tank = lv( 'tank' );
		const bottles = [ 1, 2, 3, 4, 4 ][ tank ];
		const corners = [ [ - 0.45, - 0.45 ], [ 0.45, - 0.45 ], [ - 0.45, 0.45 ], [ 0.45, 0.45 ] ];
		for ( let i = 0; i < bottles; i ++ ) {

			const [ cx, cz ] = corners[ i ];
			const col = tank >= 4 ? 0x7fe3ff : tank >= 3 ? 0xff5a36 : 0xe8e2d6;
			rb.add( new CylinderGeometry( 0.22, 0.22, 1.0, 12 ), { position: [ cx * w * 0.8, h + 0.1, cz * w * 0.8 ], color: col } );
			rb.add( new SphereGeometry( 0.22, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2 ), { position: [ cx * w * 0.8, h + 0.6, cz * w * 0.8 ], color: col } );

		}

		// sandbags hanging on the outside
		const bags = [ 0, 1, 3, 5 ][ lv( 'ballast' ) ];
		this.bagSlots = [];
		for ( let i = 0; i < bags; i ++ ) {

			const a = ( i / Math.max( bags, 1 ) ) * Math.PI * 2 + 0.4;
			this.bagSlots.push( [ Math.cos( a ) * ( w / 2 + 0.18 ), h * 0.55, Math.sin( a ) * ( w / 2 + 0.18 ) ] );

		}

		const rig = new Mesh( rb.build(), this.mats.metal );
		rig.castShadow = true;
		this.group.add( rig );

		this.bagMeshes = this.bagSlots.map( ( p ) => {

			const m = new Mesh( new ToyBuilder().add( new SphereGeometry( 0.3, 10, 8 ), { scale: [ 1, 1.25, 1 ], color: 0xc9a66b, jitter: 0.1 } ).add( new CylinderGeometry( 0.06, 0.06, 0.3, 6 ), { position: [ 0, 0.42, 0 ], color: 0x6b3f22 } ).build(), this.mats.matte );
			m.position.set( ...p );
			m.castShadow = true;
			this.group.add( m );
			return m;

		} );

		// ---- fans on outriggers
		const fans = lv( 'fans' );
		this.fanRotors = [];
		if ( fans > 0 ) {

			const fb = new ToyBuilder();
			for ( const sx of [ - 1, 1 ] ) {

				fb.add( new BoxGeometry( 1.1, 0.1, 0.1 ), { position: [ sx * ( w / 2 + 0.55 ), h * 0.7, 0 ], color: 0x3b3b44 } );
				if ( fans >= 2 ) fb.add( new TorusGeometry( 0.62, 0.08, 8, 24 ), { position: [ sx * ( w / 2 + 1.15 ), h * 0.7, 0 ], rotation: [ 0, Math.PI / 2, 0 ], color: fans >= 3 ? 0xff5a36 : 0xffc93c } );
				fb.add( new CylinderGeometry( 0.16, 0.16, 0.4, 10 ), { position: [ sx * ( w / 2 + 1.15 ), h * 0.7, 0 ], rotation: [ 0, 0, Math.PI / 2 ], color: 0x2b2f36 } );

			}

			const mounts = new Mesh( fb.build(), this.mats.paint );
			mounts.castShadow = true;
			this.group.add( mounts );
			for ( const sx of [ - 1, 1 ] ) {

				const rotor = new Mesh( new ToyBuilder()
					.add( new BoxGeometry( 0.05, 1.05, 0.2 ), { color: 0xfaf3e3 } )
					.add( new BoxGeometry( 0.05, 0.2, 1.05 ), { color: 0xfaf3e3 } ).build(), this.mats.paint );
				rotor.position.set( sx * ( w / 2 + 1.3 ), h * 0.7, 0 );
				rotor.castShadow = true;
				this.group.add( rotor );
				this.fanRotors.push( rotor );

			}

		}

		// ---- flame (additive, scaled by the burn)
		this.flames = [];
		for ( let i = 0; i < nb; i ++ ) {

			const ox = nb === 2 ? ( i - 0.5 ) * 0.55 : 0;
			const fl = new Mesh( new ToyBuilder().add( new ConeGeometry( 0.28, 1.8, 12, 4, true ), { position: [ 0, 0.9, 0 ], color: 0xffffff } ).build(), this.flameMat );
			fl.geometry.setAttribute( 'uv', uvFromHeight( fl.geometry, 1.8 ) );
			fl.position.set( ox, frameY + 0.35, 0 );
			fl.castShadow = false;
			fl.layers.set( 2 );
			this.group.add( fl );
			this.flames.push( fl );

		}

		this.flameColor = [ 0xffa040, 0xffa040, 0xffb050, 0x9fd8ff, 0xb070ff ][ burner ];

		// ---- shield bubble
		this.bubble = new Mesh( new SphereGeometry( 1, 32, 20 ), this.shieldMat );
		this.bubble.position.set( 0, ( this.mouthY + H * 0.4 ) , 0 );
		this.bubble.scale.setScalar( H * 0.72 );
		this.bubble.layers.set( 2 );
		this.bubble.visible = false;
		this.group.add( this.bubble );

		// collision circles in local (x, y): the envelope and the gondola
		this.colliders = [
			{ x: 0, y: this.mouthY + H * 0.56, r: R * 0.95 },
			{ x: 0, y: h * 0.55, r: w * 0.75 },
		];
		this.height = this.mouthY + H;

	}

	setBags( n ) {

		this.bagMeshes.forEach( ( m, i ) => {

			m.visible = i < n;

		} );

	}

	// state: flight state (Physics), dt, extra: { steer, shield (0..1), shieldHit, time }
	update( state, dt, { steer = 0, shield = 0, shieldHit = 0, time = 0 } = {} ) {

		this.group.position.set( state.x, state.y, 0 );
		// burn: flame length and flicker
		const target = state.burning ? 1 : 0;
		this.burn += ( target - this.burn ) * Math.min( 1, dt * ( target ? 14 : 6 ) );
		const flick = 0.85 + Math.sin( time * 43 ) * 0.08 + Math.sin( time * 71 + 1 ) * 0.07;
		this.flameMat.set( 'flicker', ( 0.15 + this.burn * 0.85 ) * flick );
		for ( const f of this.flames ) {

			const s = 0.35 + this.burn * ( 1.2 + ( this.levels.burner || 0 ) * 0.15 ) * flick;
			f.scale.set( 0.7 + this.burn * 0.5, s, 0.7 + this.burn * 0.5 );
			f.visible = ! state.popped;

		}

		// sway: a damped spring driven by acceleration and steering (the gondola swings)
		const ax = ( state.vx - ( this._pvx ?? state.vx ) ) / Math.max( dt, 1e-3 );
		const ay = ( state.vy - ( this._pvy ?? state.vy ) ) / Math.max( dt, 1e-3 );
		this._pvx = state.vx; this._pvy = state.vy;
		const kx = - ax * 0.004 - steer * 0.06;
		this.swayVel.x += ( ( kx - this.sway.x ) * 18 - this.swayVel.x * 3.2 ) * dt;
		this.sway.x += this.swayVel.x * dt;
		this.group.rotation.set( 0, Math.sin( time * 0.3 ) * 0.25, MathUtils.clamp( this.sway.x, - 0.35, 0.35 ) );
		// envelope squash and stretch with the climb rate
		const stretch = MathUtils.clamp( 1 + state.vy * 0.0015 + ay * 0.002, 0.92, 1.1 );
		this.envelope.scale.set( 1 / Math.sqrt( stretch ), stretch, 1 / Math.sqrt( stretch ) );
		if ( state.popped ) this.envelope.scale.set( 0.75, 0.35, 0.75 );

		this.fanSpin += dt * ( 8 + Math.abs( steer ) * 40 );
		for ( const r of this.fanRotors ) r.rotation.set( this.fanSpin, 0, 0 );

		this.bubble.visible = shield > 0.01 || shieldHit > 0.01;
		this.shieldMat.set( 'strength', shield );
		this.shieldMat.set( 'hit', shieldHit );

		// the pilot: arms down, a hand on the burner when it roars, both up to cheer
		if ( this.pilot ) {

			this.cheerT = Math.max( 0, ( this.cheerT || 0 ) - dt );
			const cheer = this.cheerT > 0 ? 1 : 0;
			const wave = Math.sin( time * 14 ) * 0.35;
			this.pilotArms[ 0 ].rotation.set( 0, 0, cheer ? - 2.6 + wave : - 0.25 );
			this.pilotArms[ 1 ].rotation.set( 0, 0, cheer ? 2.6 - wave : 0.25 + this.burn * 2.2 );
			this.pilot.position.y = this.basketTop - 0.55 + ( cheer ? Math.abs( Math.sin( time * 9 ) ) * 0.25 : 0 );
			this.pilot.rotation.y = Math.sin( time * 0.7 ) * 0.4 - steer * 0.6;

		}

	}

	cheer( seconds = 2 ) {

		this.cheerT = Math.max( this.cheerT || 0, seconds );

	}

}

const _up = new Vector3( 0, 1, 0 );
const _q = new Quaternion();
const _m = new Matrix4();

// a cylinder of radius r from a to c
function addRod( b, a, c, r, color, segments = 5 ) {

	const d = new Vector3().subVectors( c, a );
	const len = d.length();
	if ( len < 1e-4 ) return;
	const mid = new Vector3().addVectors( a, c ).multiplyScalar( 0.5 );
	_q.setFromUnitVectors( _up, d.divideScalar( len ) );
	_m.compose( mid, _q, new Vector3( 1, 1, 1 ) );
	b.add( new CylinderGeometry( r, r, len, segments, 1, true ), { matrix: _m, color } );

}

function uvFromHeight( g, h ) {

	const P = g.getAttribute( 'position' );
	const uv = new Float32Array( P.count * 2 );
	for ( let i = 0; i < P.count; i ++ ) {

		uv[ i * 2 ] = 0;
		uv[ i * 2 + 1 ] = P.getY( i ) / h;

	}

	return new Float32BufferAttribute( uv, 2 );

}
