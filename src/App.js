import { Vector3, Color, MathUtils } from './engine/math/index.js';
import { GPU } from './engine/gpu/GPU.js';
import { Engine } from './engine/Engine.js';
import { SunShadows } from './engine/render/Shadows.js';
import { SceneRenderer, LAYERS } from './engine/render/SceneRenderer.js';
import { FrameUniforms, G } from './engine/render/Frame.js';

import { Atmosphere, SUN_ILLUMINANCE, SUN_ANGULAR_RADIUS } from './sky/Atmosphere.js';
import { Sky } from './sky/Sky.js';
import { Clouds } from './sky/Clouds.js';
import { Environment } from './sky/Environment.js';
import { OceanFFT } from './ocean/OceanFFT.js';
import { Ocean } from './ocean/Ocean.js';
import { Island } from './world/Island.js';
import { Post } from './post/Post.js';
import { Particles } from './fx/Particles.js';
import { LocalLights } from './world/LocalLights.js';
import { installGroundBounce, installContactShadows, installCloudShadows, installAmbientOcclusion, GroundBounce, AmbientOcclusion } from './world/Lighting.js';

// Owns the renderer and the world systems (sky, clouds, sea, island, particles) and runs the frame.
// The game (src/game) drives the camera and adds its objects to `scene`.
//
// Floating origin: `originX` / `originY` (m) are added to scene coordinates to get real ones. The game
// lets its vehicles lag behind their real position when they go faster than the camera can follow
// (the obstacles then come at a dodgeable pace); the sky, clouds, sea and fog use the real position
// and the island is drawn shifted.
//
// Space: `space` (set by the game each frame, or null) overrides the sun (direction, size, glow,
// brightness), hands the sky its backdrop bodies and fades the atmosphere out in deep space.

export const TIMES_OF_DAY = {
	dawn: { name: 'Dawn', elevation: 5, azimuth: 68, bonus: 1.1 },
	morning: { name: 'Morning', elevation: 32, azimuth: 40, bonus: 1.0 },
	afternoon: { name: 'Afternoon', elevation: 24, azimuth: - 52, bonus: 1.0 },
	sunset: { name: 'Sunset', elevation: 3, azimuth: - 64, bonus: 1.1 },
	night: { name: 'Night', elevation: - 24, azimuth: - 40, bonus: 1.25 },
};

const _v = new Vector3();

export class App {

	constructor() {

		this.qs = new URLSearchParams( location.search );
		this.settings = {
			exposure: 0.62,
			renderScale: 1,
			quality: this.qs.get( 'quality' ) || localStorage.getItem( 'skybound.quality' ) || 'high',
		};
		// graphics toggles (live, per browser)
		let gfx = {};
		try {

			gfx = JSON.parse( localStorage.getItem( 'skybound.gfx' ) || '{}' );

		} catch { /* defaults */ }

		this.gfx = { dynres: true, rays: true, ao: true, ...gfx };
		this.dynRes = { scale: 1, avg: 16.7, t: 0, last: 0 };
		this.timeOfDay = 'afternoon';
		this.sun = { ...TIMES_OF_DAY.afternoon };
		this.originY = 0;
		this.originX = 0;
		this.space = null;
		this.worldVisible = true;
		this.cloudsEnabled = true;
		// a white flash (hyperjumps, the black hole, the Edge), decays by itself
		this.flash = 0;

	}

	async init( onProgress = () => {} ) {

		// let the loader paint between steps (a timer too: a background tab gets no animation frames,
		// and loading should carry on there)
		const progress = async ( p, text ) => {

			onProgress( p, text );
			await new Promise( ( r ) => {

				setTimeout( r, 50 );
				requestAnimationFrame( () => setTimeout( r, 0 ) );

			} );

		};

		await progress( 0.05, 'Starting WebGPU' );
		const engine = this.engine = new Engine( document.getElementById( 'app' ) );
		await engine.init();
		const { scene, camera } = engine;
		camera.fov = 50;
		camera.near = 0.25;
		camera.far = 2e6;
		camera.updateProjectionMatrix();
		this.scene = scene;
		this.camera = camera;
		if ( this.settings.quality === 'low' ) engine.setRenderScale( 0.75 );

		// point lights (engines, lamps): the hook must exist before any lit pipeline compiles
		this.lights = new LocalLights();

		await progress( 0.15, 'Mixing the atmosphere' );
		this.atmosphere = new Atmosphere( engine );
		this.sky = new Sky( this.atmosphere );
		if ( ! this.qs.has( 'noClouds' ) ) {

			this.clouds = new Clouds( engine, this.atmosphere, { quality: this.settings.quality } );
			if ( this.clouds.ready ) await this.clouds.ready;
			this.sky.clouds = this.clouds;

		}

		this.shadows = new SunShadows( { size: this.settings.quality === 'low' ? 1024 : 2048, splits: [ 45, 180, 700 ], lightMargin: 400, normalBias: [ 0.04, 0.12, 0.4 ], bias: 0.00003 } );
		this.shadows.layerMask = ( 1 << LAYERS.OPAQUE ) | ( 1 << LAYERS.TRANSPARENT );
		this.environment = new Environment( engine, scene, this.sky );
		this.environment.interval = 1.0;

		await progress( 0.35, 'Raising the island' );
		this.island = new Island( scene );
		this.island.addLights( this.lights );

		await progress( 0.5, 'Filling the sea' );
		// a trade-wind sea: wind waves with whitecaps over a long ocean swell
		this.fft = new OceanFFT( engine, {
			cascades: 4,
			local: { windSpeed: 8.5, windDirection: 25, fetch: 160, spreadBlend: 0.85, swell: 0.05 },
			swell: { scale: 0.7, windSpeed: 8, windDirection: 5, fetch: 1800, spreadBlend: 1.0, swell: 0.95, shortWavesFade: 0.1 },
		} );
		G.windSpeed.value = 8.5;
		this.ocean = new Ocean( { fft: this.fft, sky: this.sky } );
		scene.add( this.ocean.mesh );
		this.particles = new Particles( scene );

		this.sceneRenderer = new SceneRenderer( engine.meshRenderer, scene, camera );
		this.sceneRenderer.background = this.sky.background;
		this.post = new Post( engine, { sceneRenderer: this.sceneRenderer, camera, atmosphere: this.atmosphere, clouds: this.clouds } );
		this.sceneRenderer.onBeforeWater = () => this.post.composite();
		installGroundBounce();
		installCloudShadows( this.clouds );
		installContactShadows( this.sceneRenderer.opaqueCopy.depthTexture );
		installAmbientOcclusion( this.sceneRenderer.opaqueCopy.depthTexture );
		G.exposure.value = this.settings.exposure;

		this.updateSun();
		this.applyGfx();
		window.__app = this;
		this.gpu = GPU;

	}

	async precompile( onProgress = () => {} ) {

		const mr = this.engine.meshRenderer;
		if ( ! this.post._built ) {

			this.post._build();
			this.post._outW = 0;

		}

		onProgress( 0.7, 'Compiling shaders' );
		await GPU.pipelinesReady();
		mr.precompiling = true;
		try {

			this.frame( 1 / 60 );

		} catch ( e ) {

			console.warn( 'precompile failed', e );

		}

		mr.precompiling = false;
		await GPU.pipelinesReady();
		await GPU.queue.onSubmittedWorkDone();
		onProgress( 0.95, 'Warming up' );
		for ( let i = 0; i < 3; i ++ ) {

			this.frame( 1 / 60 );
			await GPU.queue.onSubmittedWorkDone();

		}

	}

	// ---------------------------------------------------------------- sun / sky

	setTimeOfDay( id ) {

		const t = TIMES_OF_DAY[ id ] || TIMES_OF_DAY.afternoon;
		this.timeOfDay = id in TIMES_OF_DAY ? id : 'afternoon';
		this.sun = { ...t };
		this.environment.update( 0, true );
		if ( this.clouds ) this.clouds.invalidate();

	}

	sunDirection( out = new Vector3() ) {

		const el = MathUtils.degToRad( this.sun.elevation ), az = MathUtils.degToRad( this.sun.azimuth );
		return out.set( Math.sin( az ) * Math.cos( el ), Math.sin( el ), - Math.cos( az ) * Math.cos( el ) ).normalize();

	}

	updateSun() {

		const sp = this.space;
		const U = this.sky.params.fields;
		if ( sp ) {

			this.atmosphere.sunDir.value.copy( sp.sunDir );
			G.sunDir.value.copy( sp.keyDir || sp.sunDir );
			G.night.value = 0;
			U.sunRadius.value = sp.sunRadius;
			U.sunGlow.value.set( sp.sunGlow, sp.sunGlow * 0.3, 0 );
			return;

		}

		U.sunRadius.value = SUN_ANGULAR_RADIUS;
		U.sunGlow.value.set( 0, 0, 0 );
		const dir = this.sunDirection();
		this.atmosphere.sunDir.value.copy( dir );
		const night = MathUtils.smoothstep( - dir.y, 0.02, 0.18 );
		G.night.value = night;
		const moon = _v.set( - dir.x, Math.abs( dir.y ) * 0.8 + 0.25, - dir.z ).normalize();
		this.sky.moonDir.value.copy( moon );
		G.sunDir.value.copy( dir.y > - 0.07 ? dir : moon );

	}

	applyAtmosphereReadback() {

		const a = this.atmosphere;
		const sp = this.space;
		if ( sp ) {

			// outside the atmosphere: the key star's light, falling off with the distance to it
			const k = SUN_ILLUMINANCE * sp.flux;
			const tn = sp.sunTint || [ 1, 1, 1 ];
			G.sunColor.value.setRGB( k * tn[ 0 ], k * 0.98 * tn[ 1 ], k * 0.95 * tn[ 2 ] );
			const earthShine = sp.earthShine || 0;
			G.skyIrradiance.value.setRGB( 0.004 + earthShine * 0.05, 0.005 + earthShine * 0.07, 0.008 + earthShine * 0.12 );
			G.horizonColor.value.setRGB( 0.01, 0.012, 0.02 );
			return;

		}

		if ( ! a.sunTransmittance ) return;
		const T = a.sunTransmittance;
		const sunY = a.sunDir.value.y;
		const sunUp = sunY > - 0.07;
		const horizonFade = MathUtils.smoothstep( sunY, - 0.03, 0.02 );
		if ( sunUp ) G.sunColor.value.setRGB( T[ 0 ], T[ 1 ], T[ 2 ] ).multiplyScalar( SUN_ILLUMINANCE * horizonFade );
		else G.sunColor.value.setRGB( 0.6, 0.7, 1.0 ).multiplyScalar( 0.16 * G.night.value );
		const irr = a.skyIrradiance;
		const nightAmb = 0.014 * G.night.value;
		G.skyIrradiance.value.setRGB( irr[ 0 ] + nightAmb * 0.6, irr[ 1 ] + nightAmb * 0.7, irr[ 2 ] + nightAmb );
		G.horizonColor.value.setRGB( a.horizon[ 0 ], a.horizon[ 1 ], a.horizon[ 2 ] );

	}

	updateSkyParams( alt, dt ) {

		const U = this.sky.params.fields;
		// stars: at night, and in daylight once the air is thin
		const high = MathUtils.smoothstep( alt, 18000, 70000 );
		U.starsDay.value = this.space ? 1 : high;
		U.starIntensity.value = this.space ? 1 : Math.max( G.night.value, high );
		U.cloudMix.value = this.space ? 0 : 1 - MathUtils.smoothstep( alt, 120000, 220000 );
		U.spaceMix.value = this.space ? this.space.spaceMix : 0;
		U.cirrus.value = this.space ? 0 : 1 - MathUtils.smoothstep( alt, 7000, 9000 );
		U.planetTime.value += dt;
		U.aurora.value = this.space ? 0 : Math.max( G.night.value * 0.8, MathUtils.smoothstep( alt, 45000, 90000 ) * ( 1 - MathUtils.smoothstep( alt, 400000, 900000 ) ) * 0.6 );
		const sp = this.space;
		if ( sp ) {

			this.sky.setBodies( sp.bodies );
			U.nebula.value.set( ...( sp.nebula || [ 0.5, 0.2, 0.7, 0 ] ) );
			U.sunTint.value.set( ...( sp.sunTint || [ 1, 1, 1 ] ) );
			U.sunDiskIntensity.value = sp.sunDisk ?? 1;
			U.starField.value = sp.starField ?? 1;
			U.deepField.value = sp.deepField || 0;
			U.web.value = sp.web || 0;
			U.cmb.value = sp.cmb || 0;
			U.tunnel.value = sp.tunnel || 0;
			if ( sp.webOffset ) U.webOffset.value.set( ...sp.webOffset );
			if ( sp.frame ) {

				U.frameX.value.set( ...sp.frame.ex );
				U.frameY.value.set( ...sp.frame.ey );
				U.frameZ.value.set( ...sp.frame.ez );

			}

		} else {

			U.bodyCount.value = 0;
			U.nebula.value.w = 0;
			U.sunTint.value.set( 1, 1, 1 );
			U.sunDiskIntensity.value = 1;
			U.starField.value = 1;
			U.deepField.value = 0;
			U.web.value = 0;
			U.cmb.value = 0;
			U.tunnel.value = 0;

		}

	}

	setGfx( key, value ) {

		this.gfx[ key ] = value;
		try {

			localStorage.setItem( 'skybound.gfx', JSON.stringify( this.gfx ) );

		} catch { /* ignore */ }

		this.applyGfx();

	}

	applyGfx() {

		AmbientOcclusion.strength.value = this.gfx.ao ? 1 : 0;
		this.post.params.rays.value = this.gfx.rays ? 0.7 : 0;
		if ( ! this.gfx.dynres ) {

			this.dynRes.scale = 1;
			this.post.setScale( 1 );

		}

	}

	// dynamic resolution: the internal render scale follows the frame time (the temporal upscaler
	// rebuilds the output); ignores hitches from hidden tabs
	updateDynRes() {

		const d = this.dynRes;
		const now = performance.now();
		const ms = d.last ? now - d.last : 16.7;
		d.last = now;
		if ( ! this.gfx.dynres || ms > 100 ) return;
		d.avg += ( ms - d.avg ) * 0.05;
		d.t += ms;
		if ( d.t < 1000 ) return;
		d.t = 0;
		if ( d.avg > 19.5 && d.scale > 0.6 ) d.scale = Math.max( 0.6, d.scale - 0.08 );
		else if ( d.avg < 14 && d.scale < 1 ) d.scale = Math.min( 1, d.scale + 0.04 );
		this.post.setScale( Math.round( d.scale * 100 ) / 100 );

	}

	// where the sun is on screen (light shafts): uv, and how much the shafts show
	updateSunScreen( cam ) {

		const sd = this.atmosphere.sunDir.value;
		cam.updateMatrixWorld();
		cam.matrixWorldInverse.copy( cam.matrixWorld ).invert();
		const e = cam.matrixWorld.elements;
		const fwd = _v.set( - e[ 8 ], - e[ 9 ], - e[ 10 ] ).normalize();
		const facing = sd.x * fwd.x + sd.y * fwd.y + sd.z * fwd.z;
		const ss = this.post.params.sunScreen.value;
		if ( facing <= 0.05 ) {

			ss[ 2 ] = 0;
			return;

		}

		const p = _v.copy( cam.position ).addScaledVector( sd, 1000 ).project( cam );
		const off = Math.max( Math.abs( p.x ), Math.abs( p.y ) );
		const above = this.space ? 1 : MathUtils.smoothstep( sd.y, - 0.03, 0.06 );
		ss[ 0 ] = p.x * 0.5 + 0.5;
		ss[ 1 ] = 0.5 - p.y * 0.5;
		ss[ 2 ] = MathUtils.smoothstep( facing, 0.05, 0.35 ) * ( 1 - MathUtils.smoothstep( off, 1.0, 1.8 ) ) * above * ( 1 - G.night.value );

	}

	// ---------------------------------------------------------------- loop

	start( update ) {

		this.engine.start( ( dt ) => {

			if ( update ) update( dt );
			this.frame( dt );

		} );

	}

	frame( dt ) {

		GPU.beginFrame();
		FrameUniforms.fields.frameIndex.value = GPU.frame;
		G.dt.value = dt;
		G.time.value += dt;
		const cam = this.camera;
		const alt = cam.position.y + this.originY;
		this.realAltitude = alt;
		G.seaLevel.value = - this.originY;
		G.originX.value = this.originX;

		this.updateSun();
		this.updateSkyParams( this.space ? this.space.altitude : alt, dt );
		this.atmosphere.update( dt, this.space ? this.space.altitude : alt );
		this.applyAtmosphereReadback();
		const cloudsOn = this.clouds && this.cloudsEnabled && ! this.space && alt < 260000;
		if ( cloudsOn ) this.clouds.update( dt, cam, this.originY, this.originX );
		else if ( this.clouds ) this.clouds.viewValid.value = 0;
		this.environment.update( dt );
		// the island and the sea are drawn shifted by the floating origin (gone in deep space)
		const world = this.worldVisible && ! this.space;
		this.island.group.position.set( - this.originX, - this.originY, 0 );
		this.island.group.visible = world && alt < 150000;
		GroundBounce.strength.value = world && alt < 20000 ? 1 : 0;
		this.ocean.mesh.visible = world;
		if ( world ) {

			this.fft.update( dt );
			this.ocean.update( cam, this.originX );
			// the boats' wakes (island coordinates are real ones)
			const wb = this.ocean.params.fields.boats.value;
			this.island.boats.forEach( ( b, i ) => wb[ i ].set( b.m.position.x, b.m.position.z, b.heading || 0, b.speed || 0 ) );

		}

		this.particles.update( dt, cam );
		this.lights.update( cam, dt );

		this.flash = Math.max( 0, this.flash - dt * 1.6 );
		G.exposure.value = this.settings.exposure * ( 1 + this.flash * this.flash * 6 );
		this.post.params.fogDensity.value = this.space ? 0 : 0.000045;
		// space: the eye adapts further (the Sun up close, the dark between the planets)
		this.post.autoExposure.min.value = this.space ? 0.05 : 0.35;
		this.post.autoExposure.max.value = this.space ? 2.2 : 4;
		this.post.flare.update( cam, dt );
		this.updateSunScreen( cam );
		this.updateDynRes();
		this.post.beginFrame();
		this.shadows.render( this.scene, this.engine.meshRenderer, this.shadows.update( cam, G.sunDir.value ) );
		this.sceneRenderer.render();
		this.post.flare.kernel.dispatch( 1 );
		this.post.render();
		this.post.endFrame();
		GPU.submit();

	}

}
