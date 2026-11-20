/**
 * Script ↔ transcript alignment (Needleman–Wunsch on words, with 1:N / N:1 merges).
 * Script text wins (spelling, £ signs, brand names); transcript timing wins.
 */
import type { ScriptToken } from './script';
import type { RawWord } from './words';
import { fixTimings } from './words';
import { canonical, similarity } from './util/text';

export type TimedToken = ScriptToken & {
  startMs: number;
  endMs: number;
  confidence: number;
  matched: boolean;
};

export type AlignResult = { words: TimedToken[]; score: number; unmatchedTranscript: string[] };

const MAX_SPAN = 3;
const GAP_SCRIPT = -0.5;
const GAP_WORD = -0.4;

type Step = { a: number; b: number; kind: 'match' | 'sub' | 'skipS' | 'skipW'; sim: number };

export const align = (script: ScriptToken[], words: RawWord[]): AlignResult => {
  const n = script.length;
  const m = words.length;
  const sText = script.map((t) => t.text);
  const wText = words.map((w) => w.text);
  const canonCache = new Map<string, string>();
  const canon = (arr: string[], i: number, len: number, tag: string) => {
    const key = `${tag}${i}:${len}`;
    let v = canonCache.get(key);
    if (v === undefined) {
      v = canonical(arr.slice(i, i + len));
      canonCache.set(key, v);
    }
    return v;
  };

  const NEG = -1e9;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(NEG));
  const back: (Step | null)[][] = Array.from({ length: n + 1 }, () => new Array<Step | null>(m + 1).fill(null));
  dp[0][0] = 0;

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const cur = dp[i][j];
      if (cur === NEG) continue;
      const relax = (ni: number, nj: number, val: number, step: Step) => {
        if (val > dp[ni][nj]) {
          dp[ni][nj] = val;
          back[ni][nj] = step;
        }
      };
      if (i < n) relax(i + 1, j, cur + GAP_SCRIPT, { a: 1, b: 0, kind: 'skipS', sim: 0 });
      if (j < m) relax(i, j + 1, cur + GAP_WORD, { a: 0, b: 1, kind: 'skipW', sim: 0 });
      for (let a = 1; a <= MAX_SPAN && i + a <= n; a++) {
        for (let b = 1; b <= MAX_SPAN && j + b <= m; b++) {
          const sim = similarity(canon(sText, i, a, 's'), canon(wText, j, b, 'w'));
          if (a === 1 && b === 1) {
            if (sim >= 0.5) relax(i + 1, j + 1, cur + 2 * sim, { a, b, kind: 'match', sim });
            else relax(i + 1, j + 1, cur - 0.2 + sim * 0.4, { a, b, kind: 'sub', sim });
          } else if (sim >= 0.8) {
            relax(i + a, j + b, cur + 2 * sim - 0.1 * (a + b - 2), { a, b, kind: 'match', sim });
          }
        }
      }
    }
  }

  // traceback
  const steps: { i: number; j: number; step: Step }[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const st = back[i][j];
    if (!st) break;
    i -= st.a;
    j -= st.b;
    steps.unshift({ i, j, step: st });
  }

  const out: TimedToken[] = script.map((t) => ({ ...t, startMs: NaN, endMs: NaN, confidence: 0, matched: false }));
  const unmatchedTranscript: string[] = [];
  let good = 0;
  for (const { i: si, j: wj, step } of steps) {
    if (step.kind === 'skipW') {
      unmatchedTranscript.push(words[wj].text);
      continue;
    }
    if (step.kind === 'skipS') continue;
    const ws = words.slice(wj, wj + step.b);
    const start = ws[0].startMs;
    const end = ws[ws.length - 1].endMs;
    const conf = Math.min(...ws.map((w) => w.confidence)) * (step.kind === 'sub' ? 0.5 : 1);
    // distribute the span over `a` script tokens by character length
    const toks = out.slice(si, si + step.a);
    const total = toks.reduce((acc, t) => acc + Math.max(1, t.text.length), 0);
    let t0 = start;
    for (const t of toks) {
      const d = ((end - start) * Math.max(1, t.text.length)) / total;
      t.startMs = Math.round(t0);
      t.endMs = Math.round(t0 + d);
      t.confidence = conf;
      t.matched = step.kind === 'match';
      t0 += d;
    }
    if (step.kind === 'match') good += step.a;
  }

  interpolateMissing(out);
  fixTimings(out);
  return { words: out, score: n ? good / n : 1, unmatchedTranscript };
};

/** script words the transcript never said get timings squeezed between their neighbours */
const interpolateMissing = (toks: TimedToken[]) => {
  let k = 0;
  while (k < toks.length) {
    if (!Number.isNaN(toks[k].startMs)) {
      k++;
      continue;
    }
    let e = k;
    while (e < toks.length && Number.isNaN(toks[e].startMs)) e++;
    const prevEnd = k > 0 ? toks[k - 1].endMs : 0;
    const nextStart = e < toks.length ? toks[e].startMs : prevEnd + 250 * (e - k);
    const count = e - k;
    const span = Math.max(nextStart - prevEnd, 120 * count);
    for (let x = 0; x < count; x++) {
      toks[k + x].startMs = Math.round(prevEnd + (span * x) / count);
      toks[k + x].endMs = Math.round(prevEnd + (span * (x + 1)) / count);
    }
    k = e;
  }
};

/** no script: every transcript word becomes a token (body section) */
export const tokensFromWords = (words: (RawWord & { section?: 'hook' | 'body' })[]): TimedToken[] =>
  words.map((w) => ({
    text: w.text,
    section: w.section ?? 'body',
    forceKey: false,
    forceCloser: false,
    breakBefore: false,
    startMs: w.startMs,
    endMs: w.endMs,
    confidence: w.confidence,
    matched: true,
  }));
