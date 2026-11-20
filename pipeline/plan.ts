/** `reel plan`: prep.json + script.md + settings → timeline.json (deterministic, instant, re-runnable). */
import fs from 'node:fs';
import { timelineSchema, type Settings, type TShot, type TSfx, type TWord, type Timeline } from '../shared/schema';
import { toFinal, type Prep } from './prep';
import { readJson, writeJson, type ReelPaths } from './paths';
import { parseScript, spreadTimes, type ImageLine } from './script';
import { timeTextBlocks } from './textwords';
import { createRng, hashString } from './util/rng';

export type PlanReport = { shots: number; warnings: string[]; unusedImages: string[]; auto: boolean; captionSource: 'script' | 'whisper' };

/** where the voice actually starts (end of the leading silence) */
const firstSpeech = (prep: Prep) => {
  const lead = prep.silences.find(([s]) => s <= 1);
  return lead ? lead[1] : 0;
};

type Asset = { name: string; src: string };

export const resolveImage = (name: string, images: Asset[]): Asset | undefined => {
  const n = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  return (
    images.find((i) => i.name.toLowerCase() === n) ??
    images.find((i) => i.name.toLowerCase().startsWith(n)) ??
    images.find((i) => i.name.toLowerCase().includes(n))
  );
};

/** whole-word, case-insensitive spelling fixes from settings.captions.replace */
export const applyReplacements = (words: TWord[], map: Record<string, string>): TWord[] => {
  const entries = Object.entries(map);
  if (!entries.length) return words;
  return words.map((w) => {
    let text = w.text;
    for (const [from, to] of entries) {
      const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'giu'), (_m, pre) => pre + to);
    }
    return { ...w, text };
  });
};

/** next item of a rotation, never the same as the previous pick */
const rotate = <T,>(list: readonly T[], index: number, prev: T | undefined): T => {
  if (!list.length) throw new Error('empty list');
  let v = list[index % list.length];
  if (v === prev && list.length > 1) v = list[(index + 1) % list.length];
  return v;
};

export const buildTimeline = (
  name: string,
  prep: Prep,
  scriptSrc: string | null,
  s: Settings,
): { timeline: Timeline; report: PlanReport } => {
  if (prep.version !== 2) throw new Error('This reel was prepared by an older version – run "reel prep <name>" again.');
  const warnings: string[] = [];
  const parsed = scriptSrc ? parseScript(scriptSrc) : { lines: [], warnings: [], hasText: false };
  warnings.push(...parsed.warnings);

  // captions: your "> …" text timed from the audio, otherwise the transcript
  let source: TWord[];
  if (parsed.hasText) {
    const textLines = parsed.lines
      .filter((l) => l.text)
      .map((l) => ({ l, at: toFinal(l.piece, l.timeMs, prep.pieces) }))
      .filter((x): x is { l: ImageLine; at: number } => x.at !== null)
      .sort((a, b) => a.at - b.at);
    const blocks = textLines.map(({ l, at }, i) => ({
      startMs: i === 0 ? Math.min(at, firstSpeech(prep)) : at,
      endMs: textLines[i + 1]?.at ?? prep.voice.durationMs,
      text: l.text!,
    }));
    source = timeTextBlocks(blocks, prep.silences);
  } else {
    source = prep.words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
    if (!source.length) warnings.push('no words for captions – add "> …" lines to script.md, or run reel prep with whisper');
  }
  const words: TWord[] = applyReplacements(source, s.captions.replace);
  const lastWordEnd = words.length ? words[words.length - 1].endMs : prep.voice.durationMs;
  let durationMs = Math.min(prep.voice.durationMs + s.audio.tailMs, lastWordEnd + s.audio.tailMs);
  if (!prep.images.length) throw new Error('No images. Put them in images/ (or the reel folder) and run reel prep again.');

  /* ---------- which image when ---------- */
  type Cut = { atMs: number; asset: Asset; line?: ImageLine };
  let cuts: Cut[] = [];
  const auto = parsed.lines.length === 0;
  if (auto) {
    // no script lines: spread the images evenly in filename order
    spreadTimes(words, prep.images.length, lastWordEnd).forEach((t, i) => cuts.push({ atMs: t, asset: prep.images[i] }));
  } else {
    for (const line of parsed.lines) {
      const asset = resolveImage(line.image, prep.images);
      if (!asset) {
        warnings.push(`line ${line.line}: no image matches "${line.image}" (have: ${prep.images.map((i) => i.name).join(', ')})`);
        continue;
      }
      const at = toFinal(line.piece, line.timeMs, prep.pieces);
      if (at === null) {
        warnings.push(`line ${line.line}: "hook" time given but there is no hook audio file`);
        continue;
      }
      cuts.push({ atMs: at, asset, line });
      if (line.endMs !== undefined) {
        const end = toFinal(line.piece, line.endMs, prep.pieces);
        if (end !== null && line === parsed.lines[parsed.lines.length - 1]) durationMs = Math.max(durationMs, end);
      }
    }
    if (!cuts.length) throw new Error('script.md has no usable image lines.');
  }

  // order, snap onto word starts, first image from frame 0
  cuts.sort((a, b) => a.atMs - b.atMs);
  const starts = words.map((w) => w.startMs);
  for (const c of cuts) {
    if (s.images.snapToWordMs <= 0 || c.atMs === 0) continue;
    const near = starts.reduce((best, x) => (Math.abs(x - c.atMs) < Math.abs(best - c.atMs) ? x : best), Infinity);
    if (Math.abs(near - c.atMs) <= s.images.snapToWordMs) c.atMs = near;
  }
  cuts[0].atMs = 0;
  cuts = cuts.filter((c, i) => {
    const dup = i > 0 && c.atMs - cuts[i - 1].atMs < 200;
    if (dup) warnings.push(`"${c.asset.name}" comes less than 0.2s after "${cuts[i - 1].asset.name}" – dropped`);
    return !dup && c.atMs < durationMs;
  });

  /* ---------- shots ---------- */
  const rng = createRng(hashString(name) ^ s.seed);
  const motionOffset = Math.floor(rng.next() * s.images.motions.length);
  const transOffset = Math.floor(rng.next() * Math.max(1, s.images.transitions.length));
  const shots: TShot[] = [];
  cuts.forEach((c, i) => {
    const endMs = i + 1 < cuts.length ? cuts[i + 1].atMs : durationMs;
    const prev = shots[i - 1];
    const motion = c.line?.motion ?? rotate(s.images.motions, motionOffset + i, prev?.motion);
    let transition = c.line?.transition ?? (s.images.transitions.length ? rotate(s.images.transitions, transOffset + i, prev?.transition) : 'cut');
    // a transition needs room on both sides of the cut
    const room = Math.min(c.atMs - (prev?.startMs ?? 0), endMs - c.atMs);
    if (i === 0) transition = 'cut';
    else if (transition !== 'cut' && room < s.images.transitionMs + 150) {
      if (!c.line?.transition) transition = 'cut';
      else warnings.push(`line ${c.line.line}: shot too short for a ${transition} – it will look rushed`);
    }
    shots.push({
      id: i,
      startMs: Math.round(c.atMs),
      endMs: Math.round(endMs),
      src: c.asset.src,
      motion,
      focus: c.line?.focus ?? 'center',
      treatment: c.line?.treatment ?? s.images.treatment,
      transition,
    });
  });

  const used = new Set(shots.map((x) => x.src));
  const unusedImages = prep.images.filter((i) => !used.has(i.src)).map((i) => i.name);

  /* ---------- sfx & ducking ---------- */
  const sfx: TSfx[] = [];
  if (s.audio.whoosh) {
    let last = -Infinity;
    for (const sh of shots) {
      if (sh.id === 0 || sh.transition === 'cut' || sh.transition === 'crossfade') continue;
      const at = Math.max(0, sh.startMs - s.images.transitionMs / 2 - 60);
      if (at - last < 800) continue;
      sfx.push({ kind: 'whoosh', atMs: Math.round(at), volume: s.audio.sfxVolume });
      last = at;
    }
  }
  const speech: [number, number][] = [];
  for (const w of words) {
    const lastR = speech[speech.length - 1];
    if (lastR && w.startMs - lastR[1] < 350) lastR[1] = w.endMs;
    else speech.push([w.startMs, w.endMs]);
  }

  const timeline = timelineSchema.parse({
    version: 2,
    name,
    durationMs: Math.round(durationMs),
    voice: prep.voice,
    music: prep.music ?? undefined,
    speech,
    shots,
    words,
    sfx,
  });
  return { timeline, report: { shots: shots.length, warnings, unusedImages, auto, captionSource: parsed.hasText ? 'script' : 'whisper' } };
};

export const plan = (p: ReelPaths, s: Settings) => {
  if (!fs.existsSync(p.prep)) throw new Error(`Run "reel prep ${p.name}" first.`);
  const prep = readJson<Prep>(p.prep);
  const script = fs.existsSync(p.script) ? fs.readFileSync(p.script, 'utf8') : null;
  const res = buildTimeline(p.name, prep, script, s);
  writeJson(p.timeline, res.timeline);
  return res;
};
