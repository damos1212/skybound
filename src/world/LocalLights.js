import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { SceneLighting, surfaceModule } from '../engine/render/wgsl/lighting.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { G } from '../engine/render/Frame.js';
import { Vector4 } from '../engine/math/index.js';

// Local lights, adapted from Tidewater's LocalLights (MIT, see src/engine/LICENSE-tidewater): the
// engines' glow (the burner, rocket exhaust, the ships' drives), lamps on the pad, the barge and the
// workshop, the lighthouse's turning beam. No light object per lamp: each frame the CPU picks the
// MAX sources nearest the camera and packs them into three small uniform arrays that every lit
// material evaluates in one loop (Lambert + GGX, inverse-square falloff with a smooth range window,
// optional spot cone, no shadows). The same module gives the smoke its glow and the sea its glints.
//
// WGSL: installs the `localLights` hook; fn localLightsIrradiance( P, N ) -> vec3f (Lambert
// irradiance, for particles), fn localLightsSpecular( P, N, V, rough ) -> vec3f (for the water).

const MAX = 8;
const v4 = () => Array.from( { length: MAX }, () => new Vector4() );
const params = new UniformBlock( 'LocalLightParams', {
	pos: [ `vec4f[${ MAX }]`, v4() ], // xyz, range^2
	col: [ `vec4f[${ MAX }]`, v4() ], // rgb x intensity, cos(inner cone)
	dir: [ `vec4f[${ MAX }]`, v4() ], // spot axis, cos(outer cone) (-2: point light)
	count: [ 'i32', 0 ],
}, { label: 'localLights' } );
const F = params.fields;

const LIGHT_WGSL = /* wgsl */`
fn localLightsSpot( cd: f32, cosInner: f32, cosOuter: f32 ) -> f32 {
	let m = smoothstep( cosOuter, cosInner, cd );
	return max( m * m, smoothstep( cosOuter - 0.55, cosOuter, cd ) * 0.04 );
}
fn localLightsIrradiance( P: vec3f, N: vec3f ) -> vec3f {
	var E = vec3f( 0.0 );
	for ( var i = 0; i < localLights.count; i++ ) {
		let p = localLights.pos[ i ];
		let d = p.xyz - P;
		let d2 = dot( d, d );
		if ( d2 < p.w ) {
			let c = localLights.col[ i ];
			let sd = localLights.dir[ i ];
			let L = d * inverseSqrt( max( d2, 1e-6 ) );
			let x = d2 / p.w;
			let win = sat( 1.0 - x * x );
			let spot = select( localLightsSpot( dot( -L, sd.xyz ), c.w, sd.w ), 1.0, sd.w < -1.5 );
			E += c.xyz * ( win * win * spot / ( d2 + 0.3 ) ) * max( dot( N, L ) * 0.6 + 0.4, 0.0 );
		}
	}
	return E;
}
// sharp reflections of the lamps (the sea's glints)
fn localLightsSpecular( P: vec3f, N: vec3f, V: vec3f, rough: f32 ) -> vec3f {
	var S = vec3f( 0.0 );
	let a2 = pow2( rough * rough );
	for ( var i = 0; i < localLights.count; i++ ) {
		let p = localLights.pos[ i ];
		let d = p.xyz - P;
		let d2 = dot( d, d );
		if ( d2 < p.w * 4.0 ) {
			let c = localLights.col[ i ];
			let L = d * inverseSqrt( max( d2, 1e-6 ) );
			let H = normalize( L + V );
			let NoH = sat( dot( N, H ) );
			let D = a2 / ( PI * pow2( NoH * NoH * ( a2 - 1.0 ) + 1.0 ) );
			let x = d2 / ( p.w * 4.0 );
			let win = sat( 1.0 - x * x );
			S += c.xyz * ( win / ( d2 + 1.0 ) ) * min( D, 200.0 ) * sat( dot( N, L ) ) * 0.25;
		}
	}
	return S;
}
`;

const HOOK_WGSL = /* wgsl */`
fn hookLocalLights( s: Surface, P: vec3f, N: vec3f, V: vec3f, acc: ptr<function, LightAccum> ) {
#if !IS_WATER && !NO_LOCAL_LIGHTS
	let diffuseColor = s.albedo * ( 1.0 - s.metalness );
	let specF0 = mix( vec3f( 0.04 ) * s.specularIntensity, s.albedo, s.metalness );
	let specF90 = mix( s.specularIntensity, 1.0, s.metalness );
	let rough = clamp( s.roughness, 0.03, 1.0 );
	for ( var i = 0; i < localLights.count; i++ ) {
		let p = localLights.pos[ i ];
		let d = p.xyz - P;
		let d2 = dot( d, d );
		if ( d2 < p.w ) {
			let c = localLights.col[ i ];
			let sd = localLights.dir[ i ];
			let L = d * inverseSqrt( max( d2, 1e-6 ) );
			let x = d2 / p.w;
			let win = sat( 1.0 - x * x );
			let spot = select( localLightsSpot( dot( -L, sd.xyz ), c.w, sd.w ), 1.0, sd.w < -1.5 );
			let lightColor = c.xyz * ( win * win * spot / ( d2 + 0.3 ) );
			let irradiance = max( dot( N, L ), 0.0 ) * lightColor;
			( *acc ).directDiffuse += irradiance * diffuseColor * INV_PI + s.translucency * lightColor * 0.5;
			( *acc ).directSpecular += irradiance * BRDF_GGX( L, V, N, specF0, specF90, rough );
		}
	}
#endif
}
`;

// the uniforms and the helpers (for the water and the particles)
export const localLightsCoreModule = new ShaderModule( {
	name: 'localLightsCore',
	deps: [ commonModule ],
	uniforms: params,
	uniformName: 'localLights',
	code: LIGHT_WGSL,
} );

// the lighting hook (lit materials)
export const localLightsModule = new ShaderModule( {
	name: 'localLights',
	deps: [ commonModule, surfaceModule, localLightsCoreModule ],
	code: HOOK_WGSL,
} );

const smooth = ( x, a, b ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

// CPU side: sources packed every frame.
//   add( { position: Vector3 (live, drawn coordinates) or getter, color: [ r, g, b ], intensity, range,
//          night: only after dusk, dir?: Vector3 (spot axis, live), cosInner?, cosOuter?, flicker?,
//          active?: () => 0..1 } )
export class LocalLights {

	constructor() {

		this.sources = [];
		this.enabled = true;
		this.time = 0;
		this._list = [];
		SceneLighting.set( 'localLights', localLightsModule );

	}

	add( src ) {

		src.phase = src.phase ?? Math.random() * 100;
		this.sources.push( src );
		return src;

	}

	update( camera, dt ) {

		this.time += dt;
		const night = smooth( G.night.value, 0.1, 0.7 );
		const list = this._list;
		list.length = 0;
		if ( this.enabled ) {

			const cp = camera.position;
			for ( const s of this.sources ) {

				const k = ( s.night ? night : 1 ) * ( s.active ? s.active() : 1 );
				if ( k <= 0.002 ) continue;
				const p = typeof s.position === 'function' ? s.position() : s.position;
				if ( ! p ) continue;
				const d = p.distanceTo( cp );
				if ( d > s.range + 600 ) continue;
				list.push( { s, k, p, d } );

			}

			list.sort( ( a, b ) => a.d - b.d );

		}

		const n = Math.min( MAX, list.length );
		for ( let i = 0; i < n; i ++ ) {

			const { s, k, p } = list[ i ];
			const fl = s.flicker ? 1 - s.flicker * ( 0.5 + 0.5 * Math.sin( this.time * 23 + s.phase ) * Math.sin( this.time * 37 + s.phase * 2 ) ) : 1;
			const I = s.intensity * k * fl;
			F.pos.value[ i ].set( p.x, p.y, p.z, s.range * s.range );
			F.col.value[ i ].set( s.color[ 0 ] * I, s.color[ 1 ] * I, s.color[ 2 ] * I, s.cosInner ?? 0.99 );
			const dir = typeof s.dir === 'function' ? s.dir() : s.dir;
			if ( dir ) F.dir.value[ i ].set( dir.x, dir.y, dir.z, s.cosOuter ?? 0.8 );
			else F.dir.value[ i ].set( 0, - 1, 0, - 2 );

		}

		F.count.value = n;

	}

}

