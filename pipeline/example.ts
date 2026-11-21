/**
 * `reel example`: a self-contained demo reel – hook.wav + voice.wav (synthetic hum, not speech),
 * generated images, one "own" sound effect, and a filled-in timeline.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { formatTime } from './input';
import { ensureDir, reelPaths, writeJson } from './paths';
import { writeWav } from './synth';
import { ffmpeg } from './util/ffmpeg';
import { createRng } from './util/rng';

const HOOK = ['Last weeks mein baby kam move karta hai?', 'Yeh bilkul galat hai.'];
const VOICE = [
  'Pehle jo kicks mehsoos hoti thi,',
  'ab woh rolling ya stretching jaisi lag sakti hain.',
  'Har baby ka apna movement pattern hota hai.',
  'Agar baby usual se kam move kare, to wait mat karein.',
  'Turant apne doctor ko contact karein.',
  'Aur aise tips ke liye follow karein.',
];

const SR = 48000;
const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g) ?? []).length);

/** speech-like hum; returns the start time of every sentence (ms, in this file's clock) */
const synthSpeech = (sentences: string[], seed: number) => {
  const rng = createRng(seed);
  const chunks: Float32Array[] = [new Float32Array(Math.round(0.3 * SR))];
  const starts: number[] = [];
  let t = 0.3;
  sentences.forEach((sentence, si) => {
    starts.push(Math.round(t * 1000));
    for (const w of sentence.split(' ')) {
      const syl = syllables(w);
      const d = (0.1 + syl * 0.12) * (0.8 + rng.next() * 0.4);
      const n = Math.round(d * SR);
      const buf = new Float32Array(n);
      const f0 = 130 + rng.next() * 40;
      for (let k = 0; k < n; k++) {
        const x = k / SR;
        const env = Math.sin(Math.PI * (((x / d) * syl) % 1)) ** 0.5 * Math.min(1, x * 100, (d - x) * 100);
        let v = 0;
        for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f0 * h * x) / h;
        buf[k] = v * 0.25 * Math.max(0.25, env);
      }
      chunks.push(buf);
      t += d;
      const gap = /[.?!]$/.test(w) ? (si === 2 ? 1.2 : 0.45) : /,$/.test(w) ? 0.22 : 0.03;
      chunks.push(new Float32Array(Math.round(gap * SR)));
      t += gap;
    }
  });
  const out = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return { samples: out, starts };
};

/** a short "boom" so the demo also shows using your own sound file */
const boom = () => {
  const n = Math.round(0.6 * SR);
  const L = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (55 + 90 * Math.exp(-t * 14))) / SR;
    L[i] = Math.sin(ph) * Math.exp(-t * 5) * 0.9;
  }
  return L;
};

const IMAGES: { name: string; size: string; c: string[] }[] = [
  { name: '1st', size: '1440x1920', c: ['0x2b1a12', '0x9b421a', '0xe8a04c', '0x1c1410'] },
  { name: '2nd', size: '1920x1280', c: ['0x14202b', '0x3d6b8c', '0xd9c6a5', '0x0e1116'] },
  { name: '3rd', size: '1600x2000', c: ['0x1a1030', '0x7b3fa0', '0xf2a65a', '0x101018'] },
  { name: '4th', size: '2000x1500', c: ['0x0d2b22', '0x2f8f6b', '0xf0e2b6', '0x0b0f0d'] },
  { name: '5th', size: '1080x1920', c: ['0x301010', '0xc0392b', '0xf5d5a0', '0x120808'] },
  { name: '6th', size: '1500x2000', c: ['0x10202a', '0x5fa8d3', '0xfafafa', '0x0a0f14'] },
];

export const makeExample = async (name = 'example') => {
  const p = reelPaths(name);
  fs.rmSync(p.dir, { recursive: true, force: true });
  ensureDir(p.images);
  ensureDir(path.join(p.dir, 'sfx'));
  for (const [i, img] of IMAGES.entries()) {
    const [w, h] = img.size.split('x').map(Number);
    const f =
      `gradients=s=${img.size}:c0=${img.c[0]}:c1=${img.c[1]}:c2=${img.c[2]}:c3=${img.c[3]}:nb_colors=4:seed=${i + 3}:speed=0.00001:type=radial,` +
      `drawbox=x=${Math.round(w * 0.12)}:y=${Math.round(h * 0.55)}:w=${Math.round(w * 0.3)}:h=${Math.round(h * 0.3)}:color=white@0.18:t=fill,` +
      `drawgrid=w=${Math.round(w / 8)}:h=${Math.round(w / 8)}:t=2:c=white@0.10`;
    await ffmpeg(['-f', 'lavfi', '-i', f, '-frames:v', '1', '-q:v', '3', path.join(p.images, `${img.name}.jpg`)]);
  }
  const hook = synthSpeech(HOOK, 1);
  const voice = synthSpeech(VOICE, 2);
  writeWav(path.join(p.dir, 'hook.wav'), hook.samples, hook.samples);
  writeWav(path.join(p.dir, 'voice.wav'), voice.samples, voice.samples);
  const b = boom();
  writeWav(path.join(p.dir, 'sfx', 'boom.wav'), b, b);

  const at = (ms: number) => formatTime(Math.max(0, ms - 100));
  writeJson(p.input, {
    hook: {
      shots: [{ time: '0:00', image: '1st', motion: 'zoom-in', text: HOOK.join(' ') }],
    },
    voice: {
      shots: [
        { time: '0:00', image: '2nd', transition: 'push', sfx: 'boom.wav', text: VOICE[0] + ' ' + VOICE[1] },
        { time: at(voice.starts[2]), image: '3rd', transition: 'zoom', text: VOICE[2] },
        { time: at(voice.starts[3]), image: '4th', transition: 'whip', motion: 'pan-left', text: VOICE[3] },
        { time: at(voice.starts[4]), image: '5th', transition: 'slide-up', sfx: 'hit', focus: 'top', text: VOICE[4] },
        { time: at(voice.starts[5]), image: '6th', transition: 'crossfade', sfx: 'riser', treatment: 'warm', text: VOICE[5] },
      ],
    },
    settings: { captions: { mode: 'word' } },
  });
  return p;
};
