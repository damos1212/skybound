import { App } from './App.js';
import { Game } from './game/Game.js';

const loader = document.getElementById( 'loader' );
const fill = loader.querySelector( '.loader-fill' );
const text = loader.querySelector( '.loader-text' );
const t0 = performance.now();
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
	loader.classList.add( 'hidden' );
	app.start( ( dt ) => game.update( dt ) );
	window.__game = game;
	window.__timings = timings;

}

boot().catch( ( e ) => {

	console.error( e );
	text.innerHTML = '';
	const box = document.createElement( 'div' );
	box.className = 'loader-error';
	box.textContent = e.message || String( e );
	text.appendChild( box );

} );
