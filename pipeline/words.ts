/** Pause tightening: what to keep from a recording, and how times move because of it. */
import type { Silence } from './util/ffmpeg';

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
