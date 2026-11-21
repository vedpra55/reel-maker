/** timeline.json + prep + settings → the render plan (.build/timeline.json). Instant and deterministic. */
import { SFX_KINDS, timelineSchema, type Settings, type TShot, type TSfx, type TWord, type Timeline } from '../shared/schema';
import type { InShot, Input, Section } from './input';
import { toFinal, type Prep } from './prep';
import { speechIn, timeTextBlocks } from './textwords';
import { createRng, hashString } from './util/rng';

export type PlanReport = {
  shots: number;
  warnings: string[];
  unusedImages: string[];
  /** where the captions of each section come from */
  captions: Partial<Record<Section, 'words' | 'text' | 'none'>>;
  sfx: number;
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
  let v = list[index % list.length];
  if (v === prev && list.length > 1) v = list[(index + 1) % list.length];
  return v;
};

const ANIMATED = new Set(['push', 'push-up', 'zoom', 'whip', 'slide-up']);
const GAIN: Record<string, number> = { whoosh: 1, pop: 0.8, tick: 0.6, riser: 0.8, hit: 1 };

export const buildTimeline = (name: string, prep: Prep, input: Input, s: Settings): { timeline: Timeline; report: PlanReport } => {
  if (prep.version !== 3) throw new Error('This reel was prepared by an older version – delete its .build folder and run reel make again.');
  if (!prep.images.length) throw new Error('No images. Put them in the images/ folder.');
  const warnings: string[] = [...input.warnings];
  const piece = (sec: Section) => prep.pieces.find((p) => p.name === sec);

  // shots in sections without their audio file can't be placed
  const shotsIn = input.shots.filter((sh) => {
    if (piece(sh.section)) return true;
    warnings.push(`${sh.label}: there is no ${sh.section} audio file (${sh.section}.mp3) – shot skipped`);
    return false;
  });
  if (!shotsIn.length) throw new Error('timeline.json has no usable shots.');

  /* ---------- captions ---------- */
  const captions: PlanReport['captions'] = {};
  let words: TWord[] = [];
  for (const sec of ['hook', 'voice'] as const) {
    const pc = piece(sec);
    if (!pc) continue;
    const secEnd = pc.offsetMs + pc.durationMs;
    const given = input.words[sec];
    if (given?.length) {
      captions[sec] = 'words';
      for (const w of given) {
        const a = toFinal(sec, w.startMs, prep.pieces)!;
        const b = toFinal(sec, w.endMs, prep.pieces)!;
        words.push({ text: w.text, startMs: a, endMs: Math.max(b, a + 40) });
      }
      continue;
    }
    const withText = shotsIn
      .filter((sh) => sh.section === sec && sh.text)
      .map((sh) => ({ sh, at: toFinal(sec, sh.timeMs, prep.pieces)! }))
      .sort((a, b) => a.at - b.at);
    if (!withText.length) {
      captions[sec] = 'none';
      continue;
    }
    captions[sec] = 'text';
    const firstSpeech = speechIn(pc.offsetMs, secEnd, prep.silences)[0]?.[0] ?? pc.offsetMs;
    const blocks = withText.map(({ sh, at }, i) => ({
      startMs: i === 0 ? Math.min(at, firstSpeech) : at,
      endMs: withText[i + 1]?.at ?? secEnd,
      text: sh.text!,
    }));
    words.push(...timeTextBlocks(blocks, prep.silences));
  }
  words.sort((a, b) => a.startMs - b.startMs);
  words = applyReplacements(words, s.captions.replace);
  if (!words.length) warnings.push('no captions: add "text" to your shots to show words on screen');

  const lastSpeech = words.length ? words[words.length - 1].endMs : prep.voice.durationMs;
  let durationMs = Math.min(prep.voice.durationMs, lastSpeech) + s.audio.tailMs;

  /* ---------- cuts ---------- */
  type Cut = { atMs: number; asset: Asset; sh: InShot };
  let cuts: Cut[] = [];
  for (const sh of shotsIn) {
    const asset = resolveImage(sh.image, prep.images);
    if (!asset) {
      warnings.push(`${sh.label}: image "${sh.image}" not found – you have ${prep.images.map((i) => i.name).join(', ')}`);
      continue;
    }
    cuts.push({ atMs: toFinal(sh.section, sh.timeMs, prep.pieces)!, asset, sh });
    if (sh.endMs !== undefined) durationMs = Math.max(durationMs, toFinal(sh.section, sh.endMs, prep.pieces)!);
  }
  if (!cuts.length) throw new Error('None of the images in timeline.json were found in images/.');
  cuts.sort((a, b) => a.atMs - b.atMs);
  const starts = words.map((w) => w.startMs);
  for (const c of cuts) {
    if (s.images.snapToWordMs <= 0 || c.atMs === 0) continue;
    const near = starts.reduce((best, x) => (Math.abs(x - c.atMs) < Math.abs(best - c.atMs) ? x : best), Infinity);
    if (Math.abs(near - c.atMs) <= s.images.snapToWordMs) c.atMs = near;
  }
  cuts[0].atMs = 0;
  cuts = cuts.filter((c, i) => {
    if (c.atMs >= durationMs) {
      warnings.push(`${c.sh.label}: its time is after the audio ends – skipped`);
      return false;
    }
    const dup = i > 0 && c.atMs - cuts[i - 1].atMs < 200;
    if (dup) warnings.push(`${c.sh.label}: less than 0.2s after the previous image – skipped`);
    return !dup;
  });

  /* ---------- shots ---------- */
  const rng = createRng(hashString(name) ^ s.seed);
  const motionOffset = Math.floor(rng.next() * s.images.motions.length);
  const transOffset = Math.floor(rng.next() * Math.max(1, s.images.transitions.length));
  const shots: TShot[] = [];
  cuts.forEach((c, i) => {
    const endMs = i + 1 < cuts.length ? cuts[i + 1].atMs : durationMs;
    const prev = shots[i - 1];
    const motion = c.sh.motion ?? rotate(s.images.motions, motionOffset + i, prev?.motion);
    let transition = c.sh.transition ?? (s.images.transitions.length ? rotate(s.images.transitions, transOffset + i, prev?.transition) : 'cut');
    const room = Math.min(c.atMs - (prev?.startMs ?? 0), endMs - c.atMs);
    if (i === 0) transition = 'cut';
    else if (transition !== 'cut' && room < s.images.transitionMs + 150) {
      if (!c.sh.transition) transition = 'cut';
      else warnings.push(`${c.sh.label}: very short shot – the ${transition} will look rushed`);
    }
    shots.push({
      id: i,
      startMs: Math.round(c.atMs),
      endMs: Math.round(endMs),
      src: c.asset.src,
      motion,
      focus: c.sh.focus ?? 'center',
      treatment: c.sh.treatment ?? s.images.treatment,
      transition,
    });
  });
  const used = new Set(shots.map((x) => x.src));
  const unusedImages = prep.images.filter((i) => !used.has(i.src)).map((i) => i.name);

  /* ---------- sound effects ---------- */
  const sfx: TSfx[] = [];
  if (s.audio.sfxVolume > 0) {
    let lastAuto = -Infinity;
    cuts.forEach((c, i) => {
      const sh = shots[i];
      const choice = c.sh.sfx;
      if (choice === 'none') return;
      let src: string | null = null;
      let kind = '';
      let vol = 1;
      if (choice) {
        vol = choice.volume;
        const base = choice.name.toLowerCase().replace(/\.wav$/, '');
        if ((SFX_KINDS as readonly string[]).includes(base)) {
          kind = base;
          src = `sfx/${base}.wav`;
        } else {
          const file = prep.sfx.find((f) => f.toLowerCase() === choice.name.toLowerCase()) ??
            prep.sfx.find((f) => f.toLowerCase().replace(/\.[a-z0-9]+$/, '') === choice.name.toLowerCase());
          if (!file) {
            warnings.push(
              `${c.sh.label}: sound "${choice.name}" not found – use ${SFX_KINDS.join(', ')}, or put the file in the reel's sfx/ folder`,
            );
            return;
          }
          src = `sfx-user/${file}`;
        }
      } else if (s.audio.autoWhoosh && i > 0 && ANIMATED.has(sh.transition)) {
        if (sh.startMs - lastAuto < 700) return;
        kind = 'whoosh';
        src = 'sfx/whoosh.wav';
        lastAuto = sh.startMs;
      }
      if (!src) return;
      // whoosh peaks on the cut, a riser ends on it, everything else hits on it
      const at =
        kind === 'whoosh' ? sh.startMs - s.images.transitionMs / 2 - 60 : kind === 'riser' ? sh.startMs - 1150 : sh.startMs;
      sfx.push({ src, atMs: Math.max(0, Math.round(at)), volume: +(s.audio.sfxVolume * vol * (GAIN[kind] ?? 1)).toFixed(3) });
    });
  }

  /* ---------- speech regions (music ducking) ---------- */
  const speech: [number, number][] = [];
  const regions = words.length ? words.map((w) => [w.startMs, w.endMs] as [number, number]) : speechIn(0, prep.voice.durationMs, prep.silences);
  for (const [a, b] of regions) {
    const last = speech[speech.length - 1];
    if (last && a - last[1] < 350) last[1] = b;
    else speech.push([a, b]);
  }

  const timeline = timelineSchema.parse({
    version: 3,
    name,
    durationMs: Math.round(durationMs),
    voice: prep.voice,
    music: prep.music ?? undefined,
    speech,
    shots,
    words,
    sfx,
  });
  return { timeline, report: { shots: shots.length, warnings, unusedImages, captions, sfx: sfx.length } };
};
