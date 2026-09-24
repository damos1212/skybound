import { BufferGeometry, Float32BufferAttribute } from '../engine/geometry/index.js';
import { Material } from '../engine/render/Material.js';
import { Color, Matrix4, Vector3, Quaternion, Euler } from '../engine/math/index.js';

// "Toy" look: chunky primitives with baked vertex colours, merged into one geometry per object so a
// whole prop is one draw. Materials are shared: a painted one (satin, a touch of clearcoat), a matte
// one (wood, fabric, rock) and an emissive one (lamps).

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _p = new Vector3();
const _n = new Vector3();
const _c = new Color();

export class ToyBuilder {

	constructor() {

		this.pos = [];
		this.nrm = [];
		this.col = [];

	}

	// add a geometry (indexed or not) transformed by position / rotation (Euler xyz, rad) / scale,
	// tinted `color` (hex, Color or [ r, g, b ] in sRGB). `flat`: faceted normals (rocks, low poly)
	add( geometry, { position = [ 0, 0, 0 ], rotation = [ 0, 0, 0 ], scale = [ 1, 1, 1 ], color = 0xffffff, matrix = null, flat = false, jitter = 0 } = {} ) {

		const g = geometry.index ? geometry.toNonIndexed() : geometry;
		if ( matrix ) _m.copy( matrix );
		else {

			_e.set( rotation[ 0 ], rotation[ 1 ], rotation[ 2 ] );
			_q.setFromEuler( _e );
			_s.set( ...( typeof scale === 'number' ? [ scale, scale, scale ] : scale ) );
			_m.compose( _p.set( ...position ), _q, _s );

		}

		const nm = new Matrix4().copy( _m ).invert().transpose();
		const P = g.getAttribute( 'position' ), N = g.getAttribute( 'normal' );
		toColor( color, _c );
		const base = this.pos.length / 3;
		for ( let i = 0; i < P.count; i ++ ) {

			_p.set( P.getX( i ), P.getY( i ), P.getZ( i ) ).applyMatrix4( _m );
			this.pos.push( _p.x, _p.y, _p.z );
			if ( N && ! flat ) {

				_n.set( N.getX( i ), N.getY( i ), N.getZ( i ) ).applyMatrix4( nm ).normalize();
				this.nrm.push( _n.x, _n.y, _n.z );

			} else this.nrm.push( 0, 1, 0 );

			const j = jitter ? 1 + ( hash( base + i ) - 0.5 ) * jitter : 1;
			this.col.push( _c.r * j, _c.g * j, _c.b * j, 1 );

		}

		if ( flat || ! N ) this._flatten( base );
		return this;

	}

	// faceted normals for the triangles from vertex `from`
	_flatten( from ) {

		const p = this.pos, n = this.nrm;
		const a = new Vector3(), b = new Vector3(), c = new Vector3();
		for ( let v = from; v < p.length / 3; v += 3 ) {

			a.fromArray( p, v * 3 ); b.fromArray( p, v * 3 + 3 ); c.fromArray( p, v * 3 + 6 );
			const f = b.sub( a ).cross( c.sub( a ) ).normalize();
			for ( let k = 0; k < 3; k ++ ) { n[ ( v + k ) * 3 ] = f.x; n[ ( v + k ) * 3 + 1 ] = f.y; n[ ( v + k ) * 3 + 2 ] = f.z; }

		}

	}

	get count() {

		return this.pos.length / 3;

	}

	build() {

		const g = new BufferGeometry();
		g.setAttribute( 'position', new Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'normal', new Float32BufferAttribute( this.nrm, 3 ) );
		g.setAttribute( 'color', new Float32BufferAttribute( this.col, 4 ) );
		g.computeBoundingBox();
		g.computeBoundingSphere();
		return g;

	}

}

function hash( i ) {

	const x = Math.sin( i * 127.1 + 311.7 ) * 43758.5453;
	return x - Math.floor( x );

}

export function toColor( c, target = new Color() ) {

	if ( c && c.isColor ) return target.copy( c );
	// hex and [ r, g, b ] are sRGB (as picked in a paint program); stored linear
	if ( Array.isArray( c ) ) return target.setRGB( c[ 0 ], c[ 1 ], c[ 2 ], 'srgb' );
	return target.set( c );

}

let _mats = null;

// shared materials (vertex colours)
export function toyMaterials() {

	if ( _mats ) return _mats;
	_mats = {
		// painted: satin with a clearcoat (balloons, hulls, signs)
		paint: new Material( {
			name: 'toy-paint', vertexColors: true, roughness: 0.5, metalness: 0,
			defines: { CLEARCOAT: 1 },
			surface: /* wgsl */`
	s.clearcoat = 0.25;
	s.clearcoatRoughness = 0.3;
`,
		} ),
		// fabric: balloon envelopes (satin nylon, a soft sheen at grazing angles)
		fabric: new Material( {
			name: 'toy-fabric', vertexColors: true, roughness: 0.62, metalness: 0,
			defines: { SHEEN: 1 },
			surface: /* wgsl */`
	s.sheenColor = s.albedo * 0.5 + vec3f( 0.15 );
	s.sheenRoughness = 0.45;
	s.specularIntensity = 0.6;
`,
		} ),
		// matte: wood, cloth, sand, rock
		matte: new Material( { name: 'toy-matte', vertexColors: true, roughness: 0.85, metalness: 0 } ),
		// metal trim
		metal: new Material( { name: 'toy-metal', vertexColors: true, roughness: 0.3, metalness: 1 } ),
		// lamps / glowing bits
		glow: new Material( { name: 'toy-glow', vertexColors: true, lit: false, surface: 's.emissive = s.albedo * 6.0; s.albedo = vec3f( 0.0 );' } ),
	};
	return _mats;

}
