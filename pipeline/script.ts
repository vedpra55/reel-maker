/**
 * script.md parser and generator.
 *
 *   # hook / # body       sections (hook maps to hook.m4a when present)
 *   *word*                force keyword          _words_   force italic-serif closer
 *   [img name opts]       cut to image on the next word (opts: split bw warm duo none focus=top motion=zoom-in)
 *   [text] [text dark]    text-only beat         [stat]    big number beat
 *   [end]                 end card starts here   |         force caption break
 *   <!-- comments -->     ignored
 */
import { FOCI, MOTIONS, TREATMENTS, BACKGROUNDS } from '../shared/schema';
import type { Background } from '../shared/schema';
import { isSentenceEnd } from './util/text';

export type Section = 'hook' | 'body';

export type Marker =
  | {
      kind: 'img';
      image: string;
      split: boolean;
      treatment?: (typeof TREATMENTS)[number];
      focus?: (typeof FOCI)[number];
      motion?: (typeof MOTIONS)[number];
    }
  | { kind: 'text'; bg?: Background }
  | { kind: 'stat' }
  | { kind: 'end' };

export type ScriptToken = {
  text: string;
  section: Section;
  forceKey: boolean;
  forceCloser: boolean;
  breakBefore: boolean;
  marker?: Marker;
};

export type ParsedScript = {
  tokens: ScriptToken[];
  /** markers after the last word (e.g. a trailing [end]) */
  trailing: Marker[];
  hasHookSection: boolean;
  warnings: string[];
};

export const parseMarker = (body: string, warnings: string[]): Marker | null => {
  const parts = body.trim().split(/\s+/).filter(Boolean);
  const kind = (parts.shift() ?? '').toLowerCase();
  if (kind === 'img' || kind === 'image' || kind === 'split') {
    const m: Extract<Marker, { kind: 'img' }> = { kind: 'img', image: '', split: kind === 'split' };
    for (const p of parts) {
      const [k, v] = p.includes('=') ? p.split('=') : [p, ''];
      const lk = k.toLowerCase();
      if (lk === 'split') m.split = true;
      else if (v && lk === 'focus' && (FOCI as readonly string[]).includes(v)) m.focus = v as never;
      else if (v && lk === 'motion' && (MOTIONS as readonly string[]).includes(v)) m.motion = v as never;
      else if ((TREATMENTS as readonly string[]).includes(lk)) m.treatment = lk as never;
      else if ((MOTIONS as readonly string[]).includes(lk)) m.motion = lk as never;
      else if (!m.image) m.image = p;
      else warnings.push(`unknown option "${p}" in [${body}]`);
    }
    if (!m.image) {
      warnings.push(`[${body}] has no image name – ignored`);
      return null;
    }
    return m;
  }
  if (kind === 'text') {
    const bg = parts.find((p) => (BACKGROUNDS as readonly string[]).includes(p)) as Background | undefined;
    return { kind: 'text', bg };
  }
  if (kind === 'stat') return { kind: 'stat' };
  if (kind === 'end') return { kind: 'end' };
  warnings.push(`unknown marker [${body}] – ignored`);
  return null;
};

export const parseScript = (src: string): ParsedScript => {
  const warnings: string[] = [];
  const tokens: ScriptToken[] = [];
  let section: Section = 'body';
  let hasHookSection = false;
  let pendingMarker: Marker | undefined;
  let pendingBreak = false;
  let inKey = false;
  let inCloser = false;
  const trailing: Marker[] = [];

  const text = src.replace(/<!--[\s\S]*?-->/g, '');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const h = line.match(/^#+\s*(\w+)/);
    if (h) {
      const name = h[1].toLowerCase();
      if (name === 'hook') {
        section = 'hook';
        hasHookSection = true;
      } else section = 'body';
      inKey = inCloser = false;
      continue;
    }
    // split into markers, breaks and words
    const re = /\[([^\]]*)\]|\||[^\s[\]|]+/g;
    for (const m of line.matchAll(re)) {
      const chunk = m[0];
      if (m[1] !== undefined) {
        const mk = parseMarker(m[1], warnings);
        if (mk) {
          if (pendingMarker) warnings.push(`two markers in a row – [${m[1]}] replaces the previous one`);
          pendingMarker = mk;
        }
        continue;
      }
      if (chunk === '|') {
        pendingBreak = true;
        continue;
      }
      let w = chunk;
      let key = inKey;
      let closer = inCloser;
      // opening marks
      while (/^[*_]/.test(w)) {
        if (w[0] === '*') {
          inKey = true;
          key = true;
        } else {
          inCloser = true;
          closer = true;
        }
        w = w.slice(1);
      }
      // closing marks (may be followed by punctuation: "weeks._" or "*92%*,")
      const close = w.match(/^(.*?)([*_]+)([^\p{L}\p{N}]*)$/u);
      if (close && close[1]) {
        for (const ch of close[2]) {
          if (ch === '*') inKey = false;
          else inCloser = false;
        }
        w = close[1] + close[3];
      }
      if (!w) continue;
      tokens.push({
        text: w,
        section,
        forceKey: key,
        forceCloser: closer,
        breakBefore: pendingBreak,
        marker: pendingMarker,
      });
      pendingMarker = undefined;
      pendingBreak = false;
    }
  }
  if (pendingMarker) trailing.push(pendingMarker);
  return { tokens, trailing, hasHookSection, warnings };
};

/* ------------------------------------------------------------------ */
/* Generator: transcript → editable script.md                          */
/* ------------------------------------------------------------------ */

type GenWord = { text: string; section: Section; startMs: number };

/**
 * Writes one sentence per line and spreads the images over sentence starts in filename order,
 * so the generated file already renders well and you only edit what you want to change.
 */
export const generateScript = (words: GenWord[], imageNames: string[], opts: { hasHookAudio: boolean }): string => {
  const sentences: { section: Section; words: GenWord[] }[] = [];
  let cur: GenWord[] = [];
  let curSection: Section | null = null;
  for (const w of words) {
    if (curSection !== null && w.section !== curSection && cur.length) {
      sentences.push({ section: curSection, words: cur });
      cur = [];
    }
    curSection = w.section;
    cur.push(w);
    if (isSentenceEnd(w.text)) {
      sentences.push({ section: w.section, words: cur });
      cur = [];
    }
  }
  if (cur.length && curSection) sentences.push({ section: curSection, words: cur });

  // hook without a hook file = first sentence
  if (!opts.hasHookAudio && sentences.length) sentences[0].section = 'hook';

  const hook = sentences.filter((s) => s.section === 'hook');
  const body = sentences.filter((s) => s.section === 'body');

  // spread images: first one on the hook, the rest evenly over body sentences
  const assign = new Map<number, string>();
  const imgs = [...imageNames];
  if (imgs.length && hook.length) assign.set(sentences.indexOf(hook[0]), imgs.shift()!);
  if (imgs.length && body.length) {
    const step = body.length / imgs.length;
    imgs.forEach((name, i) => {
      const idx = sentences.indexOf(body[Math.min(body.length - 1, Math.floor(i * step))]);
      if (!assign.has(idx)) assign.set(idx, name);
    });
  }

  const lines: string[] = [
    '<!--',
    '  Edit freely, then run: reel plan <name>   (or reel render <name>)',
    '  *word* = keyword   _words_ = italic serif   | = caption break',
    '  [img name] [img name split] [img name bw focus=top] [text] [text dark] [stat] [end]',
    '  Images were spread automatically – move or change the [img …] markers as you like.',
    '-->',
    '',
  ];
  let lastSection: Section | null = null;
  sentences.forEach((s, i) => {
    if (s.section !== lastSection) {
      if (lastSection) lines.push('');
      lines.push(`# ${s.section}`);
      lastSection = s.section;
    }
    const img = assign.get(i);
    lines.push(`${img ? `[img ${img}] ` : ''}${s.words.map((w) => w.text).join(' ')}`);
  });
  return lines.join('\n') + '\n';
};
