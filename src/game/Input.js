// Keyboard, mouse and touch. Flight controls:
//   burn: Space / W / ArrowUp / left mouse / touch the right half of the screen
//   steer: A D / arrows / touch-drag on the left half (virtual stick)
//   sandbag: Shift / E / the on-screen bag button
export class Input {

	constructor( element ) {

		this.keys = new Set();
		this.hits = new Set();
		this.mouse = false;
		this.touchBurn = false;
		this.touchSteer = 0;
		this.buttons = { bag: false };
		this._touches = new Map();
		this.element = element;

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ) ) return;
			if ( [ 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight' ].includes( e.code ) ) e.preventDefault();
			if ( ! e.repeat ) this.hits.add( e.code );
			this.keys.add( e.code );

		} );
		window.addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => {

			this.keys.clear();
			this.mouse = false;
			this.touchBurn = false;
			this.touchSteer = 0;

		} );

		element.addEventListener( 'mousedown', ( e ) => {

			if ( e.button === 0 ) this.mouse = true;

		} );
		window.addEventListener( 'mouseup', ( e ) => {

			if ( e.button === 0 ) this.mouse = false;

		} );
		element.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );

		const onTouch = ( e ) => {

			e.preventDefault();
			const w = window.innerWidth;
			for ( const t of e.changedTouches ) {

				if ( e.type === 'touchstart' ) this._touches.set( t.identifier, { x0: t.clientX, x: t.clientX, left: t.clientX < w * 0.5 } );
				else if ( e.type === 'touchmove' ) {

					const s = this._touches.get( t.identifier );
					if ( s ) s.x = t.clientX;

				} else this._touches.delete( t.identifier );

			}

			this.touchBurn = false;
			this.touchSteer = 0;
			for ( const s of this._touches.values() ) {

				if ( s.left ) this.touchSteer = Math.max( - 1, Math.min( 1, ( s.x - s.x0 ) / 50 ) );
				else this.touchBurn = true;

			}

		};

		for ( const ev of [ 'touchstart', 'touchmove', 'touchend', 'touchcancel' ] ) element.addEventListener( ev, onTouch, { passive: false } );

	}

	down( ...codes ) {

		return codes.some( ( c ) => this.keys.has( c ) );

	}

	hit( ...codes ) {

		return codes.some( ( c ) => this.hits.has( c ) );

	}

	get burn() {

		return this.down( 'Space', 'KeyW', 'ArrowUp' ) || this.mouse || this.touchBurn;

	}

	get steer() {

		let s = 0;
		if ( this.down( 'KeyA', 'ArrowLeft' ) ) s -= 1;
		if ( this.down( 'KeyD', 'ArrowRight' ) ) s += 1;
		if ( this.touchSteer ) s = this.touchSteer;
		return s;

	}

	get bag() {

		const b = this.hit( 'ShiftLeft', 'ShiftRight', 'KeyE' ) || this.buttons.bag;
		this.buttons.bag = false;
		return b;

	}

	endFrame() {

		this.hits.clear();

	}

}
