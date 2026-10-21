import { read as readStored, write as writeStored } from "@/src/ui/storage";

export type Sfx =
  | "beep" | "go" | "gem" | "airGem" | "nitroCharge" | "nitro"
  | "jump" | "stunt" | "land" | "crash" | "oob" | "lane"
  | "transform" | "powerDown" | "slash" | "smash" | "monsterHit"
  | "lap" | "finish" | "bump";

/** Per-realm background atmosphere loops. */
export type AmbientKind =
  | "none" | "wind" | "lava" | "city" | "space" | "forest" | "mist";

const MUTE_KEY = "muted";

/** One music step. 16 steps a bar, so a bar is 3.2 s and the 8-bar form 25.6 s. */
const STEP = 0.2;

/**
 * How far ahead of the audio clock the sequencer books notes.
 *
 * The old sequencer fired every note from a setInterval at "now", so its
 * rhythm was only as steady as the main thread — and in a WebGL game the main
 * thread is the busiest thing on the machine. Notes are now scheduled on the
 * audio clock a little ahead of time (the "two clocks" pattern): the timer can
 * be late by up to this much and every onset still lands exactly on the grid.
 */
const LOOKAHEAD = 0.16;

/**
 * Per-effect trim, in dB, set by measurement rather than by ear: rendered
 * offline and levelled so the big events (crash, finish, nitro) peak near
 * −12 dBFS and the small ones (gems, lane, countdown) near −15. Re-measure with
 * the sound lab before changing a voice, or the balance drifts again.
 */
const FX_TRIM: Record<Sfx, number> = {
  beep: 1, go: -1, gem: 0, airGem: 3.5, nitroCharge: 1, nitro: 2.8,
  jump: 7, stunt: 0.5, land: -4, crash: -3.7, oob: 3, lane: 3.5,
  transform: 3, powerDown: 5.5, slash: -2, smash: -3.5, monsterHit: -2.5,
  lap: 0.5, finish: -4, bump: -3.2,
};

/**
 * Recorded one-shots, all CC0 from Kenney's Impact and Sci-fi packs (see
 * public/sfx/LICENSE-kenney.txt), trimmed, mono, AAC. Synthesis is good at
 * tones and bad at the dense, irregular spectrum of metal and rubber hitting
 * things, so these are the effects that use recordings. Each name has several
 * takes; the count is how many files `/sfx/<name>-<i>.m4a` there are.
 */
const SAMPLE_TAKES = {
  "crash-metal": 5, "crash-plate": 5, bump: 5, land: 5, smash: 3, hit: 5, nitro: 2, transform: 2,
} as const;
type SampleName = keyof typeof SAMPLE_TAKES;

/** Linear gain per recording, levelled against the synthesised voices it
 *  replaces (the files themselves are all normalised to −1 dBFS). */
const SAMPLE_GAIN = {
  crashMetal: 0.5, crashPlate: 0.35, bump: 0.3, land: 0.35, smash: 0.2, hit: 0.45, nitro: 0.15, transform: 0.14,
};

/** Hirajoshi on D across two octaves — gems climb this as you chain them. */
const GEM_SCALE = [587.33, 659.25, 698.46, 880.0, 932.33, 1174.66, 1318.51, 1396.91, 1760.0];

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

interface ToneOpts {
  sweepTo?: number;
  attack?: number;
  lowpass?: number;
  dest?: AudioNode;
  detune?: number;
}

/**
 * Procedural audio via Web Audio — no external assets. A continuous engine
 * whose note tracks revs and load, a road layer (wind, rumble, tyres), one-shot
 * SFX, a per-realm ambience and a scheduled music bed. Every call is guarded
 * so audio failures never affect gameplay.
 *
 * Signal flow: engine / road / sfx / music(→duck) / ambience → mix → limiter
 * → master (mute) → speakers. The limiter is a safety net, not a sound: the
 * worst stack measured (flat out on nitro, five hits on one frame) has peaked
 * at no more than −2.2 dBFS in any render, under its threshold.
 */
export class Sound {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private roadBus: GainNode | null = null;
  private ambientBus: GainNode | null = null;

  private ambientKind: AmbientKind = "none";
  private ambient: AmbientGraph | null = null;

  /** Shared, seamlessly looping noise. One-shots read a random window of it
   *  instead of allocating and filling a fresh buffer on every hit. */
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;

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

  // road layer: what the car is doing to the air and the tarmac
  private rushBP: BiquadFilterNode | null = null;
  private rushGain: GainNode | null = null;
  private rumbleLP: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;
  private squealGain: GainNode | null = null;
  private squealBP: BiquadFilterNode | null = null;

  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private nextStepAt = 0;
  private musicVerb: ConvolverNode | null = null;  // the space the music sits in
  private musicSend: GainNode | null = null;       // reverb send
  private droneGain: GainNode | null = null;

  private samples: Partial<Record<SampleName, AudioBuffer[]>> = {};
  private lastTake: Partial<Record<SampleName, number>> = {};

  /** Where one-shots go while play() runs: a per-call trim node on sfxBus. */
  private fxOut: AudioNode | null = null;
  private gemRun = 0;
  private gemLast = -10;

  private muted = false;
  private started = false;
  private suspendedByUs = false;
  private musicVol = 0.7;
  private sfxVol = 0.9;
  private musicIntensity = 0.4; // eased value the sequencer reads
  private musicIntTarget = 0.4; // driven by the engine from speed + nitro

  constructor() {
    if (typeof window !== "undefined") {
      this.muted = readStored(MUTE_KEY) === "1";
    }
  }

  /**
   * Create/resume the context after a user gesture and start everything.
   *
   * `ctx` is for rendering offline (an OfflineAudioContext), which is how the
   * mix is measured — peaks, clipping, onsets — without a pair of ears.
   */
  unlock(ctx?: BaseAudioContext) {
    try {
      if (!this.ctx) {
        if (ctx) {
          this.ctx = ctx;
        } else {
          const Ctor = window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (!Ctor) return;
          this.ctx = new Ctor();
          document.addEventListener("visibilitychange", this.onVisibility);
        }
        this.build(this.ctx);
        if (!ctx) void this.loadSamples();
      }
      const live = this.live();
      if (live && live.state === "suspended" && !this.suspendedByUs) void live.resume();
      this.started = true;
    } catch {
      // audio unavailable; ignore
    }
  }

  private live(): AudioContext | null {
    return typeof AudioContext !== "undefined" && this.ctx instanceof AudioContext ? this.ctx : null;
  }

  /**
   * A hidden tab stops requestAnimationFrame, so the race freezes — but the
   * audio kept going: the engine droned on at whatever it was last told, and
   * the throttled timers fed the music in one-second clumps. Suspend with the
   * race, and pick up where it left off.
   */
  private onVisibility = () => {
    const live = this.live();
    if (!live) return;
    if (document.hidden) {
      if (live.state === "running") { this.suspendedByUs = true; void live.suspend(); }
    } else if (this.suspendedByUs) {
      this.suspendedByUs = false;
      void live.resume();
    }
  };

  private build(ctx: BaseAudioContext) {
    this.white = this.makeNoiseBuffer(2, false);
    this.brown = this.makeNoiseBuffer(2, true);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    // Only ever touches a stack of hits louder than anything measured, so the
    // mix sounds the same with it as without it.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    limiter.connect(this.master);

    const mix = ctx.createGain();
    mix.gain.value = 1;
    mix.connect(limiter);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.85 * this.sfxVol;
    this.sfxBus.connect(mix);

    // Music sits under a duck, so a crash or a nitro punches through instead
    // of fighting the bed for the same headroom.
    this.musicDuck = ctx.createGain();
    this.musicDuck.gain.value = 1;
    this.musicDuck.connect(mix);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.22 * this.musicVol;
    this.musicBus.connect(this.musicDuck);

    // Nothing useful lives below ~30 Hz on any speaker this will play on, and
    // the sub there was spending the compressor's headroom on rumble.
    const engineHP = ctx.createBiquadFilter();
    engineHP.type = "highpass";
    engineHP.frequency.value = 32;
    engineHP.Q.value = 0.7;
    engineHP.connect(mix);
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0;
    this.engineBus.connect(engineHP);

    // The road layer belongs to the car, so it follows the SFX volume.
    this.roadBus = ctx.createGain();
    this.roadBus.gain.value = 0.85 * this.sfxVol;
    this.roadBus.connect(mix);

    // Ambience sits well under music/engine and is tied to the music
    // volume in setVolumes. Under master, so mute affects it too.
    this.ambientBus = ctx.createGain();
    this.ambientBus.gain.value = 0.18 * this.musicVol;
    this.ambientBus.connect(mix);

    this.startEngine();
    this.startRoad();
    this.startMusic();
  }

  /**
   * Fetch and decode the recorded one-shots. Never awaited by the game: until a
   * take arrives — or if this browser cannot decode AAC — that effect plays its
   * synthesised voice, so nothing is ever silent for want of a file.
   */
  async loadSamples(base = "/sfx/", ext = "m4a") {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(Object.entries(SAMPLE_TAKES).map(async ([name, n]) => {
      const takes: AudioBuffer[] = [];
      await Promise.all(Array.from({ length: n }, async (_, i) => {
        try {
          const res = await fetch(`${base}${name}-${i}.${ext}`);
          if (!res.ok) return;
          takes[i] = await ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          // this take is unavailable; the others (or the synth) cover it
        }
      }));
      const ok = takes.filter(Boolean);
      if (ok.length) this.samples[name as SampleName] = ok;
    }));
  }

  /** Play one take of a recording. False if none is loaded, so the caller can
   *  fall back to synthesis. Never the same take twice running. */
  private sample(name: SampleName, gain: number, at: number, rate = 1): boolean {
    const takes = this.samples[name];
    if (!this.ctx || !this.sfxBus || !takes?.length) return false;
    let i = Math.floor(Math.random() * takes.length);
    if (takes.length > 1 && i === this.lastTake[name]) i = (i + 1) % takes.length;
    this.lastTake[name] = i;
    const src = this.ctx.createBufferSource();
    src.buffer = takes[i];
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 0.06);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.fxOut ?? this.sfxBus);
    src.start(at);
    return true;
  }

  get isMuted() {
    return this.muted;
  }

  /**
   * True when the browser is holding the context suspended — i.e. `unlock()`
   * ran outside a user gesture and the autoplay policy refused it. iOS Safari
   * is the one that actually does this: it requires the resume to happen
   * inside the gesture's own call stack, and the race starts a tick later from
   * a React effect. The UI uses this to offer a tap rather than leaving the
   * player in silence with no explanation. A suspend of our own (hidden tab)
   * is not a block.
   */
  get blocked() {
    if (!this.ctx) return true;
    const live = this.live();
    return !!live && live.state === "suspended" && !this.suspendedByUs;
  }

  setVolumes(music: number, sfx: number) {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus?.gain.setTargetAtTime(0.22 * music, t, 0.05);
    this.sfxBus?.gain.setTargetAtTime(0.85 * sfx, t, 0.05);
    this.roadBus?.gain.setTargetAtTime(0.85 * sfx, t, 0.05);
    this.ambientBus?.gain.setTargetAtTime(0.18 * music, t, 0.05);
  }

  /** 0..1 — how hard the music drives. The engine feeds this from the car's
   *  speed + nitro so the bed thickens as you go faster and settles when you
   *  slow. Safe before the context exists. */
  setMusicIntensity(x: number) {
    this.musicIntTarget = Math.max(0, Math.min(1, x));
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
    try {
      writeStored(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      // ignore
    }
    return this.muted;
  }

  // ---------------------------------------------------------------- engine

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

    // sub: weight you feel rather than hear. Half what it was — at f0/2 it sat
    // at 16–60 Hz, mostly below what a laptop or phone can reproduce, and it
    // was the loudest thing feeding the compressor.
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = "sine";
    this.engineSub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.4;
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
    this.engineB.detune.value = -7;    // a shade flat, so it beats slowly (gently)
    const bGain = ctx.createGain();
    bGain.gain.value = 0.34;
    this.engineB.connect(bGain);
    bGain.connect(this.engineFilter);
    this.engineB.start();

    // air: intake/exhaust turbulence
    if (this.brown) {
      this.engineNoise = ctx.createBufferSource();
      this.engineNoise.buffer = this.brown;
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
    const upshift = gear > this.engineGear;
    const shifting = this.engineGear !== gear;
    this.engineGear = gear;

    // --- rev wander: a small random walk. A perfectly steady pitch is the
    // giveaway of a synth; engines always hunt slightly.
    this.engineJitter += (Math.random() - 0.5) * 0.009;
    this.engineJitter = Math.max(-0.009, Math.min(0.009, this.engineJitter * 0.92));
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
    this.engineLfoGain?.gain.setTargetAtTime(0.09 * (1 - rpm * 0.75) * (1 - ld * 0.6), t, 0.15);

    // air rises with revs AND with load — you hear the engine breathe when you
    // ask it for something
    this.engineNoiseBP?.frequency.setTargetAtTime(320 + rpm * 1500 + (boosting ? 900 : 0), t, smooth);
    // Air kept to a whisper. It's needed so the tone reads as a machine rather
    // than an oscillator, but the previous mix was hissy — this is roughly a
    // third of it, enough to imply moving air without the sandpaper.
    this.engineNoiseGain?.gain.setTargetAtTime(
      0.025 + sp * 0.05 + ld * 0.05 + (boosting ? 0.08 : 0), t, smooth);

    // formants: the upper bite only opens on the power (and hard on boost); the
    // low boom eases off as revs climb, like a real car leaving its lumpy range.
    // Edge kept modest — that upper peak is exactly what read as harsh; the
    // growl carries the character instead.
    this.engineFormantEdge?.gain.setTargetAtTime(-2 + ld * 3.5 + (boosting ? 3 : 0), t, 0.12);
    this.engineFormantGrowl?.gain.setTargetAtTime(5.5 + ld * 3.5, t, 0.12);
    this.engineFormantBody?.gain.setTargetAtTime(3.5 - rpm * 1.5, t, 0.12); // less boom
    this.engineFormantBody?.frequency.setTargetAtTime(f0 * 1.05, t, smooth);

    this.engineFilter.frequency.setTargetAtTime(
      (boosting ? 1150 : 480) + rpm * 820 + sp * 200 + ld * 520, t, smooth);

    // level: dip through the shift, and back right off when you lift
    const lift = shifting ? 0.55 : 1;
    const loadLevel = 0.6 + ld * 0.4;
    this.engineBus.gain.setTargetAtTime(
      (0.05 + sp * 0.11 + (boosting ? 0.05 : 0)) * lift * loadLevel, t, smooth);

    // An upshift on the power gets the little exhaust crack a real box makes as
    // the throttle closes and reopens. Only from third up and only on load —
    // at every shift it turns into a stutter.
    if (upshift && gear >= 2 && ld > 0.6) {
      this.burst(0.07, 0.11, "lowpass", 900, { dest: this.engineBus, at: t + 0.015 });
    }
  }

  // ------------------------------------------------------------ road layer

  /**
   * Wind, tarmac and tyres. A drift game had no tyre sound at all, and nothing
   * rose with speed except the engine — so 300 km/h sounded like the engine at
   * a high note rather than like going fast.
   */
  private startRoad() {
    if (!this.ctx || !this.roadBus || !this.white || !this.brown) return;
    const ctx = this.ctx;
    const loop = (buf: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, Math.random() * buf.duration);
      return s;
    };

    // wind rush past the car: broadband, rising in pitch and level with speed
    this.rushBP = ctx.createBiquadFilter();
    this.rushBP.type = "bandpass";
    this.rushBP.frequency.value = 400;
    this.rushBP.Q.value = 0.55;
    this.rushGain = ctx.createGain();
    this.rushGain.gain.value = 0;
    loop(this.white).connect(this.rushBP);
    this.rushBP.connect(this.rushGain);
    this.rushGain.connect(this.roadBus);

    // tyres on tarmac: low, dark, rough — and gravel when you leave the road
    this.rumbleLP = ctx.createBiquadFilter();
    this.rumbleLP.type = "lowpass";
    this.rumbleLP.frequency.value = 170;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    loop(this.brown).connect(this.rumbleLP);
    this.rumbleLP.connect(this.rumbleGain);
    this.rumbleGain.connect(this.roadBus);

    // squeal: a rubber squeal is noise excited into a couple of narrow
    // resonances, with a fast wobble from the tread stick-slipping — not a tone
    this.squealBP = ctx.createBiquadFilter();
    this.squealBP.type = "bandpass";
    this.squealBP.frequency.value = 1350;
    this.squealBP.Q.value = 9;
    const squealHi = ctx.createBiquadFilter();
    squealHi.type = "bandpass";
    squealHi.frequency.value = 2250;
    squealHi.Q.value = 12;
    const squealHiGain = ctx.createGain();
    squealHiGain.gain.value = 0.5;
    const squealLP = ctx.createBiquadFilter();
    squealLP.type = "lowpass";
    squealLP.frequency.value = 3800;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    const src = loop(this.white);
    src.connect(this.squealBP);
    src.connect(squealHi);
    squealHi.connect(squealHiGain);
    this.squealBP.connect(squealLP);
    squealHiGain.connect(squealLP);
    squealLP.connect(this.squealGain);
    this.squealGain.connect(this.roadBus);
    const wob = ctx.createOscillator();
    wob.frequency.value = 7.3;
    const wobDepth = ctx.createGain();
    wobDepth.gain.value = 70;
    wob.connect(wobDepth);
    wobDepth.connect(this.squealBP.frequency);
    wob.start();
  }

  /**
   * Feed the road layer each frame.
   * @param speedPercent 0..1 of top speed
   * @param slip side-slip speed in m/s (freeDrive.slip) — the tyres' complaint
   * @param airborne wheels off the ground: no rumble, no squeal, more wind
   * @param offRoad on grass/dirt: gravel instead of squeal
   */
  setRoad(speedPercent: number, slip: number, airborne: boolean, offRoad: boolean) {
    if (!this.ctx || !this.rushGain || !this.rumbleGain || !this.squealGain) return;
    const t = this.ctx.currentTime;
    const sp = Math.max(0, Math.min(1, speedPercent));

    // wind goes with the square of speed, like the drag that makes it
    this.rushBP?.frequency.setTargetAtTime(350 + sp * 1900, t, 0.1);
    this.rushGain.gain.setTargetAtTime(sp * sp * (airborne ? 0.13 : 0.09), t, 0.1);

    const ground = airborne ? 0 : 1;
    this.rumbleLP?.frequency.setTargetAtTime(offRoad ? 650 : 170, t, 0.08);
    this.rumbleGain.gain.setTargetAtTime(
      ground * Math.min(1, sp * 2.2) * (offRoad ? 0.34 : 0.13), t, 0.06);

    // Squeal starts where freedrive starts calling it a drift (1.8 m/s) and is
    // full by a big slide. Needs real speed too — you can't squeal at a crawl.
    const s = Math.max(0, Math.min(1, (Math.abs(slip) - 1.6) / 3.2));
    const squeal = ground * (offRoad ? 0 : 1) * s * Math.min(1, sp * 3);
    this.squealBP?.frequency.setTargetAtTime(1250 + s * 250 + sp * 150, t, 0.1);
    this.squealGain.gain.setTargetAtTime(squeal * 0.16, t, squeal > 0 ? 0.05 : 0.09);
  }

  // ------------------------------------------------------------ one-shots

  /** ±2.5% pitch, so a run of the same sound is a performance, not a machine gun. */
  private vary(f: number) {
    return f * (1 + (Math.random() - 0.5) * 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, at?: number, o: ToneOpts = {}) {
    if (!this.ctx || !this.sfxBus) return;
    const t = at ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.detune) osc.detune.value = o.detune;
    if (o.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (o.attack ?? 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    let tail: AudioNode = g;
    if (o.lowpass) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.lowpass;
      g.connect(f);
      tail = f;
    }
    tail.connect(o.dest ?? this.fxOut ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(
    dur: number, gain: number, filterType: BiquadFilterType, freq: number,
    o: { sweepTo?: number; q?: number; attack?: number; dest?: AudioNode; at?: number } = {},
  ) {
    if (!this.ctx || !this.sfxBus || !this.white) return;
    const t = o.at ?? this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.white;
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(freq, t);
    if (o.q) filt.Q.value = o.q;
    if (o.sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t + dur);
    const g = this.ctx.createGain();
    if (o.attack) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + o.attack);
    } else {
      g.gain.setValueAtTime(gain, t);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(o.dest ?? this.fxOut ?? this.sfxBus);
    const room = Math.max(0, this.white.duration - dur - 0.01);
    src.start(t, Math.random() * room, dur + 0.01);
  }

  /** A struck chime with the music's inharmonic bell partials, so pickups sit
   *  in the same world as the score instead of on top of it as square beeps. */
  private chime(freq: number, gain: number, decay: number, at?: number) {
    const partials = [1, 2.76, 5.4];
    const levels = [1, 0.36, 0.14];
    for (let i = 0; i < partials.length; i++) {
      this.tone(freq * partials[i], decay / (1 + i * 0.7), "sine", gain * levels[i], at, { attack: 0.003 });
    }
  }

  /** A hit with weight: a pitched body falling away under a short noise skin. */
  private thud(freq: number, gain: number, dur: number, at?: number) {
    // A few ms of slop, so several thuds on one frame do not start on the same
    // sample and sum in phase — that is what pushed a five-hit stack to −1 dB.
    const t = (at ?? this.ctx?.currentTime ?? 0) + Math.random() * 0.006;
    this.tone(freq, dur, "sine", gain, t, { sweepTo: freq * 0.45, attack: 0.002 });
    this.burst(Math.min(0.06, dur), gain * 0.5, "lowpass", 1400, { at: t });
  }

  /** Pull the music down for a moment so a big event lands. */
  private duck(depth: number, hold: number) {
    if (!this.ctx || !this.musicDuck) return;
    const t = this.ctx.currentTime;
    const g = this.musicDuck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - depth, t, 0.015);
    g.setTargetAtTime(1, t + hold, 0.25);
  }

  play(name: Sfx) {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const trim = this.ctx.createGain();
    trim.gain.value = Math.pow(10, FX_TRIM[name] / 20);
    trim.connect(this.sfxBus);
    this.fxOut = trim;
    try {
      this.playVoices(name, t);
    } finally {
      this.fxOut = null;
    }
  }

  private playVoices(name: Sfx, t: number) {
    switch (name) {
      // countdown: a soft, clear pip, then a bright two-note GO — readable
      // without the old square wave's buzz
      case "beep":
        this.tone(880, 0.16, "sine", 0.26, t, { attack: 0.004 });
        this.tone(1760, 0.08, "triangle", 0.05, t);
        break;
      case "go":
        this.tone(1174.66, 0.55, "sine", 0.26, t, { attack: 0.004 });
        this.tone(1760, 0.45, "sine", 0.12, t);
        this.tone(587.33, 0.5, "triangle", 0.1, t, { lowpass: 2400 });
        break;

      // gems climb the scale while you chain them, so a line of pickups plays a
      // phrase; a pause resets it to the bottom
      case "gem": {
        this.gemRun = t - this.gemLast < 1.3 ? Math.min(this.gemRun + 1, GEM_SCALE.length - 1) : 0;
        this.gemLast = t;
        this.chime(GEM_SCALE[this.gemRun], 0.17, 0.45, t);
        break;
      }
      case "airGem":
        this.chime(this.vary(1760), 0.15, 0.6, t);
        this.chime(this.vary(2637), 0.07, 0.5, t + 0.05);
        break;
      case "nitroCharge":
        this.chime(this.vary(880), 0.13, 0.3, t);
        this.chime(this.vary(1318.5), 0.12, 0.35, t + 0.07);
        break;

      // a whoosh that opens up, under an exhaust roar that climbs
      case "nitro":
        if (this.sample("nitro", SAMPLE_GAIN.nitro, t)) {
          this.burst(0.6, 0.14, "bandpass", 500, { sweepTo: 3400, q: 0.9, attack: 0.03 });
        } else {
          this.burst(0.7, 0.32, "bandpass", 380, { sweepTo: 3400, q: 0.9, attack: 0.03 });
          this.tone(70, 0.6, "sawtooth", 0.16, t, { sweepTo: 150, attack: 0.02, lowpass: 700 });
        }
        this.thud(95, 0.22, 0.18, t);
        this.duck(0.35, 0.35);
        break;
      case "jump":
        this.burst(0.35, 0.18, "bandpass", 500, { sweepTo: 1800, q: 1.2, attack: 0.02 });
        this.tone(this.vary(240), 0.25, "triangle", 0.08, t, { sweepTo: 520, lowpass: 1600 });
        break;
      case "stunt":
        // a rising arpeggio on the bells — scheduled on the audio clock, so the
        // three notes are evenly spaced however busy the frame was
        [880, 1174.66, 1760].forEach((f, i) => this.chime(f, 0.16, 0.5, t + i * 0.075));
        break;
      case "land":
        if (!this.sample("land", SAMPLE_GAIN.land, t)) {
          this.thud(this.vary(85), 0.38, 0.2, t);
          this.burst(0.12, 0.12, "bandpass", 2400, { q: 2, at: t + 0.01 }); // suspension clunk
        }
        break;
      case "crash":
        // metal and a body panel, a few ms apart, over the synthesised weight
        if (this.sample("crash-metal", SAMPLE_GAIN.crashMetal, t)) {
          this.sample("crash-plate", SAMPLE_GAIN.crashPlate, t + 0.004);
          this.thud(70, 0.3, 0.42, t);
        } else {
          this.thud(70, 0.55, 0.42, t);
          this.burst(0.35, 0.3, "bandpass", 1300, { sweepTo: 400, q: 0.8 });     // crunch
          [430, 990, 1680].forEach((f, i) => this.tone(this.vary(f), 0.22 - i * 0.04, "triangle", 0.07, t + 0.01));
        }
        this.duck(0.45, 0.4);
        break;
      case "oob":
        this.tone(330, 0.13, "triangle", 0.18, t, { lowpass: 1500 });
        this.tone(247, 0.2, "triangle", 0.18, t + 0.15, { lowpass: 1500 });
        break;
      case "lane": this.chime(this.vary(1318.5), 0.11, 0.35, t); break;
      case "transform":
        if (!this.sample("transform", SAMPLE_GAIN.transform, t)) {
          this.tone(160, 0.6, "sawtooth", 0.18, t, { sweepTo: 960, lowpass: 2200, attack: 0.03 });
          this.burst(0.6, 0.14, "bandpass", 600, { sweepTo: 4000, q: 1.5, attack: 0.05 });
        }
        this.chime(1174.66, 0.14, 0.8, t + 0.5);
        this.duck(0.35, 0.6);
        break;
      case "powerDown":
        this.tone(700, 0.45, "sawtooth", 0.15, t, { sweepTo: 160, lowpass: 1500 });
        break;
      case "slash":
        this.burst(0.18, 0.3, "highpass", 2200, { sweepTo: 6500, attack: 0.01 });
        this.tone(this.vary(1600), 0.1, "sine", 0.1, t, { sweepTo: 2600 });
        break;
      case "smash":
        if (!this.sample("smash", SAMPLE_GAIN.smash, t)) {
          this.thud(this.vary(90), 0.4, 0.25, t);
          this.burst(0.25, 0.28, "bandpass", 1500, { sweepTo: 500, q: 0.9 });
        }
        break;
      case "monsterHit":
        // the growl stays synthesised; the blow itself is a recording
        this.tone(90, 0.4, "sawtooth", 0.22, t, { sweepTo: 50, lowpass: 600 });
        if (!this.sample("hit", SAMPLE_GAIN.hit, t)) this.thud(60, 0.4, 0.3, t);
        break;
      case "lap":
        this.chime(880, 0.17, 0.6, t);
        this.chime(1174.66, 0.17, 0.8, t + 0.11);
        break;
      case "finish":
        // was four square waves fired from setTimeout, so its rhythm depended
        // on the frame that happened to be running
        [587.33, 698.46, 880, 1174.66].forEach((f, i) => this.chime(f, 0.2, 1.1, t + i * 0.13));
        this.thud(80, 0.35, 0.4, t);
        this.duck(0.5, 1.2);
        break;
      case "bump":
        if (!this.sample("bump", SAMPLE_GAIN.bump, t)) this.thud(this.vary(110), 0.3, 0.12, t);
        break;
    }
  }

  // ----------------------------------------------------------------- music

  /** A synthetic reverb impulse: stereo decaying noise, slightly darker in the
   *  tail. Reverb is the single thing that turns a set of tones into a PLACE,
   *  which is most of what "ethereal" means. */
  private makeReverbIR(seconds: number, decay: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const env = Math.pow(1 - i / len, decay);
        const white = Math.random() * 2 - 1;
        lp = lp * 0.72 + white * 0.28;          // roll the tail off = warmer space
        d[i] = (white * 0.35 + lp * 0.65) * env;
      }
    }
    return buf;
  }

  /** AKIRA-flavoured cyberpunk / ethereal bed.
   *
   *  Built the way Geinoh Yamashirogumi's Akira score is: gamelan-like
   *  INHARMONIC bells, deep taiko heartbeat, breathy choral pads and a
   *  sustained drone, all in a big reverberant space, over a Japanese HIRAJOSHI
   *  mode (D E F A Bb) instead of functional pop harmony.
   *
   *  It used to be one 4-bar loop played identically for a whole race. Now the
   *  same four harmonies run as an 8-bar form: the bell line rotates each pass,
   *  the second half lifts an octave, and the eighth bar closes on a taiko fill.
   *  The drone is one continuous voice rather than re-struck every bar, which
   *  put a small bump at each downbeat. `musicIntensity` (speed + nitro) still
   *  thickens the texture — more bells, more taiko, brighter pad. */
  private startMusic() {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;

    // the space
    this.musicVerb = ctx.createConvolver();
    const ir = this.makeReverbIR(3.6, 2.4);
    if (ir) this.musicVerb.buffer = ir;
    const wetOut = ctx.createGain();
    wetOut.gain.value = 0.9;
    this.musicVerb.connect(wetOut);
    wetOut.connect(this.musicBus);
    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = 1;
    this.musicSend.connect(this.musicVerb);

    // the drone: one voice for the whole race, breathing through a slow filter
    const D2 = 73.42;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.028;
    const droneLP = ctx.createBiquadFilter();
    droneLP.type = "lowpass";
    droneLP.frequency.value = 260;
    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.07;
    const breatheDepth = ctx.createGain();
    breatheDepth.gain.value = 90;
    breathe.connect(breatheDepth);
    breatheDepth.connect(droneLP.frequency);
    breathe.start();
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.value = D2;
    const oct = ctx.createOscillator();
    oct.type = "sine";
    oct.frequency.value = D2 * 2;
    const octGain = ctx.createGain();
    octGain.gain.value = 0.5;
    saw.connect(droneLP);
    oct.connect(octGain);
    octGain.connect(droneLP);
    droneLP.connect(this.droneGain);
    this.droneGain.connect(this.musicBus);
    const droneWet = ctx.createGain();
    droneWet.gain.value = 0.5;
    this.droneGain.connect(droneWet);
    droneWet.connect(this.musicSend);
    saw.start();
    oct.start();

    this.nextStepAt = ctx.currentTime + 0.05;
    if (this.live()) {
      this.musicTimer = setInterval(() => {
        if (this.ctx) this.scheduleMusic(this.ctx.currentTime + LOOKAHEAD);
      }, 25);
    }
  }

  /**
   * Book every music step up to `until` on the audio clock. If the timer fell
   * badly behind (a long frame, a debugger pause), skip the missed steps rather
   * than firing them all at once in a heap.
   */
  scheduleMusic(until: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.nextStepAt < now - 0.05) {
      const missed = Math.ceil((now - this.nextStepAt) / STEP);
      this.musicStep += missed;
      this.nextStepAt += missed * STEP;
    }
    while (this.nextStepAt < until) {
      if (!this.muted) this.musicStepAt(this.musicStep, this.nextStepAt);
      this.musicStep++;
      this.nextStepAt += STEP;
    }
  }

  private musicStepAt(s: number, at: number) {
    // Hirajoshi on D — the interval that gives it the eastern, slightly uneasy
    // colour is the minor 2nd between E and F sitting over an open D-A fifth.
    const N = { D3: 146.83, E3: 164.81, F3: 174.61, A3: 220.0, Bb3: 233.08,
                D4: 293.66, E4: 329.63, F4: 349.23, A4: 440.0, Bb4: 466.16,
                D5: 587.33, F5: 698.46, A5: 880.0 };
    // Open, quartal-ish voicings. Bar 3 leans on E against Bb (a tritone) for
    // the cyberpunk unease; nothing here resolves like pop harmony.
    const bars = [
      { pad: [N.D3, N.A3, N.F4], bell: [N.D4, N.F4, N.A4, N.D5] },
      { pad: [N.Bb3, N.F4, N.D4], bell: [N.Bb3, N.D4, N.F4, N.Bb4] },
      { pad: [N.E3, N.Bb3, N.D4], bell: [N.E4, N.Bb4, N.D5, N.E3] },
      { pad: [N.D3, N.A3, N.E3], bell: [N.A4, N.F4, N.D4, N.A3] },
    ];

    this.musicIntensity += (this.musicIntTarget - this.musicIntensity) * 0.15;
    const I = this.musicIntensity;
    const step = s % 16;
    const barNo = Math.floor(s / 16);
    const bar = bars[barNo % 4];
    const inForm = barNo % 8;           // 0..7 within the 8-bar form
    const pass = Math.floor(barNo / 8); // rotates the bell line each time round
    const lift = inForm >= 4 ? 2 : 1;   // second half of the form an octave up

    if (step === 0) {
      // Matched to the old drone's AVERAGE level. That one was re-struck each
      // bar and decayed to nothing within about a second (τ ≈ 0.6 s), so the
      // same gain held continuously came out three times as loud.
      this.droneGain?.gain.setTargetAtTime(0.021 + (1 - I) * 0.01, at, 0.8);
      this.mChoir(bar.pad, 3.8, 0.032 + I * 0.022, at);
    }

    // taiko heartbeat — the pulse the whole bed hangs off
    if (step === 0) this.mTaiko(0.5, at);
    if (step === 8) this.mTaiko(0.4, at);
    if (I > 0.5 && step === 12) this.mTaiko(0.3, at);
    if (I > 0.78 && step === 6) this.mTaiko(0.26, at);
    // the eighth bar turns the form over with a fill
    if (inForm === 7 && I > 0.4 && step >= 13) this.mTaiko(0.18 + (step - 13) * 0.07, at);

    // gamelan bells: irregular placement so it never reads as a dance beat
    const bellSteps = I > 0.72 ? [0, 3, 6, 10, 13] : I > 0.42 ? [0, 6, 10] : [0, 6];
    const k = bellSteps.indexOf(step);
    if (k >= 0) {
      const note = bar.bell[(k + pass + (inForm >> 1)) % bar.bell.length];
      // the lift only on the higher bells, so the low end of the line stays put
      this.mGamelan(note * (note < 300 ? 1 : lift), (0.055 + I * 0.05) / (lift > 1 ? 1.25 : 1), at);
    }
    // a high shimmer up top when you're really moving
    if (I > 0.62 && step === 14) this.mGamelan(N.A5, 0.03 + I * 0.02, at);
    // a soft pulse on the drone's own pitch for forward motion without a kick.
    // It was at 37 Hz, which a laptop speaker cannot play at all.
    if (step === 0 || step === 8) this.mTone(73.42, 0.7, "sine", 0.045, at, undefined, 220);
  }

  /** One musical tone routed to the music bus, with an optional reverb send. */
  private mTone(freq: number, dur: number, type: OscillatorType, gain: number, at: number, sweepTo?: number, filterHz?: number, wet = 0) {
    if (!this.ctx || !this.musicBus) return;
    const t = at;
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
    if (wet > 0 && this.musicSend) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      tail.connect(w);
      w.connect(this.musicSend);
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Deep taiko: a pitched thump with a skin transient over it. */
  private mTaiko(gain: number, at: number) {
    if (!this.ctx || !this.musicBus || !this.white) return;
    const t = at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(105, t);
    osc.frequency.exponentialRampToValueAtTime(41, t + 0.3);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(g);
    g.connect(this.musicBus);
    if (this.musicSend) {
      const w = this.ctx.createGain();
      w.gain.value = 0.35;
      g.connect(w);
      w.connect(this.musicSend);
    }
    osc.start(t);
    osc.stop(t + 0.45);
    // the stick on the skin
    this.burst(0.09, gain * 0.3, "lowpass", 900, { dest: this.musicBus, at: t });
  }

  /** Gamelan / temple bell: INHARMONIC partials (2.76, 5.4, 8.93 — the ratios a
   *  struck metal bowl actually rings at, not integer harmonics). This is what
   *  makes it read as struck bronze instead of a synth lead. */
  private mGamelan(freq: number, gain: number, at: number) {
    const partials = [1, 2.76, 5.4, 8.93];
    const levels = [1, 0.5, 0.28, 0.16];
    const decays = [2.6, 1.7, 1.1, 0.7];
    for (let i = 0; i < partials.length; i++) {
      this.mTone(freq * partials[i], decays[i], "sine", gain * levels[i], at, undefined, undefined, 0.85);
    }
  }

  /** Breathy choral pad: detuned voices, slow swell, drenched in the reverb. */
  private mChoir(freqs: number[], dur: number, gain: number, at: number) {
    if (!this.ctx || !this.musicBus) return;
    const t = at;
    for (const f of freqs) {
      for (const det of [-7, 6]) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const filt = this.ctx.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.value = 1300;
        osc.type = "triangle";
        osc.frequency.value = f;
        osc.detune.value = det;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + dur * 0.42);   // slow swell in
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(filt);
        filt.connect(g);
        g.connect(this.musicBus);
        if (this.musicSend) {
          const w = this.ctx.createGain();
          w.gain.value = 1.1;
          g.connect(w);
          w.connect(this.musicSend);
        }
        osc.start(t);
        osc.stop(t + dur + 0.05);
      }
    }
  }

  // -------------------------------------------------------------- ambience

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

  /**
   * Fill a mono AudioBuffer with white (or integrated "brown") noise that
   * loops WITHOUT A SEAM.
   *
   * Brown noise wanders, so its last sample is nowhere near its first, and a
   * looping source jumps between them: a click every loop — every two seconds
   * under the engine, every three under the lava. The end is crossfaded into
   * the start, so sample N-1 runs straight into sample 0.
   */
  private makeNoiseBuffer(seconds: number, brown = false): AudioBuffer | null {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const fade = Math.floor(rate * 0.05);
    const raw = new Float32Array(len + fade);
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        raw[i] = Math.max(-1, Math.min(1, last * 3.5));
      } else {
        raw[i] = white;
      }
    }
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = raw[i];
    // equal-power crossfade of the overrun into the head
    for (let i = 0; i < fade; i++) {
      const w = i / fade;
      data[i] = raw[i] * Math.sin(w * Math.PI / 2) + raw[len + i] * Math.cos(w * Math.PI / 2);
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

    // A looping noise bed, from the shared seamless buffers.
    const noiseSource = (brownNoise = false) => {
      const buf = brownNoise ? this.brown : this.white;
      const src = ctx.createBufferSource();
      if (buf) src.buffer = buf;
      src.loop = true;
      src.start(0, buf ? Math.random() * buf.duration : 0);
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
        noiseSource().connect(bp);
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
        noiseSource(true).connect(lp);
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
        noiseSource().connect(hp);
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
        noiseSource().connect(hp);
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
        noiseSource().connect(lp);
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
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
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
      void this.live()?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
    this.started = false;
  }
}
