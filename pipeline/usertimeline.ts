/**
 * reels/<name>/timeline.json – the same information as script.md, as JSON (handy for other tools / AI):
 *
 * {
 *   "shots": [
 *     { "time": "0:00", "image": "1st", "motion": "zoom-in", "focus": "center",
 *       "text": "Last weeks mein baby kam move karta hai?" },
 *     { "time": 7.5, "image": "2nd", "transition": "crossfade", "text": "Pehle jo kicks mehsoos hoti thi," }
 *   ],
 *   "words": [ { "text": "Last", "start": 0.06, "end": 0.31 } ]      // optional, exact word timings
 * }
 *
 * Times are in your ORIGINAL voice file's clock: a number = seconds, or "m:ss.s".
 * `"hook": true` on a shot or word = the time is inside hook.m4a. `startMs`/`endMs` (milliseconds) also work.
 * A plain array of shots is accepted too.
 */
import { FOCI, MOTIONS, TRANSITIONS, TREATMENTS } from '../shared/schema';
import fs from 'node:fs';
import type { ReelPaths } from './paths';
import { parseTime, scriptHasText, type ImageLine, type ParsedScript } from './script';

export type UserWord = { text: string; startMs: number; endMs: number; piece: 'hook' | 'voice' };
export type UserTimeline = ParsedScript & { words: UserWord[] | null };

type Obj = Record<string, unknown>;

/** true for the internal file older versions wrote into the reel folder */
export const isGeneratedTimeline = (raw: unknown) =>
  !!raw && typeof raw === 'object' && !Array.isArray(raw) && 'voice' in (raw as Obj) && 'speech' in (raw as Obj);

const readTime = (o: Obj, sec: string[], ms: string): number | null => {
  if (typeof o[ms] === 'number') return Math.round(o[ms] as number);
  for (const k of sec) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 1000);
    if (typeof v === 'string') {
      const t = parseTime(v.trim());
      if (t !== null) return t;
    }
  }
  return null;
};

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (list as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as T) : undefined;

export const parseUserTimeline = (raw: unknown): UserTimeline => {
  const warnings: string[] = [];
  const root = (Array.isArray(raw) ? { shots: raw } : (raw ?? {})) as Obj;
  const shotsRaw = (root.shots ?? root.images) as unknown;
  if (!Array.isArray(shotsRaw)) {
    return { lines: [], warnings: ['timeline.json has no "shots" list'], hasText: false, words: null };
  }

  const lines: ImageLine[] = [];
  shotsRaw.forEach((item, i) => {
    const o = (item ?? {}) as Obj;
    const label = `shot ${i + 1}`;
    const timeMs = readTime(o, ['time', 'start', 'at'], 'startMs');
    const image = String(o.image ?? o.src ?? o.file ?? '').trim();
    if (timeMs === null) return void warnings.push(`${label}: no "time" – skipped`);
    if (!image) return void warnings.push(`${label}: no "image" – skipped`);
    const line: ImageLine = {
      line: i + 1,
      piece: o.hook === true ? 'hook' : 'voice',
      timeMs,
      image: image.replace(/^images\//, ''),
      motion: pick(MOTIONS, o.motion),
      transition: pick(TRANSITIONS, o.transition),
      focus: pick(FOCI, o.focus),
      treatment: pick(TREATMENTS, o.treatment),
    };
    for (const k of ['motion', 'transition', 'focus', 'treatment'] as const) {
      if (o[k] !== undefined && line[k] === undefined) warnings.push(`${label}: unknown ${k} "${String(o[k])}"`);
    }
    const end = readTime(o, ['end'], 'endMs');
    if (end !== null) line.endMs = end;
    const text = Array.isArray(o.text) ? o.text.join(' ') : typeof o.text === 'string' ? o.text : '';
    if (text.trim()) line.text = text.trim().replace(/\s+/g, ' ');
    lines.push(line);
  });

  let words: UserWord[] | null = null;
  const wordsRaw = (root.words ?? root.captions) as unknown;
  if (Array.isArray(wordsRaw)) {
    words = [];
    wordsRaw.forEach((item, i) => {
      const o = (item ?? {}) as Obj;
      const text = String(o.text ?? o.word ?? '').trim();
      const startMs = readTime(o, ['start', 'time'], 'startMs');
      if (!text || startMs === null) return void warnings.push(`word ${i + 1}: needs "text" and "start" – skipped`);
      const endMs = readTime(o, ['end'], 'endMs') ?? startMs + 300;
      words!.push({ text, startMs, endMs: Math.max(endMs, startMs + 40), piece: o.hook === true ? 'hook' : 'voice' });
    });
  }

  return { lines, warnings, hasText: lines.some((l) => !!l.text), words };
};

/** does this reel bring its own captions (so whisper isn't needed)? */
export const hasOwnCaptions = (p: ReelPaths): boolean => {
  if (fs.existsSync(p.userTimeline)) {
    try {
      const data = JSON.parse(fs.readFileSync(p.userTimeline, 'utf8'));
      if (!isGeneratedTimeline(data)) {
        const parsed = parseUserTimeline(data);
        return parsed.hasText || !!parsed.words?.length;
      }
    } catch {
      /* invalid JSON is reported by plan */
    }
  }
  return fs.existsSync(p.script) && scriptHasText(fs.readFileSync(p.script, 'utf8'));
};
