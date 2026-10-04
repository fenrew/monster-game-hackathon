// Procedural rock soundtrack (original compositions), synthesized with Web Audio: no audio files needed.
// Three songs: overworld anthem, battle gallop, boss breakdown. M toggles music.
import { isTyping } from './dom';

type LeadNote = [string | null, number]; // note name (or null = rest), length in 16th steps

interface Section {
  chords: string[]; // one power-chord root per bar, e.g. "E2"
  guitar: string;   // 16 steps per bar: x = palm-muted chug, X = open ringing chord, - = rest
  kick: string;
  snare: string;
  hat: string;      // h = closed hat, c = crash
  lead: LeadNote[][]; // one array per bar (each should add up to 16 steps)
}

interface Song { name: string; bpm: number; sections: Section[] }

// ---------------------------------------------------------------- the songs (original)

const n = (s: string): LeadNote[] => s.trim().split(/\s+/).map((tok) => {
  const [note, len] = tok.split(':');
  return [note === '.' ? null : note, Number(len)];
});

const ROUTE_RIOT: Song = {
  name: 'Route Riot',
  bpm: 150,
  sections: [
    {
      chords: ['E2', 'E2', 'C2', 'D2', 'E2', 'E2', 'A2', 'B2'],
      guitar: 'x-x-x-x-x-x-x-x-',
      kick: 'x-----x-x-------',
      snare: '----x-------x---',
      hat: 'h-h-h-h-h-h-h-h-',
      lead: [
        n('B4:4 E5:2 F#5:2 G#5:4 F#5:2 E5:2'), n('B4:6 .:2 G#4:2 A4:2 B4:4'),
        n('C5:4 E5:4 G5:4 E5:2 C5:2'), n('D5:4 F#5:4 A5:6 .:2'),
        n('B5:4 G#5:2 E5:2 B5:4 A5:2 G#5:2'), n('F#5:6 E5:2 F#5:4 G#5:4'),
        n('A5:4 C#6:4 B5:2 A5:2 E5:4'), n('F#5:4 D#5:4 B4:8'),
      ],
    },
    {
      chords: ['A2', 'B2', 'G#2', 'C#3', 'A2', 'B2', 'E2', 'E2'],
      guitar: 'X-------X---x-x-',
      kick: 'x---x-x-x---x-x-',
      snare: '----x-------x---',
      hat: 'c-h-h-h-h-h-h-h-',
      lead: [
        n('E5:4 E5:2 F#5:2 A5:4 G#5:2 F#5:2'), n('F#5:4 F#5:2 G#5:2 B5:6 .:2'),
        n('G#5:4 B5:4 C#6:4 B5:4'), n('G#5:8 F#5:4 E5:4'),
        n('E5:2 F#5:2 A5:4 B5:4 C#6:4'), n('D#6:4 C#6:2 B5:2 F#5:8'),
        n('E6:6 B5:2 G#5:4 B5:4'), n('E6:12 .:4'),
      ],
    },
  ],
};

const WILD_CLASH: Song = {
  name: 'Wild Clash',
  bpm: 172,
  sections: [
    {
      chords: ['E2', 'E2', 'C2', 'D2', 'E2', 'E2', 'G2', 'A2'],
      guitar: 'x-xxx-xxx-xxx-xx',
      kick: 'x-x-x-x-x-x-x-x-',
      snare: '----x-------x---',
      hat: 'c-h-h-h-h-h-h-h-',
      lead: [
        n('E5:2 G5:2 B5:2 E6:2 D6:2 B5:2 G5:2 A5:2'), n('B5:4 A5:2 G5:2 F#5:4 E5:4'),
        n('G5:2 C6:2 E6:2 C6:2 G5:2 E5:2 G5:2 C6:2'), n('D6:4 C6:2 B5:2 A5:4 F#5:4'),
        n('E6:4 D6:2 E6:2 G6:4 F#6:2 E6:2'), n('D6:2 B5:2 G5:2 B5:2 E5:8'),
        n('D6:4 B5:4 G5:4 B5:4'), n('C#6:4 E6:4 A5:8'),
      ],
    },
    {
      // hardcore half: double-kick 16ths under ringing chords
      chords: ['C2', 'D2', 'E2', 'E2', 'C2', 'D2', 'B1', 'B1'],
      guitar: 'X-----X-X-----x-',
      kick: 'xxxxxxxxxxxxxxxx',
      snare: '----x-------x---',
      hat: 'c-------h-------',
      lead: [
        n('E6:8 D6:4 C6:4'), n('D6:8 F#6:4 A6:4'),
        n('G6:6 F#6:2 E6:8'), n('B5:4 D6:4 E6:8'),
        n('E6:4 G6:4 E6:4 C6:4'), n('D6:4 F#6:4 A6:4 F#6:4'),
        n('G6:4 F#6:4 D#6:4 B5:4'), n('F#6:12 .:4'),
      ],
    },
  ],
};

const TITAN: Song = {
  name: 'Titan',
  bpm: 140,
  sections: [
    {
      // half-time breakdown in drop D
      chords: ['D2', 'D2', 'A#1', 'C2', 'D2', 'D2', 'F2', 'E2'],
      guitar: 'x--x--x---x-x---',
      kick: 'x--x--x---x-x---',
      snare: '--------x-------',
      hat: 'c---h---h---h---',
      lead: [
        n('D5:8 F5:4 E5:4'), n('D5:4 A4:4 C5:4 D5:4'),
        n('F5:8 E5:4 D5:4'), n('E5:8 G5:4 A5:4'),
        n('A5:8 G5:4 F5:4'), n('E5:4 F5:4 D5:8'),
        n('C6:8 A5:4 F5:4'), n('G#5:8 E5:4 B4:4'),
      ],
    },
    {
      chords: ['D2', 'D2', 'D2', 'D#2', 'D2', 'D2', 'A#1', 'A1'],
      guitar: 'xxxxxxxxX-------',
      kick: 'xxxxxxxxx---x---',
      snare: '----x-------x---',
      hat: 'c-h-h-h-h-h-h-h-',
      lead: [
        n('D6:4 C6:4 A5:4 F5:4'), n('G5:4 A5:4 D5:8'),
        n('D6:4 C6:4 A5:4 C6:4'), n('D#6:12 .:4'),
        n('A5:4 D6:4 F6:4 E6:4'), n('D6:4 C6:4 A5:8'),
        n('A#5:8 A5:4 F5:4'), n('A5:8 C#6:8'),
      ],
    },
  ],
};

const SONGS = { overworld: ROUTE_RIOT, battle: WILD_CLASH, boss: TITAN };
export type SongKey = keyof typeof SONGS;

// ---------------------------------------------------------------- synthesis

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function freq(note: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(note);
  if (!m) return 440;
  const midi = 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function distortionCurve(amount: number): Float32Array {
  const len = 2048;
  const curve = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = (i * 2) / len - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

class Engine {
  ctx: AudioContext;
  private master: GainNode;
  private guitarIn: GainNode;
  private leadIn: GainNode;
  private drums: GainNode;
  private noise: AudioBuffer;

  constructor() {
    this.ctx = new AudioContext();
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    comp.connect(this.master).connect(ctx.destination);

    // guitar bus: drive -> distortion -> "cabinet" filtering
    this.guitarIn = ctx.createGain();
    this.guitarIn.gain.value = 2.2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(380) as Float32Array<ArrayBuffer>;
    shaper.oversample = '4x';
    const cab = ctx.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 3600;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 800;
    mid.gain.value = -5; // scooped mids, metal-style
    const gOut = ctx.createGain();
    gOut.gain.value = 0.16;
    this.guitarIn.connect(shaper).connect(cab).connect(mid).connect(gOut).connect(comp);

    // lead bus: lighter drive + slapback delay
    this.leadIn = ctx.createGain();
    const leadShaper = ctx.createWaveShaper();
    leadShaper.curve = distortionCurve(60) as Float32Array<ArrayBuffer>;
    const leadLp = ctx.createBiquadFilter();
    leadLp.type = 'lowpass';
    leadLp.frequency.value = 4200;
    const leadOut = ctx.createGain();
    leadOut.gain.value = 0.11;
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.27;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    this.leadIn.connect(leadShaper).connect(leadLp).connect(leadOut).connect(comp);
    leadOut.connect(delay).connect(fb).connect(delay);
    fb.connect(comp);

    this.drums = ctx.createGain();
    this.drums.gain.value = 0.8;
    this.drums.connect(comp);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number, at = this.ctx.currentTime) {
    this.master.gain.cancelScheduledValues(at);
    this.master.gain.setTargetAtTime(v, at, 0.15);
  }

  private env(t: number, peak: number, decay: number, dest: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(dest);
    return g;
  }

  powerChord(root: string, t: number, dur: number, muted: boolean) {
    const f = freq(root);
    const g = this.env(t, muted ? 0.8 : 0.6, muted ? Math.min(dur, 0.14) : dur, this.guitarIn);
    const ratios = muted ? [1, 1.5, 2] : [1, 1.5, 2, 3];
    for (const r of ratios) {
      for (const det of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * r;
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
    // bass doubles the root
    const b = this.ctx.createOscillator();
    b.type = 'square';
    b.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const bg = this.env(t, 0.22, Math.max(0.12, dur), this.drums);
    b.connect(lp).connect(bg);
    b.start(t);
    b.stop(t + dur + 0.05);
  }

  lead(note: string, t: number, dur: number) {
    const f = freq(note);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
    g.gain.setValueAtTime(0.9, t + Math.max(0.03, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    g.connect(this.leadIn);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibAmt = this.ctx.createGain();
    vibAmt.gain.value = dur > 0.3 ? f * 0.012 : 0; // vibrato on held notes
    vib.connect(vibAmt);
    for (const [type, det] of [['sawtooth', -6], ['square', 6]] as const) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      vibAmt.connect(o.frequency);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    vib.start(t);
    vib.stop(t + dur + 0.1);
  }

  kick(t: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    o.connect(this.env(t, 1, 0.22, this.drums));
    o.start(t);
    o.stop(t + 0.25);
    // beater click
    this.noiseHit(t, 0.25, 0.012, 'highpass', 2500);
  }

  snare(t: number) {
    this.noiseHit(t, 0.55, 0.18, 'bandpass', 1900);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    o.connect(this.env(t, 0.35, 0.1, this.drums));
    o.start(t);
    o.stop(t + 0.12);
  }

  hat(t: number) {
    this.noiseHit(t, 0.12, 0.04, 'highpass', 8000);
  }

  crash(t: number) {
    this.noiseHit(t, 0.28, 1.4, 'highpass', 5000);
  }

  private noiseHit(t: number, peak: number, decay: number, type: BiquadFilterType, f: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = f;
    src.connect(filt).connect(this.env(t, peak, decay, this.drums));
    src.start(t);
    src.stop(t + decay + 0.05);
  }
}

// ---------------------------------------------------------------- sequencer

const VOL_KEY = 'stb-music-volume';
const MUTE_KEY = 'stb-music-muted';

class Music {
  private engine: Engine | null = null;
  private song: Song = ROUTE_RIOT;
  private wanted: Song = ROUTE_RIOT;
  private section = 0;
  private bar = 0;
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  volume = 0.5;
  muted = false;
  onChange: () => void = () => {};

  constructor() {
    try {
      this.volume = Number(localStorage.getItem(VOL_KEY) ?? 0.5);
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch { /* storage unavailable */ }
  }

  /** Audio can only start after a user gesture; call this from one. */
  unlock() {
    if (!this.engine) {
      try {
        this.engine = new Engine();
      } catch {
        return; // no Web Audio support
      }
      this.engine.setVolume(this.muted ? 0 : this.volume);
      this.nextTime = this.engine.ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
    if (this.engine.ctx.state === 'suspended') void this.engine.ctx.resume();
  }

  play(key: SongKey) {
    this.wanted = SONGS[key];
  }

  get songName() {
    return this.song.name;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.engine?.setVolume(this.muted ? 0 : this.volume);
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* ignore */ }
    this.onChange();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (!this.muted) this.engine?.setVolume(this.volume);
    try { localStorage.setItem(VOL_KEY, String(this.volume)); } catch { /* ignore */ }
    this.onChange();
  }

  private schedule() {
    const e = this.engine;
    if (!e || e.ctx.state !== 'running') return;
    // Skip ahead after the tab was in the background, rather than playing a burst of stale notes.
    if (this.nextTime < e.ctx.currentTime - 0.2) this.nextTime = e.ctx.currentTime + 0.05;
    while (this.nextTime < e.ctx.currentTime + 0.12) {
      this.playStep(e, this.nextTime);
      this.nextTime += 60 / this.song.bpm / 4;
      if (++this.step >= 16) {
        this.step = 0;
        this.bar++;
        // Switch songs on a bar line so changes land on the beat.
        if (this.wanted !== this.song) {
          this.song = this.wanted;
          this.section = 0;
          this.bar = 0;
          this.onChange();
        } else if (this.bar >= this.song.sections[this.section].chords.length) {
          this.bar = 0;
          this.section = (this.section + 1) % this.song.sections.length;
        }
      }
    }
  }

  private playStep(e: Engine, t: number) {
    const sec = this.song.sections[this.section];
    const s = this.step;
    const stepDur = 60 / this.song.bpm / 4;
    const root = sec.chords[this.bar];
    const g = sec.guitar[s];
    if (g === 'x' || g === 'X') {
      let len = 1;
      if (g === 'X') while (s + len < 16 && sec.guitar[s + len] === '-') len++;
      e.powerChord(root, t, len * stepDur, g === 'x');
    }
    if (sec.kick[s] === 'x') e.kick(t);
    if (sec.snare[s] === 'x') e.snare(t);
    if (sec.hat[s] === 'h') e.hat(t);
    if (sec.hat[s] === 'c' && this.bar % 4 === 0) e.crash(t);
    else if (sec.hat[s] === 'c') e.hat(t);
    // lead line
    let pos = 0;
    for (const [note, len] of sec.lead[this.bar] ?? []) {
      if (pos === s && note) e.lead(note, t, len * stepDur * 0.95);
      pos += len;
    }
  }
}

export const music = new Music();

/** Wires gesture unlock, the M key, and picks the song from game state. */
export function initMusic(currentSong: () => SongKey) {
  const unlock = () => music.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', (e) => {
    unlock();
    if (isTyping()) return;
    if (e.key === 'm' || e.key === 'M') music.toggleMute();
  });
  setInterval(() => music.play(currentSong()), 300);
}
