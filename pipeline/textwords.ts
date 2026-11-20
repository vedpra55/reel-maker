/**
 * Word timings for captions you wrote yourself (script.md "> …" lines) – no speech recognition.
 *
 *  1. Each block of text owns the audio from its image's time to the next block's time.
 *     Those boundaries are nudged onto the nearest real pause, since sentences start after one.
 *  2. Inside a block, the audio is split into "speaking" stretches using the detected silences.
 *  3. Pauses are matched to the word gaps where they most likely fall (by how far through the text
 *     we are, with a pull towards commas and full stops).
 *  4. Between those anchors, words share the speaking time by estimated length (syllables).
 *
 * Works for any language written in Latin letters, including Hinglish.
 */
import type { TWord } from '../shared/schema';
import type { Silence } from './util/ffmpeg';

export type TextBlock = { startMs: number; endMs: number; text: string };

const PUNCT_END = /[.,!?;:…—–]["'”’)]*$/;

/** rough spoken length of a word: vowel groups ≈ syllables (works for Hinglish spellings too) */
export const wordWeight = (w: string) => {
  const bare = w.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^\d+$/.test(bare)) return 0.6 + bare.length * 0.9; // numbers are said as several words
  const syl = (bare.match(/[aeiouy]+/g) ?? []).length;
  return 0.35 + Math.max(1, syl) + bare.length * 0.04;
};

/** speaking stretches inside [a, b): the complement of silences */
export const speechIn = (a: number, b: number, silences: Silence[]): [number, number][] => {
  const out: [number, number][] = [];
  let cur = a;
  for (const [s, e] of silences) {
    if (e <= cur) continue;
    if (s >= b) break;
    if (s > cur) out.push([cur, Math.min(s, b)]);
    cur = Math.max(cur, e);
    if (cur >= b) break;
  }
  if (cur < b) out.push([cur, b]);
  return out.filter(([x, y]) => y - x >= 60);
};

/** move each block boundary onto the nearest pause (within `reach` ms) */
const settleBoundaries = (blocks: TextBlock[], silences: Silence[], reach = 700) => {
  for (let i = 1; i < blocks.length; i++) {
    const c = blocks[i].startMs;
    let best: Silence | null = null;
    let bestD = Infinity;
    for (const sil of silences) {
      const d = c < sil[0] ? sil[0] - c : c > sil[1] ? c - sil[1] : 0;
      if (d < bestD) {
        bestD = d;
        best = sil;
      }
    }
    if (best && bestD <= reach && best[1] > blocks[i - 1].startMs + 200) {
      blocks[i - 1].endMs = Math.max(blocks[i - 1].startMs + 100, best[0]);
      blocks[i].startMs = Math.min(best[1], blocks[i].endMs - 100);
    }
  }
};

/** time-ordered words for one block */
export const distribute = (words: string[], speech: [number, number][]): TWord[] => {
  if (!words.length || !speech.length) return [];
  const lens = speech.map(([a, b]) => b - a);
  const total = lens.reduce((x, y) => x + y, 0);
  // speech-time position (ms of talking) → clock time; atEnd picks the end of a stretch at a boundary
  const toClock = (x: number, atEnd: boolean) => {
    let acc = 0;
    for (let i = 0; i < speech.length; i++) {
      const L = lens[i];
      if (x < acc + L || (atEnd && x <= acc + L) || i === speech.length - 1) return speech[i][0] + Math.min(L, Math.max(0, x - acc));
      acc += L;
    }
    return speech[speech.length - 1][1];
  };

  const w = words.map(wordWeight);
  const W = w.reduce((a, b) => a + b, 0);
  const cum = [0];
  for (const x of w) cum.push(cum[cum.length - 1] + x);

  // anchor pauses to word gaps: gap k sits after `before[k]` ms of talking
  const anchors: { word: number; at: number }[] = [{ word: 0, at: 0 }];
  let acc = 0;
  let lastWord = 0;
  for (let k = 0; k < speech.length - 1; k++) {
    acc += lens[k];
    const frac = acc / total;
    let best = -1;
    let bestCost = Infinity;
    for (let j = lastWord + 1; j < words.length; j++) {
      const off = Math.abs(cum[j] / W - frac);
      const cost = off - (PUNCT_END.test(words[j - 1]) ? 0.12 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = j;
      }
    }
    // only trust a match that is plausible; otherwise the pause is a breath inside a phrase
    if (best > 0 && bestCost < 0.08) {
      anchors.push({ word: best, at: acc });
      lastWord = best;
    }
  }
  anchors.push({ word: words.length, at: total });

  const out: TWord[] = [];
  for (let a = 0; a < anchors.length - 1; a++) {
    const { word: j0, at: x0 } = anchors[a];
    const { word: j1, at: x1 } = anchors[a + 1];
    const span = cum[j1] - cum[j0] || 1;
    for (let j = j0; j < j1; j++) {
      const s = x0 + ((cum[j] - cum[j0]) / span) * (x1 - x0);
      const e = x0 + ((cum[j + 1] - cum[j0]) / span) * (x1 - x0);
      out.push({ text: words[j], startMs: Math.round(toClock(s, false)), endMs: Math.round(toClock(e, true)) });
    }
  }
  return out;
};

export const timeTextBlocks = (input: TextBlock[], silences: Silence[]): TWord[] => {
  const blocks = input.map((b) => ({ ...b })).filter((b) => b.text.trim() && b.endMs > b.startMs);
  settleBoundaries(blocks, silences);
  const out: TWord[] = [];
  for (const b of blocks) {
    const words = b.text.split(/\s+/).filter(Boolean);
    let speech = speechIn(b.startMs, b.endMs, silences);
    if (!speech.length) speech = [[b.startMs, b.endMs]];
    out.push(...distribute(words, speech));
  }
  // keep strictly increasing, non-overlapping
  for (let i = 1; i < out.length; i++) {
    if (out[i].startMs < out[i - 1].endMs) out[i - 1].endMs = Math.max(out[i - 1].startMs + 40, out[i].startMs);
  }
  return out;
};
