export type Sfx =
  | "beep" | "go" | "gem" | "airGem" | "nitroCharge" | "nitro"
  | "jump" | "stunt" | "land" | "crash" | "oob" | "lane"
  | "transform" | "powerDown" | "slash" | "smash" | "monsterHit"
  | "lap" | "finish" | "bump";

/** Per-realm background atmosphere loops. */
export type AmbientKind =
  | "none" | "wind" | "lava" | "city" | "space" | "forest" | "mist";

const MUTE_KEY = "fantasy-racer-muted";

/**
 * A running ambience graph. Every long-lived node is tracked so the whole
 * thing can be crossfaded out and stopped/disconnected on demand. `gain` is
 * the crossfade node (0..1) that all of this ambience's voices feed into.
 */
interface AmbientGraph {
  gain: GainNode;
  oscillators: OscillatorNode[];
  sources: AudioBufferSourceNode[];
  timers: ReturnType<typeof setInterval>[];
}

/**
 * Procedural audio via Web Audio — no external assets. A continuous engine
 * hum whose pitch tracks speed, one-shot SFX, and a soft ambient music loop.
 * Every call is guarded so audio failures never affect gameplay.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private ambientBus: GainNode | null = null;

  private ambientKind: AmbientKind = "none";
  private ambient: AmbientGraph | null = null;

  private engineA: OscillatorNode | null = null;
  private engineB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineSub: OscillatorNode | null = null;      // low body/rumble
  private engineNoise: AudioBufferSourceNode | null = null; // intake/exhaust air
  private engineNoiseBP: BiquadFilterNode | null = null;
  private engineNoiseGain: GainNode | null = null;
  private engineAmp: GainNode | null = null;            // firing-pulse AM target
  private engineLfo: OscillatorNode | null = null;      // idle lope
  private engineLfoGain: GainNode | null = null;
  private engineGear = 0;
  private engineFormantBody: BiquadFilterNode | null = null;  // exhaust boom
  private engineFormantGrowl: BiquadFilterNode | null = null; // mid growl
  private engineFormantEdge: BiquadFilterNode | null = null;  // on-throttle bite
  private engineJitter = 0;   // small rpm wander so it isn't a perfect tone
  private engineLoad = 0;     // smoothed throttle/coast state

  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;

  private muted = false;
  private started = false;
  private musicVol = 0.7;
  private sfxVol = 0.9;
  private musicIntensity = 0.4; // eased value the sequencer reads
  private musicIntTarget = 0.4; // driven by the engine from speed + nitro

  constructor() {
    if (typeof window !== "undefined") {
      this.muted = window.localStorage.getItem(MUTE_KEY) === "1";
    }
  }

  /** Create/resume the context after a user gesture and start hum + music. */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();

        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);

        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = 0.85 * this.sfxVol;
        this.sfxBus.connect(this.master);

        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.22 * this.musicVol;
        this.musicBus.connect(this.master);

        this.engineBus = this.ctx.createGain();
        this.engineBus.gain.value = 0;
        this.engineBus.connect(this.master);

        // Ambience sits well under music/engine and is tied to the music
        // volume in setVolumes. Under master, so mute affects it too.
        this.ambientBus = this.ctx.createGain();
        this.ambientBus.gain.value = 0.18 * this.musicVol;
        this.ambientBus.connect(this.master);

        this.startEngine();
        this.startMusic();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      this.started = true;
    } catch {
      // audio unavailable; ignore
    }
  }

  get isMuted() {
    return this.muted;
  }

  setVolumes(music: number, sfx: number) {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus?.gain.setTargetAtTime(0.22 * music, t, 0.05);
    this.sfxBus?.gain.setTargetAtTime(0.85 * sfx, t, 0.05);
    this.ambientBus?.gain.setTargetAtTime(0.18 * music, t, 0.05);
  }

  /** 0..1 — how hard the music drives. The engine feeds this from the car's
   *  speed + nitro so the track lifts (hats, snare, lead, extra kicks) as you
   *  go faster and settles when you slow. Safe before the context exists. */
  setMusicIntensity(x: number) {
    this.musicIntTarget = Math.max(0, Math.min(1, x));
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
    try {
      window.localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      // ignore
    }
    return this.muted;
  }

  /** A custom harmonic spectrum for the engine tone.
   *
   *  This is the piece that matters most for "does it sound like a car". A
   *  sawtooth rolls its harmonics off as a plain 1/n, which is the classic synth
   *  buzz — no amount of filtering makes it combust. Real exhaust has a strong
   *  fundamental and second, a dip in the thirds, and pronounced EVEN harmonics
   *  above that, which is what reads as a growl. Web Audio lets us just state
   *  that spectrum directly. */
  private engineWave(): PeriodicWave | null {
    if (!this.ctx) return null;
    const amps = [
      0, 1.0, 0.92, 0.44, 0.70, 0.29, 0.54, 0.21, 0.40,
      0.15, 0.27, 0.11, 0.19, 0.08, 0.13, 0.06, 0.09, 0.04, 0.06,
    ];
    const real = new Float32Array(amps.length); // no cosine terms
    const imag = new Float32Array(amps);
    return this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  private startEngine() {
    if (!this.ctx || !this.engineBus) return;
    const ctx = this.ctx;

    this.engineAmp = ctx.createGain();
    this.engineAmp.gain.value = 0.8;
    this.engineAmp.connect(this.engineBus);

    // EXHAUST FORMANTS. Fixed resonant peaks, like the pipe and body of a real
    // car: a low boom, a mid growl, and an upper bite that only opens when
    // you're actually on the throttle. Static filtering alone can shape
    // brightness but never gives an instrument its *character* — these do.
    this.engineFormantEdge = ctx.createBiquadFilter();
    this.engineFormantEdge.type = "peaking";
    this.engineFormantEdge.frequency.value = 1500;
    this.engineFormantEdge.Q.value = 1.4;
    this.engineFormantEdge.gain.value = 0;
    this.engineFormantEdge.connect(this.engineAmp);

    this.engineFormantGrowl = ctx.createBiquadFilter();
    this.engineFormantGrowl.type = "peaking";
    this.engineFormantGrowl.frequency.value = 620;
    this.engineFormantGrowl.Q.value = 1.5;
    this.engineFormantGrowl.gain.value = 5.5;
    this.engineFormantGrowl.connect(this.engineFormantEdge);

    this.engineFormantBody = ctx.createBiquadFilter();
    this.engineFormantBody.type = "peaking";
    this.engineFormantBody.frequency.value = 115;
    this.engineFormantBody.Q.value = 1.1;
    this.engineFormantBody.gain.value = 6;
    this.engineFormantBody.connect(this.engineFormantGrowl);

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 400;
    this.engineFilter.Q.value = 0.7;
    this.engineFilter.connect(this.engineFormantBody);

    const wave = this.engineWave();

    // sub: weight you feel rather than hear
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = "sine";
    this.engineSub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.8;
    this.engineSub.connect(subGain);
    subGain.connect(this.engineFilter);
    this.engineSub.start();

    // two banks on the engine spectrum, detuned against each other. Real
    // cylinders never fire perfectly evenly; the slow beating between these is
    // what stops it sounding like one rock-steady oscillator.
    this.engineA = ctx.createOscillator();
    if (wave) this.engineA.setPeriodicWave(wave); else this.engineA.type = "sawtooth";
    this.engineA.frequency.value = 60;
    const aGain = ctx.createGain();
    aGain.gain.value = 0.55;
    this.engineA.connect(aGain);
    aGain.connect(this.engineFilter);
    this.engineA.start();

    this.engineB = ctx.createOscillator();
    if (wave) this.engineB.setPeriodicWave(wave); else this.engineB.type = "sawtooth";
    this.engineB.frequency.value = 60;
    this.engineB.detune.value = -14;   // a shade flat, so it beats slowly
    const bGain = ctx.createGain();
    bGain.gain.value = 0.34;
    this.engineB.connect(bGain);
    bGain.connect(this.engineFilter);
    this.engineB.start();

    // air: intake/exhaust turbulence
    const buf = this.makeNoiseBuffer(2, true);
    if (buf) {
      this.engineNoise = ctx.createBufferSource();
      this.engineNoise.buffer = buf;
      this.engineNoise.loop = true;
      this.engineNoiseBP = ctx.createBiquadFilter();
      this.engineNoiseBP.type = "bandpass";
      this.engineNoiseBP.frequency.value = 400;
      this.engineNoiseBP.Q.value = 1.1;
      this.engineNoiseGain = ctx.createGain();
      this.engineNoiseGain.gain.value = 0.1;
      this.engineNoise.connect(this.engineNoiseBP);
      this.engineNoiseBP.connect(this.engineNoiseGain);
      this.engineNoiseGain.connect(this.engineAmp);
      this.engineNoise.start();
    }

    // idle lope only — a gentle uneven-tick at low revs that smooths out as it
    // spins up. Kept shallow: deep tremolo reads as a wobble, not combustion.
    this.engineLfo = ctx.createOscillator();
    this.engineLfo.type = "triangle";
    this.engineLfo.frequency.value = 11;
    this.engineLfoGain = ctx.createGain();
    this.engineLfoGain.gain.value = 0.16;
    this.engineLfo.connect(this.engineLfoGain);
    this.engineLfoGain.connect(this.engineAmp.gain);
    this.engineLfo.start();
  }

  /** Drive the engine from speed (0..1), boost, and how hard you're on the power.
   *
   *  `load` is 1 on throttle, ~0 coasting, negative-ish braking. A real car's
   *  note changes completely between driving and trailing throttle, and without
   *  that the sound can only ever be a function of speed — which is why it stayed
   *  synthetic even after the gearbox went in. */
  setEngine(speedPercent: number, boosting: boolean, load = 1) {
    if (!this.ctx || !this.engineBus || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const sp = Math.max(0, Math.min(1, speedPercent));

    // --- gearbox: revs climb within a gear, drop on the shift
    const GEARS = 6;
    const span = 1 / GEARS;
    const gear = Math.min(GEARS - 1, Math.floor(sp / span));
    const within = span > 0 ? (sp - gear * span) / span : 0;
    const topOut = 1 - gear * 0.06;
    let rpm = 0.26 + within * (topOut - 0.26);
    const shifting = this.engineGear !== gear;
    this.engineGear = gear;

    // --- rev wander: a small random walk. A perfectly steady pitch is the
    // giveaway of a synth; engines always hunt slightly.
    this.engineJitter += (Math.random() - 0.5) * 0.02;
    this.engineJitter = Math.max(-0.02, Math.min(0.02, this.engineJitter * 0.9));
    rpm = Math.max(0.05, rpm * (1 + this.engineJitter));

    // --- smoothed load
    this.engineLoad += (Math.max(0, Math.min(1, load)) - this.engineLoad) * 0.12;
    const ld = this.engineLoad;
    const smooth = shifting ? 0.02 : 0.09;

    const f0 = 32 + rpm * 88;
    this.engineSub?.frequency.setTargetAtTime(f0 * 0.5, t, smooth);
    this.engineA?.frequency.setTargetAtTime(f0, t, smooth);
    this.engineB?.frequency.setTargetAtTime(f0, t, smooth);

    // lope: only really present down low, and only off the power
    this.engineLfo?.frequency.setTargetAtTime(8 + rpm * 22, t, smooth);
    this.engineLfoGain?.gain.setTargetAtTime(0.18 * (1 - rpm * 0.7) * (1 - ld * 0.5), t, 0.15);

    // air rises with revs AND with load — you hear the engine breathe when you
    // ask it for something
    this.engineNoiseBP?.frequency.setTargetAtTime(320 + rpm * 1500 + (boosting ? 900 : 0), t, smooth);
    this.engineNoiseGain?.gain.setTargetAtTime(
      0.07 + sp * 0.13 + ld * 0.16 + (boosting ? 0.18 : 0), t, smooth);

    // formants: the upper bite only opens on the power (and hard on boost); the
    // low boom eases off as revs climb, like a real car leaving its lumpy range
    // Brightness is no longer the enemy now that the fundamental sits at ~84 Hz
    // instead of 196. A mosquito is a THIN HIGH PURE TONE; rich harmonics over a
    // LOW fundamental is a growl. The first pass over-corrected into muffled
    // (centroid 347 Hz, only 3 audible harmonics, and on/off throttle measured
    // near-identical) — so open it up hard on the power and keep it shut when
    // coasting. That contrast is most of what makes a car sound alive.
    this.engineFormantEdge?.gain.setTargetAtTime(-1 + ld * 9 + (boosting ? 6 : 0), t, 0.12);
    this.engineFormantGrowl?.gain.setTargetAtTime(5 + ld * 5, t, 0.12);
    this.engineFormantBody?.gain.setTargetAtTime(3.5 - rpm * 1.5, t, 0.12); // less boom
    this.engineFormantBody?.frequency.setTargetAtTime(f0 * 1.05, t, smooth);

    this.engineFilter.frequency.setTargetAtTime(
      (boosting ? 1500 : 520) + rpm * 1100 + sp * 260 + ld * 900, t, smooth);

    // level: dip through the shift, and back right off when you lift
    const lift = shifting ? 0.55 : 1;
    const loadLevel = 0.6 + ld * 0.4;
    this.engineBus.gain.setTargetAtTime(
      (0.05 + sp * 0.11 + (boosting ? 0.05 : 0)) * lift * loadLevel, t, smooth);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, sweepTo?: number) {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterType: BiquadFilterType, freq: number, sweepTo?: number) {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(freq, t);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur);
  }

  play(name: Sfx) {
    if (!this.ctx) return;
    switch (name) {
      case "beep": this.tone(520, 0.14, "square", 0.25); break;
      case "go": this.tone(880, 0.3, "square", 0.3); break;
      case "gem": this.tone(880, 0.12, "sine", 0.25, 1320); break;
      case "airGem": this.tone(1245, 0.15, "sine", 0.28, 1760); break;
      case "nitroCharge": this.tone(660, 0.1, "triangle", 0.22, 990); break;
      case "nitro":
        this.noise(0.5, 0.3, "bandpass", 600, 3000);
        this.tone(120, 0.4, "sawtooth", 0.15, 260);
        break;
      case "jump": this.tone(300, 0.25, "square", 0.22, 900); break;
      case "stunt":
        this.tone(660, 0.15, "square", 0.2);
        this.tone(880, 0.18, "square", 0.2, 990);
        this.tone(1320, 0.22, "square", 0.2);
        break;
      case "land": this.noise(0.15, 0.25, "lowpass", 400); break;
      case "crash":
        this.noise(0.35, 0.4, "lowpass", 900, 150);
        this.tone(160, 0.3, "sawtooth", 0.2, 60);
        break;
      case "oob": this.tone(200, 0.25, "sawtooth", 0.2, 90); break;
      case "lane": this.tone(1046, 0.12, "sine", 0.2, 1318); break;
      case "transform":
        this.tone(200, 0.5, "sawtooth", 0.22, 1200);
        this.tone(600, 0.5, "sine", 0.15, 1600);
        break;
      case "powerDown": this.tone(700, 0.4, "sawtooth", 0.18, 180); break;
      case "slash":
        this.noise(0.18, 0.35, "highpass", 2000, 6000);
        this.tone(1600, 0.12, "sine", 0.2, 2600);
        break;
      case "smash":
        this.noise(0.25, 0.35, "lowpass", 1200, 200);
        this.tone(220, 0.2, "square", 0.18, 90);
        break;
      case "monsterHit":
        this.tone(90, 0.4, "sawtooth", 0.3, 50);
        this.noise(0.3, 0.3, "lowpass", 600);
        break;
      case "lap": this.tone(990, 0.2, "sine", 0.25, 1320); break;
      case "finish":
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, "square", 0.28), i * 130));
        break;
      case "bump": this.noise(0.1, 0.25, "lowpass", 500); break;
    }
  }

  private startMusic() {
    // A driving 4-bar groove over an Am–F–C–G progression: four-on-the-floor
    // kick, backbeat snare, hats, a rolling bassline and an arpeggiated lead.
    // Layers fade in with `musicIntensity` (fed by speed) so the track lifts as
    // the car goes faster and settles to a calm pulse when idling/finished.
    // An EIGHT-bar progression (Am F C G | Am F G E) rather than a 4-bar loop, so
    // it takes twice as long to come round and the E turnaround gives the phrase a
    // real resolution instead of chasing its own tail.
    const bassRoots = [110, 87.31, 65.41, 98, 110, 87.31, 98, 82.41];
    // A written MELODY (one entry per bar, sixteenth-indexed) instead of a random
    // walk through a note pool — a hook you can actually whistle. 0 = rest.
    const A4 = 440, C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99;
    const F5 = 698.46, B4 = 493.88, G4 = 392, E4 = 329.63, A5 = 880;
    const melody: number[][] = [
      [A4, 0, C5, 0, E5, 0, D5, 0, C5, 0, 0, 0, B4, 0, 0, 0],   // Am
      [0, 0, A4, 0, C5, 0, F5, 0, E5, 0, 0, 0, C5, 0, 0, 0],    // F
      [G4, 0, C5, 0, E5, 0, G5, 0, E5, 0, 0, 0, D5, 0, 0, 0],   // C
      [0, 0, B4, 0, D5, 0, G5, 0, D5, 0, B4, 0, 0, 0, 0, 0],    // G
      [A4, 0, E5, 0, C5, 0, A5, 0, G5, 0, E5, 0, C5, 0, 0, 0],  // Am (octave lift)
      [0, 0, F5, 0, A5, 0, G5, 0, F5, 0, 0, 0, E5, 0, 0, 0],    // F
      [G4, 0, D5, 0, G5, 0, F5, 0, D5, 0, 0, 0, B4, 0, 0, 0],   // G
      [E4, 0, B4, 0, E5, 0, D5, 0, B4, 0, 0, 0, 0, 0, 0, 0],    // E (turnaround)
    ];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || !this.musicBus || this.muted) return;
      // ease intensity toward its target so speed changes glide, not jump
      this.musicIntensity += (this.musicIntTarget - this.musicIntensity) * 0.15;
      const I = this.musicIntensity;
      const s = this.musicStep++;
      const step = s % 16;                       // sixteenth within the bar
      const bar = Math.floor(s / 16) % 8;        // which bar of the eight
      const root = bassRoots[bar];
      const line = melody[bar];

      // pad: a soft root/fifth/octave swell on each downbeat for body
      if (step === 0) this.mPad([root, root * 1.5, root * 2], 0.05 + (1 - I) * 0.035);

      // kick: four-on-the-floor, with syncopation added when driving hard
      if (step % 4 === 0) this.mKick(0.55);
      if (I > 0.6 && step === 10) this.mKick(0.42);
      if (I > 0.82 && step === 14) this.mKick(0.44);

      // backbeat snare (enters once you're moving), with a fill into each 8-bar turn
      if (I > 0.25 && (step === 4 || step === 12)) this.mSnare(0.2 + I * 0.12);
      if (I > 0.5 && bar === 7 && step >= 12) this.mSnare(0.12 + (step - 12) * 0.05);

      // hats: offbeats, then full sixteenths when flat out
      if (I > 0.3 && step % 2 === 1) this.mHat(0.05 + I * 0.05);
      if (I > 0.72 && step % 2 === 0) this.mHat(0.03);

      // bass: rolling pattern, jumping to the fifth for movement
      if (step === 0 || step === 3 || step === 6 || step === 8 || step === 11 || step === 14) {
        const f = (step === 6 || step === 14) ? root * 1.5 : root;
        this.mBass(f, 0.2 + I * 0.08);
      }

      // the melody carries the tune once you're moving; a soft octave doubling
      // and an offbeat counter-note stack on top when you're flat out
      const note = line[step];
      if (note && I > 0.34) this.mLead(note, 0.06 + I * 0.09);
      if (note && I > 0.8) this.mLead(note * 2, 0.02 + I * 0.03);
      if (I > 0.62 && !note && step % 4 === 2) this.mLead(root * 4, 0.02 + I * 0.03);
    }, 112);
  }

  /** One musical tone routed to the music bus (optional pitch sweep + lowpass). */
  private mTone(freq: number, dur: number, type: OscillatorType, gain: number, sweepTo?: number, filterHz?: number) {
    if (!this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    let tail: AudioNode = g;
    if (filterHz) {
      const filt = this.ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = filterHz;
      g.connect(filt);
      tail = filt;
    }
    tail.connect(this.musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** One percussive noise hit routed to the music bus. */
  private mNoise(dur: number, gain: number, filterType: BiquadFilterType, freq: number) {
    if (!this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.musicBus);
    src.start(t);
    src.stop(t + dur);
  }

  private mKick(gain: number) {
    if (!this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.19);
  }

  private mSnare(gain: number) {
    this.mNoise(0.14, gain, "bandpass", 1900);
    this.mTone(190, 0.11, "triangle", gain * 0.5, 90);
  }

  private mHat(gain: number) {
    this.mNoise(0.03, gain, "highpass", 8000);
  }

  private mBass(freq: number, gain: number) {
    this.mTone(freq, 0.17, "sawtooth", gain, undefined, 320);
  }

  private mLead(freq: number, gain: number) {
    this.mTone(freq, 0.17, "triangle", gain);
  }

  private mPad(freqs: number[], gain: number) {
    for (const f of freqs) this.mTone(f, 1.5, "sine", gain, undefined, 1400);
  }

  /**
   * Crossfade the background ambience to a new realm atmosphere. Fades the
   * running ambience out (~0.6s) while fading the replacement in over the same
   * window. Passing the current kind is a no-op; "none" fades to silence.
   */
  setAmbient(kind: AmbientKind) {
    if (kind === this.ambientKind) return;
    if (!this.ctx || !this.ambientBus) return; // context not ready; ignore
    const t = this.ctx.currentTime;

    // Retire whatever is currently playing.
    if (this.ambient) {
      this.stopAmbientGraph(this.ambient, 0.6);
      this.ambient = null;
    }

    this.ambientKind = kind;
    if (kind === "none") return;

    const graph = this.buildAmbient(kind);
    if (!graph) return;
    this.ambient = graph;
    graph.gain.gain.setValueAtTime(0.0001, t);
    graph.gain.gain.setTargetAtTime(1, t, 0.2); // ~0.6s fade-in
  }

  /** Fade the current ambience out to silence. */
  stopAmbient() {
    this.setAmbient("none");
  }

  /** Fill a mono AudioBuffer with white (or integrated "brown") noise. */
  private makeNoiseBuffer(seconds: number, brown = false): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    if (brown) {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = Math.max(-1, Math.min(1, last * 3.5));
      }
    } else {
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  /** Build a small looping procedural graph for one ambience, routed to ambientBus. */
  private buildAmbient(kind: AmbientKind): AmbientGraph | null {
    if (!this.ctx || !this.ambientBus || kind === "none") return null;
    const ctx = this.ctx;
    const oscillators: OscillatorNode[] = [];
    const sources: AudioBufferSourceNode[] = [];
    const timers: ReturnType<typeof setInterval>[] = [];

    // Crossfade node; every voice for this ambience feeds into it.
    const top = ctx.createGain();
    top.gain.value = 0.0001;
    top.connect(this.ambientBus);

    // A looping noise bed.
    const noiseSource = (seconds: number, brownNoise = false) => {
      const buf = this.makeNoiseBuffer(seconds, brownNoise);
      const src = ctx.createBufferSource();
      if (buf) src.buffer = buf;
      src.loop = true;
      src.start();
      sources.push(src);
      return src;
    };

    // A low-frequency oscillator modulating some AudioParam (gusts/tremolo/drift).
    const lfo = (freq: number, depth: number, target: AudioParam) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g);
      g.connect(target);
      o.start();
      oscillators.push(o);
    };

    // A sustained tone (drone/hum) feeding straight into `top`.
    const drone = (freq: number, detune: number, type: OscillatorType, level: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(top);
      o.start();
      oscillators.push(o);
      return { osc: o, gain: g };
    };

    switch (kind) {
      case "wind": {
        // Filtered noise with slow gusting on filter cutoff and level.
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 500;
        bp.Q.value = 0.9;
        const g = ctx.createGain();
        g.gain.value = 0.22;
        const src = noiseSource(3);
        src.connect(bp);
        bp.connect(g);
        g.connect(top);
        lfo(0.08, 260, bp.frequency); // sweep the passband -> gusts
        lfo(0.05, 0.14, g.gain);      // swell the level -> gusts
        break;
      }
      case "lava": {
        // Low brown-noise rumble + slow tremolo, with occasional soft bloops.
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 80;
        const g = ctx.createGain();
        g.gain.value = 0.32;
        const src = noiseSource(3, true);
        src.connect(lp);
        lp.connect(g);
        g.connect(top);
        lfo(0.15, 0.1, g.gain); // tremolo
        timers.push(setInterval(() => {
          if (this.muted) return;
          this.ambBloop(top, 50 + Math.random() * 10, 0.9);
        }, 5300));
        break;
      }
      case "city": {
        // Two detuned low hums + faint highpassed distant traffic.
        drone(55, 0, "triangle", 0.11);
        drone(55, 9, "triangle", 0.09);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 2200;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        const src = noiseSource(3);
        src.connect(hp);
        hp.connect(g);
        g.connect(top);
        lfo(0.06, 0.03, g.gain); // distant traffic ebb and flow
        break;
      }
      case "space": {
        // Deep detuned drone + a slow shimmering high sine.
        drone(40, 0, "sine", 0.16);
        drone(40, -11, "sine", 0.13);
        const shimmer = ctx.createOscillator();
        shimmer.type = "sine";
        shimmer.frequency.value = 1180;
        const sg = ctx.createGain();
        sg.gain.value = 0.02;
        shimmer.connect(sg);
        sg.connect(top);
        shimmer.start();
        oscillators.push(shimmer);
        lfo(0.07, 0.018, sg.gain);        // shimmer swell
        lfo(0.05, 6, shimmer.frequency);  // slow pitch drift
        break;
      }
      case "forest": {
        // Airy highpassed breeze + very occasional short high chirps.
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1600;
        const g = ctx.createGain();
        g.gain.value = 0.06;
        const src = noiseSource(3);
        src.connect(hp);
        hp.connect(g);
        g.connect(top);
        lfo(0.09, 0.03, g.gain); // breeze swell
        timers.push(setInterval(() => {
          if (this.muted) return;
          this.ambChirp(top);
        }, 7000));
        break;
      }
      case "mist": {
        // Soft, low, very slow wind pad + a faint eerie low drone.
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 300;
        const g = ctx.createGain();
        g.gain.value = 0.14;
        const src = noiseSource(4);
        src.connect(lp);
        lp.connect(g);
        g.connect(top);
        lfo(0.03, 90, lp.frequency); // very slow cutoff drift
        lfo(0.04, 0.06, g.gain);     // slow swell
        drone(70, 4, "sine", 0.04);  // faint low presence
        break;
      }
    }

    return { gain: top, oscillators, sources, timers };
  }

  /** One soft, downward "bloop" for the lava ambience. */
  private ambBloop(dest: GainNode, freq: number, dur: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, freq * 0.6), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A short cluster of high blips for the forest ambience. */
  private ambChirp(dest: GainNode) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.09;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      const f = 2600 + Math.random() * 900;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.15, t + 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  /** Fade an ambience graph out and stop/clear all of its nodes and timers. */
  private stopAmbientGraph(graph: AmbientGraph, fade: number) {
    for (const timer of graph.timers) clearInterval(timer);
    graph.timers.length = 0;
    if (!this.ctx) {
      try {
        for (const o of graph.oscillators) o.stop();
        for (const s of graph.sources) s.stop();
      } catch {
        // already stopped
      }
      return;
    }
    const t = this.ctx.currentTime;
    graph.gain.gain.setTargetAtTime(0.0001, t, Math.max(0.02, fade / 3));
    const stopAt = t + fade + 0.3;
    try {
      for (const o of graph.oscillators) o.stop(stopAt);
      for (const s of graph.sources) s.stop(stopAt);
    } catch {
      // already stopped
    }
  }

  dispose() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    if (this.ambient) {
      for (const timer of this.ambient.timers) clearInterval(timer);
      try {
        for (const o of this.ambient.oscillators) o.stop();
        for (const s of this.ambient.sources) s.stop();
      } catch {
        // already stopped
      }
      try {
        this.ambient.gain.disconnect();
      } catch {
        // ignore
      }
      this.ambient = null;
    }
    this.ambientKind = "none";
    try {
      this.engineA?.stop();
      this.engineB?.stop();
    } catch {
      // already stopped
    }
    try {
      void this.ctx?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
    this.started = false;
  }
}
