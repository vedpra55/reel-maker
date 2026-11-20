/** Caption pages: 1–4 words that appear together. */
import type { Settings } from '../shared/schema';
import type { TimedToken } from './align';
import { STOPWORDS, bare, isClauseEnd, isSentenceEnd } from './util/text';

export type Page = {
  words: TimedToken[];
  hook: boolean;
  startMs: number;
  endMs: number;
};

const chars = (ws: { text: string }[]) => ws.reduce((a, w) => a + w.text.length, 0) + Math.max(0, ws.length - 1);

/** a page may not be broken *before* this word (it's glued to the previous one) */
const hardStart = (w: TimedToken) => !!w.marker || w.breakBefore;

export const paginate = (tokens: TimedToken[], s: Settings): Page[] => {
  const c = s.captions;
  const groups: TimedToken[][] = [];
  let cur: TimedToken[] = [];
  const maxW = (w: TimedToken) => (w.section === 'hook' ? c.hookMaxWords : c.maxWords);

  tokens.forEach((w, i) => {
    const prev = tokens[i - 1];
    if (!cur.length) {
      cur.push(w);
      return;
    }
    const hard =
      w.section !== prev.section || hardStart(w) || isClauseEnd(prev.text) || w.startMs - prev.endMs >= c.pauseBreakMs;
    const full = cur.length >= maxW(w) || chars([...cur, w]) > c.maxCharsPerLine * 2;
    // marked spans (*Rewrite Saturday*, _one idea_) stay on one page, up to 2 extra words
    const glue = glued(prev, w) && cur.length < maxW(w) + 2 && !hard;
    if (hard || (full && !glue)) {
      // don't leave "our" / "the" dangling at the end of a page – carry it over
      const last = cur[cur.length - 1];
      if (!hard && cur.length >= 3 && STOPWORDS.has(bare(last.text).toLowerCase()) && !isClauseEnd(last.text) && !glued(cur[cur.length - 2], last)) {
        cur.pop();
        groups.push(cur);
        cur = [last];
      } else {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  });
  if (cur.length) groups.push(cur);

  fixOrphans(groups, s);

  // timings: appear `leadInMs` early, stay until the next page (unless there is a long pause)
  const pages: Page[] = groups.map((g) => ({
    words: g,
    hook: g[0].section === 'hook',
    startMs: Math.max(0, g[0].startMs - c.leadInMs),
    endMs: g[g.length - 1].endMs,
  }));
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const next = pages[i + 1];
    if (i > 0) p.startMs = Math.max(p.startMs, pages[i - 1].endMs);
    if (next) {
      const nextStart = Math.max(0, next.words[0].startMs - c.leadInMs);
      p.endMs = nextStart - p.endMs < 650 ? nextStart : Math.min(nextStart, p.endMs + 350);
    } else p.endMs = p.endMs + 500;
    // never shorter than 350 ms on screen
    if (p.endMs - p.startMs < 350 && next) p.endMs = Math.min(p.startMs + 350, Math.max(p.endMs, next.words[0].startMs));
  }
  return pages;
};

const isStrong = (w: TimedToken) => w.forceKey || /\d/.test(w.text);
const glued = (a: TimedToken | undefined, b: TimedToken) =>
  !!a && !b.breakBefore && !b.marker && ((a.forceKey && b.forceKey) || (a.forceCloser && b.forceCloser));

/** one-word pages read as flicker – rebalance them with a neighbour when it doesn't break meaning */
const fixOrphans = (groups: TimedToken[][], s: Settings) => {
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.length !== 1 || isStrong(g[0]) || g[0].forceCloser) continue;
    const w = g[0];
    const prev = groups[i - 1];
    const next = groups[i + 1];
    const max = w.section === 'hook' ? s.captions.hookMaxWords : s.captions.maxWords;
    const sameSection = (o?: TimedToken[]) => o && o[0].section === w.section;
    const prevLast = prev?.[prev.length - 1];

    // join backwards when the orphan finishes the previous phrase ("…a | day.")
    if (prev && sameSection(prev) && prevLast && !isClauseEnd(prevLast.text) && !hardStart(w)) {
      if (prev.length + 1 <= max) {
        prev.push(w);
        groups.splice(i, 1);
        i--;
      } else if (prev.length >= 3 && !hardStart(prevLast) && !glued(prev[prev.length - 2], prevLast)) {
        g.unshift(prev.pop()!); // 4+1 → 3+2
      }
      continue;
    }
    // join forwards when the orphan starts the next phrase ("So | here's the thing")
    if (next && sameSection(next) && !isSentenceEnd(w.text) && !hardStart(next[0]) && next.length + 1 <= max) {
      next.unshift(w);
      groups.splice(i, 1);
      i--;
    }
  }
};
