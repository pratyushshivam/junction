/** Every sound is synthesised with WebAudio; there are no audio files. */
import { load, save } from "./storage";

type Ctor = typeof AudioContext;

export class Sound {
  muted = load("muted") === "1";
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastTick = 0;

  /** Browsers only allow sound after a gesture, so call this from one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    save("muted", muted ? "1" : "0");
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  vibrate(pattern: number | number[]): void {
    if (this.muted) return;
    // Browsers refuse (and log) vibration before the first real tap.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation && !activation.hasBeenActive) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* not supported */
    }
  }

  private tone(
    freq: number,
    start: number,
    length: number,
    peak: number,
    type: OscillatorType = "sine",
    slideTo?: number,
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + length + 0.03);
  }

  /** Soft tick while a line is being drawn. Rate limited. */
  tick(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTick < 0.045) return;
    this.lastTick = now;
    this.tone(1500 + Math.random() * 250, 0, 0.03, 0.022, "triangle");
  }

  pick(): void {
    this.tone(520, 0, 0.07, 0.05, "triangle");
  }

  /** The line reached its bay. */
  lock(bay: number): void {
    const base = NOTES[bay % NOTES.length]!;
    this.tone(base, 0, 0.09, 0.06, "triangle");
    this.tone(base * 1.5, 0.06, 0.14, 0.05, "triangle");
    this.vibrate(8);
  }

  /** A vehicle parked. */
  chime(bay: number): void {
    const base = NOTES[bay % NOTES.length]!;
    this.tone(base * 2, 0, 0.5, 0.09);
    this.tone(base * 3, 0.09, 0.6, 0.06);
    this.vibrate(14);
  }

  arrival(): void {
    this.tone(330, 0, 0.1, 0.018);
  }

  newBay(): void {
    this.tone(392, 0, 0.3, 0.05);
    this.tone(494, 0.1, 0.3, 0.05);
    this.tone(587, 0.2, 0.5, 0.05);
  }

  /** Two vehicles touched, but there are hearts left. */
  bump(): void {
    this.vibrate(40);
    this.tone(150, 0, 0.3, 0.3, "sine", 55);
  }

  crash(): void {
    this.vibrate([50, 40, 110]);
    if (!this.ctx || !this.master || this.muted) return;
    this.tone(120, 0, 0.45, 0.5, "sine", 38);
    // A short burst of filtered noise for the crunch.
    const length = 0.22;
    const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * length), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }
}

/** One note per bay (a pentatonic scale, so any mix of deliveries sounds fine together). */
const NOTES = [261.63, 293.66, 329.63, 392.0, 440.0];
