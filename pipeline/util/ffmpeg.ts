import { run } from './exec';

export const FFMPEG = process.env.REEL_FFMPEG || 'ffmpeg';
export const FFPROBE = process.env.REEL_FFPROBE || 'ffprobe';

export const ffmpeg = (args: string[]) => run(FFMPEG, ['-hide_banner', '-y', '-loglevel', 'error', ...args], { check: true });

/** like ffmpeg() but keeps stderr info-level output (for analysis filters) */
export const ffmpegAnalyze = async (args: string[]) => {
  const r = await run(FFMPEG, ['-hide_banner', '-nostats', ...args], { check: true });
  return r.stderr;
};

export const probeDurationMs = async (file: string): Promise<number> => {
  const r = await run(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { check: true },
  );
  return Math.round(parseFloat(r.stdout.trim()) * 1000);
};

export const probeImageSize = async (file: string): Promise<{ w: number; h: number }> => {
  const r = await run(
    FFPROBE,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file],
    { check: true },
  );
  const [w, h] = r.stdout.trim().split('x').map(Number);
  return { w, h };
};

export type Silence = [number, number];

/** silencedetect → [[startMs, endMs], …] */
export const detectSilences = async (file: string, noiseDb: number, minDurS: number): Promise<Silence[]> => {
  const err = await ffmpegAnalyze(['-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=${minDurS}`, '-f', 'null', '-']);
  const out: Silence[] = [];
  let start: number | null = null;
  for (const line of err.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) start = Math.max(0, parseFloat(s[1]) * 1000);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && start !== null) {
      out.push([Math.round(start), Math.round(parseFloat(e[1]) * 1000)]);
      start = null;
    }
  }
  if (start !== null) out.push([Math.round(start), Number.POSITIVE_INFINITY]);
  return out;
};

/** two-pass loudnorm measurement */
export const measureLoudness = async (file: string, I: number, TP: number, LRA: number) => {
  const err = await ffmpegAnalyze([
    '-i', file, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-',
  ]);
  const json = err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1);
  return JSON.parse(json) as {
    input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string;
  };
};

export const listFilters = async (): Promise<string> => (await run(FFMPEG, ['-hide_banner', '-filters'])).stdout;
export const listEncoders = async (): Promise<string> => (await run(FFMPEG, ['-hide_banner', '-encoders'])).stdout;
