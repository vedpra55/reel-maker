/** Instagram-ready output: faststart, size cap, contact sheet, report. */
import fs from 'node:fs';
import path from 'node:path';
import type { Settings, Timeline } from '../shared/schema';
import type { ReelPaths } from './paths';
import type { PlanReport } from './plan';
import { ffmpeg, probeDurationMs } from './util/ffmpeg';
import { log } from './util/log';

const mb = (file: string) => fs.statSync(file).size / (1024 * 1024);

export const finalize = async (p: ReelPaths, s: Settings, raw: string, timeline: Timeline) => {
  const out = path.join(p.out, 'reel.mp4');
  await ffmpeg(['-i', raw, '-c', 'copy', '-movflags', '+faststart', out]);
  let size = mb(out);
  if (size > s.export.sizeCapMB) {
    const durS = (await probeDurationMs(out)) / 1000;
    const audioK = parseInt(s.export.audioBitrate, 10) || 192;
    const videoK = Math.floor(((s.export.sizeCapMB * 0.95 * 8 * 1024) / durS) - audioK);
    log.warn(`${size.toFixed(1)} MB is over the ${s.export.sizeCapMB} MB cap – re-encoding at ${videoK} kbps`);
    const tmp = path.join(p.out, 'reel.capped.mp4');
    await ffmpeg([
      '-i', raw, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${videoK}k`, '-maxrate', `${Math.round(videoK * 1.5)}k`,
      '-bufsize', `${videoK * 3}k`, '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', tmp,
    ]);
    fs.renameSync(tmp, out);
    size = mb(out);
  }
  fs.rmSync(raw, { force: true });
  const sheet = await contactSheet(p, out, timeline);
  return { out, sizeMB: size, sheet };
};

/** one frame from the middle of every beat, tiled 5 wide */
export const contactSheet = async (p: ReelPaths, video: string, timeline: Timeline) => {
  const dir = path.join(p.build, 'sheet');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const beats = timeline.beats;
  for (const [i, b] of beats.entries()) {
    // sample once the beat's first caption is fully on screen (not mid-transition or mid-exit)
    const page = timeline.pages.find((pg) => pg.startMs >= b.startMs - 1 && pg.startMs < b.endMs);
    const lastWord = page?.words[page.words.length - 1];
    const ms = page && lastWord ? Math.min(page.endMs - 250, lastWord.startMs + 300, b.endMs - 350) : (b.startMs + b.endMs) / 2;
    const t = (Math.max(b.startMs + 300, ms) / 1000).toFixed(3);
    await ffmpeg(['-ss', t, '-i', video, '-frames:v', '1', '-vf', 'scale=216:384', '-q:v', '3', path.join(dir, `${String(i).padStart(3, '0')}.jpg`)]);
  }
  const cols = Math.min(5, beats.length);
  const rows = Math.ceil(beats.length / cols);
  const sheet = path.join(p.out, 'contact-sheet.jpg');
  await ffmpeg([
    '-framerate', '1', '-i', path.join(dir, '%03d.jpg'),
    '-vf', `tile=${cols}x${rows}:padding=8:margin=8:color=0x111111`, '-frames:v', '1', '-q:v', '3', sheet,
  ]);
  return sheet;
};

export const writeReport = (
  p: ReelPaths,
  data: { plan: PlanReport | null; timeline: Timeline; sizeMB?: number; renderS?: number; settings: Settings },
) => {
  const { plan, timeline: tl } = data;
  const lines = [
    `reel: ${p.name}`,
    `duration: ${(tl.durationMs / 1000).toFixed(1)}s   beats: ${tl.beats.length}   caption pages: ${tl.pages.length}   sfx: ${tl.sfx.length}`,
    `preset: ${data.settings.preset}   intensity: ${data.settings.intensity}   seed: ${data.settings.seed}`,
  ];
  if (plan) {
    lines.push(`beats by kind: ${Object.entries(plan.beats).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    lines.push(`stacked pages: ${plan.stackPages}/${plan.pages}`);
    if (plan.alignScore !== null) lines.push(`script alignment: ${(plan.alignScore * 100).toFixed(0)}%`);
    if (plan.unmatched.length) lines.push(`spoken but not in script: ${plan.unmatched.join(' ')}`);
    for (const w of plan.warnings) lines.push(`warning: ${w}`);
  }
  if (data.sizeMB !== undefined) lines.push(`file: ${data.sizeMB.toFixed(1)} MB`);
  if (data.renderS !== undefined) lines.push(`render time: ${data.renderS.toFixed(0)}s`);
  lines.push('', 'beats:');
  for (const b of tl.beats) {
    const what = b.image ? `${b.image.src} (${b.image.motion}${b.image.punch > 1 ? ', punch-in' : ''})` : b.stat ? `stat ${b.stat.raw} on ${b.bg}` : (b.bg ?? '');
    lines.push(`  ${(b.startMs / 1000).toFixed(2).padStart(6)}s  ${b.kind.padEnd(6)} ${b.transition.padEnd(10)} ${what}`);
  }
  fs.mkdirSync(p.out, { recursive: true });
  fs.writeFileSync(path.join(p.out, 'report.txt'), lines.join('\n') + '\n');
  return lines.join('\n');
};
