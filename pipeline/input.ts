/**
 * reels/<name>/timeline.json – the one file you write per reel.
 *
 * {
 *   "hook":  { "shots": [ … ] },              ← times read off hook.mp3   (leave out if no hook file)
 *   "voice": { "shots": [ … ] },              ← times read off voice.mp3
 *   "settings": { … }                         ← optional, this reel only
 * }
 *
 * a shot: { "time": "0:03.5", "image": "2nd", "motion": "zoom-in", "transition": "push",
 *           "focus": "top", "treatment": "bw", "sfx": "whoosh", "text": "what you say here" }
 * optional per section: "words": [ { "text": "Pehle", "start": 0.12, "end": 0.4 } ]  (exact timings)
 */
import { FOCI, MOTIONS, TRANSITIONS, TREATMENTS, type Focus, type Motion, type Transition } from '../shared/schema';

export type Section = 'hook' | 'voice';
export type SfxChoice = { name: string; volume: number } | 'none';

export type InShot = {
  section: Section;
  label: string; // "voice shot 3" – used in messages
  timeMs: number;
  endMs?: number;
  image: string;
  motion?: Motion;
  transition?: Transition;
  focus?: Focus;
  treatment?: (typeof TREATMENTS)[number];
  text?: string;
  sfx?: SfxChoice;
};

export type InWord = { section: Section; text: string; startMs: number; endMs: number };

export type Input = {
  shots: InShot[];
  words: Record<Section, InWord[] | null>;
  settings: Record<string, unknown>;
  warnings: string[];
};

type Obj = Record<string, unknown>;

/* ---------------- time ---------------- */

const TIME = /^\[?(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)\]?$/;

/** "0:03.5", "3.5", "1:02:03" → ms */
export const parseTime = (t: string): number | null => {
  const m = t.trim().match(TIME);
  if (!m) return null;
  const parts = m[1].split(':').map(Number);
  if (parts.some((x) => !Number.isFinite(x))) return null;
  return Math.round(parts.reduce((acc, x) => acc * 60 + x, 0) * 1000);
};

export const formatTime = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

/** seconds (number), "m:ss.s" (string), or *Ms fields in milliseconds */
const readTime = (o: Obj, keys: string[], msKey: string): number | null => {
  if (typeof o[msKey] === 'number') return Math.round(o[msKey] as number);
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 1000);
    if (typeof v === 'string') {
      const t = parseTime(v);
      if (t !== null) return t;
    }
  }
  return null;
};

/* ---------------- parsing ---------------- */

const SHOT_KEYS = new Set([
  'time', 'start', 'startMs', 'at', 'image', 'src', 'file', 'motion', 'transition', 'focus', 'treatment',
  'text', 'sfx', 'end', 'endMs', 'hook', 'note', 'comment',
]);

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (list as readonly string[]).includes(v.trim().toLowerCase()) ? (v.trim().toLowerCase() as T) : undefined;

const listOf = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

/** true for the internal plan file older versions wrote into the reel folder */
export const isGeneratedTimeline = (raw: unknown) =>
  !!raw && typeof raw === 'object' && !Array.isArray(raw) && 'voice' in (raw as Obj) && 'speech' in (raw as Obj);

const parseShot = (item: unknown, section: Section, n: number, warnings: string[]): InShot | null => {
  const label = `${section} shot ${n}`;
  if (!item || typeof item !== 'object') {
    warnings.push(`${label}: is not a { … } object – skipped`);
    return null;
  }
  const o = item as Obj;
  for (const k of Object.keys(o)) if (!SHOT_KEYS.has(k)) warnings.push(`${label}: unknown field "${k}" (typo?)`);
  const timeMs = readTime(o, ['time', 'start', 'at'], 'startMs');
  const image = String(o.image ?? o.src ?? o.file ?? '').trim().replace(/^images\//, '');
  if (timeMs === null) {
    warnings.push(`${label}: missing "time" (like "0:03.5") – skipped`);
    return null;
  }
  if (!image) {
    warnings.push(`${label}: missing "image" – skipped`);
    return null;
  }
  const shot: InShot = { section, label, timeMs, image };
  const opts = [
    ['motion', MOTIONS],
    ['transition', TRANSITIONS],
    ['focus', FOCI],
    ['treatment', TREATMENTS],
  ] as const;
  for (const [key, list] of opts) {
    if (o[key] === undefined || o[key] === '') continue;
    const v = pick(list as readonly string[], o[key]);
    if (v) (shot as Record<string, unknown>)[key] = v;
    else warnings.push(`${label}: ${key} "${String(o[key])}" isn't one of: ${list.join(', ')}`);
  }
  const end = readTime(o, ['end'], 'endMs');
  if (end !== null) shot.endMs = end;
  const text = Array.isArray(o.text) ? o.text.join(' ') : typeof o.text === 'string' ? o.text : '';
  if (text.trim()) shot.text = text.trim().replace(/\s+/g, ' ');
  if (o.sfx !== undefined && o.sfx !== null && o.sfx !== '') {
    if (o.sfx === false || o.sfx === 'none') shot.sfx = 'none';
    else if (typeof o.sfx === 'string') shot.sfx = { name: o.sfx.trim(), volume: 1 };
    else if (typeof o.sfx === 'object') {
      const s = o.sfx as Obj;
      const name = String(s.name ?? s.file ?? '').trim();
      const volume = typeof s.volume === 'number' ? s.volume : 1;
      if (name) shot.sfx = { name, volume };
      else warnings.push(`${label}: sfx needs a "name" (like "whoosh" or "boom.mp3")`);
    }
  }
  return shot;
};

const parseWords = (raw: unknown, section: Section, warnings: string[]): InWord[] | null => {
  const list = listOf(raw);
  if (!list) return null;
  const out: InWord[] = [];
  list.forEach((item, i) => {
    const o = (item ?? {}) as Obj;
    const text = String(o.text ?? o.word ?? '').trim();
    const startMs = readTime(o, ['start', 'time'], 'startMs');
    if (!text || startMs === null) return void warnings.push(`${section} word ${i + 1}: needs "text" and "start" – skipped`);
    const endMs = readTime(o, ['end'], 'endMs') ?? startMs + 300;
    out.push({ section, text, startMs, endMs: Math.max(endMs, startMs + 40) });
  });
  return out;
};

/** a section is either { "shots": [...], "words": [...] } or just the shots array */
const readSection = (raw: unknown, section: Section, input: Input) => {
  if (raw === undefined || raw === null) return;
  const shots = listOf(raw) ?? listOf((raw as Obj).shots);
  if (!shots) {
    input.warnings.push(`"${section}" needs a "shots" list`);
    return;
  }
  shots.forEach((item, i) => {
    const sh = parseShot(item, section, i + 1, input.warnings);
    if (sh) input.shots.push(sh);
  });
  if (!Array.isArray(raw)) input.words[section] = parseWords((raw as Obj).words, section, input.warnings);
};

export const parseInput = (raw: unknown): Input => {
  const input: Input = { shots: [], words: { hook: null, voice: null }, settings: {}, warnings: [] };
  if (!raw || typeof raw !== 'object') {
    input.warnings.push('timeline.json must be a { … } object');
    return input;
  }
  const root = raw as Obj;
  if (root.settings && typeof root.settings === 'object') input.settings = root.settings as Obj;
  readSection(root.hook, 'hook', input);
  readSection(root.voice, 'voice', input);
  // earlier format: one top-level "shots" list (shots with "hook": true belong to the hook)
  if (!root.voice && Array.isArray(root.shots)) {
    (root.shots as unknown[]).forEach((item, i) => {
      const section: Section = (item as Obj)?.hook === true ? 'hook' : 'voice';
      const sh = parseShot(item, section, i + 1, input.warnings);
      if (sh) input.shots.push(sh);
    });
    input.words.voice = parseWords(root.words, 'voice', input.warnings);
  }
  for (const k of Object.keys(root)) {
    if (!['hook', 'voice', 'settings', 'shots', 'words', '$schema', 'note', 'comment'].includes(k)) {
      input.warnings.push(`unknown top-level field "${k}" (expected hook, voice, settings)`);
    }
  }
  return input;
};

/* ---------------- starter file ---------------- */

type StarterInfo = {
  images: string[];
  /** speaking starts (in each file's own clock) – good places for a cut */
  starts: Record<Section, number[]>;
  durations: Record<Section, number | null>;
};

const spread = (n: number, durationMs: number, starts: number[]): number[] => {
  const out = [0];
  for (let i = 1; i < n; i++) {
    const ideal = (durationMs * i) / n;
    const cand = starts
      .filter((x) => x > out[out.length - 1] + 500 && Math.abs(x - ideal) < durationMs / n / 2)
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
    out.push(cand ?? Math.round(ideal));
  }
  return out;
};

/** a ready-to-edit timeline.json: your images spread over the audio, empty text to fill in */
export const starterTimeline = ({ images, starts, durations }: StarterInfo) => {
  const imgs = images.length ? images : ['1st'];
  const hookImgs = durations.hook ? imgs.slice(0, 1) : [];
  const voiceImgs = durations.hook ? (imgs.length > 1 ? imgs.slice(1) : imgs) : imgs;
  const shot = (time: number, image: string) => ({ time: formatTime(time), image, text: '' });
  const out: Record<string, unknown> = {};
  if (durations.hook) out.hook = { shots: hookImgs.map((im) => shot(0, im)) };
  out.voice = {
    shots: spread(voiceImgs.length, durations.voice ?? 10000, starts.voice).map((t, i) => shot(t, voiceImgs[i])),
  };
  return out;
};

/* ---------------- one-time migration from script.md ---------------- */

/** turn an old script.md (time image options / > text) into the timeline.json shape */
export const convertScriptMd = (src: string): Record<string, unknown> | null => {
  const sections: Record<Section, Obj[]> = { hook: [], voice: [] };
  let last: Obj | null = null;
  const text = src.replace(/<!--[\s\S]*?-->/g, '');
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[-*•]\s+/, '');
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (line.startsWith('>')) {
      const said = line.replace(/^>+\s*/, '').trim();
      if (last && said) last.text = last.text ? `${last.text} ${said}` : said;
      continue;
    }
    let tokens = line.match(/"[^"]+"|\S+/g)?.map((t) => t.replace(/^"|"$/g, '')) ?? [];
    let section: Section = 'voice';
    if (tokens[0]?.toLowerCase() === 'hook') {
      section = 'hook';
      tokens = tokens.slice(1);
    }
    const t = parseTime((tokens.shift() ?? '').split(/[-–]/)[0]);
    const image = tokens.shift();
    if (t === null || !image) continue;
    const shot: Obj = { time: formatTime(t), image };
    for (const tok of tokens) {
      const [k, v] = tok.includes('=') ? tok.split('=', 2) : ['', tok];
      const val = v.toLowerCase();
      if ((k === 'focus' || !k) && (FOCI as readonly string[]).includes(val)) shot.focus = val;
      else if ((k === 'transition' || !k) && (TRANSITIONS as readonly string[]).includes(val)) shot.transition = val;
      else if ((k === 'motion' || !k) && (MOTIONS as readonly string[]).includes(val)) shot.motion = val;
      else if ((TREATMENTS as readonly string[]).includes(val)) shot.treatment = val;
    }
    sections[section].push(shot);
    last = shot;
  }
  if (!sections.hook.length && !sections.voice.length) return null;
  const out: Record<string, unknown> = {};
  if (sections.hook.length) out.hook = { shots: sections.hook };
  out.voice = { shots: sections.voice };
  return out;
};
