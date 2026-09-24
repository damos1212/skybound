// Synthesized sound (Web Audio, no samples): wind that rises with speed and thins out with
// altitude, the surf near the sea, the balloon burner's roar, the rocket's thunder, the Starship's
// drive hum, and one-shot effects. The music (Music.js) plays through the same master bus.

export class Sound {

	constructor() {

		this.ctx = null;
		this.muted = false;
		this.volume = 0.85;
		this.burn = 0;
		this.onUnlock = null;

	}

	unlock() {

		if ( this.ctx ) {

			if ( this.ctx.state === 'suspended' ) this.ctx.resume();
			return;

		}

		const AC = window.AudioContext || window.webkitAudioContext;
		if ( ! AC ) return;
		const ctx = this.ctx = new AC();
		this.master = ctx.createGain();
		this.master.gain.value = this.muted ? 0 : 1;
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = - 14;
		comp.ratio.value = 4;
		this.master.connect( comp ).connect( ctx.destination );
		this.sfx = ctx.createGain();
		this.sfx.gain.value = this.volume;
		this.sfx.connect( this.master );

		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer( 1, len, ctx.sampleRate );
		const d = buf.getChannelData( 0 );
		let b0 = 0, b1 = 0, b2 = 0;
		for ( let i = 0; i < len; i ++ ) {

			const w = Math.random() * 2 - 1;
			b0 = 0.99765 * b0 + w * 0.099046;
			b1 = 0.963 * b1 + w * 0.2965164;
			b2 = 0.57 * b2 + w * 1.0526913;
			d[ i ] = ( b0 + b1 + b2 + w * 0.1848 ) * 0.2;

		}

		this.noise = buf;
		const loop = ( type, freq, q ) => {

			const src = ctx.createBufferSource();
			src.buffer = buf;
			src.loop = true;
			src.playbackRate.value = 0.8 + Math.random() * 0.4;
			const f = ctx.createBiquadFilter();
			f.type = type;
			f.frequency.value = freq;
			f.Q.value = q;
			const g = ctx.createGain();
			g.gain.value = 0;
			src.connect( f ).connect( g ).connect( this.sfx );
			src.start();
			return { f, g };

		};

		this.wind = loop( 'bandpass', 500, 0.7 );
		this.surf = loop( 'lowpass', 700, 0.5 );
		this.roar = loop( 'lowpass', 900, 1.2 );
		this.thunder = loop( 'lowpass', 220, 0.9 );
		const osc = ( type, f, cutoff ) => {

			const o = ctx.createOscillator();
			o.type = type;
			o.frequency.value = f;
			const lp = ctx.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.value = cutoff;
			const g = ctx.createGain();
			g.gain.value = 0;
			o.connect( lp ).connect( g ).connect( this.sfx );
			o.start();
			return { o, g, lp };

		};

		this.rumble = osc( 'sawtooth', 55, 180 );
		this.hum = osc( 'sine', 110, 800 );
		this.hum2 = osc( 'triangle', 165.5, 1200 );
		if ( this.onUnlock ) this.onUnlock( ctx, this.master );

	}

	setMuted( m ) {

		this.muted = m;
		if ( this.master ) this.master.gain.setTargetAtTime( m ? 0 : 1, this.ctx.currentTime, 0.05 );

	}

	setVolume( v ) {

		this.volume = v;
		if ( this.sfx ) this.sfx.gain.setTargetAtTime( v, this.ctx.currentTime, 0.05 );

	}

	update( dt, game ) {

		if ( ! this.ctx ) {

			if ( ! this._armed ) {

				this._armed = true;
				const go = () => this.unlock();
				window.addEventListener( 'pointerdown', go, { once: true } );
				window.addEventListener( 'keydown', go, { once: true } );

			}

			return;

		}

		const t = this.ctx.currentTime;
		const s = game.s;
		const v = game.vehicle;
		const flying = game.state === 'flight' || game.state === 'ascent';
		const space = game.mode === 'space';
		const alt = game.realH ? game.realH() : 0;
		const lp = game.lp;
		const speed = lp ? Math.hypot( lp.vx, lp.vy ) : 0;
		const thin = space ? 0 : Math.exp( - alt / 9000 );
		const wind = Math.min( 1, 0.08 + speed / 70 ) * ( 0.15 + 0.85 * thin ) * ( flying ? 1 : 0.5 ) * ( space ? 0 : 1 );
		this.wind.g.gain.setTargetAtTime( wind * 0.5, t, 0.3 );
		this.wind.f.frequency.setTargetAtTime( 300 + speed * 12, t, 0.3 );
		const sea = space ? 0 : Math.exp( - Math.max( 0, alt - 5 ) / 120 );
		this.surf.g.gain.setTargetAtTime( sea * 0.35, t, 0.4 );
		this.surf.f.frequency.setTargetAtTime( 500 + Math.sin( t * 0.4 ) * 250, t, 0.5 );
		const burning = s && s.burning && ! s.popped ? 1 : 0;
		this.burn += ( burning - this.burn ) * Math.min( 1, dt * ( burning ? 12 : 5 ) );
		const b = this.burn;
		// the balloon's burner, the rocket's engine (muffled once the air is gone), the drive's hum
		const inAir = space ? 0.15 : 0.35 + 0.65 * thin;
		this.roar.g.gain.setTargetAtTime( v === 'balloon' ? b * 0.55 : 0, t, 0.04 );
		this.roar.f.frequency.setTargetAtTime( 700 + Math.random() * 300, t, 0.05 );
		const boosters = s && s.boosterLit && s.boosters ? 1 : 0;
		this.thunder.g.gain.setTargetAtTime( v === 'rocket' ? ( b * 0.9 + boosters * 0.6 ) * inAir : 0, t, 0.05 );
		this.thunder.f.frequency.setTargetAtTime( 180 + b * 140 + Math.random() * 40, t, 0.05 );
		this.rumble.g.gain.setTargetAtTime( ( v === 'balloon' ? b * 0.12 : v === 'rocket' ? ( b + boosters ) * 0.14 * inAir : 0 ), t, 0.04 );
		// the space drives hum; the Warpship's and the Ark's sit lower and swell during a jump
		const ship = v === 'starship' || v === 'warpship' || v === 'ark';
		const jumping = game.state === 'jump' || ( s && s.jumpT > 0 );
		const hum = ship && ( flying || game.state === 'countdown' || game.state === 'jump' ) ? 0.04 + b * 0.1 + ( jumping ? 0.08 : 0 ) : 0;
		const base = v === 'ark' ? 55 : v === 'warpship' ? 70 : 90;
		const pitch = ship && s && s.v ? base + Math.min( 220, Math.log10( Math.max( 1, s.v / 7800 ) ) * ( v === 'starship' ? 22 : 9 ) ) * ( jumping ? 1.5 : 1 ) : 110;
		this.hum.g.gain.setTargetAtTime( hum, t, 0.1 );
		this.hum2.g.gain.setTargetAtTime( hum * 0.6, t, 0.1 );
		this.hum.o.frequency.setTargetAtTime( pitch, t, 0.2 );
		this.hum2.o.frequency.setTargetAtTime( pitch * 1.505, t, 0.2 );

	}

	// ---------------------------------------------------------------- one-shots

	_tone( { type = 'sine', f0, f1 = f0, dur = 0.15, gain = 0.3, delay = 0, attack = 0.005 } ) {

		const ctx = this.ctx, t = ctx.currentTime + delay;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime( f0, t );
		o.frequency.exponentialRampToValueAtTime( Math.max( 1, f1 ), t + dur );
		const g = ctx.createGain();
		g.gain.setValueAtTime( 0, t );
		g.gain.linearRampToValueAtTime( gain, t + attack );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + dur );
		o.connect( g ).connect( this.sfx );
		o.start( t );
		o.stop( t + dur + 0.05 );

	}

	_noise( { dur = 0.3, gain = 0.4, type = 'lowpass', f0 = 2000, f1 = 200, q = 0.8, delay = 0 } ) {

		const ctx = this.ctx, t = ctx.currentTime + delay;
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.Q.value = q;
		f.frequency.setValueAtTime( f0, t );
		f.frequency.exponentialRampToValueAtTime( Math.max( 20, f1 ), t + dur );
		const g = ctx.createGain();
		g.gain.setValueAtTime( gain, t );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + dur );
		src.connect( f ).connect( g ).connect( this.sfx );
		src.start( t, Math.random() );
		src.stop( t + dur + 0.05 );

	}

	play( name, step = 0 ) {

		if ( ! this.ctx ) return;
		const arp = ( notes, type = 'triangle', gap = 0.08, gain = 0.16, dur = 0.35 ) => notes.forEach( ( f, i ) => this._tone( { type, f0: f, dur, gain, delay: i * gap } ) );
		switch ( name ) {

			case 'coin': {

				// climbs a major scale with the combo
				const k = Math.pow( 2, [ 0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21 ][ Math.min( 12, step ) ] / 12 );
				this._tone( { type: 'square', f0: 1320 * k, dur: 0.06, gain: 0.08 } );
				this._tone( { type: 'square', f0: 1760 * k, dur: 0.14, gain: 0.08, delay: 0.05 } );
				break;

			}

			case 'boom':
				this._noise( { dur: 1.4, gain: 1.1, f0: 900, f1: 50 } );
				this._tone( { f0: 70, f1: 30, dur: 0.9, gain: 0.6 } );
				break;
			case 'whoosh':
				this._noise( { dur: 0.45, gain: 0.5, type: 'bandpass', f0: 2500, f1: 400, q: 2 } );
				break;
			case 'mission':
				[ 659, 880, 1109, 1319 ].forEach( ( f, i ) => this._tone( { type: 'square', f0: f, dur: 0.2, gain: 0.07, delay: i * 0.07 } ) );
				break;
			case 'fuel':
				this._tone( { f0: 180, f1: 520, dur: 0.25, gain: 0.3 } );
				this._tone( { f0: 360, f1: 900, dur: 0.2, gain: 0.15, delay: 0.1 } );
				break;
			case 'star':
				arp( [ 660, 830, 990, 1320 ], 'triangle', 0.06, 0.18, 0.18 );
				break;
			case 'orb':
				arp( [ 523, 784, 1047 ], 'sine', 0.05, 0.2, 0.3 );
				this._noise( { dur: 0.3, gain: 0.15, type: 'highpass', f0: 4000, f1: 9000 } );
				break;
			case 'boost':
				this._noise( { dur: 0.8, gain: 0.5, type: 'bandpass', f0: 300, f1: 3000, q: 1.5 } );
				this._tone( { type: 'sawtooth', f0: 110, f1: 440, dur: 0.6, gain: 0.12 } );
				break;
			case 'rescue':
				arp( [ 587, 740, 880, 1175 ], 'square', 0.09, 0.07, 0.25 );
				break;
			case 'hit':
				this._noise( { dur: 0.35, gain: 0.8, f0: 3000, f1: 150 } );
				this._tone( { f0: 140, f1: 40, dur: 0.3, gain: 0.5 } );
				break;
			case 'zap':
				this._noise( { dur: 0.5, gain: 0.9, type: 'highpass', f0: 1200, f1: 4000, q: 2 } );
				this._tone( { type: 'sawtooth', f0: 90, f1: 60, dur: 0.4, gain: 0.3 } );
				break;
			case 'thunder':
				this._noise( { dur: 1.6, gain: 0.35, f0: 600, f1: 60 } );
				break;
			case 'pop':
				this._noise( { dur: 0.6, gain: 1.0, f0: 6000, f1: 100 } );
				this._tone( { f0: 300, f1: 40, dur: 0.5, gain: 0.5 } );
				break;
			case 'explosion':
				this._noise( { dur: 1.8, gain: 1.2, f0: 2500, f1: 40 } );
				this._tone( { f0: 90, f1: 25, dur: 1.2, gain: 0.7 } );
				break;
			case 'shield':
				this._tone( { f0: 400, f1: 1400, dur: 0.18, gain: 0.25 } );
				this._noise( { dur: 0.2, gain: 0.3, type: 'highpass', f0: 3000, f1: 6000 } );
				break;
			case 'launch':
				this._noise( { dur: 1.2, gain: 0.5, type: 'bandpass', f0: 200, f1: 1200, q: 1.2 } );
				break;
			case 'ignition':
				this._noise( { dur: 2.2, gain: 0.9, f0: 300, f1: 1800, q: 0.7 } );
				this._tone( { type: 'sawtooth', f0: 40, f1: 70, dur: 1.5, gain: 0.3 } );
				break;
			case 'separation':
				this._noise( { dur: 0.4, gain: 0.7, type: 'highpass', f0: 800, f1: 2500 } );
				this._tone( { type: 'square', f0: 200, f1: 90, dur: 0.25, gain: 0.2 } );
				break;
			case 'tick':
				this._tone( { type: 'square', f0: 880, dur: 0.08, gain: 0.12 } );
				break;
			case 'bag':
				this._tone( { f0: 120, f1: 60, dur: 0.2, gain: 0.4 } );
				this._noise( { dur: 0.25, gain: 0.3, f0: 800, f1: 200 } );
				break;
			case 'zone':
				this._tone( { type: 'triangle', f0: 880, dur: 0.3, gain: 0.15 } );
				this._tone( { type: 'triangle', f0: 1320, dur: 0.4, gain: 0.12, delay: 0.1 } );
				break;
			case 'zoneNew':
			case 'record':
				arp( [ 523, 659, 784, 1047, 1319 ] );
				break;
			case 'achievement':
				arp( [ 784, 988, 1175, 1568 ], 'square', 0.07, 0.07, 0.3 );
				this._tone( { type: 'triangle', f0: 1568, dur: 0.8, gain: 0.1, delay: 0.3 } );
				break;
			case 'unlock':
				arp( [ 392, 523, 659, 784, 1047, 1319, 1568 ], 'triangle', 0.07, 0.16, 0.5 );
				break;
			case 'select':
				this._tone( { type: 'triangle', f0: 660, dur: 0.08, gain: 0.12 } );
				this._tone( { type: 'triangle', f0: 990, dur: 0.1, gain: 0.1, delay: 0.05 } );
				break;
			case 'buy':
				this._tone( { type: 'square', f0: 988, dur: 0.07, gain: 0.1 } );
				this._tone( { type: 'square', f0: 1319, dur: 0.25, gain: 0.1, delay: 0.07 } );
				this._noise( { dur: 0.15, gain: 0.2, type: 'highpass', f0: 5000, f1: 8000, delay: 0.02 } );
				break;
			case 'splash':
				this._noise( { dur: 1.0, gain: 0.9, f0: 4000, f1: 200 } );
				break;
			case 'end':
				[ 392, 494, 587 ].forEach( ( f, i ) => this._tone( { type: 'sine', f0: f, dur: 0.9, gain: 0.12, delay: i * 0.05, attack: 0.05 } ) );
				break;
			case 'click':
				this._tone( { type: 'triangle', f0: 1200, dur: 0.04, gain: 0.08 } );
				break;
			case 'jump':
				// a rising warp whine and a thump
				this._tone( { type: 'sawtooth', f0: 80, f1: 1600, dur: 1.1, gain: 0.14, attack: 0.05 } );
				this._tone( { type: 'sine', f0: 220, f1: 3200, dur: 1.2, gain: 0.12, attack: 0.1 } );
				this._noise( { dur: 1.3, gain: 0.55, type: 'bandpass', f0: 200, f1: 6000, q: 1.2 } );
				this._tone( { f0: 60, f1: 30, dur: 0.6, gain: 0.5 } );
				break;
			case 'warpin':
				this._noise( { dur: 1.6, gain: 0.8, f0: 6000, f1: 80 } );
				this._tone( { f0: 110, f1: 40, dur: 1.2, gain: 0.5 } );
				arp( [ 262, 392, 523, 784 ], 'triangle', 0.05, 0.1, 0.8 );
				break;
			case 'ring': {

				// each ring in a chain a step higher
				const k = Math.pow( 2, [ 0, 4, 7, 11, 12, 16, 19 ][ Math.min( 6, Math.max( 0, step - 1 ) ) ] / 12 );
				this._tone( { type: 'triangle', f0: 660 * k, f1: 990 * k, dur: 0.25, gain: 0.16 } );
				this._tone( { type: 'sine', f0: 1320 * k, dur: 0.3, gain: 0.08, delay: 0.04 } );
				this._noise( { dur: 0.25, gain: 0.18, type: 'highpass', f0: 3000, f1: 9000 } );
				break;

			}

			case 'chain':
				arp( [ 523, 659, 784, 1047, 1319, 1568, 2093 ], 'square', 0.05, 0.07, 0.25 );
				this._tone( { type: 'triangle', f0: 2093, dur: 0.9, gain: 0.1, delay: 0.35 } );
				break;

		}

	}

}
