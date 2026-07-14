export type Sfx =
  | "beep" | "go" | "gem" | "airGem" | "nitroCharge" | "nitro"
  | "jump" | "stunt" | "land" | "crash" | "oob" | "lane"
  | "transform" | "powerDown" | "slash" | "smash" | "monsterHit"
  | "lap" | "finish" | "bump";

const MUTE_KEY = "fantasy-racer-muted";

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

  private engineA: OscillatorNode | null = null;
  private engineB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;

  private muted = false;
  private started = false;
  private musicVol = 0.7;
  private sfxVol = 0.9;

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

  private startEngine() {
    if (!this.ctx || !this.engineBus) return;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 400;
    this.engineFilter.connect(this.engineBus);

    this.engineA = this.ctx.createOscillator();
    this.engineA.type = "sawtooth";
    this.engineA.frequency.value = 48;
    this.engineA.connect(this.engineFilter);
    this.engineA.start();

    this.engineB = this.ctx.createOscillator();
    this.engineB.type = "sawtooth";
    this.engineB.frequency.value = 72;
    this.engineB.detune.value = 8;
    this.engineB.connect(this.engineFilter);
    this.engineB.start();
  }

  /** Drive the engine hum from the current speed fraction (0..1). */
  setEngine(speedPercent: number, boosting: boolean) {
    if (!this.ctx || !this.engineBus || !this.engineA || !this.engineB || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const base = 46 + speedPercent * 150;
    this.engineA.frequency.setTargetAtTime(base, t, 0.08);
    this.engineB.frequency.setTargetAtTime(base * 1.5, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(
      (boosting ? 1400 : 500) + speedPercent * 1600, t, 0.08
    );
    this.engineBus.gain.setTargetAtTime(0.05 + speedPercent * 0.1 + (boosting ? 0.05 : 0), t, 0.08);
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
    // soft minor-pentatonic arpeggio loop with an occasional bass note
    const scale = [220, 261.6, 293.66, 349.23, 392, 523.25];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || !this.musicBus || this.muted) return;
      const note = scale[this.musicStep % scale.length];
      this.arp(note, 0.5, 0.09);
      if (this.musicStep % 4 === 0) this.arp(note / 2, 0.9, 0.07); // bass
      this.musicStep++;
    }, 320);
  }

  private arp(freq: number, dur: number, gain: number) {
    if (!this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  dispose() {
    if (this.musicTimer) clearInterval(this.musicTimer);
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
