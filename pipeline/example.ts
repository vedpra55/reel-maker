/**
 * `reel example`: a self-contained demo reel (synthetic "voice", generated images, word timings)
 * so the pipeline can be tried without a recording or whisper.
 * The voice is a hum, not speech – it exists to drive timing, pauses and loudness.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, reelPaths, writeJson } from './paths';
import { writeWav } from './synth';
import { ffmpeg } from './util/ffmpeg';
import { createRng } from './util/rng';

const SPOKEN =
  'Nobody watches past the first second. So we rebuilt our whole process from the ground up. ' +
  'We cut every video down to the one idea that matters. Ten thousand followers in just six weeks. ' +
  'The secret was not a bigger budget. It was a simple system we run every Saturday. ' +
  'Write the hook first. Then everything else. Make every second earn the next one.';

/** times are in the ORIGINAL voice.wav clock – the same numbers you'd read off a player */
export const EXAMPLE_SCRIPT = `# One line per image:  time  image  [options]
0:00     01-studio   zoom-in
0:03.1   02-desk     push
0:07.4   03-city     pan-left     zoom
0:11.6   04-street   whip
0:15.2   05-room     focus=top
0:19.0   06-light    bw   slide-up
0:23.4   01-studio   zoom-out     crossfade
`;

const SR = 48000;
const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g) ?? []).length);

/** speech-like hum: voiced harmonics with a syllable envelope */
const synthVoice = (words: string[], seed: number) => {
  const rng = createRng(seed);
  const timings: { text: string; startMs: number; endMs: number }[] = [];
  const chunks: Float32Array[] = [];
  let t = 0.35;
  chunks.push(new Float32Array(Math.round(t * SR)));
  words.forEach((text, i) => {
    const syl = syllables(text);
    const d = 0.11 + syl * 0.13 + rng.next() * 0.04;
    const n = Math.round(d * SR);
    const buf = new Float32Array(n);
    const f0 = 120 + rng.next() * 40;
    for (let k = 0; k < n; k++) {
      const x = k / SR;
      const env = Math.sin(Math.PI * (((x / d) * syl) % 1)) ** 0.6 * Math.min(1, x * 80, (d - x) * 80);
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f0 * h * x) / h;
      buf[k] = v * 0.25 * env;
    }
    chunks.push(buf);
    timings.push({ text, startMs: Math.round(t * 1000), endMs: Math.round((t + d) * 1000) });
    t += d;
    const gap = /[.!?]$/.test(text) ? (i === 30 ? 1.3 : 0.55) : /,$/.test(text) ? 0.25 : 0.05;
    chunks.push(new Float32Array(Math.round(gap * SR)));
    t += gap;
  });
  const out = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
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
  { name: '05-room', size: '1080x1920', c: ['0x301010', '0xc0392b', '0xf5d5a0', '0x120808'] },
  { name: '06-light', size: '1500x2000', c: ['0x10202a', '0x5fa8d3', '0xfafafa', '0x0a0f14'] },
];

export const makeExample = async (name = 'example') => {
  const p = reelPaths(name);
  ensureDir(p.images);
  fs.writeFileSync(p.script, EXAMPLE_SCRIPT);
  writeJson(p.settings, {});
  for (const [i, img] of IMAGES.entries()) {
    const [w, h] = img.size.split('x').map(Number);
    const f =
      `gradients=s=${img.size}:c0=${img.c[0]}:c1=${img.c[1]}:c2=${img.c[2]}:c3=${img.c[3]}:nb_colors=4:seed=${i + 3}:speed=0.00001:type=radial,` +
      `drawbox=x=${Math.round(w * 0.12)}:y=${Math.round(h * 0.55)}:w=${Math.round(w * 0.3)}:h=${Math.round(h * 0.3)}:color=white@0.18:t=fill,` +
      `drawbox=x=${Math.round(w * 0.55)}:y=${Math.round(h * 0.18)}:w=${Math.round(w * 0.25)}:h=${Math.round(h * 0.5)}:color=black@0.25:t=fill,` +
      `drawgrid=w=${Math.round(w / 8)}:h=${Math.round(w / 8)}:t=2:c=white@0.10`;
    await ffmpeg(['-f', 'lavfi', '-i', f, '-frames:v', '1', '-q:v', '3', path.join(p.images, `${img.name}.jpg`)]);
  }
  const { samples, timings } = synthVoice(SPOKEN.split(' '), 2);
  writeWav(path.join(p.dir, 'voice.wav'), samples, samples);
  // whisper-style word list (leading spaces, no capitals) – what you'd get from a transcript
  writeJson(
    path.join(p.dir, 'voice.words.json'),
    timings.map((w) => ({ text: ' ' + w.text, startMs: w.startMs, endMs: w.endMs, confidence: 0.95 })),
  );
  return p;
};
