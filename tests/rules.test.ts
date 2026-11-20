import { describe, expect, it } from 'vitest';
import { align } from '../pipeline/align';
import { buildTimeline } from '../pipeline/plan';
import type { Prep } from '../pipeline/prep';
import { paginate } from '../pipeline/phrases';
import { generateScript, parseScript } from '../pipeline/script';
import { resolveSettings } from '../pipeline/settings';
import { canonical, parseStat, wordsToNumber } from '../pipeline/util/text';
import { applyCutMap, cleanWords, computeCutMap, mapTime, normaliseWords } from '../pipeline/words';
import { EXAMPLE_SCRIPT } from '../pipeline/example';

const S = resolveSettings();

/** fake transcript: one word every 320 ms, longer gaps after punctuation */
const fakeWords = (text: string, section: 'hook' | 'body' = 'body', t0 = 0) => {
  let t = t0;
  return text.split(/\s+/).filter(Boolean).map((w) => {
    const start = t;
    const end = t + 260;
    t = end + (/[.!?]$/.test(w) ? 500 : /,$/.test(w) ? 250 : 60);
    return { text: w, startMs: start, endMs: end, confidence: 0.9, section };
  });
};

describe('numbers', () => {
  it('reads spoken numbers', () => {
    expect(wordsToNumber(['fifteen', 'thousand'])).toBe(15000);
    expect(wordsToNumber(['two', 'hundred', 'and', 'forty'])).toBe(240);
    expect(wordsToNumber(['hello'])).toBeNull();
  });
  it('canonicalises currency and percent', () => {
    expect(canonical(['$15,000'])).toBe(canonical(['fifteen', 'thousand', 'dollars']));
    expect(canonical(['92%'])).toBe(canonical(['ninety', 'two', 'percent']));
    expect(canonical(['10K'])).toBe('10000');
    expect(canonical(['pound', 'smile'])).toBe('poundsmile'); // currency words only drop next to numbers
  });
  it('parses stats', () => {
    expect(parseStat('$15,000')).toMatchObject({ prefix: '$', value: 15000, suffix: '', grouping: true });
    expect(parseStat('10K')).toMatchObject({ value: 10, suffix: 'K' });
    expect(parseStat('92%,')).toMatchObject({ value: 92, suffix: '%' });
    expect(parseStat('2.5x')).toMatchObject({ value: 2.5, decimals: 1, suffix: 'x' });
    expect(parseStat('hello')).toBeNull();
  });
});

describe('script.md', () => {
  it('parses sections, emphasis, markers and breaks', () => {
    const s = parseScript('# hook\nA *Rewrite Saturday* plan.\n# body\n[img 02 split bw focus=top] The _whole journey._ | Done. [end]');
    expect(s.hasHookSection).toBe(true);
    const t = s.tokens;
    expect(t.map((x) => x.text)).toEqual(['A', 'Rewrite', 'Saturday', 'plan.', 'The', 'whole', 'journey.', 'Done.']);
    expect(t[1].forceKey && t[2].forceKey && !t[3].forceKey).toBe(true);
    expect(t[5].forceCloser && t[6].forceCloser).toBe(true);
    expect(t[4].marker).toEqual({ kind: 'img', image: '02', split: true, treatment: 'bw', focus: 'top' });
    expect(t[7].breakBefore).toBe(true);
    expect(s.trailing).toEqual([{ kind: 'end' }]);
    expect(t[0].section).toBe('hook');
    expect(t[4].section).toBe('body');
  });
  it('generates a script that round-trips', () => {
    const words = fakeWords('Hello there. This is a test. Another line here.');
    const md = generateScript(words, ['01-a', '02-b'], { hasHookAudio: false });
    const parsed = parseScript(md);
    expect(parsed.tokens.map((t) => t.text).join(' ')).toBe('Hello there. This is a test. Another line here.');
    expect(parsed.tokens.filter((t) => t.marker).length).toBe(2);
    expect(parsed.tokens[0].section).toBe('hook');
  });
});

describe('alignment', () => {
  it('keeps script spelling and transcript timing', () => {
    const script = parseScript('Our whole *$15,000* journey started in Central London.').tokens;
    const heard = fakeWords('our whole fifteen thousand dollar journey started in central london');
    const r = align(script, heard);
    expect(r.score).toBe(1);
    const money = r.words[2];
    expect(money.text).toBe('$15,000');
    expect(money.startMs).toBe(heard[2].startMs);
    expect(money.endMs).toBe(heard[4].endMs);
    expect(r.words[r.words.length - 1].text).toBe('London.');
  });
  it('interpolates words the speaker skipped and reports extra ones', () => {
    const script = parseScript('one two three four five').tokens;
    const heard = fakeWords('one two um four five');
    const r = align(script, heard);
    expect(r.words.map((w) => w.text)).toEqual(['one', 'two', 'three', 'four', 'five']);
    for (let i = 1; i < r.words.length; i++) expect(r.words[i].startMs).toBeGreaterThanOrEqual(r.words[i - 1].startMs);
  });
});

describe('words', () => {
  it('normalises whisper-style tokens', () => {
    const w = cleanWords([
      { text: ' Hello', startMs: 0, endMs: 200, confidence: 1 },
      { text: ',', startMs: 200, endMs: 210, confidence: 1 },
      { text: ' wor', startMs: 300, endMs: 400, confidence: 1 },
      { text: 'ld', startMs: 400, endMs: 500, confidence: 1 },
      { text: ' [BLANK_AUDIO]', startMs: 600, endMs: 900, confidence: 1 },
    ]);
    expect(w.map((x) => x.text)).toEqual(['Hello,', 'world']);
  });
  it('accepts seconds-based transcripts', () => {
    const w = normaliseWords({ segments: [{ words: [{ word: 'hi', start: 1.5, end: 1.8 }] }] });
    expect(w[0]).toMatchObject({ text: 'hi', startMs: 1500, endMs: 1800 });
  });
  it('tightens pauses and maps times through the cut', () => {
    const map = computeCutMap(10000, [[0, 500], [3000, 5000], [9000, 10000]], { maxPauseMs: 450, keepPauseMs: 300 });
    // lead silence trimmed to 60 ms, 2 s pause → 300 ms, tail kept 250 ms
    expect(map.keep[0][0]).toBe(440);
    expect(mapTime(440, map)).toBe(0);
    expect(mapTime(4000, map)).toBe(mapTime(3150, map)); // inside the removed gap snaps to the cut
    const words = applyCutMap([{ text: 'x', startMs: 5000, endMs: 5200, confidence: 1 }], map);
    expect(words[0].startMs).toBe(3150 - 440 + 150);
  });
});

describe('pages', () => {
  it('breaks on punctuation and max words, never splits marked spans', () => {
    const toks = align(parseScript('So this is how we did it, and the _whole journey_ took six weeks.').tokens, fakeWords('so this is how we did it and the whole journey took six weeks')).words;
    const pages = paginate(toks, S).map((p) => p.words.map((w) => w.text).join(' '));
    for (const p of pages) expect(p.split(' ').length).toBeLessThanOrEqual(S.captions.maxWords + 2);
    expect(pages.some((p) => p.includes('whole journey'))).toBe(true);
    expect(pages.some((p) => p.endsWith('it,'))).toBe(true);
  });
});

describe('timeline', () => {
  const prepFor = (script: string, images: string[]): Prep => {
    const parsed = parseScript(script);
    const words = fakeWords(parsed.tokens.map((t) => t.text).join(' '));
    words.forEach((w, i) => (w.section = parsed.tokens[i].section));
    return {
      version: 1,
      voice: { src: 'voice.wav', durationMs: words[words.length - 1].endMs + 300 },
      hookEndMs: null,
      words,
      silences: [],
      images: images.map((n) => ({ name: n, src: `images/${n}.jpg`, w: 1080, h: 1920 })),
      music: null,
      stats: { inputLufs: -20, removedMs: 0, whisper: false },
    };
  };

  it('is deterministic and covers the whole reel without gaps', () => {
    const prep = prepFor(EXAMPLE_SCRIPT, ['01-studio', '02-desk', '03-city', '04-street']);
    const a = buildTimeline('t', prep, EXAMPLE_SCRIPT, S);
    const b = buildTimeline('t', prep, EXAMPLE_SCRIPT, S);
    expect(JSON.stringify(a.timeline)).toBe(JSON.stringify(b.timeline));
    const beats = a.timeline.beats;
    expect(beats[0].startMs).toBe(0);
    expect(beats[0].kind).toBe('hook');
    expect(beats[beats.length - 1].kind).toBe('end');
    expect(beats[beats.length - 1].endMs).toBe(a.timeline.durationMs);
    for (let i = 1; i < beats.length; i++) expect(beats[i].startMs).toBe(beats[i - 1].endMs);
    expect(a.report.alignScore).toBe(1);
    expect(a.report.warnings).toEqual([]);
  });

  it('honours markers: stat, split, text', () => {
    const prep = prepFor(EXAMPLE_SCRIPT, ['01-studio', '02-desk', '03-city', '04-street']);
    const { timeline } = buildTimeline('t', prep, EXAMPLE_SCRIPT, S);
    const kinds = timeline.beats.map((b) => b.kind);
    expect(kinds).toContain('stat');
    expect(kinds).toContain('split');
    expect(kinds).toContain('text');
    const stat = timeline.beats.find((b) => b.kind === 'stat')!;
    expect(stat.stat?.raw).toBe('10K');
  });

  it('no layout runs: no motion repeats three times in a row', () => {
    const prep = prepFor(EXAMPLE_SCRIPT, ['01-studio', '02-desk', '03-city', '04-street']);
    const { timeline } = buildTimeline('t', prep, EXAMPLE_SCRIPT, S);
    const motions = timeline.beats.filter((b) => b.image).map((b) => b.image!.motion);
    for (let i = 2; i < motions.length; i++) expect(motions[i] === motions[i - 1] && motions[i] === motions[i - 2]).toBe(false);
  });

  it('spreads images automatically when there are no markers', () => {
    const script = '# hook\nThis is the hook line.\n# body\nFirst sentence is here. Second one follows now. Third comes after that. Fourth wraps it up. Fifth is the end.';
    const prep = prepFor(script, ['a', 'b', 'c']);
    const { timeline } = buildTimeline('t', prep, script, S);
    const used = new Set(timeline.beats.filter((b) => b.image).map((b) => b.image!.src));
    expect(used.size).toBe(3);
    expect(timeline.beats[0].image).toBeTruthy(); // hook gets the first image in pure-auto mode
  });

  it('keeps sfx sparse', () => {
    const prep = prepFor(EXAMPLE_SCRIPT, ['01-studio', '02-desk', '03-city', '04-street']);
    const { timeline } = buildTimeline('t', prep, EXAMPLE_SCRIPT, S);
    const whooshes = timeline.sfx.filter((x) => x.kind === 'whoosh').map((x) => x.atMs);
    for (let i = 1; i < whooshes.length; i++) expect(whooshes[i] - whooshes[i - 1]).toBeGreaterThanOrEqual(1200);
  });

  it('settings: presets + overrides resolve', () => {
    const s = resolveSettings({ preset: 'anyash-dark', captions: { y: 0.5 } }, { intensity: 0.9 });
    expect(s.look.surface).toBe('dark');
    expect(s.captions.y).toBe(0.5);
    expect(s.captions.maxWords).toBe(4);
    expect(s.intensity).toBe(0.9);
    expect(() => resolveSettings({ preset: 'nope' })).toThrow(/Unknown preset/);
    // project config < reel.json < CLI
    const p = resolveSettings({ whisper: { model: 'base.en' } }, {}, { whisper: { model: 'tiny.en' }, look: { brandLine: '@x' } });
    expect(p.whisper.model).toBe('base.en');
    expect(p.look.brandLine).toBe('@x');
    expect(resolveSettings().whisper.model).toBe('small.en');
  });
});
