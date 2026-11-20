/** Word-timing clean-up: normalise any transcript shape, fix whisper quirks, apply cut maps, snap to silences. */
import type { Silence } from './util/ffmpeg';

export type RawWord = { text: string; startMs: number; endMs: number; confidence: number };

type Loose = Record<string, unknown>;

/**
 * Accepts:
 *  - @remotion/captions Caption[]           {text, startMs, endMs, confidence?}
 *  - seconds-based arrays                     {word|text, start, end}
 *  - whisper / whisperX JSON                  {segments:[{words:[…]}]}   or {words:[…]}
 */
export const normaliseWords = (data: unknown): RawWord[] => {
  let arr: Loose[] = [];
  if (Array.isArray(data)) arr = data as Loose[];
  else if (data && typeof data === 'object') {
    const d = data as Loose;
    if (Array.isArray(d.words)) arr = d.words as Loose[];
    else if (Array.isArray(d.segments)) arr = (d.segments as Loose[]).flatMap((s) => (s.words as Loose[]) ?? []);
  }
  return arr
    .map((w) => {
      const text = String(w.text ?? w.word ?? '');
      const ms = typeof w.startMs === 'number';
      const startMs = ms ? Number(w.startMs) : Number(w.start) * 1000;
      const endMs = ms ? Number(w.endMs) : Number(w.end) * 1000;
      const confidence = typeof w.confidence === 'number' ? w.confidence : typeof w.probability === 'number' ? (w.probability as number) : 1;
      return { text, startMs, endMs, confidence };
    })
    .filter((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs));
};

const NOISE = /^[[(].*[\])]$/; // [BLANK_AUDIO], (music)
const PUNCT_ONLY = /^[^\p{L}\p{N}£$€₹]+$/u;

export const cleanWords = (input: RawWord[], minDurMs = 60): RawWord[] => {
  const whisperStyle = input.some((w) => w.text.startsWith(' '));
  const out: RawWord[] = [];
  for (const w of [...input].sort((a, b) => a.startMs - b.startMs)) {
    const t = w.text.trim();
    if (!t || NOISE.test(t)) continue;
    const prev = out[out.length - 1];
    const continuation = whisperStyle && !w.text.startsWith(' ') && prev;
    if (prev && (PUNCT_ONLY.test(t) || continuation)) {
      prev.text += t;
      prev.endMs = Math.max(prev.endMs, w.endMs);
      prev.confidence = Math.min(prev.confidence, w.confidence);
      continue;
    }
    out.push({ text: t, startMs: Math.round(w.startMs), endMs: Math.round(Math.max(w.endMs, w.startMs)), confidence: w.confidence });
  }
  return fixTimings(out, minDurMs);
};

/** monotonic starts, no overlaps, minimum duration */
export const fixTimings = <T extends { startMs: number; endMs: number }>(words: T[], minDurMs = 60): T[] => {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    if (prev && w.startMs < prev.startMs + 30) w.startMs = prev.startMs + 30;
    if (prev && prev.endMs > w.startMs) prev.endMs = w.startMs;
    if (w.endMs < w.startMs + minDurMs) {
      const next = words[i + 1];
      w.endMs = next ? Math.min(w.startMs + minDurMs, Math.max(next.startMs, w.startMs + 30)) : w.startMs + minDurMs;
    }
  }
  return words;
};

/* ------------------------------------------------------------------ */
/* Cut maps (pause tightening)                                         */
/* ------------------------------------------------------------------ */

/** segments of the original audio that were kept, in order */
export type CutMap = { keep: [number, number][] };

/** original time → time in the tightened file */
export const mapTime = (t: number, map: CutMap): number => {
  let offset = 0;
  for (const [a, b] of map.keep) {
    if (t < a) return offset; // inside a removed gap → snap to the cut
    if (t <= b) return offset + (t - a);
    offset += b - a;
  }
  return offset;
};

/** time in the tightened file → original time (inverse of mapTime) */
export const unmapTime = (t: number, map: CutMap): number => {
  let offset = 0;
  for (const [a, b] of map.keep) {
    const len = b - a;
    if (t <= offset + len) return a + (t - offset);
    offset += len;
  }
  const last = map.keep[map.keep.length - 1];
  return last ? last[1] + (t - offset) : t;
};

export const applyCutMap = (words: RawWord[], map: CutMap): RawWord[] =>
  words.map((w) => ({ ...w, startMs: Math.round(mapTime(w.startMs, map)), endMs: Math.round(mapTime(w.endMs, map)) }));

/**
 * Compute what to keep: trim lead/trail silence and shorten long internal pauses.
 * A pause longer than maxPauseMs becomes keepPauseMs (half kept on each side).
 */
export const computeCutMap = (
  durationMs: number,
  silences: Silence[],
  opts: { maxPauseMs: number; keepPauseMs: number; headMs?: number; tailMs?: number },
): CutMap => {
  const head = opts.headMs ?? 60;
  const tail = opts.tailMs ?? 250;
  const keep: [number, number][] = [];
  let cursor = 0;
  for (const [s0, e0] of silences) {
    const s = Math.max(0, s0);
    const e = Math.min(durationMs, e0);
    if (e <= s) continue;
    if (s <= 1) {
      // leading silence
      cursor = Math.max(0, e - head);
      continue;
    }
    if (e >= durationMs - 1) {
      // trailing silence
      keep.push([cursor, Math.min(durationMs, s + tail)]);
      cursor = durationMs;
      break;
    }
    if (e - s > opts.maxPauseMs) {
      const half = opts.keepPauseMs / 2;
      keep.push([cursor, s + half]);
      cursor = e - half;
    }
  }
  if (cursor < durationMs) keep.push([cursor, durationMs]);
  return { keep: keep.filter(([a, b]) => b - a > 5) };
};

export const keptDuration = (map: CutMap) => map.keep.reduce((acc, [a, b]) => acc + (b - a), 0);

/* ------------------------------------------------------------------ */
/* Silence snapping                                                    */
/* ------------------------------------------------------------------ */

/** pull word ends back to where silence starts, push starts forward to where it ends */
export const snapToSilences = (words: RawWord[], silences: Silence[]): RawWord[] => {
  for (const w of words) {
    for (const [s, e] of silences) {
      if (s > w.endMs) break;
      // word end runs into a silence
      if (w.startMs < s && w.endMs > s + 20) w.endMs = Math.max(w.startMs + 60, s + 20);
      // word starts inside a silence
      if (w.startMs >= s && w.startMs < e - 30 && w.endMs > e) w.startMs = Math.max(s, e - 30);
    }
  }
  return words;
};
