/**
 * Word roles — the 3-slot look from the references:
 *   lead   "was i" / "in its whole" / "central"       light, small
 *   key    "started" / "$15,000" / "London"            heavy, big, colour or bar
 *   closer "practice" / "journey."                    italic serif, overlapping
 *   tail   "followers mark,"                           light line under the key
 */
import type { Role, Settings } from '../shared/schema';
import type { Page } from './phrases';
import { STOPWORDS, bare, isCapitalised, isNumberToken, isSentenceEnd } from './util/text';

export type KeyInfo = {
  /** [from, to) word indexes of the keyword span, or null */
  span: [number, number] | null;
  score: number;
  hasNumber: boolean;
  forced: boolean;
};

export const findKey = (page: Page, s: Settings, pageStartsSentence = true): KeyInfo => {
  const ws = page.words;
  const list = new Set(s.captions.keywords.map((k) => k.toLowerCase()));

  const forcedIdx = ws.findIndex((w) => w.forceKey);
  if (forcedIdx >= 0) {
    let e = forcedIdx;
    while (e < ws.length && ws[e].forceKey) e++;
    return { span: [forcedIdx, e], score: 100, hasNumber: ws.some((w) => isNumberToken(w.text)), forced: true };
  }
  const numIdx = ws.findIndex((w) => isNumberToken(w.text));
  if (numIdx >= 0) return { span: [numIdx, numIdx + 1], score: 80, hasNumber: true, forced: false };

  const listIdx = ws.findIndex((w) => list.has(bare(w.text).toLowerCase()));
  if (listIdx >= 0) return { span: [listIdx, listIdx + 1], score: 60, hasNumber: false, forced: false };

  // Capitalised words that are not just sentence starts ("Rewrite Saturday", "London")
  for (let i = 0; i < ws.length; i++) {
    const sentenceStart = i === 0 ? pageStartsSentence : isSentenceEnd(ws[i - 1].text);
    if (sentenceStart || !isCapitalised(ws[i].text) || STOPWORDS.has(bare(ws[i].text).toLowerCase())) continue;
    let e = i + 1;
    while (e < ws.length && e - i < 3 && isCapitalised(ws[e].text) && !isSentenceEnd(ws[e - 1].text)) e++;
    return { span: [i, e], score: 40, hasNumber: false, forced: false };
  }

  // longest content word
  let best = -1;
  let bestLen = 0;
  ws.forEach((w, i) => {
    const b = bare(w.text);
    if (STOPWORDS.has(b.toLowerCase())) return;
    if (b.length > bestLen || (b.length === bestLen && i > best)) {
      best = i;
      bestLen = b.length;
    }
  });
  if (best >= 0 && bestLen >= 4) return { span: [best, best + 1], score: 10 + bestLen, hasNumber: false, forced: false };
  return { span: null, score: 0, hasNumber: false, forced: false };
};

/** choose which overlay pages get the big stacked treatment */
export const pickEmphasis = (infos: KeyInfo[], eligible: boolean[], ratio: number): boolean[] => {
  const chosen = infos.map((inf, i) => eligible[i] && inf.forced);
  const target = Math.round(eligible.filter(Boolean).length * ratio);
  let count = chosen.filter(Boolean).length;
  const order = infos
    .map((inf, i) => ({ i, score: inf.score }))
    .filter(({ i, score }) => eligible[i] && !chosen[i] && score >= 14)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { i } of order) {
    if (count >= target) break;
    if (chosen[i - 1] || chosen[i + 1]) continue; // keep emphasis spaced out
    chosen[i] = true;
    count++;
  }
  return chosen;
};

export const assignRoles = (page: Page, info: KeyInfo, style: 'inline' | 'stack', s: Settings): Role[] => {
  const ws = page.words;
  if (style === 'inline') {
    return ws.map((w, i) => {
      if (w.forceCloser) return 'closer';
      const inKey = info.span && i >= info.span[0] && i < info.span[1];
      return inKey && (info.forced || info.hasNumber) ? 'key' : 'normal';
    });
  }
  let span = info.span;
  if (!span) span = [ws.length - 1, ws.length]; // fall back to the last word
  const [a, b] = span;
  const endsSentence = isSentenceEnd(ws[ws.length - 1].text);
  const after = ws.length - b;
  return ws.map((w, i) => {
    if (w.forceCloser && !(i >= a && i < b)) return 'closer';
    if (i < a) return 'lead';
    if (i < b) return 'key';
    // words after the key: a short sentence ending becomes the italic "closer"
    if (endsSentence && after <= 2) return 'closer';
    return 'tail';
  });
};

export const keyStyleFor = (info: KeyInfo, roles: Role[], s: Settings): 'color' | 'bar' | 'none' => {
  if (!roles.includes('key')) return 'none';
  if (s.captions.keyStyle !== 'auto') return s.captions.keyStyle;
  return info.hasNumber ? 'bar' : 'color';
};
