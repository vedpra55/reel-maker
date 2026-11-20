/**
 * `reel example`: builds a self-contained demo reel (synthetic "voice", generated images, word timings)
 * so the whole pipeline can be tried without a recording or whisper.
 * The voice is a hum, not speech – it exists to drive timing, pauses and loudness.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, reelPaths, writeJson } from './paths';
import { parseScript } from './script';
import { writeWav } from './synth';
import { ffmpeg } from './util/ffmpeg';
import { createRng } from './util/rng';

export const EXAMPLE_SCRIPT = `# hook
Nobody watches past the *first second.*

# body
[img 01-studio] So we rebuilt our whole process from the ground up.
We cut every video down to the _one idea_ that matters.
[stat] *10K* followers in just six weeks.
[img 02-desk split] The secret was not a bigger budget.
It was a simple system we run every Saturday.
[text] Write the hook first. Then everything else.
[img 03-city] Our whole $15,000 journey started with one decision.
[img 04-street] Make every second earn the next one.
[end] Follow for more.
`;

const SR = 48000;

const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g) ?? []).length);

/** speech-like hum: voiced harmonics with a syllable envelope */
const synthVoice = (words: { text: string; gapAfter: number }[], seed: number) => {
  const rng = createRng(seed);
  const timings: { text: string; startMs: number; endMs: number }[] = [];
  const chunks: Float32Array[] = [];
  let t = 0.35; // leading silence (gets trimmed)
  chunks.push(new Float32Array(Math.round(t * SR)));
  for (const w of words) {
    const syl = /\d/.test(w.text) ? 3 : syllables(w.text);
    const d = 0.11 + syl * 0.13 + rng.next() * 0.04;
    const n = Math.round(d * SR);
    const buf = new Float32Array(n);
    const f0 = 120 + rng.next() * 40;
    for (let i = 0; i < n; i++) {
      const x = i / SR;
      const sylPos = (x / d) * syl;
      const env = Math.sin(Math.PI * (sylPos % 1)) ** 0.6 * Math.min(1, x * 80, (d - x) * 80);
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f0 * h * x) / h;
      buf[i] = v * 0.25 * env + (rng.next() * 2 - 1) * 0.01 * env;
    }
    chunks.push(buf);
    timings.push({ text: w.text, startMs: Math.round(t * 1000), endMs: Math.round((t + d) * 1000) });
    t += d;
    const gap = new Float32Array(Math.round(w.gapAfter * SR));
    for (let i = 0; i < gap.length; i++) gap[i] = (rng.next() * 2 - 1) * 0.0005;
    chunks.push(gap);
    t += w.gapAfter;
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return { samples: out, timings };
};

const IMAGES: { name: string; size: string; c: string[] }[] = [
  { name: '01-studio', size: '1440x1920', c: ['0x2b1a12', '0x9b421a', '0xe8a04c', '0x1c1410'] },
  { name: '02-desk', size: '1920x1280', c: ['0x14202b', '0x3d6b8c', '0xd9c6a5', '0x0e1116'] },
  { name: '03-city', size: '1600x2000', c: ['0x1a1030', '0x7b3fa0', '0xf2a65a', '0x101018'] },
  { name: '04-street', size: '2000x1500', c: ['0x0d2b22', '0x2f8f6b', '0xf0e2b6', '0x0b0f0d'] },
];

export const makeExample = async (name = 'example') => {
  const p = reelPaths(name);
  ensureDir(p.images);
  fs.writeFileSync(p.script, EXAMPLE_SCRIPT);
  writeJson(p.settings, { preset: 'anyash-light', look: { brandLine: '' } });

  // images: soft gradients with a few shapes, different sizes/orientations
  for (const [i, img] of IMAGES.entries()) {
    const [w, h] = img.size.split('x').map(Number);
    const f =
      `gradients=s=${img.size}:c0=${img.c[0]}:c1=${img.c[1]}:c2=${img.c[2]}:c3=${img.c[3]}:nb_colors=4:seed=${i + 3}:speed=0.00001:type=radial,` +
      `drawbox=x=${Math.round(w * 0.12)}:y=${Math.round(h * 0.55)}:w=${Math.round(w * 0.3)}:h=${Math.round(h * 0.3)}:color=white@0.18:t=fill,` +
      `drawbox=x=${Math.round(w * 0.55)}:y=${Math.round(h * 0.18)}:w=${Math.round(w * 0.25)}:h=${Math.round(h * 0.5)}:color=black@0.25:t=fill,` +
      `drawgrid=w=${Math.round(w / 8)}:h=${Math.round(w / 8)}:t=2:c=white@0.08`;
    await ffmpeg(['-f', 'lavfi', '-i', f, '-frames:v', '1', '-q:v', '3', path.join(p.images, `${img.name}.jpg`)]);
  }

  // voice: hook and body as separate files, with natural-ish gaps (and one long pause to tighten)
  const parsed = parseScript(EXAMPLE_SCRIPT);
  const gapFor = (t: string, i: number) => (/[.!?]$/.test(t) ? (i === 30 ? 1.3 : 0.55) : /,$/.test(t) ? 0.25 : 0.05);
  for (const section of ['hook', 'body'] as const) {
    const toks = parsed.tokens.filter((t) => t.section === section);
    const { samples, timings } = synthVoice(
      toks.map((t, i) => ({ text: t.text, gapAfter: gapFor(t.text, i) })),
      section === 'hook' ? 1 : 2,
    );
    const base = section === 'hook' ? 'hook' : 'voice';
    writeWav(path.join(p.dir, `${base}.wav`), samples, samples);
    // the "transcript" is lowercased and loses punctuation like whisper sometimes does
    writeJson(
      path.join(p.dir, `${base}.words.json`),
      timings.map((w) => ({ text: ' ' + w.text.replace(/[*_]/g, ''), startMs: w.startMs, endMs: w.endMs, confidence: 0.95 })),
    );
  }
  return p;
};
