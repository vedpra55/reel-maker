/**
 * Sound effects synthesised in code (no samples, no AI). 48 kHz stereo 16-bit WAV.
 * Drop your own whoosh.wav / pop.wav / tick.wav / riser.wav / hit.wav into assets/sfx to replace them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SFX_KINDS } from '../shared/schema';
import { createRng } from './util/rng';

const SR = 48000;

export const writeWav = (file: string, left: Float32Array, right: Float32Array, SR = 48000) => {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  // normalise to -1 dBFS peak
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const g = 0.89 / peak;
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * g)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * g)) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
};

/** state-variable filter, returns band-pass output per sample */
const svf = () => {
  let low = 0;
  let band = 0;
  return (x: number, fc: number, q: number) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR);
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    return { low, band, high };
  };
};

const env = (t: number, attack: number, release: number, total: number) => {
  if (t < attack) return Math.pow(t / attack, 2);
  const r = (t - attack) / Math.max(1e-6, total - attack);
  return Math.pow(Math.max(0, 1 - r), release);
};

const whoosh = () => {
  const len = 0.55;
  const n = Math.round(len * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rng = createRng(7);
  const fl = svf();
  const fr = svf();
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = t / len;
    // sweep up then down
    const fc = 350 + 3200 * Math.sin(Math.PI * Math.min(1, p * 1.15));
    const e = env(t, len * 0.62, 2.2, len);
    const pan = 0.5 + 0.45 * Math.sin(Math.PI * (p - 0.5)); // left → right
    L[i] = fl(rng.next() * 2 - 1, fc, 0.9).band * e * (1 - pan);
    R[i] = fr(rng.next() * 2 - 1, fc * 1.03, 0.9).band * e * pan;
  }
  return [L, R] as const;
};

const pop = () => {
  const len = 0.14;
  const n = Math.round(len * SR);
  const L = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 300 + 700 * Math.exp(-t * 45);
    phase += (2 * Math.PI * f) / SR;
    L[i] = Math.sin(phase) * Math.exp(-t * 32) * Math.min(1, t * 2000);
  }
  return [L, L] as const;
};

const tick = () => {
  const len = 0.06;
  const n = Math.round(len * SR);
  const L = new Float32Array(n);
  const rng = createRng(3);
  const f = svf();
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const click = (rng.next() * 2 - 1) * Math.exp(-t * 900);
    const tone = Math.sin(2 * Math.PI * 2600 * t) * Math.exp(-t * 110) * 0.6;
    L[i] = f(click, 4000, 0.5).band + tone;
  }
  return [L, L] as const;
};

const riser = () => {
  const len = 1.2;
  const n = Math.round(len * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rng = createRng(11);
  const fl = svf();
  const fr = svf();
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = t / len;
    const fc = 200 * Math.pow(30, p);
    const e = Math.pow(p, 2.2) * (p > 0.96 ? (1 - p) / 0.04 : 1);
    ph += (2 * Math.PI * (110 * Math.pow(4, p))) / SR;
    const tone = Math.sin(ph) * 0.25;
    L[i] = (fl(rng.next() * 2 - 1, fc, 0.7).band + tone) * e;
    R[i] = (fr(rng.next() * 2 - 1, fc * 1.05, 0.7).band + tone) * e;
  }
  return [L, R] as const;
};

const hit = () => {
  const len = 0.7;
  const n = Math.round(len * SR);
  const L = new Float32Array(n);
  const rng = createRng(5);
  const f = svf();
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fr = 42 + 70 * Math.exp(-t * 18);
    ph += (2 * Math.PI * fr) / SR;
    const body = Math.sin(ph) * Math.exp(-t * 6.5);
    const crack = f(rng.next() * 2 - 1, 1800, 0.6).low * Math.exp(-t * 40) * 0.8;
    L[i] = Math.tanh((body + crack) * 1.6) * Math.min(1, t * 3000);
  }
  return [L, L] as const;
};

const GENERATORS = { whoosh, pop, tick, riser, hit } as const;

/** write any missing SFX files; returns the list that was generated */
export const ensureSfx = (dir: string, force = false): string[] => {
  fs.mkdirSync(dir, { recursive: true });
  const made: string[] = [];
  for (const k of SFX_KINDS) {
    const file = path.join(dir, `${k}.wav`);
    if (!force && fs.existsSync(file)) continue;
    const [L, R] = GENERATORS[k]();
    writeWav(file, L, R);
    made.push(k);
  }
  return made;
};
