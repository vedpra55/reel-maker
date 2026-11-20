/**
 * script.md – which image shows when. One line per image:
 *
 *     0:00    1st
 *     0:03.5  2nd    zoom-out
 *     0:07    3rd    push   focus=top
 *     12.4    4th.png  bw
 *
 *   time     m:ss(.s) or seconds, read off your ORIGINAL voice file
 *            (`hook 0:01.2 …` = a time inside hook.m4a). A range "0:03-0:07" also works; the end is
 *            only used for the last image.
 *   image    file name, with or without extension; a unique prefix is enough ("2nd", "02")
 *   options  any order: a motion (zoom-in zoom-out pan-left pan-right pan-up pan-down drift tilt),
 *            a transition into this image (cut crossfade push push-up zoom whip slide-up),
 *            focus=top|bottom|left|right|center, bw | warm
 *   > text   the words spoken while this image is up – they become the captions, spelled exactly
 *            as written (Hinglish in English letters works). Several > lines per image are fine.
 *            With > text in the file, whisper is not used for captions.
 *   Lines starting with #, // or <!-- are comments. "- " bullets are fine.
 */
import { FOCI, MOTIONS, TRANSITIONS, TREATMENTS, type Focus, type Motion, type Transition } from '../shared/schema';

export type ImageLine = {
  line: number;
  piece: 'hook' | 'voice';
  timeMs: number;
  endMs?: number;
  image: string;
  motion?: Motion;
  transition?: Transition;
  focus?: Focus;
  treatment?: (typeof TREATMENTS)[number];
  /** caption text from the "> …" lines under this image */
  text?: string;
};

export type ParsedScript = { lines: ImageLine[]; warnings: string[]; hasText: boolean };

/** quick check used by prep: does this script carry its own caption text? */
export const scriptHasText = (src: string) => /^\s*>\s*\S/m.test(src.replace(/<!--[\s\S]*?-->/g, ''));

const TIME = /^\[?(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)\]?$/;

export const parseTime = (t: string): number | null => {
  const m = t.match(TIME);
  if (!m) return null;
  const parts = m[1].split(':').map(Number);
  if (parts.some((x) => !Number.isFinite(x))) return null;
  const sec = parts.reduce((acc, x) => acc * 60 + x, 0);
  return Math.round(sec * 1000);
};

const formatTime = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${rest}`;
};

/** split a line into tokens, keeping "quoted names" together */
const tokenize = (line: string) => [...line.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

export const parseScript = (src: string): ParsedScript => {
  const warnings: string[] = [];
  const lines: ImageLine[] = [];
  let orphanText = '';
  const text = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
  text.split('\n').forEach((raw, i) => {
    let line = raw.trim().replace(/^[-*•]\s+/, '');
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    if (line.startsWith('>')) {
      const said = line.replace(/^>+\s*/, '').trim();
      if (!said) return;
      const owner = lines[lines.length - 1];
      if (owner) owner.text = owner.text ? `${owner.text} ${said}` : said;
      else orphanText = orphanText ? `${orphanText} ${said}` : said;
      return;
    }
    let tokens = tokenize(line);
    let piece: ImageLine['piece'] = 'voice';
    if (tokens[0]?.toLowerCase() === 'hook') {
      piece = 'hook';
      tokens = tokens.slice(1);
    }
    // time, "time-time", or "time - time"
    let first = tokens.shift() ?? '';
    let endTok: string | undefined;
    const dash = first.match(/^(.+?)[-–](.+)$/);
    if (dash && parseTime(dash[1]) !== null) {
      first = dash[1];
      endTok = dash[2];
    } else if (tokens[0] === '-' || tokens[0] === '–') {
      tokens.shift();
      endTok = tokens.shift();
    }
    const timeMs = parseTime(first);
    if (timeMs === null) {
      warnings.push(`line ${i + 1}: "${raw.trim()}" – no time at the start, skipped`);
      return;
    }
    const entry: ImageLine = { line: i + 1, piece, timeMs, image: '' };
    if (endTok) {
      const e = parseTime(endTok);
      if (e !== null) entry.endMs = e;
    }
    // the first word after the time is always the image; the rest are options in any order
    const [image, ...opts] = tokens;
    entry.image = image ?? '';
    const isIn = (list: readonly string[], v: string) => list.includes(v);
    for (const tok of opts) {
      const [k, v] = tok.includes('=') ? tok.split('=', 2) : ['', tok];
      const key = k.toLowerCase();
      const val = v.toLowerCase();
      if ((key === 'focus' || !key) && isIn(FOCI, val)) entry.focus = val as Focus;
      else if ((key === 'transition' || !key) && isIn(TRANSITIONS, val)) entry.transition = val as Transition;
      else if ((key === 'motion' || !key) && isIn(MOTIONS, val)) entry.motion = val as Motion;
      else if (!key && isIn(TREATMENTS, val)) entry.treatment = val as ImageLine['treatment'];
      else warnings.push(`line ${i + 1}: unknown option "${tok}"`);
    }
    if (!entry.image) {
      warnings.push(`line ${i + 1}: no image name after the time, skipped`);
      return;
    }
    lines.push(entry);
  });
  if (orphanText) {
    if (lines[0]) lines[0].text = lines[0].text ? `${orphanText} ${lines[0].text}` : orphanText;
    else warnings.push('caption text (> lines) but no image lines – nothing to attach it to');
  }
  return { lines, warnings, hasText: lines.some((l) => !!l.text) };
};

/* ------------------------------------------------------------------ */
/* Generator                                                           */
/* ------------------------------------------------------------------ */

/**
 * First draft of script.md: images spread evenly over the voice, each cut moved to the nearest
 * sentence (or word) start. Times are written in the ORIGINAL voice file's clock.
 */
export const generateScript = (
  words: { text: string; startMs: number }[],
  images: string[],
  durationMs: number,
  toOriginal: (finalMs: number) => { piece: 'hook' | 'voice'; ms: number },
): string => {
  const header = [
    '# One line per image:  time  image  [options]',
    '#   time    = where in your voice file the image appears (m:ss.s or seconds)',
    '#   options = motion (zoom-in zoom-out pan-left pan-right pan-up pan-down drift tilt)',
    '#             transition into it (cut crossfade push push-up zoom whip slide-up)',
    '#             focus=top|bottom|left|right   bw | warm',
    '# Edit the times, then: reel render <name>',
    '',
  ];
  if (!images.length) return header.join('\n') + '# (no images found – add some to images/)\n';
  const out = spreadTimes(words, images.length, durationMs).map((t, i) => {
    const o = toOriginal(t);
    return `${o.piece === 'hook' ? 'hook ' : ''}${formatTime(o.ms).padEnd(8)} ${images[i]}`;
  });
  return header.concat(out).join('\n') + '\n';
};

/** n cut times spread evenly over the voice, each moved to a nearby sentence start (else word start) */
export const spreadTimes = (words: { text: string; startMs: number }[], n: number, durationMs: number): number[] => {
  const sentenceStarts = words.filter((_, i) => i === 0 || /[.!?…]["'”’)]*$/.test(words[i - 1].text)).map((w) => w.startMs);
  const wordStarts = words.map((w) => w.startMs);
  const used = new Set<number>([0]);
  const times = [0];
  for (let i = 1; i < n; i++) {
    const ideal = (durationMs * i) / n;
    const near = (arr: number[], within: number) =>
      arr
        .filter((x) => !used.has(x) && x > times[times.length - 1] && Math.abs(x - ideal) <= within)
        .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
    const t = near(sentenceStarts, (durationMs / n) * 0.35) ?? near(wordStarts, 1500) ?? Math.round(ideal);
    used.add(t);
    times.push(t);
  }
  return times;
};
