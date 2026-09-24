import { Vector3, Color, MathUtils } from './engine/math/index.js';
import { GPU } from './engine/gpu/GPU.js';
import { Engine } from './engine/Engine.js';
import { SunShadows } from './engine/render/Shadows.js';
import { SceneRenderer, LAYERS } from './engine/render/SceneRenderer.js';
import { FrameUniforms, G } from './engine/render/Frame.js';

import { Atmosphere, SUN_ILLUMINANCE } from './sky/Atmosphere.js';
import { Sky } from './sky/Sky.js';
import { Clouds } from './sky/Clouds.js';
import { Environment } from './sky/Environment.js';
import { OceanFFT } from './ocean/OceanFFT.js';
import { Ocean } from './ocean/Ocean.js';
import { Island } from './world/Island.js';
import { Post } from './post/Post.js';

// Owns the renderer and the world systems (sky, clouds, sea, island) and runs the frame. The game
// (src/game) drives the camera and adds its objects to `scene`; App renders whatever is there.

export class App {

	constructor() {

		this.qs = new URLSearchParams( location.search );
		this.settings = {
			exposure: 0.62,
			renderScale: 1,
			quality: this.qs.get( 'quality' ) || 'high',
		};
		// sun: late afternoon, ahead and to the left of the camera (which looks toward -z)
		this.sun = { elevation: 24, azimuth: - 52 };
		this.cameraAltitude = 0;
		this.onFrame = null;

	}

	async init( onProgress = () => {} ) {

		const progress = async ( p, text ) => {

			onProgress( p, text );
			await new Promise( ( r ) => requestAnimationFrame( () => setTimeout( r, 0 ) ) );

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

		await progress( 0.15, 'Mixing the atmosphere' );
		this.atmosphere = new Atmosphere( engine );
		this.sky = new Sky( this.atmosphere );
		if ( ! this.qs.has( 'noClouds' ) ) {

			this.clouds = new Clouds( engine, this.atmosphere, { quality: this.settings.quality } );
			if ( this.clouds.ready ) await this.clouds.ready;
			this.sky.clouds = this.clouds;

		}

		this.shadows = new SunShadows( { size: 2048, splits: [ 45, 180, 700 ], lightMargin: 400, normalBias: [ 0.04, 0.12, 0.4 ], bias: 0.00003 } );
		this.shadows.layerMask = ( 1 << LAYERS.OPAQUE ) | ( 1 << LAYERS.TRANSPARENT );
		this.environment = new Environment( engine, scene, this.sky );
		this.environment.interval = 1.0;

		await progress( 0.35, 'Raising the island' );
		this.island = new Island( scene );

		await progress( 0.5, 'Filling the sea' );
		this.fft = new OceanFFT( engine, { cascades: 4 } );
		this.ocean = new Ocean( { fft: this.fft, sky: this.sky } );
		scene.add( this.ocean.mesh );

		this.sceneRenderer = new SceneRenderer( engine.meshRenderer, scene, camera );
		this.sceneRenderer.background = this.sky.background;
		this.post = new Post( engine, { sceneRenderer: this.sceneRenderer, camera, atmosphere: this.atmosphere, clouds: this.clouds } );
		this.sceneRenderer.onBeforeWater = () => this.post.composite();
		G.exposure.value = this.settings.exposure;

		this.updateSun();
		window.__app = this;
		this.gpu = GPU;

	}

	// compile every pipeline behind the loading screen
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

	sunDirection( out = new Vector3() ) {

		const el = MathUtils.degToRad( this.sun.elevation ), az = MathUtils.degToRad( this.sun.azimuth );
		// azimuth 0 = straight ahead of the camera (-z), negative = to the left
		return out.set( Math.sin( az ) * Math.cos( el ), Math.sin( el ), - Math.cos( az ) * Math.cos( el ) ).normalize();

	}

	updateSun() {

		const dir = this.sunDirection();
		this.atmosphere.sunDir.value.copy( dir );
		G.sunDir.value.copy( dir );
		G.night.value = MathUtils.smoothstep( - dir.y, 0.02, 0.18 );
		this.sky.starIntensity.value = 0;

	}

	applyAtmosphereReadback() {

		const a = this.atmosphere;
		if ( ! a.sunTransmittance ) return;
		const T = a.sunTransmittance;
		const sunY = a.sunDir.value.y;
		const horizonFade = MathUtils.smoothstep( sunY, - 0.03, 0.02 );
		G.sunColor.value.setRGB( T[ 0 ], T[ 1 ], T[ 2 ] ).multiplyScalar( SUN_ILLUMINANCE * horizonFade );
		const irr = a.skyIrradiance;
		G.skyIrradiance.value.setRGB( irr[ 0 ], irr[ 1 ], irr[ 2 ] );
		G.horizonColor.value.setRGB( a.horizon[ 0 ], a.horizon[ 1 ], a.horizon[ 2 ] );

	}

	// stars fade in as the sky above goes dark (from ~15 km up)
	updateStars( altitude ) {

		this.sky.starIntensity.value = MathUtils.smoothstep( altitude, 12000, 45000 );

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
		const alt = cam.position.y;
		this.cameraAltitude = alt;

		this.updateSun();
		this.updateStars( alt );
		this.atmosphere.update( dt, alt );
		this.applyAtmosphereReadback();
		if ( this.clouds ) this.clouds.update( dt, cam );
		this.environment.update( dt );
		this.fft.update( dt );
		this.ocean.update( cam );

		G.exposure.value = this.settings.exposure;
		this.post.flare.update( cam, dt );
		this.post.beginFrame();
		this.shadows.render( this.scene, this.engine.meshRenderer, this.shadows.update( cam, G.sunDir.value ) );
		this.sceneRenderer.render();
		this.post.flare.kernel.dispatch( 1 );
		this.post.render();
		this.post.endFrame();
		GPU.submit();

	}

}
