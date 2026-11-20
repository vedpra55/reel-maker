/** `reel plan`: prep.json + script.md + settings → timeline.json (deterministic, cheap, re-runnable). */
import fs from 'node:fs';
import { timelineSchema, type Settings, type TPage, type Timeline } from '../shared/schema';
import { align, tokensFromWords, type TimedToken } from './align';
import { planBeats, type PlanPage } from './beats';
import { paginate } from './phrases';
import type { Prep } from './prep';
import { readJson, writeJson, type ReelPaths } from './paths';
import { assignRoles, findKey, keyStyleFor, pickEmphasis } from './roles';
import { parseScript, type Marker } from './script';
import { planSfx } from './sfx';
import { createRng, hashString } from './util/rng';
import { isSentenceEnd } from './util/text';

export type PlanReport = {
  alignScore: number | null;
  unmatched: string[];
  warnings: string[];
  beats: Record<string, number>;
  pages: number;
  stackPages: number;
};

/** without a `# hook` section and hook audio, the hook is the first sentence (capped) */
const markHook = (toks: TimedToken[], prep: Prep, hasHookSection: boolean, s: Settings) => {
  if (hasHookSection) return;
  if (prep.hookEndMs !== null) {
    for (const t of toks) t.section = t.startMs < prep.hookEndMs ? 'hook' : 'body';
    return;
  }
  for (const t of toks) t.section = 'body';
  const limit = (toks[0]?.startMs ?? 0) + s.pacing.hookMaxS * 1000;
  for (const t of toks) {
    if (t.startMs > limit) break;
    if (t !== toks[0] && t.marker) break;
    t.section = 'hook';
    if (isSentenceEnd(t.text)) break;
  }
};

export const buildTimeline = (
  name: string,
  prep: Prep,
  scriptSrc: string | null,
  s: Settings,
): { timeline: Timeline; words: TimedToken[]; report: PlanReport } => {
  const warnings: string[] = [];
  let tokens: TimedToken[];
  let alignScore: number | null = null;
  let unmatched: string[] = [];
  let trailing: Marker[] = [];
  let hasHookSection = false;

  if (scriptSrc && scriptSrc.trim()) {
    const parsed = parseScript(scriptSrc);
    warnings.push(...parsed.warnings);
    trailing = parsed.trailing;
    hasHookSection = parsed.hasHookSection && parsed.tokens.some((t) => t.section === 'hook');
    const res = align(parsed.tokens, prep.words);
    tokens = res.words;
    alignScore = res.score;
    unmatched = res.unmatchedTranscript;
    if (res.score < 0.85) {
      warnings.push(`script matches only ${(res.score * 100).toFixed(0)}% of the spoken words – is script.md for this audio?`);
    }
  } else tokens = tokensFromWords(prep.words);
  if (!tokens.length) throw new Error('No words found.');
  markHook(tokens, prep, hasHookSection, s);

  const rng = createRng(hashString(name) ^ s.seed);
  const drafts = paginate(tokens, s);
  const pages: PlanPage[] = drafts.map((pg, i) => {
    const prevLast = drafts[i - 1]?.words.at(-1);
    return { ...pg, info: findKey(pg, s, !prevLast || isSentenceEnd(prevLast.text)) };
  });

  const voiceEndMs = tokens[tokens.length - 1].endMs;
  const { beats, durationMs } = planBeats({
    pages,
    images: prep.images.map((i) => ({ name: i.name, src: i.src })),
    trailing,
    settings: s,
    rng,
    voiceEndMs,
    warnings,
  });

  // page styles: embedded beats always stack; overlay pages get stacked by emphasis ratio
  const beatOf = (pg: PlanPage) => beats.find((b) => pg.startMs >= b.startMs - 1 && pg.startMs < b.endMs) ?? beats[beats.length - 1];
  const overlay = pages.map((pg) => beatOf(pg).captions === 'overlay');
  const emphasis =
    s.captions.style === 'stack'
      ? overlay
      : s.captions.style === 'inline'
        ? overlay.map(() => false)
        : pickEmphasis(
            pages.map((p) => p.info),
            overlay,
            s.captions.emphasisRatio,
          );

  const outPages: TPage[] = pages.map((pg, i) => {
    const style = !overlay[i] || emphasis[i] ? 'stack' : 'inline';
    const roles = assignRoles(pg, pg.info, style, s);
    return {
      id: i,
      startMs: Math.round(pg.startMs),
      endMs: Math.round(pg.endMs),
      style,
      keyStyle: keyStyleFor(pg.info, roles, s),
      hook: pg.hook,
      words: pg.words.map((w, k) => ({
        text: w.text,
        startMs: Math.round(w.startMs),
        endMs: Math.round(w.endMs),
        role: roles[k],
        sentenceEnd: isSentenceEnd(w.text),
      })),
    };
  });

  // speech regions for music ducking
  const speech: [number, number][] = [];
  for (const w of tokens) {
    const last = speech[speech.length - 1];
    if (last && w.startMs - last[1] < 350) last[1] = w.endMs;
    else speech.push([w.startMs, w.endMs]);
  }

  const timeline: Timeline = timelineSchema.parse({
    version: 1,
    name,
    durationMs,
    voice: prep.voice,
    music: prep.music ?? undefined,
    speech,
    pages: outPages,
    beats,
    sfx: planSfx(beats, outPages, s),
  });

  const counts: Record<string, number> = {};
  for (const b of beats) counts[b.kind] = (counts[b.kind] ?? 0) + 1;
  return {
    timeline,
    words: tokens,
    report: {
      alignScore,
      unmatched,
      warnings,
      beats: counts,
      pages: outPages.length,
      stackPages: outPages.filter((p) => p.style === 'stack').length,
    },
  };
};

export const plan = (p: ReelPaths, s: Settings) => {
  if (!fs.existsSync(p.prep)) throw new Error(`Run "reel prep ${p.name}" first.`);
  const prep = readJson<Prep>(p.prep);
  const script = fs.existsSync(p.script) ? fs.readFileSync(p.script, 'utf8') : null;
  const res = buildTimeline(p.name, prep, script, s);
  writeJson(p.timeline, res.timeline);
  writeJson(p.words, res.words);
  return res;
};
