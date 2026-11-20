/**
 * `reel prep`: everything expensive, done once per input change.
 *   images → public/images (resized), audio → public/voice.wav, words with final timings → prep.json,
 *   script.md generated from the transcript if you didn't write one.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/schema';
import { masterVoice, processPiece, type Piece } from './audio';
import { AUDIO_EXT, ensureDir, findAudio, listImages, readJson, reelImages, writeJson, type ReelPaths } from './paths';
import { generateScript } from './script';
import { transcribeWords } from './transcribe';
import { ffmpeg, probeImageSize, type Silence } from './util/ffmpeg';
import { which } from './util/exec';
import { log } from './util/log';
import { applyCutMap, cleanWords, fixTimings, normaliseWords, snapToSilences, type RawWord } from './words';

export type PrepWord = RawWord & { section: 'hook' | 'body' };

export type Prep = {
  version: 1;
  voice: { src: string; durationMs: number };
  /** end of the hook audio in the master voice track (when hook.m4a exists) */
  hookEndMs: number | null;
  words: PrepWord[];
  silences: Silence[];
  images: { name: string; src: string; w: number; h: number }[];
  music: { src: string } | null;
  stats: { inputLufs: number; removedMs: number; whisper: boolean };
};

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

/** <piece>.words.json next to the audio skips whisper for that piece */
const suppliedWords = (dir: string, base: string): RawWord[] | null => {
  for (const f of [`${base}.words.json`, ...(base === 'voice' ? ['words.json'] : [])]) {
    const file = path.join(dir, f);
    if (fs.existsSync(file)) return normaliseWords(readJson(file));
  }
  return null;
};

export const prep = async (p: ReelPaths, s: Settings, opts: { noWhisper?: boolean } = {}): Promise<Prep> => {
  ensureDir(p.pub);
  const work = path.join(p.build, 'work');
  ensureDir(work);

  log.step('Images');
  const images = await ingestImages(p);
  if (images.length) log.ok(`${images.length} image(s): ${images.map((i) => i.name).join(', ')}`);
  else log.warn(`no images found in ${path.relative(process.cwd(), p.images)}/ – text beats only`);

  log.step('Audio');
  const voiceSrc = findAudio(p.dir, 'voice');
  if (!voiceSrc) throw new Error(`No voice file. Put voice.m4a (or ${AUDIO_EXT.join('/')}) in ${p.dir}`);
  const hookSrc = findAudio(p.dir, 'hook');
  const pieces: Piece[] = [];
  if (hookSrc) pieces.push(await processPiece('hook', hookSrc, work, s));
  pieces.push(await processPiece('voice', voiceSrc, work, s));
  for (const pc of pieces) {
    const cut = pc.originalMs - pc.durationMs;
    log.ok(`${pc.name}: ${(pc.originalMs / 1000).toFixed(1)}s → ${(pc.durationMs / 1000).toFixed(1)}s (removed ${(cut / 1000).toFixed(1)}s of dead air)`);
  }
  const master = await masterVoice(pieces, path.join(p.pub, 'voice.wav'), work, s);
  log.ok(`master voice ${(master.durationMs / 1000).toFixed(1)}s, normalised from ${master.inputLufs.toFixed(1)} to ${s.audio.lufs} LUFS`);

  log.step('Words');
  const words: PrepWord[] = [];
  let offset = 0;
  let usedWhisper = false;
  let hookEndMs: number | null = null;
  for (const pc of pieces) {
    const section = pc.name === 'hook' ? 'hook' : 'body';
    let raw = suppliedWords(p.dir, pc.name);
    if (raw) {
      raw = applyCutMap(cleanWords(raw), pc.cutMap);
      log.ok(`${pc.name}: ${raw.length} words from ${pc.name}.words.json`);
    } else {
      if (opts.noWhisper) throw new Error(`No ${pc.name}.words.json and --no-whisper was given`);
      log.info(`${pc.name}: transcribing with whisper.cpp (${s.whisper.model})…`);
      raw = cleanWords(await transcribeWords(pc.file16k, path.join(p.build, 'cache'), s.whisper.model));
      usedWhisper = true;
      log.ok(`${pc.name}: ${raw.length} words`);
    }
    for (const w of raw) words.push({ ...w, startMs: w.startMs + offset, endMs: w.endMs + offset, section });
    if (pc.name === 'hook') hookEndMs = pc.durationMs;
    offset += pc.durationMs + (pc.name === 'hook' ? s.audio.hookGapMs : 0);
  }
  fixTimings(snapToSilences(words, master.silences));
  const lowConf = words.filter((w) => w.confidence < 0.5);
  if (lowConf.length) log.warn(`${lowConf.length} low-confidence word(s): ${lowConf.slice(0, 8).map((w) => w.text).join(', ')}`);

  let music: Prep['music'] = null;
  const musicSrc = findAudio(p.dir, 'music');
  if (musicSrc) {
    const dst = path.join(p.pub, `music${path.extname(musicSrc).toLowerCase()}`);
    fs.copyFileSync(musicSrc, dst);
    music = { src: path.basename(dst) };
    log.ok(`music: ${path.basename(musicSrc)} (ducked under the voice)`);
  }

  const result: Prep = {
    version: 1,
    voice: { src: 'voice.wav', durationMs: master.durationMs },
    hookEndMs,
    words,
    silences: master.silences,
    images,
    music,
    stats: {
      inputLufs: master.inputLufs,
      removedMs: pieces.reduce((a, pc) => a + pc.originalMs - pc.durationMs, 0),
      whisper: usedWhisper,
    },
  };
  writeJson(p.prep, result);

  if (!fs.existsSync(p.script)) {
    fs.writeFileSync(p.script, generateScript(words, images.map((i) => i.name), { hasHookAudio: !!hookSrc }));
    log.ok(`wrote script.md from the transcript – edit it to place images and keywords`);
  }
  return result;
};
