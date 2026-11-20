/** Voice processing with the system ffmpeg: clean → tighten pauses → join hook + voice → loudness. */
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/schema';
import { detectSilences, ffmpeg, measureLoudness, probeDurationMs, type Silence } from './util/ffmpeg';
import { computeCutMap, keptDuration, type CutMap } from './words';

export type Piece = {
  name: 'hook' | 'voice';
  src: string;
  /** cleaned + tightened, 48 kHz mono */
  file: string;
  /** 16 kHz mono copy for whisper */
  file16k: string;
  cutMap: CutMap;
  originalMs: number;
  durationMs: number;
};

const cleanChain = (s: Settings) =>
  [
    'highpass=f=80',
    s.audio.denoise ? 'afftdn=nf=-25' : null,
    'acompressor=threshold=-18dB:ratio=3:attack=5:release=60:makeup=2',
    // rough level so silence detection works the same on quiet and loud recordings
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  ]
    .filter(Boolean)
    .join(',');

/** select only the kept ranges and re-time them back to back */
const selectExpr = (map: CutMap) =>
  map.keep.map(([a, b]) => `between(t,${(a / 1000).toFixed(4)},${(b / 1000).toFixed(4)})`).join('+');

export const processPiece = async (name: Piece['name'], src: string, workDir: string, s: Settings): Promise<Piece> => {
  const stage1 = path.join(workDir, `${name}.clean.wav`);
  const file = path.join(workDir, `${name}.tight.wav`);
  const file16k = path.join(workDir, `${name}.16k.wav`);
  await ffmpeg(['-i', src, '-vn', '-ac', '1', '-af', cleanChain(s), '-ar', '48000', '-c:a', 'pcm_s16le', stage1]);
  const originalMs = await probeDurationMs(stage1);

  const silences = await detectSilences(stage1, -40, 0.12);
  const cutMap = computeCutMap(originalMs, silences, {
    maxPauseMs: s.audio.tightenPauses ? s.audio.maxPauseMs : Number.POSITIVE_INFINITY,
    keepPauseMs: s.audio.keepPauseMs,
  });
  if (cutMap.keep.length === 1 && cutMap.keep[0][0] === 0 && cutMap.keep[0][1] >= originalMs) {
    fs.copyFileSync(stage1, file);
  } else {
    await ffmpeg(['-i', stage1, '-af', `aselect='${selectExpr(cutMap)}',asetpts=N/SR/TB`, '-c:a', 'pcm_s16le', file]);
  }
  await ffmpeg(['-i', file, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', file16k]);
  const durationMs = await probeDurationMs(file);
  // sanity: kept length should match the rendered length
  const expected = keptDuration(cutMap);
  if (Math.abs(expected - durationMs) > 80) {
    console.warn(`  ! ${name}: tightened length ${durationMs} ms differs from cut map ${Math.round(expected)} ms`);
  }
  return { name, src, file, file16k, cutMap, originalMs, durationMs };
};

/** hook + gap + voice → loudness-normalised master voice track */
export const masterVoice = async (pieces: Piece[], out: string, workDir: string, s: Settings) => {
  const joined = path.join(workDir, 'voice.joined.wav');
  if (pieces.length === 1) fs.copyFileSync(pieces[0].file, joined);
  else {
    const gap = (s.audio.hookGapMs / 1000).toFixed(3);
    await ffmpeg([
      '-i', pieces[0].file, '-i', pieces[1].file,
      '-filter_complex', `aevalsrc=0:d=${gap}:s=48000[g];[0:a][g][1:a]concat=n=3:v=0:a=1[o]`,
      '-map', '[o]', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', joined,
    ]);
  }
  const TP = -1.5;
  const LRA = 7;
  const m = await measureLoudness(joined, s.audio.lufs, TP, LRA);
  const ln =
    `loudnorm=I=${s.audio.lufs}:TP=${TP}:LRA=${LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
    `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  await ffmpeg(['-i', joined, '-af', ln, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
  const durationMs = await probeDurationMs(out);
  const silences: Silence[] = await detectSilences(out, -40, 0.1);
  return { durationMs, silences, inputLufs: parseFloat(m.input_i) };
};
