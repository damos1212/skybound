import { Group } from '../engine/scene/Group.js';
import { Mesh } from '../engine/scene/Mesh.js';
import { Material } from '../engine/render/Material.js';
import { CylinderGeometry, ConeGeometry, SphereGeometry, BoxGeometry, TorusGeometry, LatheGeometry, Float32BufferAttribute } from '../engine/geometry/index.js';
import { Vector2, MathUtils } from '../engine/math/index.js';
import { ToyBuilder, toyMaterials } from '../world/Toy.js';

// The sounding rocket, assembled from its upgrades: a white body with the livery's bands, a nose cone,
// fins, the engine bell(s) and strap-on boosters that separate and tumble away. Local frame: origin at
// the bottom of the engine, +y up the rocket. Exhaust: an additive plume + particles (Game).

export const ROCKET_LIVERIES = {
	classic: { name: 'Classic', body: 0xf4efe6, band: 0xe2463a, accent: 0x2b2f36 },
	nasa: { name: 'Meatball', body: 0xf6f6f2, band: 0x2f6fde, accent: 0xe2463a },
	tintin: { name: 'Checkerboard', body: 0xe2463a, band: 0xf6f6f2, accent: 0xe2463a, checker: true },
	stealth: { name: 'Stealth', body: 0x2b2f36, band: 0x3b3f48, accent: 0xffc93c },
	gold: { name: 'Gilded', body: 0xe8c45a, band: 0xfff1c0, accent: 0x6b3f22 },
};

function flameMaterial( name, color ) {

	return new Material( {
		name, lit: false, transparent: true, blending: 'additive', depthWrite: false, side: 'double',
		uniforms: { power: [ 'f32', 1 ], tint: [ 'vec3f', color ] },
		surface: /* wgsl */`
	let along = sat( in.uv.y );
	let core = pow( sat( abs( dot( in.N, in.V ) ) ), 2.0 );
	let shock = 0.75 + 0.25 * sin( along * 40.0 - frame.time * 30.0 );
	s.emissive = mix( vec3f( 1.0, 0.95, 0.85 ), mat.tint, along ) * 40.0 * mat.power * core * shock * ( 1.0 - along * 0.7 );
	s.albedo = vec3f( 0.0 );
	s.alpha = sat( core * 1.4 ) * ( 1.0 - along ) * mat.power;
`,
	} );

}

function uvAlong( g, from, len ) {

	const P = g.getAttribute( 'position' );
	const uv = new Float32Array( P.count * 2 );
	for ( let i = 0; i < P.count; i ++ ) uv[ i * 2 + 1 ] = ( from - P.getY( i ) ) / len;
	g.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );
	return g;

}

export class Rocket {

	constructor( scene ) {

		this.group = new Group();
		this.group.name = 'rocket';
		scene.add( this.group );
		this.mats = toyMaterials();
		this.flameMat = flameMaterial( 'rocket-flame', [ 1.0, 0.45, 0.12 ] );
		this.boosterFlameMat = flameMaterial( 'booster-flame', [ 1.0, 0.6, 0.25 ] );
		this.shieldMat = new Material( {
			name: 'rocket-bubble', lit: false, transparent: true, depthWrite: false,
			uniforms: { strength: [ 'f32', 0 ], hit: [ 'f32', 0 ] },
			surface: /* wgsl */`
	let f = pow( 1.0 - sat( dot( in.N, in.V ) ), 3.0 );
	s.emissive = vec3f( 0.4, 0.8, 1.0 ) * ( f * 3.0 + 0.05 ) * mat.strength + vec3f( 1.0, 0.9, 0.6 ) * mat.hit * 4.0;
	s.albedo = vec3f( 0.0 );
	s.alpha = ( f * 0.8 + 0.04 ) * mat.strength + mat.hit * 0.5;
`,
		} );
		this.dropped = [];
		this.burn = 0;

	}

	build( levels, livery = 'classic' ) {

		this.levels = { ...levels };
		for ( const c of [ ...this.group.children ] ) this.group.remove( c );
		const L = ( id ) => levels[ id ] || 0;
		const liv = ROCKET_LIVERIES[ livery ] || ROCKET_LIVERIES.classic;
		const R = 1.25 + L( 'fuel' ) * 0.06;
		const bodyH = 10 + L( 'fuel' ) * 1.3;
		const engineH = 1.6;
		this.radius = R;

		const b = new ToyBuilder();
		// engine skirt + tank
		b.add( new CylinderGeometry( R, R * 1.08, 1.2, 28 ), { position: [ 0, engineH + 0.6, 0 ], color: liv.accent } );
		const bands = 5;
		for ( let i = 0; i < bands; i ++ ) {

			const h = bodyH / bands;
			const y = engineH + 1.2 + h * ( i + 0.5 );
			if ( liv.checker ) {

				for ( let k = 0; k < 8; k ++ ) b.add( new CylinderGeometry( R, R, h, 7, 1, true, k / 8 * Math.PI * 2, Math.PI * 2 / 8 ), { position: [ 0, y, 0 ], color: ( k + i ) % 2 ? liv.body : liv.band } );

			} else b.add( new CylinderGeometry( R, R, h, 28 ), { position: [ 0, y, 0 ], color: i === 1 || i === 3 ? liv.band : liv.body } );

		}

		const topY = engineH + 1.2 + bodyH;
		// interstage ring and a porthole
		b.add( new TorusGeometry( R + 0.02, 0.08, 6, 28 ), { position: [ 0, topY - bodyH * 0.2, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: liv.accent } );
		b.add( new CylinderGeometry( 0.42, 0.42, 0.2, 18 ), { position: [ 0, topY - bodyH * 0.12, R - 0.04 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x9fd4ea } );
		b.add( new TorusGeometry( 0.44, 0.07, 6, 18 ), { position: [ 0, topY - bodyH * 0.12, R + 0.04 ], color: liv.accent } );

		// nose cone
		const nose = L( 'nose' );
		const noseH = [ 2.2, 3.4, 4.4, 4.0 ][ nose ];
		if ( nose === 0 ) b.add( new SphereGeometry( R, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2 ), { position: [ 0, topY, 0 ], scale: [ 1, noseH / R, 1 ], color: liv.band } );
		else if ( nose === 3 ) {

			b.add( new ConeGeometry( R, noseH, 28 ), { position: [ 0, topY + noseH / 2, 0 ], color: 0xc9d3dc } );
			b.add( new CylinderGeometry( 0.06, 0.06, 1.4, 6 ), { position: [ 0, topY + noseH + 0.6, 0 ], color: 0x2b2f36 } );

		} else {

			// ogive / Von Kármán: a lathe profile
			const pts = [];
			for ( let i = 0; i <= 16; i ++ ) {

				const t = i / 16;
				const r = nose === 1 ? R * Math.sqrt( 1 - t * t ) : R * Math.sqrt( Math.max( 0, Math.acos( 2 * t - 1 ) - Math.sin( 2 * Math.acos( 2 * t - 1 ) ) / 2 ) / Math.PI );
				pts.push( new Vector2( Math.max( 0.001, r ), t * noseH ) );

			}

			b.add( new LatheGeometry( pts, 28 ), { position: [ 0, topY, 0 ], color: liv.band } );

		}

		this.height = topY + noseH;

		// fins
		const fins = L( 'fins' );
		const finCount = fins >= 2 ? 4 : 3;
		for ( let i = 0; i < finCount; i ++ ) {

			const a = i / finCount * Math.PI * 2 + Math.PI / 4;
			const fx = Math.cos( a ), fz = Math.sin( a );
			const size = [ 1.6, 1.9, 2.1, 1.5 ][ fins ];
			b.add( new BoxGeometry( size, 2.6, 0.14 ), { position: [ fx * ( R + size / 2 - 0.1 ), engineH + 1.8, fz * ( R + size / 2 - 0.1 ) ], rotation: [ 0, - a, 0.0 ], color: liv.accent, flat: true } );
			if ( fins === 3 ) {

				// grid fins near the top
				b.add( new BoxGeometry( 1.2, 0.9, 0.12 ), { position: [ fx * ( R + 0.65 ), topY - 0.8, fz * ( R + 0.65 ) ], rotation: [ 0, - a, 0 ], color: 0x6f7a86, flat: true } );

			}

		}

		// engine bell(s)
		const engine = L( 'engine' );
		const bells = engine >= 2 ? ( engine >= 4 ? 1 : 2 ) : 1;
		this.nozzles = [];
		for ( let i = 0; i < bells; i ++ ) {

			const ox = bells === 2 ? ( i - 0.5 ) * R * 0.9 : 0;
			const br = bells === 2 ? R * 0.42 : R * 0.62;
			b.add( new CylinderGeometry( br * 0.5, br, engineH, 20, 1, true ), { position: [ ox, engineH / 2, 0 ], color: engine >= 3 ? 0x3b3f48 : 0x8f9aa6 } );
			if ( engine >= 4 ) b.add( new TorusGeometry( br * 1.05, 0.1, 6, 24 ), { position: [ ox, 0.2, 0 ], rotation: [ Math.PI / 2, 0, 0 ], color: 0x7fe3ff } );
			this.nozzles.push( { x: ox, r: br } );

		}

		this.body = new Mesh( b.build(), this.mats.paint );
		this.body.castShadow = true;
		this.body.receiveShadow = true;
		this.group.add( this.body );

		// boosters (separate meshes: they drop away)
		const bst = L( 'boosters' );
		const count = [ 0, 2, 4, 2 ][ bst ], heavy = bst === 3;
		this.boosterMeshes = [];
		for ( let i = 0; i < count; i ++ ) {

			const a = i / count * Math.PI * 2 + ( count === 2 ? 0 : Math.PI / 4 );
			const br = heavy ? R * 0.95 : R * 0.48;
			const bh = heavy ? bodyH * 0.95 : bodyH * 0.62;
			const bb = new ToyBuilder();
			bb.add( new CylinderGeometry( br, br, bh, 20 ), { position: [ 0, bh / 2 + 1.0, 0 ], color: heavy ? liv.body : 0xf4efe6 } );
			bb.add( new ConeGeometry( br, br * 2.2, 20 ), { position: [ 0, bh + 1.0 + br * 1.1, 0 ], color: heavy ? liv.band : liv.band } );
			bb.add( new CylinderGeometry( br * 0.5, br * 0.85, 1.0, 16, 1, true ), { position: [ 0, 0.5, 0 ], color: 0x6f7a86 } );
			for ( let k = 0; k < 3; k ++ ) bb.add( new CylinderGeometry( br + 0.02, br + 0.02, 0.18, 20 ), { position: [ 0, 2 + k * bh * 0.3, 0 ], color: liv.accent } );
			const m = new Mesh( bb.build(), this.mats.paint );
			m.castShadow = true;
			const dist = R + br + 0.05;
			m.position.set( Math.cos( a ) * dist, 0.4, Math.sin( a ) * dist );
			m.userData = { angle: a, dist, r: br, h: bh };
			this.group.add( m );
			const fl = new Mesh( uvAlong( new ConeGeometry( br * 0.8, 9, 16, 1, true ).rotateX( Math.PI ).translate( 0, - 4.5, 0 ), 0, 9 ), this.boosterFlameMat );
			fl.layers.set( 2 );
			m.add( fl );
			m.userData.flame = fl;
			this.boosterMeshes.push( m );

		}

		// main plume
		this.flames = this.nozzles.map( ( n ) => {

			const fl = new Mesh( uvAlong( new ConeGeometry( n.r * 0.85, 12, 20, 1, true ).rotateX( Math.PI ).translate( 0, - 6, 0 ), 0, 12 ), this.flameMat );
			fl.position.set( n.x, 0.1, 0 );
			fl.layers.set( 2 );
			this.group.add( fl );
			return fl;

		} );

		this.bubble = new Mesh( new SphereGeometry( 1, 32, 20 ), this.shieldMat );
		this.bubble.position.set( 0, this.height * 0.5, 0 );
		this.bubble.scale.set( R * 3.2, this.height * 0.62, R * 3.2 );
		this.bubble.layers.set( 2 );
		this.bubble.visible = false;
		this.group.add( this.bubble );

		const n = 4;
		this.colliders = [];
		for ( let i = 0; i < n; i ++ ) this.colliders.push( { x: 0, y: 1.5 + ( this.height - 2 ) * ( i + 0.5 ) / n, r: R * 1.05 } );
		if ( count ) this.colliders.push( { x: - ( R + 0.8 ), y: bodyH * 0.35, r: 1 }, { x: R + 0.8, y: bodyH * 0.35, r: 1 } );
		this.mouthY = this.height * 0.3;
		this.envelopeH = this.height * 0.5;
		this.bagSlots = [];

	}

	setBags() {}

	// detach the boosters: they become free tumbling pieces (update moves them)
	separate( state ) {

		for ( const m of this.boosterMeshes ) {

			const a = m.userData.angle;
			this.group.remove( m );
			m.position.set( state.x + Math.cos( a ) * m.userData.dist, state.y + 0.4, Math.sin( a ) * m.userData.dist );
			m.rotation.set( 0, 0, this.group.rotation.z );
			m.userData.flame.visible = false;
			m.userData.v = { x: state.vx + Math.cos( a ) * 6, y: state.vy * 0.9, z: Math.sin( a ) * 6, spin: ( Math.random() - 0.5 ) * 2 + Math.cos( a ) * 1.5 };
			m.userData.life = 6;
			this.group.parent.add( m );
			this.dropped.push( m );

		}

		this.boosterMeshes = [];
		this.colliders = this.colliders.slice( 0, 4 );

	}

	clearDropped() {

		for ( const m of this.dropped ) m.parent && m.parent.remove( m );
		this.dropped = [];

	}

	update( state, dt, { shield = 0, shieldHit = 0, time = 0, visualY = null } = {} ) {

		this.group.position.set( state.lx ?? state.x, visualY ?? state.y, 0 );
		this.group.rotation.set( 0, Math.sin( time * 0.2 ) * 0.1, - state.angle );
		const target = state.burning ? 1 : 0;
		this.burn += ( target - this.burn ) * Math.min( 1, dt * ( target ? 16 : 8 ) );
		const fl = 0.9 + Math.sin( time * 57 ) * 0.06 + Math.sin( time * 91 ) * 0.05;
		// the plume widens in thin air
		const thin = MathUtils.clamp( ( state.y - 20000 ) / 60000, 0, 1 );
		this.flameMat.set( 'power', this.burn * fl );
		for ( const f of this.flames ) {

			f.visible = this.burn > 0.02 && ! state.popped;
			f.scale.set( 1 + thin * 1.8, ( 0.5 + this.burn * 0.8 ) * ( 1 + thin * 0.6 ) * fl, 1 + thin * 1.8 );

		}

		const boosting = state.boosterLit && state.boosters;
		this.boosterFlameMat.set( 'power', boosting ? fl : 0 );
		for ( const m of this.boosterMeshes ) m.userData.flame.visible = boosting;

		for ( const m of this.dropped ) {

			const v = m.userData.v;
			v.y -= 9.81 * dt;
			m.position.x += v.x * dt; m.position.y += v.y * dt; m.position.z += v.z * dt;
			m.rotation.z += v.spin * dt;
			m.userData.life -= dt;

		}

		this.dropped = this.dropped.filter( ( m ) => {

			if ( m.userData.life > 0 ) return true;
			m.parent && m.parent.remove( m );
			return false;

		} );

		this.bubble.visible = shield > 0.01 || shieldHit > 0.01;
		this.shieldMat.set( 'strength', shield );
		this.shieldMat.set( 'hit', shieldHit );

	}

	// where exhaust particles leave the nozzle (world)
	exhaustPoints( state, visualY ) {

		const c = Math.cos( state.angle ), s = Math.sin( state.angle );
		const x0 = state.lx ?? state.x, y0 = visualY ?? state.y;
		return this.nozzles.map( ( n ) => ( { x: x0 + n.x * c, y: y0 - n.x * s, dx: - s, dy: - c } ) );

	}

}
