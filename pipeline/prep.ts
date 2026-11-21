/**
 * Prep: the slow part, redone only when audio, images or audio settings change.
 *   images → public/images (resized) · hook + voice → cleaned, tightened, joined public/voice.wav
 *   your sfx/ files → public/sfx-user · pauses + time maps → .build/prep.json
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/schema';
import { masterVoice, processPiece, type Piece } from './audio';
import { AUDIO_EXT, ensureDir, findAudio, listImages, reelImages, writeJson, type ReelPaths } from './paths';
import { ffmpeg, probeImageSize, type Silence } from './util/ffmpeg';
import { which } from './util/exec';
import { log } from './util/log';
import { mapTime, unmapTime, type CutMap } from './words';

/** where each recording sits in the master track, and what pause-tightening removed from it */
export type PrepPiece = { name: 'hook' | 'voice'; offsetMs: number; durationMs: number; originalMs: number; cutMap: CutMap };

export type Prep = {
  version: 3;
  voice: { src: string; durationMs: number };
  pieces: PrepPiece[];
  /** pauses in the joined voice track (final clock) */
  silences: Silence[];
  images: { name: string; src: string; w: number; h: number }[];
  /** your own sound files from the reel's sfx/ folder (file names) */
  sfx: string[];
  music: { src: string } | null;
  /** audio settings this prep was made with – a change means prep must run again */
  audioKey: string;
  stats: { inputLufs: number; removedMs: number };
};

export const audioKeyOf = (s: Settings) => JSON.stringify(s.audio);

const MAX_EDGE = 2160;
export const imageName = (file: string) => path.basename(file, path.extname(file)).trim().replace(/\s+/g, '-');

const ingestImages = async (p: ReelPaths) => {
  ensureDir(p.pubImages);
  const sips = process.platform === 'darwin' ? which('sips') : null;
  const out: Prep['images'] = [];
  const sources = reelImages(p);
  if (sources.length && !listImages(p.images).length) {
    log.info(`using ${sources.length} image(s) from the reel folder (tip: keep them in images/)`);
  }
  for (const src of sources) {
    const name = imageName(src);
    const keepPng = path.extname(src).toLowerCase() === '.png';
    const dst = path.join(p.pubImages, `${name}${keepPng ? '.png' : '.jpg'}`);
    const fresh = fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs;
    if (!fresh) {
      if (sips) {
        const { run } = await import('./util/exec');
        const args = ['-s', 'format', keepPng ? 'png' : 'jpeg'];
        if (!keepPng) args.push('-s', 'formatOptions', '90');
        const dims = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src]);
        const w = Number(dims.stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
        const h = Number(dims.stdout.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);
        if (Math.max(w, h) > MAX_EDGE) args.push('-Z', String(MAX_EDGE));
        await run('sips', [...args, src, '--out', dst], { check: true });
      } else {
        const scale = `scale=w='if(gt(iw,ih),min(${MAX_EDGE},iw),-2)':h='if(gt(iw,ih),-2,min(${MAX_EDGE},ih))'`;
        await ffmpeg(['-i', src, '-vf', scale, '-frames:v', '1', ...(keepPng ? [] : ['-q:v', '2']), dst]);
      }
    }
    const { w, h } = await probeImageSize(dst);
    out.push({ name, src: `images/${path.basename(dst)}`, w, h });
  }
  return out;
};


const copyUserSfx = (p: ReelPaths): string[] => {
  const src = path.join(p.dir, 'sfx');
  const dst = path.join(p.pub, 'sfx-user');
  fs.rmSync(dst, { recursive: true, force: true });
  if (!fs.existsSync(src)) return [];
  ensureDir(dst);
  const files = fs.readdirSync(src).filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase()) && !f.startsWith('.'));
  for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  return files;
};

export const prep = async (p: ReelPaths, s: Settings): Promise<Prep> => {
  ensureDir(p.pub);
  const work = path.join(p.build, 'work');
  ensureDir(work);

  log.step('Images');
  const images = await ingestImages(p);
  if (images.length) log.ok(`${images.length} image(s): ${images.map((i) => i.name).join(', ')}`);
  else log.warn(`No images found. Put them in ${path.relative(process.cwd(), p.images)}/`);

  log.step('Audio');
  const voiceSrc = findAudio(p.dir, 'voice');
  if (!voiceSrc) throw new Error(`No voice file. Put voice.mp3 (or .m4a / .wav) in ${path.relative(process.cwd(), p.dir)}/`);
  const hookSrc = findAudio(p.dir, 'hook');
  const pieces: Piece[] = [];
  if (hookSrc) pieces.push(await processPiece('hook', hookSrc, work, s));
  pieces.push(await processPiece('voice', voiceSrc, work, s));
  for (const pc of pieces) {
    const cut = pc.originalMs - pc.durationMs;
    log.ok(`${path.basename(pc.src)}: ${(pc.originalMs / 1000).toFixed(1)}s, removed ${(cut / 1000).toFixed(1)}s of silence`);
  }
  const master = await masterVoice(pieces, path.join(p.pub, 'voice.wav'), work, s);
  log.ok(`voice cleaned and levelled (${(master.durationMs / 1000).toFixed(1)}s)`);

  const placed: PrepPiece[] = [];
  let offset = 0;
  for (const pc of pieces) {
    placed.push({ name: pc.name, offsetMs: offset, durationMs: pc.durationMs, originalMs: pc.originalMs, cutMap: pc.cutMap });
    offset += pc.durationMs + (pc.name === 'hook' ? s.audio.hookGapMs : 0);
  }

  const sfx = copyUserSfx(p);
  if (sfx.length) log.ok(`your sound effects: ${sfx.join(', ')}`);

  let music: Prep['music'] = null;
  const musicSrc = findAudio(p.dir, 'music');
  if (musicSrc) {
    const dst = path.join(p.pub, `music${path.extname(musicSrc).toLowerCase()}`);
    fs.copyFileSync(musicSrc, dst);
    music = { src: path.basename(dst) };
    log.ok(`music: ${path.basename(musicSrc)} (quieter while you speak)`);
  }

  const result: Prep = {
    version: 3,
    voice: { src: 'voice.wav', durationMs: master.durationMs },
    pieces: placed,
    silences: master.silences,
    images,
    sfx,
    music,
    audioKey: audioKeyOf(s),
    stats: { inputLufs: master.inputLufs, removedMs: pieces.reduce((a, pc) => a + pc.originalMs - pc.durationMs, 0) },
  };
  writeJson(p.prep, result);
  return result;
};

/** master-track time → (recording, time in the original file) */
export const toOriginal = (finalMs: number, pieces: PrepPiece[]): { piece: 'hook' | 'voice'; ms: number } => {
  const pc = [...pieces].reverse().find((x) => finalMs >= x.offsetMs) ?? pieces[0];
  return { piece: pc.name, ms: Math.round(unmapTime(Math.max(0, finalMs - pc.offsetMs), pc.cutMap)) };
};

/** time in an original recording → master-track time */
export const toFinal = (piece: 'hook' | 'voice', ms: number, pieces: PrepPiece[]): number | null => {
  const pc = pieces.find((x) => x.name === piece);
  return pc ? Math.round(pc.offsetMs + mapTime(ms, pc.cutMap)) : null;
};
