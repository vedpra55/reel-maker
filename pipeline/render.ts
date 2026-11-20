/** `reel render`: bundle the Remotion project once, render timeline.json + settings to MP4. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { timelineSchema, type Settings, type Timeline } from '../shared/schema';
import { FONTS_DIR, ROOT, SFX_DIR, ASSETS, ensureDir, readJson, type ReelPaths } from './paths';
import { ensureActive } from './active';
import { ensureSfx } from './synth';
import { ffmpeg } from './util/ffmpeg';
import { log, progress } from './util/log';

/** set REEL_BROWSER to use a specific Chrome / chrome-headless-shell binary */
const browserExecutable = () => process.env.REEL_BROWSER || null;

const copyDir = (from: string, to: string, filter: (f: string) => boolean = () => true) => {
  ensureDir(to);
  for (const f of fs.readdirSync(from)) {
    if (!filter(f)) continue;
    const src = path.join(from, f);
    const dst = path.join(to, f);
    if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) fs.copyFileSync(src, dst);
  }
};

/** fonts, SFX and the grain tile go next to the reel's own media in its public dir */
export const preparePublic = async (p: ReelPaths) => {
  ensureActive();
  copyDir(FONTS_DIR, path.join(p.pub, 'fonts'), (f) => f.endsWith('.woff2'));
  ensureSfx(SFX_DIR);
  copyDir(SFX_DIR, path.join(p.pub, 'sfx'), (f) => f.endsWith('.wav'));
  const grain = path.join(ASSETS, 'fx', 'grain.png');
  if (!fs.existsSync(grain)) {
    ensureDir(path.dirname(grain));
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x808080:s=256x256', '-vf', 'noise=alls=70:allf=u,format=gray', '-frames:v', '1', grain]);
  }
  copyDir(path.dirname(grain), path.join(p.pub, 'fx'));
};

export const bundleFor = async (p: ReelPaths) => {
  await preparePublic(p);
  const report = progress('bundling');
  return bundle({
    entryPoint: path.join(ROOT, 'remotion', 'index.ts'),
    publicDir: p.pub,
    onProgress: (pct) => report(pct / 100),
  });
};

export const loadTimeline = (p: ReelPaths): Timeline => {
  if (!fs.existsSync(p.timeline)) throw new Error(`No timeline.json – run "reel plan ${p.name}" first.`);
  return timelineSchema.parse(readJson(p.timeline));
};

export type RenderOpts = { draft?: boolean; out?: string; serveUrl?: string };

export const renderReel = async (p: ReelPaths, s: Settings, opts: RenderOpts = {}) => {
  const timeline = loadTimeline(p);
  const serveUrl = opts.serveUrl ?? (await bundleFor(p));
  const inputProps = { settings: s, timeline };
  const composition = await selectComposition({
    serveUrl,
    id: 'Reel',
    inputProps,
    browserExecutable: browserExecutable(),
  });
  ensureDir(p.out);
  const out = opts.out ?? path.join(p.out, opts.draft ? 'reel.draft.mp4' : 'reel.raw.mp4');
  const e = s.export;
  const totalMem = os.totalmem() / 2 ** 30;
  const concurrency = Math.min(e.concurrency, totalMem <= 8.5 ? 3 : 16, os.cpus().length);
  log.info(`${composition.durationInFrames} frames @ ${composition.fps} fps, concurrency ${concurrency}${opts.draft ? ', draft' : ''}`);
  const report = progress('rendering');
  const t0 = Date.now();
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: 'h264',
    outputLocation: out,
    crf: opts.draft ? 26 : e.crf,
    x264Preset: opts.draft ? 'veryfast' : e.x264Preset,
    encodingMaxRate: opts.draft ? undefined : (e.maxrate as Rate),
    encodingBufferSize: opts.draft ? undefined : (doubleRate(e.maxrate) as Rate),
    audioCodec: 'aac',
    audioBitrate: e.audioBitrate as Rate,
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    imageFormat: 'jpeg',
    jpegQuality: opts.draft ? 80 : 92,
    scale: opts.draft ? e.draftScale : 1,
    concurrency,
    browserExecutable: browserExecutable(),
    onProgress: ({ progress: pr }) => report(pr),
  });
  return { out, seconds: (Date.now() - t0) / 1000, timeline, serveUrl };
};

type Rate = `${number}k` | `${number}K` | `${number}M`;

const doubleRate = (rate: string) => {
  const m = rate.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  return m ? `${parseFloat(m[1]) * 2}${m[2]}` : rate;
};

/** single frame(s) for quick looks: reel still <name> --at 3.2 */
export const renderStills = async (p: ReelPaths, s: Settings, atSeconds: number[], serveUrl?: string) => {
  const timeline = loadTimeline(p);
  const url = serveUrl ?? (await bundleFor(p));
  const inputProps = { settings: s, timeline };
  const composition = await selectComposition({ serveUrl: url, id: 'Reel', inputProps, browserExecutable: browserExecutable() });
  ensureDir(path.join(p.out, 'stills'));
  const files: string[] = [];
  for (const t of atSeconds) {
    const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(t * composition.fps)));
    const file = path.join(p.out, 'stills', `t${t.toFixed(2).replace('.', '_')}.jpg`);
    await renderStill({ composition, serveUrl: url, inputProps, frame, output: file, imageFormat: 'jpeg', jpegQuality: 90, browserExecutable: browserExecutable() });
    files.push(file);
  }
  return files;
};
