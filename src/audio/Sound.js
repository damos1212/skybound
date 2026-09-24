// Synthesized sound (Web Audio, no samples): wind that rises with speed and thins out with
// altitude, the surf near the sea, the burner's roar, and one-shot effects.

export class Sound {

	constructor() {

		this.ctx = null;
		this.muted = false;
		this.burn = 0;

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
		this.master.gain.value = this.muted ? 0 : 0.8;
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = - 14;
		comp.ratio.value = 4;
		this.master.connect( comp ).connect( ctx.destination );

		// noise source shared by the loops
		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer( 1, len, ctx.sampleRate );
		const d = buf.getChannelData( 0 );
		let b0 = 0, b1 = 0, b2 = 0;
		for ( let i = 0; i < len; i ++ ) {

			// pinkish noise (Paul Kellet's economy filter)
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
			src.connect( f ).connect( g ).connect( this.master );
			src.start();
			return { f, g };

		};

		this.wind = loop( 'bandpass', 500, 0.7 );
		this.surf = loop( 'lowpass', 700, 0.5 );
		this.roar = loop( 'lowpass', 900, 1.2 );
		// burner rumble
		const osc = ctx.createOscillator();
		osc.type = 'sawtooth';
		osc.frequency.value = 55;
		const of = ctx.createBiquadFilter();
		of.type = 'lowpass';
		of.frequency.value = 180;
		this.rumble = ctx.createGain();
		this.rumble.gain.value = 0;
		osc.connect( of ).connect( this.rumble ).connect( this.master );
		osc.start();

	}

	setMuted( m ) {

		this.muted = m;
		if ( this.master ) this.master.gain.setTargetAtTime( m ? 0 : 0.8, this.ctx.currentTime, 0.05 );

	}

	update( dt, game ) {

		if ( ! this.ctx ) {

			// the first click or key anywhere starts the audio
			if ( ! this._armed ) {

				this._armed = true;
				const go = () => this.unlock();
				window.addEventListener( 'pointerdown', go, { once: true } );
				window.addEventListener( 'keydown', go, { once: true } );

			}

			return;

		}

		const t = this.ctx.currentTime;
		const s = game.flight;
		const flying = game.state === 'flight';
		const alt = s ? s.y : 0;
		const speed = s ? Math.hypot( s.vx, s.vy ) : 0;
		const thin = Math.exp( - alt / 9000 );
		const wind = Math.min( 1, 0.08 + speed / 70 ) * ( 0.25 + 0.75 * thin ) * ( flying ? 1 : 0.5 );
		this.wind.g.gain.setTargetAtTime( wind * 0.5, t, 0.3 );
		this.wind.f.frequency.setTargetAtTime( 300 + speed * 12, t, 0.3 );
		const sea = Math.exp( - Math.max( 0, alt - 5 ) / 120 );
		this.surf.g.gain.setTargetAtTime( sea * 0.35, t, 0.4 );
		this.surf.f.frequency.setTargetAtTime( 500 + Math.sin( t * 0.4 ) * 250, t, 0.5 );
		const burning = s && s.burning ? 1 : 0;
		this.burn += ( burning - this.burn ) * Math.min( 1, dt * ( burning ? 12 : 5 ) );
		this.roar.g.gain.setTargetAtTime( this.burn * 0.55, t, 0.04 );
		this.rumble.gain.setTargetAtTime( this.burn * 0.12, t, 0.04 );
		this.roar.f.frequency.setTargetAtTime( 700 + Math.random() * 300, t, 0.05 );

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
		o.connect( g ).connect( this.master );
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
		src.connect( f ).connect( g ).connect( this.master );
		src.start( t, Math.random() );
		src.stop( t + dur + 0.05 );

	}

	play( name ) {

		if ( ! this.ctx ) return;
		switch ( name ) {

			case 'coin':
				this._tone( { type: 'square', f0: 1320, dur: 0.06, gain: 0.08 } );
				this._tone( { type: 'square', f0: 1760, dur: 0.14, gain: 0.08, delay: 0.05 } );
				break;
			case 'fuel':
				this._tone( { f0: 180, f1: 520, dur: 0.25, gain: 0.3 } );
				this._tone( { f0: 360, f1: 900, dur: 0.2, gain: 0.15, delay: 0.1 } );
				break;
			case 'star':
				[ 660, 830, 990, 1320 ].forEach( ( f, i ) => this._tone( { type: 'triangle', f0: f, dur: 0.18, gain: 0.18, delay: i * 0.06 } ) );
				break;
			case 'hit':
				this._noise( { dur: 0.35, gain: 0.8, f0: 3000, f1: 150 } );
				this._tone( { f0: 140, f1: 40, dur: 0.3, gain: 0.5 } );
				break;
			case 'zap':
				this._noise( { dur: 0.5, gain: 0.9, type: 'highpass', f0: 1200, f1: 4000, q: 2 } );
				this._tone( { type: 'sawtooth', f0: 90, f1: 60, dur: 0.4, gain: 0.3 } );
				break;
			case 'pop':
				this._noise( { dur: 0.6, gain: 1.0, f0: 6000, f1: 100 } );
				this._tone( { f0: 300, f1: 40, dur: 0.5, gain: 0.5 } );
				break;
			case 'shield':
				this._tone( { f0: 400, f1: 1400, dur: 0.18, gain: 0.25 } );
				this._noise( { dur: 0.2, gain: 0.3, type: 'highpass', f0: 3000, f1: 6000 } );
				break;
			case 'launch':
				this._noise( { dur: 1.2, gain: 0.5, type: 'bandpass', f0: 200, f1: 1200, q: 1.2 } );
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
				[ 523, 659, 784, 1047, 1319 ].forEach( ( f, i ) => this._tone( { type: 'triangle', f0: f, dur: 0.35, gain: 0.16, delay: i * 0.08 } ) );
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

		}

	}

}
