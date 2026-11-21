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
  const shots = timeline.shots;
  for (const [i, sh] of shots.entries()) {
    // middle of the shot, clear of the transitions
    const t = ((sh.startMs + sh.endMs) / 2 / 1000).toFixed(3);
    await ffmpeg(['-ss', t, '-i', video, '-frames:v', '1', '-vf', 'scale=216:384', '-q:v', '3', path.join(dir, `${String(i).padStart(3, '0')}.jpg`)]);
  }
  const cols = Math.min(5, shots.length);
  const rows = Math.ceil(shots.length / cols);
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
  const { plan, timeline: tl, settings: st } = data;
  const lines = [
    `reel: ${p.name}`,
    `duration: ${(tl.durationMs / 1000).toFixed(1)}s   images: ${tl.shots.length}   words: ${tl.words.length}   captions: ${st.captions.mode}`,
  ];
  if (plan) {
    if (plan.unusedImages.length) lines.push(`images not used: ${plan.unusedImages.join(', ')}`);
    lines.push(`sound effects: ${plan.sfx}`);
    for (const w of plan.warnings) lines.push(`warning: ${w}`);
  }
  if (data.sizeMB !== undefined) lines.push(`file: ${data.sizeMB.toFixed(1)} MB`);
  if (data.renderS !== undefined) lines.push(`render time: ${data.renderS.toFixed(0)}s`);
  lines.push('', 'shots (times in the finished video, after silences were removed):');
  for (const sh of tl.shots) {
    lines.push(
      `  ${(sh.startMs / 1000).toFixed(2).padStart(6)}s – ${(sh.endMs / 1000).toFixed(2).padStart(6)}s  ${path.basename(sh.src).padEnd(22)} ${sh.motion.padEnd(9)} in: ${sh.transition}`,
    );
  }
  fs.mkdirSync(p.out, { recursive: true });
  fs.writeFileSync(path.join(p.out, 'report.txt'), lines.join('\n') + '\n');
  return lines.join('\n');
};
