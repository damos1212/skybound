// Generative background music (Web Audio): soft pads, a bass line and a sparkly arpeggio over a
// looping chord progression. Moods pick the progression, tempo and density: the hangar is warm and
// easy, flight has a pulse, space is slow and wide with long echoes, and the higher you fly the
// sparser it gets. Notes are scheduled a little ahead of the audio clock.

const MOODS = {
	hangar: { bpm: 92, chords: [ [ 0, 4, 7, 11 ], [ 5, 9, 12, 16 ], [ 9, 12, 16, 19 ], [ 7, 11, 14, 17 ] ], root: 57, arp: 0.55, bass: 1, pad: 0.8, echo: 0.25 },
	flight: { bpm: 112, chords: [ [ 0, 4, 7, 14 ], [ 9, 12, 16, 19 ], [ 5, 9, 12, 16 ], [ 7, 11, 14, 19 ] ], root: 57, arp: 0.8, bass: 1, pad: 0.6, echo: 0.3 },
	space: { bpm: 70, chords: [ [ 0, 7, 14, 16 ], [ 5, 12, 16, 21 ], [ - 3, 4, 11, 16 ], [ 2, 9, 14, 17 ] ], root: 50, arp: 0.35, bass: 0.6, pad: 1, echo: 0.55 },
	results: { bpm: 84, chords: [ [ 0, 4, 7, 12 ], [ 5, 9, 12, 17 ] ], root: 60, arp: 0.4, bass: 0.7, pad: 0.8, echo: 0.3 },
};

const midi = ( n ) => 440 * Math.pow( 2, ( n - 69 ) / 12 );

export class Music {

	constructor() {

		this.ctx = null;
		this.mood = 'hangar';
		this.volume = 0.55;
		this.muted = false;
		this.step = 0;
		this.nextTime = 0;
		this.intensity = 1;

	}

	attach( ctx, destination ) {

		this.ctx = ctx;
		this.out = ctx.createGain();
		this.out.gain.value = this.muted ? 0 : this.volume * 0.5;
		// feedback echo for space and air
		this.delay = ctx.createDelay( 2 );
		this.delay.delayTime.value = 0.42;
		this.fb = ctx.createGain();
		this.fb.gain.value = 0.3;
		this.wet = ctx.createGain();
		this.wet.gain.value = 0.3;
		const lp = ctx.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 2400;
		this.bus = ctx.createGain();
		this.bus.connect( this.out );
		this.bus.connect( this.delay );
		this.delay.connect( lp ).connect( this.fb ).connect( this.delay );
		lp.connect( this.wet ).connect( this.out );
		this.out.connect( destination );
		this.nextTime = ctx.currentTime + 0.3;

	}

	setMood( m ) {

		if ( MOODS[ m ] ) this.mood = m;

	}

	setVolume( v ) {

		this.volume = v;
		if ( this.out ) this.out.gain.setTargetAtTime( this.muted ? 0 : v * 0.5, this.ctx.currentTime, 0.2 );

	}

	setMuted( m ) {

		this.muted = m;
		this.setVolume( this.volume );

	}

	_note( { f, t, dur, type = 'triangle', gain = 0.1, attack = 0.01, cutoff = 3000 } ) {

		const c = this.ctx;
		const o = c.createOscillator();
		o.type = type;
		o.frequency.value = f;
		const flt = c.createBiquadFilter();
		flt.type = 'lowpass';
		flt.frequency.value = cutoff;
		const g = c.createGain();
		g.gain.setValueAtTime( 0, t );
		g.gain.linearRampToValueAtTime( gain, t + attack );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + dur );
		o.connect( flt ).connect( g ).connect( this.bus );
		o.start( t );
		o.stop( t + dur + 0.1 );

	}

	update( dt, game ) {

		if ( ! this.ctx || this.muted || this.volume <= 0.001 ) return;
		const M = MOODS[ this.mood ];
		const c = this.ctx;
		// thinner music the higher (and quieter) it gets outside the air
		const h = game.realH ? game.realH() : 0;
		const target = this.mood === 'flight' ? 1 - Math.min( 0.5, Math.log10( 1 + h / 1000 ) * 0.12 ) : 1;
		this.intensity += ( target - this.intensity ) * Math.min( 1, dt );
		this.fb.gain.setTargetAtTime( M.echo, c.currentTime, 0.5 );
		this.wet.gain.setTargetAtTime( M.echo * 0.8, c.currentTime, 0.5 );
		const sixteenth = 60 / M.bpm / 4;
		while ( this.nextTime < c.currentTime + 0.25 ) {

			const t = this.nextTime;
			const s = this.step % 64;
			const chord = M.chords[ Math.floor( s / 16 ) % M.chords.length ];
			const beat = s % 16;
			// pad: the chord at the top of each bar, long and soft
			if ( beat === 0 ) {

				for ( const n of chord ) {

					this._note( { f: midi( M.root + n ), t, dur: sixteenth * 16 * 1.1, type: 'sawtooth', gain: 0.018 * M.pad, attack: sixteenth * 5, cutoff: 900 } );
					this._note( { f: midi( M.root + n ) * 1.004, t, dur: sixteenth * 16 * 1.1, type: 'triangle', gain: 0.025 * M.pad, attack: sixteenth * 4, cutoff: 1500 } );

				}

			}

			// bass: root on 1 and a fifth / octave on the offbeats
			if ( M.bass > 0 && ( beat === 0 || beat === 6 || beat === 10 ) ) {

				const n = beat === 0 ? chord[ 0 ] : beat === 6 ? chord[ 0 ] + 7 : chord[ 0 ] + 12;
				this._note( { f: midi( M.root - 24 + n ), t, dur: sixteenth * 3, type: 'triangle', gain: 0.09 * M.bass * this.intensity, cutoff: 500 } );

			}

			// arpeggio: 8ths, chord tones two octaves up, with a little randomness
			if ( beat % 2 === 0 && Math.random() < M.arp * this.intensity ) {

				const n = chord[ ( ( s / 2 ) | 0 ) % chord.length ] + ( Math.random() < 0.3 ? 24 : 12 );
				this._note( { f: midi( M.root + n ), t, dur: sixteenth * 3.5, type: Math.random() < 0.5 ? 'triangle' : 'sine', gain: 0.045, cutoff: 4000 } );

			}

			// a soft tick on the beat in flight
			if ( this.mood === 'flight' && beat % 4 === 2 ) this._note( { f: 5200, t, dur: 0.03, type: 'square', gain: 0.006 * this.intensity, cutoff: 8000 } );
			this.step ++;
			this.nextTime += sixteenth;

		}

	}

}
