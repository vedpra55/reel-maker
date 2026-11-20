/**
 * Beat planner: decides what is on screen and when.
 *
 *  1. script markers cut the reel into segments (hook → body segments → end card)
 *  2. unmarked stretches get the unused images, spread over page boundaries
 *  3. number pages become stat beats (spaced), long image holds get split
 *     (punch-in reframes or text beats on strong keyword pages)
 *  4. too-short auto beats merge away, then motions/backgrounds/transitions are
 *     chosen with a seeded RNG so nothing repeats more than twice in a row
 */
import type { Background, BeatKind, Motion, Settings, TBeat, TStat } from '../shared/schema';
import { MOTIONS } from '../shared/schema';
import type { Marker } from './script';
import type { Page } from './phrases';
import type { KeyInfo } from './roles';
import type { Rng } from './util/rng';
import { isNumberToken, isSentenceEnd, parseStat } from './util/text';

export type ImageAsset = { name: string; src: string };
export type PlanPage = Page & { info: KeyInfo };
type ImgMarker = Extract<Marker, { kind: 'img' }>;

type Draft = {
  kind: BeatKind;
  startMs: number;
  endMs: number;
  from: number; // first page index
  to: number; // page index after the last page
  explicit: boolean;
  img?: { asset: ImageAsset; marker?: ImgMarker };
  bg?: Background;
  /** same image as the previous draft (reframe / punch-in) */
  continuation?: boolean;
};

type Spec =
  | { type: 'hook'; marker?: ImgMarker }
  | { type: 'auto' }
  | { type: 'marker'; marker: Marker };

type Seg = { spec: Spec; from: number; to: number; startMs: number; endMs: number };

export type BeatPlanInput = {
  pages: PlanPage[];
  images: ImageAsset[];
  trailing: Marker[];
  settings: Settings;
  rng: Rng;
  voiceEndMs: number;
  warnings: string[];
};

export const resolveImage = (name: string, images: ImageAsset[]): ImageAsset | undefined => {
  const n = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  return (
    images.find((i) => i.name.toLowerCase() === n) ??
    images.find((i) => i.name.toLowerCase().startsWith(n)) ??
    images.find((i) => i.name.toLowerCase().includes(n))
  );
};

const dur = (d: { startMs: number; endMs: number }) => d.endMs - d.startMs;

export const planBeats = (input: BeatPlanInput): { beats: TBeat[]; durationMs: number } => {
  const { pages, images, settings: s, rng, warnings } = input;
  const minHold = s.pacing.minHoldS * 1000;
  const maxHold = s.pacing.maxHoldS * 1000;
  if (!pages.length) throw new Error('No words to plan – is the transcript empty?');

  /* ---------- 1. segments ---------- */
  let hookEnd = pages.findIndex((p) => !p.hook);
  if (hookEnd < 0) hookEnd = pages.length;
  if (hookEnd === 0) hookEnd = 1;
  for (let i = 1; i < hookEnd; i++) if (pages[i].words[0].marker) hookEnd = i;
  const m0 = pages[0].words[0].marker;
  const segs: Seg[] = [
    { spec: { type: 'hook', marker: m0?.kind === 'img' ? m0 : undefined }, from: 0, to: hookEnd, startMs: 0, endMs: 0 },
  ];
  let cur: Seg = { spec: { type: 'auto' }, from: hookEnd, to: hookEnd, startMs: 0, endMs: 0 };
  for (let i = hookEnd; i < pages.length; i++) {
    const mk = pages[i].words[0].marker;
    if (mk && i > hookEnd - 0) {
      if (cur.to > cur.from) segs.push(cur);
      cur = { spec: { type: 'marker', marker: mk }, from: i, to: i + 1, startMs: 0, endMs: 0 };
    } else cur.to = i + 1;
  }
  if (cur.to > cur.from) segs.push(cur);

  // everything from an [end] marker on is the end card
  const endIdx = segs.findIndex((g) => g.spec.type === 'marker' && g.spec.marker.kind === 'end');
  if (endIdx > 0) {
    const tail = segs.splice(endIdx);
    segs.push({ ...tail[0], to: tail[tail.length - 1].to });
  }
  const hasEndMarker = endIdx > 0 || input.trailing.some((t) => t.kind === 'end');

  // timing
  const voiceEnd = input.voiceEndMs;
  const endCardMs = s.endCard.durationS * 1000;
  let durationMs: number;
  let appendedEnd: { startMs: number; endMs: number } | null = null;
  if (endIdx > 0) {
    const es = pages[segs[segs.length - 1].from].startMs;
    durationMs = Math.max(voiceEnd + 400, es + endCardMs);
  } else if (s.endCard.enabled || hasEndMarker) {
    appendedEnd = { startMs: voiceEnd + 150, endMs: voiceEnd + 150 + endCardMs };
    durationMs = appendedEnd.endMs;
  } else durationMs = voiceEnd + 500;

  segs.forEach((g, i) => {
    g.startMs = i === 0 ? 0 : pages[g.from].startMs;
  });
  segs.forEach((g, i) => {
    g.endMs = i + 1 < segs.length ? segs[i + 1].startMs : appendedEnd ? appendedEnd.startMs : durationMs;
  });

  /* ---------- 2. image assignment ---------- */
  const used = new Set<string>();
  const markerImage = (mk: ImgMarker): ImageAsset | undefined => {
    const a = resolveImage(mk.image, images);
    if (!a) warnings.push(`[img ${mk.image}] – no image matches "${mk.image}" in images/`);
    else used.add(a.name);
    return a;
  };
  const resolved = new Map<Seg, ImageAsset | undefined>();
  for (const g of segs) {
    if (g.spec.type === 'hook' && g.spec.marker) resolved.set(g, markerImage(g.spec.marker));
    if (g.spec.type === 'marker' && g.spec.marker.kind === 'img') resolved.set(g, markerImage(g.spec.marker));
  }
  const anyImgMarker = used.size > 0 || segs.some((g) => g.spec.type === 'marker' && g.spec.marker.kind === 'img');
  const unused = images.filter((i) => !used.has(i.name));
  const hookSeg = segs[0];
  if (!anyImgMarker && unused.length && !resolved.get(hookSeg)) resolved.set(hookSeg, unused.shift());

  // spread the rest over the auto segments (largest remainder by duration, capped by min hold)
  const autos = segs.filter((g) => g.spec.type === 'auto');
  const alloc = new Map<Seg, number>();
  if (autos.length) {
    const total = autos.reduce((a, g) => a + dur(g), 0);
    const raw = autos.map((g) => (unused.length * dur(g)) / Math.max(1, total));
    const base = raw.map(Math.floor);
    let left = unused.length - base.reduce((a, b) => a + b, 0);
    raw
      .map((r, i) => ({ i, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac)
      .forEach(({ i }) => {
        if (left > 0) {
          base[i]++;
          left--;
        }
      });
    autos.forEach((g, i) => alloc.set(g, Math.min(base[i], Math.max(1, Math.floor(dur(g) / (minHold * 1.2))))));
  }

  /* ---------- 3. segments → drafts ---------- */
  let drafts: Draft[] = [];
  let imgCursor = 0;
  for (const g of segs) {
    const base = { startMs: g.startMs, endMs: g.endMs, from: g.from, to: g.to };
    if (g.spec.type === 'hook') {
      const a = resolved.get(g);
      drafts.push({ ...base, kind: 'hook', explicit: true, img: a ? { asset: a, marker: g.spec.marker } : undefined });
    } else if (g.spec.type === 'auto') {
      const k = alloc.get(g) ?? 0;
      if (k === 0) {
        drafts.push({ ...base, kind: 'text', explicit: false });
        continue;
      }
      const cuts = cutPoints(pages, g.from, g.to, g.startMs, g.endMs, k);
      const bounds = [g.from, ...cuts, g.to];
      for (let c = 0; c < bounds.length - 1; c++) {
        const asset = unused[imgCursor++];
        drafts.push({
          kind: 'image',
          explicit: false,
          from: bounds[c],
          to: bounds[c + 1],
          startMs: c === 0 ? g.startMs : pages[bounds[c]].startMs,
          endMs: c === bounds.length - 2 ? g.endMs : pages[bounds[c + 1]].startMs,
          img: asset ? { asset } : undefined,
        });
      }
    } else {
      const mk = g.spec.marker;
      if (mk.kind === 'img') {
        const a = resolved.get(g);
        if (a) drafts.push({ ...base, kind: mk.split ? 'split' : 'image', explicit: true, img: { asset: a, marker: mk } });
        else drafts.push({ ...base, kind: 'text', explicit: true });
      } else if (mk.kind === 'text') drafts.push({ ...base, kind: 'text', explicit: true, bg: mk.bg });
      else if (mk.kind === 'stat') {
        const hasNum = pages.slice(g.from, g.to).some((p) => p.info.hasNumber);
        if (!hasNum) warnings.push(`[stat] at "${pages[g.from].words[0].text}…" has no number – using a text beat`);
        drafts.push({ ...base, kind: hasNum ? 'stat' : 'text', explicit: true });
      } else if (mk.kind === 'end') drafts.push({ ...base, kind: 'end', explicit: true });
    }
  }
  if (appendedEnd) drafts.push({ kind: 'end', explicit: true, from: pages.length, to: pages.length, ...appendedEnd });

  /* ---------- 4. auto stat beats ---------- */
  let lastStat = -Infinity;
  if (s.pacing.autoStatBeats) {
    const out: Draft[] = [];
    for (const d of drafts) {
      if (d.kind === 'stat') lastStat = d.startMs;
      const canHost = d.kind === 'image' || (d.kind === 'text' && !d.explicit);
      if (!canHost) {
        out.push(d);
        continue;
      }
      let rest: Draft | null = d;
      for (let pi = d.from; pi < d.to && rest; pi++) {
        const pg = pages[pi];
        if (!pg.info.hasNumber || pg.startMs - lastStat < s.pacing.statEveryS * 1000) continue;
        if (pi < rest.from) continue;
        const pieces = carve(rest, pi, extendTo(pages, pi, rest.to, minHold), 'stat', pages, minHold);
        lastStat = pg.startMs;
        rest = pieces.after;
        if (pieces.before) out.push(pieces.before);
        out.push(pieces.mid);
        pi = pieces.mid.to - 1;
      }
      if (rest) out.push(rest);
    }
    drafts = out;
  }

  /* ---------- 5. long holds ---------- */
  {
    const out: Draft[] = [];
    let lastText = -Infinity;
    for (const d of drafts) {
      if (d.kind === 'text') lastText = d.startMs;
      // long text-only stretches: split and cycle backgrounds so the screen keeps changing
      if (d.kind === 'text' && !d.bg && dur(d) > maxHold * 1.3 && d.to - d.from >= 2) {
        const n = Math.ceil(dur(d) / maxHold);
        const bounds = [d.from, ...cutPoints(pages, d.from, d.to, d.startMs, d.endMs, n), d.to];
        for (let c = 0; c < bounds.length - 1; c++) {
          out.push({
            ...d,
            from: bounds[c],
            to: bounds[c + 1],
            startMs: c === 0 ? d.startMs : pages[bounds[c]].startMs,
            endMs: c === bounds.length - 2 ? d.endMs : pages[bounds[c + 1]].startMs,
            explicit: c === 0 ? d.explicit : false,
          });
        }
        continue;
      }
      if ((d.kind !== 'image' && d.kind !== 'split') || dur(d) <= maxHold || d.to - d.from < 2) {
        out.push(d);
        continue;
      }
      const n = Math.ceil(dur(d) / maxHold);
      const cuts = cutPoints(pages, d.from, d.to, d.startMs, d.endMs, n);
      const bounds = [d.from, ...cuts, d.to];
      for (let c = 0; c < bounds.length - 1; c++) {
        const part: Draft = {
          ...d,
          from: bounds[c],
          to: bounds[c + 1],
          startMs: c === 0 ? d.startMs : pages[bounds[c]].startMs,
          endMs: c === bounds.length - 2 ? d.endMs : pages[bounds[c + 1]].startMs,
          continuation: c > 0 ? true : d.continuation,
          explicit: c === 0 ? d.explicit : false,
        };
        const lead = pages[part.from];
        const strong = lead.info.score >= 40 && !lead.info.hasNumber;
        if (c > 0 && d.kind === 'image' && s.pacing.autoTextBeats && strong && part.startMs - lastText > 6000) {
          const pieces = carve(part, part.from, extendTo(pages, part.from, part.to, minHold), 'text', pages, minHold);
          lastText = pieces.mid.startMs;
          if (pieces.before) out.push(pieces.before);
          out.push(pieces.mid);
          if (pieces.after) out.push({ ...pieces.after, continuation: false });
        } else out.push(part);
      }
    }
    drafts = out;
  }

  /* ---------- 6. merge too-short auto beats ---------- */
  for (let i = 1; i < drafts.length; i++) {
    const d = drafts[i];
    const prev = drafts[i - 1];
    if (d.kind === 'end' || prev.kind === 'end') continue;
    if (dur(d) < minHold && !d.explicit) {
      prev.endMs = d.endMs;
      prev.to = d.to;
      drafts.splice(i, 1);
      i--;
    } else if (dur(d) < 500 && d.explicit) {
      warnings.push(`beat at ${(d.startMs / 1000).toFixed(1)}s is only ${dur(d)} ms long – consider moving its marker`);
    }
  }

  /* ---------- 7. looks, transitions ---------- */
  const beats: TBeat[] = [];
  const motions: Motion[] = [];
  let textCount = 0;
  let prevBg: Background | undefined;
  drafts.forEach((d, i) => {
    const prev = beats[i - 1];
    const sameImage = !!d.continuation && prev?.image && d.img && prev.image.src === d.img.asset.src;
    const transition = chooseTransition(d.kind, prev?.transition, !!sameImage, i, s, rng);
    const beat: TBeat = {
      id: i,
      kind: d.kind,
      startMs: Math.round(d.startMs),
      endMs: Math.round(d.endMs),
      transition,
      captions: d.kind === 'image' ? 'overlay' : 'embedded',
    };
    if (d.img && (d.kind === 'image' || d.kind === 'split' || d.kind === 'hook')) {
      const mk = d.img.marker;
      const motion = (!d.continuation && mk?.motion) || rng.pickNot(MOTIONS, motions.slice(-2));
      motions.push(motion);
      beat.image = {
        src: d.img.asset.src,
        motion,
        focus: mk?.focus ?? 'center',
        treatment: mk?.treatment ?? s.look.imageTreatment,
        punch: sameImage ? (prev!.image!.punch > 1 ? 1 : 1.08) : 1,
      };
    }
    if (d.kind === 'text' || d.kind === 'stat' || (d.kind === 'hook' && !d.img)) {
      const home: Background = s.look.surface === 'dark' ? 'dark' : 'paper';
      const cycle: Background[] = home === 'paper' ? ['paper', 'brand', 'paper', 'dark'] : ['dark', 'brand', 'dark', 'paper'];
      let bg: Background = d.bg ?? home;
      if (!d.bg) {
        if (d.kind === 'hook') bg = 'brand';
        else if (d.kind === 'text') {
          bg = cycle[textCount % cycle.length];
          if (bg === prevBg) bg = cycle[(textCount + 1) % cycle.length];
        }
      }
      if (d.kind === 'text') textCount++;
      beat.bg = bg;
      prevBg = bg;
    } else prevBg = undefined;
    if (d.kind === 'stat') {
      const tok = pages.slice(d.from, d.to).flatMap((p) => p.words).find((w) => isNumberToken(w.text));
      const st = tok ? parseStat(tok.text) : null;
      if (st) beat.stat = st as TStat;
      else beat.kind = 'text';
    }
    beats.push(beat);
  });

  return { beats, durationMs: Math.round(durationMs) };
};

/** grow a page range forward until it lasts at least `minMs` (staying inside `limit`) */
const extendTo = (pages: PlanPage[], from: number, limit: number, minMs: number): number => {
  let to = from + 1;
  while (to < limit && pages[to - 1].endMs - pages[from].startMs < minMs) to++;
  return to;
};

/** cut [from,to) out of a draft as a new beat; absorb slivers into it */
const carve = (d: Draft, from: number, to: number, kind: BeatKind, pages: PlanPage[], minHold: number) => {
  let start = from === d.from ? d.startMs : pages[from].startMs;
  let end = to >= d.to ? d.endMs : pages[to].startMs;
  let before: Draft | null = start > d.startMs ? { ...d, to: from, endMs: start } : null;
  let after: Draft | null = end < d.endMs ? { ...d, from: to, startMs: end, explicit: false, continuation: true } : null;
  if (before && dur(before) < minHold * 0.6) {
    start = d.startMs;
    from = d.from;
    before = null;
  }
  if (after && dur(after) < minHold * 0.6) {
    end = d.endMs;
    to = d.to;
    after = null;
  }
  const mid: Draft = { kind, explicit: false, from, to, startMs: start, endMs: end };
  return { before, mid, after };
};

/**
 * Pick k-1 page indexes inside (from, to) that split the time range into k nearly-equal parts,
 * preferring boundaries right after a sentence ends.
 */
export const cutPoints = (pages: PlanPage[], from: number, to: number, startMs: number, endMs: number, k: number): number[] => {
  const cuts: number[] = [];
  if (k <= 1 || to - from < 2) return cuts;
  const step = (endMs - startMs) / k;
  let lo = from + 1;
  for (let c = 1; c < k; c++) {
    const ideal = startMs + step * c;
    let best = -1;
    let bestCost = Infinity;
    for (let i = lo; i < to; i++) {
      const remainingCuts = k - 1 - c;
      if (to - i <= remainingCuts) break;
      const sentenceBonus = isSentenceEnd(pages[i - 1].words[pages[i - 1].words.length - 1].text) ? step * 0.25 : 0;
      const cost = Math.abs(pages[i].startMs - ideal) - sentenceBonus;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    if (best < 0) break;
    cuts.push(best);
    lo = best + 1;
  }
  return cuts;
};

const chooseTransition = (
  kind: BeatKind,
  prev: TBeat['transition'] | undefined,
  sameImage: boolean,
  index: number,
  s: Settings,
  rng: Rng,
): TBeat['transition'] => {
  if (index === 0 || s.intensity <= 0.02) return 'cut';
  if (sameImage) return 'cut';
  const allowed: readonly TBeat['transition'][] = s.pacing.transitions.length ? s.pacing.transitions : ['fade'];
  const prefer = (opts: readonly TBeat['transition'][]) => {
    const ok = opts.filter((o) => allowed.includes(o));
    return rng.pickNot(ok.length ? ok : allowed, [prev]);
  };
  if (kind === 'stat' || kind === 'text') return prefer(['wipe', 'slide', 'zoom-punch']);
  if (kind === 'end') return prefer(['slide', 'fade', 'wipe']);
  if (index === 1) return prefer(['zoom-punch', 'whip']);
  return prefer(allowed);
};
