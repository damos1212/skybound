import { App } from './App.js';
import { Game } from './game/Game.js';

const loader = document.getElementById( 'loader' );
const fill = loader.querySelector( '.loader-fill' );
const text = loader.querySelector( '.loader-text' );
const tip = loader.querySelector( '.loader-tip' );
const t0 = performance.now();
// tips while the shaders build (a first visit compiles them all; later visits load from the cache)
const TIPS = [
	'Tip: fly through ring chains for a speed kick and a combo',
	'Tip: near misses pay out: skim past birds, jets and asteroids',
	'Tip: launch at dawn, sunset or night for bonus pay',
	'Tip: sky events like Gold Rush and Air Show change every few runs',
	'Tip: land on the pad target for a bullseye bonus',
	'Tip: C toggles photo mode when you are on the pad or paused',
	'Tip: balloons ride thermals: look for the shimmering columns',
];
let tipI = Math.floor( Math.random() * TIPS.length );
const tipTimer = setInterval( () => {

	const slow = performance.now() - t0 > 5000;
	tip.textContent = ( slow ? 'First flight builds the shaders; next time it loads in a second. ' : '' ) + TIPS[ tipI ++ % TIPS.length ];

}, 3500 );
const timings = [];
const setLoading = ( p, t ) => {

	fill.style.width = Math.round( p * 100 ) + '%';
	if ( t ) {

		text.textContent = t;
		timings.push( [ t, Math.round( performance.now() - t0 ) ] );

	}

};

async function boot() {

	if ( ! navigator.gpu ) throw new Error( 'This game needs WebGPU. Try a recent Chrome, Edge or Safari on a desktop.' );
	const app = new App();
	await app.init( setLoading );
	const game = new Game( app, document.getElementById( 'ui' ) );
	await game.init( setLoading );
	await app.precompile( setLoading );
	setLoading( 1, 'Ready' );
	clearInterval( tipTimer );
	loader.classList.add( 'hidden' );
	app.start( ( dt ) => game.update( dt ) );
	// the GPU can be reset under us (driver update, sleep, too many tabs): offer a reload
	app.gpu.device.lost.then( ( info ) => {

		if ( info.reason === 'destroyed' ) return;
		const box = document.createElement( 'div' );
		box.className = 'device-lost';
		box.innerHTML = '<div class="card"><div class="res-title">Graphics reset</div><p>The browser restarted the GPU. Your progress is saved.</p><button class="btn big primary">Reload</button></div>';
		box.querySelector( 'button' ).onclick = () => location.reload();
		document.body.appendChild( box );

	} );
	window.__game = game;
	window.__timings = timings;

}

boot().catch( ( e ) => {

	console.error( e );
	clearInterval( tipTimer );
	tip.textContent = '';
	text.innerHTML = '';
	const box = document.createElement( 'div' );
	box.className = 'loader-error';
	box.textContent = e.message || String( e );
	text.appendChild( box );

} );
