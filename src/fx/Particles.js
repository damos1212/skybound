import { Mesh } from '../engine/scene/Mesh.js';
import { InstancedBufferGeometry, InstancedBufferAttribute, Float32BufferAttribute } from '../engine/geometry/index.js';
import { Material } from '../engine/render/Material.js';
import { localLightsCoreModule } from '../world/LocalLights.js';

// CPU-simulated billboard particles, drawn as one instanced quad batch per blend mode:
//   glow (additive): flames, sparks, exhaust cores, star dust
//   soft (alpha): smoke, clouds of debris, confetti, splashes
// emit( { x, y, z, vx, vy, vz, life, size, grow, color: [ r, g, b ], alpha, drag, gravity, spin, kind } )
// Colours are linear HDR (glow values above 1 bloom). kind: 0 round soft, 1 square (confetti), 2 streak.

const MAX = 6000;

class Batch {

	constructor( scene, name, blending, lit = false ) {

		this.pos = new Float32Array( MAX * 4 );
		this.col = new Float32Array( MAX * 4 );
		this.ext = new Float32Array( MAX * 4 );
		const g = new InstancedBufferGeometry();
		g.setAttribute( 'position', new Float32BufferAttribute( [ - 0.5, - 0.5, 0, 0.5, - 0.5, 0, 0.5, 0.5, 0, - 0.5, - 0.5, 0, 0.5, 0.5, 0, - 0.5, 0.5, 0 ], 3 ) );
		this.aPos = new InstancedBufferAttribute( this.pos, 4 );
		this.aCol = new InstancedBufferAttribute( this.col, 4 );
		this.aExt = new InstancedBufferAttribute( this.ext, 4 );
		g.setAttribute( 'aPos', this.aPos );
		g.setAttribute( 'aCol', this.aCol );
		g.setAttribute( 'aExt', this.aExt );
		g.instanceCount = 0;
		this.geometry = g;
		this.material = new Material( {
			name, lit: false, transparent: true, depthWrite: false, blending, side: 'double',
			velocityWeight: 0,
			modules: lit ? [ localLightsCoreModule ] : [],
			attributes: { aPos: 'vec4f', aCol: 'vec4f', aExt: 'vec4f' },
			varyings: { vCol: 'vec4f', vCorner: 'vec3f' },
			vertex: /* wgsl */`
	// camera-facing quad: right / up from the camera's world matrix, streaks along their velocity
	let right = normalize( frame.invView[ 0 ].xyz );
	let up = normalize( frame.invView[ 1 ].xyz );
	let rot = v.aExt.x;
	let cs = cos( rot ); let sn = sin( rot );
	var c = vec2f( v.position.x * cs - v.position.y * sn, v.position.x * sn + v.position.y * cs );
	var wp = v.aPos.xyz + ( right * c.x + up * c.y ) * v.aPos.w;
	if ( v.aExt.z > 1.5 ) {
		// streak: stretch along the (screen-projected) direction stored in aExt.w (angle)
		let a = v.aExt.w;
		let d = right * cos( a ) + up * sin( a );
		let n = right * -sin( a ) + up * cos( a );
		wp = v.aPos.xyz + d * v.position.x * v.aPos.w * 6.0 + n * v.position.y * v.aPos.w * 0.35;
	}
	v.useWorld = true;
	v.worldPos = wp;
	v.worldNormal = normalize( frame.cameraPos - wp );
	o.vCol = v.aCol;
	o.vCorner = vec3f( v.position.xy, v.aExt.z );
`,
			surface: /* wgsl */`
	let k = in.vs.vCorner;
	var a = 1.0;
	if ( k.z < 0.5 ) { a = pow( sat( 1.0 - length( k.xy ) * 2.0 ), 1.6 ); }
	else if ( k.z > 1.5 ) { a = sat( 1.0 - abs( k.y ) * 2.0 ) * sat( 1.0 - abs( k.x ) * 2.0 ); }
	s.albedo = vec3f( 0.0 );
${ lit ? /* wgsl */`
	// smoke, spray and confetti are lit: the sun wrapped round a puff (a sphere normal from the
	// corner), the sky, and the engines' and lamps' glow
	let right = normalize( frame.invView[ 0 ].xyz );
	let up = normalize( frame.invView[ 1 ].xyz );
	let toCam = normalize( frame.cameraPos - in.P );
	let c2 = k.xy * 2.0;
	let n = normalize( right * c2.x + up * c2.y + toCam * sqrt( max( 1.0 - dot( c2, c2 ), 0.05 ) ) );
	let wrap = 0.35 + 0.65 * max( dot( n, frame.sunDir ), 0.0 );
	let E = frame.sunColor * wrap * INV_PI + frame.skyIrradiance * 1.1 + localLightsIrradiance( in.P, n ) * INV_PI;
	s.emissive = in.vs.vCol.rgb * E;` : /* wgsl */`
	s.emissive = in.vs.vCol.rgb;` }
	s.alpha = in.vs.vCol.a * a;
`,
		} );
		this.mesh = new Mesh( g, this.material );
		this.mesh.frustumCulled = false;
		this.mesh.layers.set( 2 );
		this.mesh.castShadow = false;
		scene.add( this.mesh );
		this.list = [];

	}

}

export class Particles {

	constructor( scene ) {

		this.glow = new Batch( scene, 'particles-glow', 'additive' );
		this.soft = new Batch( scene, 'particles-soft', 'normal', true );
		this.time = 0;

	}

	emit( p ) {

		const b = p.additive === false || p.soft ? this.soft : this.glow;
		if ( b.list.length >= MAX ) b.list.shift();
		const c = p.color || [ 1, 1, 1 ];
		b.list.push( {
			x: p.x, y: p.y, z: p.z || 0,
			vx: p.vx || 0, vy: p.vy || 0, vz: p.vz || 0,
			life: p.life || 1, age: 0,
			size: p.size || 1, grow: p.grow ?? 0,
			r: c[ 0 ], g: c[ 1 ], b: c[ 2 ], a: p.alpha ?? 1,
			fade: p.fade ?? 1, drag: p.drag ?? 0, gravity: p.gravity ?? 0,
			rot: p.rot ?? Math.random() * 6.28, spin: p.spin ?? 0,
			kind: p.kind || 0, cool: p.cool || null,
		} );

	}

	// a burst of n particles around ( x, y ) with random velocities
	burst( n, o ) {

		for ( let i = 0; i < n; i ++ ) {

			const a = Math.random() * Math.PI * 2, e = ( Math.random() - 0.5 ) * Math.PI;
			const sp = ( o.speed || 10 ) * ( 0.3 + Math.random() * 0.7 );
			const col = Array.isArray( o.colors ) ? o.colors[ ( Math.random() * o.colors.length ) | 0 ] : o.color;
			this.emit( {
				...o, color: col,
				x: o.x + ( Math.random() - 0.5 ) * ( o.spread || 0 ), y: o.y + ( Math.random() - 0.5 ) * ( o.spread || 0 ), z: ( o.z || 0 ) + ( Math.random() - 0.5 ) * ( o.spread || 0 ),
				vx: Math.cos( a ) * Math.cos( e ) * sp + ( o.vx || 0 ), vy: Math.sin( e ) * sp + ( o.vy || 0 ), vz: Math.sin( a ) * Math.cos( e ) * sp * 0.5,
				life: ( o.life || 1 ) * ( 0.6 + Math.random() * 0.8 ), size: ( o.size || 1 ) * ( 0.6 + Math.random() * 0.8 ),
				spin: ( o.spin || 0 ) * ( Math.random() - 0.5 ) * 2,
			} );

		}

	}

	confetti( x, y, n = 120 ) {

		const cols = [ [ 1.6, 0.3, 0.2 ], [ 1.6, 1.2, 0.2 ], [ 0.2, 1.3, 0.5 ], [ 0.3, 0.7, 1.8 ], [ 1.2, 0.4, 1.5 ], [ 1.8, 1.8, 1.8 ] ];
		for ( let i = 0; i < n; i ++ ) {

			const a = Math.random() * Math.PI * 2;
			const sp = 8 + Math.random() * 22;
			this.emit( {
				soft: true, x, y, z: ( Math.random() - 0.5 ) * 4, vx: Math.cos( a ) * sp, vy: Math.sin( a ) * sp + 10, vz: ( Math.random() - 0.5 ) * 8,
				life: 2.5 + Math.random() * 2, size: 0.45 + Math.random() * 0.4, color: cols[ i % cols.length ], alpha: 1, fade: 0.3,
				drag: 1.4, gravity: - 6, spin: ( Math.random() - 0.5 ) * 14, kind: 1,
			} );

		}

	}

	explosion( x, y, scale = 1 ) {

		this.burst( 40 * scale, { x, y, speed: 22 * scale, life: 0.6, size: 3 * scale, grow: 4, color: [ 12, 6, 2 ], drag: 3, fade: 1.5 } );
		this.burst( 30 * scale, { x, y, speed: 12 * scale, life: 1.8, size: 4 * scale, grow: 6, color: [ 0.25, 0.22, 0.2 ], soft: true, alpha: 0.8, drag: 2 } );
		this.burst( 24 * scale, { x, y, speed: 45 * scale, life: 0.5, size: 0.25 * scale, color: [ 20, 12, 5 ], kind: 2, drag: 1 } );

	}

	clear() {

		this.glow.list.length = 0;
		this.soft.list.length = 0;

	}

	update( dt, camera ) {

		this.time += dt;
		for ( const b of [ this.glow, this.soft ] ) {

			let n = 0;
			const keep = [];
			for ( const p of b.list ) {

				p.age += dt;
				if ( p.age >= p.life ) continue;
				const k = Math.exp( - p.drag * dt );
				p.vx *= k; p.vy *= k; p.vz *= k;
				p.vy += p.gravity * dt;
				p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
				p.rot += p.spin * dt;
				keep.push( p );
				const t = p.age / p.life;
				const size = p.size * ( 1 + p.grow * t );
				const fade = Math.pow( 1 - t, p.fade );
				let r = p.r, g = p.g, bl = p.b;
				if ( p.cool ) {

					// fire cools toward smoke colour over its life
					r += ( p.cool[ 0 ] - r ) * t; g += ( p.cool[ 1 ] - g ) * t; bl += ( p.cool[ 2 ] - bl ) * t;

				}

				const o = n * 4;
				b.pos[ o ] = p.x; b.pos[ o + 1 ] = p.y; b.pos[ o + 2 ] = p.z; b.pos[ o + 3 ] = size;
				b.col[ o ] = r; b.col[ o + 1 ] = g; b.col[ o + 2 ] = bl; b.col[ o + 3 ] = p.a * fade;
				let ang = 0;
				if ( p.kind === 2 && camera ) {

					// streak direction on screen: project the velocity onto the camera plane
					const e = camera.matrixWorld.elements;
					ang = Math.atan2( p.vx * e[ 4 ] + p.vy * e[ 5 ] + p.vz * e[ 6 ], p.vx * e[ 0 ] + p.vy * e[ 1 ] + p.vz * e[ 2 ] );

				}

				b.ext[ o ] = p.rot; b.ext[ o + 1 ] = 0; b.ext[ o + 2 ] = p.kind; b.ext[ o + 3 ] = ang;
				n ++;

			}

			b.list = keep;
			b.geometry.instanceCount = n;
			b.mesh.visible = n > 0;
			if ( n > 0 ) {

				for ( const a of [ b.aPos, b.aCol, b.aExt ] ) {

					a.clearUpdateRanges();
					a.addUpdateRange( 0, n * 4 );
					a.needsUpdate = true;

				}

			}

		}

	}

}
