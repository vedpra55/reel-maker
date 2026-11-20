/**
 * Caption cues from word timings. Pure functions shared by the renderer (so Studio
 * updates live when you switch mode) and the tests.
 */
import type { Settings, TWord } from './schema';

export type Cue = { startMs: number; endMs: number; words: TWord[] };

const SENTENCE_END = /[.!?…]["'”’)]*$/;
const CLAUSE_END = /[,;:—–]["'”’)]*$/;

/** strip punctuation for display (keeps $, £, %, apostrophes, hyphens inside words) */
export const displayText = (t: string, s: Settings['captions']) => {
  let out = s.punctuation ? t : t.replace(/^[^\p{L}\p{N}£$€₹#@]+/u, '').replace(/[^\p{L}\p{N}%+]+$/u, '');
  if (!out) out = t;
  return s.uppercase ? out.toUpperCase() : out;
};

/** how long each cue stays: until the next one, unless there is a real pause */
const settle = (cues: Cue[], s: Settings['captions']) => {
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const next = cues[i + 1];
    const lastEnd = c.words[c.words.length - 1].endMs;
    if (next) {
      const gap = next.startMs - lastEnd;
      c.endMs = gap <= s.holdMs ? next.startMs : Math.min(next.startMs, lastEnd + 250);
    } else c.endMs = lastEnd + 400;
  }
  return cues;
};

export const buildCues = (words: TWord[], s: Settings['captions']): Cue[] => {
  if (s.mode === 'off' || !words.length) return [];
  const lead = s.leadInMs;
  if (s.mode === 'word') {
    return settle(
      words.map((w) => ({ startMs: Math.max(0, w.startMs - lead), endMs: w.endMs, words: [w] })),
      s,
    );
  }
  // phrase: break on pauses, punctuation and length
  const groups: TWord[][] = [];
  let cur: TWord[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const brk =
      cur.length > 0 &&
      (cur.length >= s.maxWords ||
        w.startMs - prev.endMs >= s.pauseBreakMs ||
        SENTENCE_END.test(prev.text) ||
        CLAUSE_END.test(prev.text));
    if (brk) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  });
  if (cur.length) groups.push(cur);
  return settle(
    groups.map((g) => ({ startMs: Math.max(0, g[0].startMs - lead), endMs: g[g.length - 1].endMs, words: g })),
    s,
  );
};
