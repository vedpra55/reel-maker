import { describe, expect, it } from 'vitest';
import { buildCues, displayText } from '../shared/captions';
import { EXAMPLE_SCRIPT } from '../pipeline/example';
import { applyReplacements, buildTimeline, resolveImage } from '../pipeline/plan';
import { toFinal, toOriginal, type Prep, type PrepPiece } from '../pipeline/prep';
import { generateScript, parseScript, parseTime } from '../pipeline/script';
import { resolveSettings } from '../pipeline/settings';
import { applyCutMap, cleanWords, computeCutMap, mapTime, normaliseWords, unmapTime } from '../pipeline/words';
import { distribute, speechIn, timeTextBlocks, wordWeight } from '../pipeline/textwords';
import { isGeneratedTimeline, parseUserTimeline } from '../pipeline/usertimeline';

const S = resolveSettings();

/** fake transcript: one word every 320 ms, longer gaps after punctuation */
const fakeWords = (text: string, t0 = 0) => {
  let t = t0;
  return text.split(/\s+/).filter(Boolean).map((w) => {
    const start = t;
    const end = t + 260;
    t = end + (/[.!?]$/.test(w) ? 500 : /,$/.test(w) ? 250 : 60);
    return { text: w, startMs: start, endMs: end, confidence: 0.9, section: 'body' as const };
  });
};

const identity = (durationMs: number): PrepPiece[] => [
  { name: 'voice', offsetMs: 0, durationMs, originalMs: durationMs, cutMap: { keep: [[0, durationMs]] } },
];

const prepFor = (text: string, images: string[], pieces?: PrepPiece[]): Prep => {
  const words = fakeWords(text);
  const dur = words[words.length - 1].endMs + 300;
  return {
    version: 2,
    voice: { src: 'voice.wav', durationMs: dur },
    pieces: pieces ?? identity(dur),
    words,
    ownCaptions: false,
    silences: [],
    images: images.map((n) => ({ name: n, src: `images/${n}.jpg`, w: 1080, h: 1920 })),
    music: null,
    stats: { inputLufs: -20, removedMs: 0, whisper: false },
  };
};

const TEXT =
  'Nobody watches past the first second. So we rebuilt our whole process from the ground up. ' +
  'We cut every video down to the one idea that matters. The secret was not a bigger budget.';

describe('script.md', () => {
  it('reads times in several formats', () => {
    expect(parseTime('0:03.5')).toBe(3500);
    expect(parseTime('3.5')).toBe(3500);
    expect(parseTime('[1:02]')).toBe(62000);
    expect(parseTime('1:00:01')).toBe(3601000);
    expect(parseTime('abc')).toBeNull();
  });

  it('parses image lines with options in any order', () => {
    const { lines, warnings } = parseScript(`# comment
<!-- also a comment -->
0:00    1st
- 0:03.5  2nd.png   zoom-out  push
[0:07]  "my photo"  focus=top bw
hook 0:01  4th  transition=whip  motion=tilt
0:10-0:14  5th
oops no time
0:12  6th  sparkle`);
    expect(lines.map((l) => l.image)).toEqual(['1st', '2nd.png', 'my photo', '4th', '5th', '6th']);
    expect(lines[1]).toMatchObject({ timeMs: 3500, motion: 'zoom-out', transition: 'push' });
    expect(lines[2]).toMatchObject({ focus: 'top', treatment: 'bw' });
    expect(lines[3]).toMatchObject({ piece: 'hook', timeMs: 1000, transition: 'whip', motion: 'tilt' });
    expect(lines[4]).toMatchObject({ timeMs: 10000, endMs: 14000 });
    expect(warnings.some((w) => w.includes('no time'))).toBe(true);
    expect(warnings.some((w) => w.includes('sparkle'))).toBe(true);
  });

  it('the image name is always the first word, even if it looks like an option', () => {
    expect(parseScript('0:00 zoom push').lines[0]).toMatchObject({ image: 'zoom', transition: 'push' });
  });

  it('generates a draft that parses back', () => {
    const words = fakeWords(TEXT);
    const md = generateScript(words, ['a', 'b', 'c'], words[words.length - 1].endMs, (ms) => ({ piece: 'voice', ms }));
    const { lines } = parseScript(md);
    expect(lines.map((l) => l.image)).toEqual(['a', 'b', 'c']);
    expect(lines[0].timeMs).toBe(0);
    expect(lines[1].timeMs).toBeGreaterThan(0);
    expect(lines[2].timeMs).toBeGreaterThan(lines[1].timeMs);
  });
});

describe('time mapping', () => {
  it('maps original times through pause tightening and back', () => {
    const map = computeCutMap(10000, [[0, 500], [3000, 5000], [9000, 10000]], { maxPauseMs: 450, keepPauseMs: 300 });
    expect(map.keep[0][0]).toBe(440);
    expect(mapTime(440, map)).toBe(0);
    expect(mapTime(4000, map)).toBe(mapTime(3150, map)); // inside a removed gap → the cut
    for (const t of [440, 1000, 3100, 5200, 8000]) expect(unmapTime(mapTime(t, map), map)).toBeCloseTo(t, 5);
    const w = applyCutMap([{ text: 'x', startMs: 5000, endMs: 5200, confidence: 1 }], map);
    expect(w[0].startMs).toBe(3150 - 440 + 150);
  });

  it('hook and voice pieces', () => {
    const pieces: PrepPiece[] = [
      { name: 'hook', offsetMs: 0, durationMs: 2000, originalMs: 2000, cutMap: { keep: [[0, 2000]] } },
      { name: 'voice', offsetMs: 2150, durationMs: 9000, originalMs: 10000, cutMap: { keep: [[0, 4000], [5000, 10000]] } },
    ];
    expect(toFinal('voice', 0, pieces)).toBe(2150);
    expect(toFinal('voice', 6000, pieces)).toBe(2150 + 5000);
    expect(toFinal('hook', 1000, pieces)).toBe(1000);
    expect(toOriginal(7150, pieces)).toEqual({ piece: 'voice', ms: 6000 });
    expect(toOriginal(500, pieces)).toEqual({ piece: 'hook', ms: 500 });
  });
});

describe('words & captions', () => {
  it('normalises whisper-style tokens', () => {
    const w = cleanWords([
      { text: ' Hello', startMs: 0, endMs: 200, confidence: 1 },
      { text: ',', startMs: 200, endMs: 210, confidence: 1 },
      { text: ' wor', startMs: 300, endMs: 400, confidence: 1 },
      { text: 'ld', startMs: 400, endMs: 500, confidence: 1 },
      { text: ' [BLANK_AUDIO]', startMs: 600, endMs: 900, confidence: 1 },
    ]);
    expect(w.map((x) => x.text)).toEqual(['Hello,', 'world']);
    expect(normaliseWords({ segments: [{ words: [{ word: 'hi', start: 1.5, end: 1.8 }] }] })[0]).toMatchObject({ startMs: 1500, endMs: 1800 });
  });

  it('word mode: one cue per word, held through short pauses', () => {
    const words = fakeWords('one two. three');
    const cues = buildCues(words, S.captions);
    expect(cues).toHaveLength(3);
    expect(cues[0].endMs).toBe(cues[1].startMs); // 60 ms gap → held
    expect(cues[0].startMs).toBe(0);
  });

  it('phrase mode: groups of up to maxWords, broken at sentence ends', () => {
    const s = resolveSettings({ captions: { mode: 'phrase', maxWords: 3 } }).captions;
    const cues = buildCues(fakeWords('a b c d e. f g'), s);
    expect(cues.map((c) => c.words.map((w) => w.text).join(' '))).toEqual(['a b c', 'd e.', 'f g']);
  });

  it('display text drops punctuation unless asked', () => {
    expect(displayText('budget.', S.captions)).toBe('budget');
    expect(displayText('$15,000,', S.captions)).toBe('$15,000');
    expect(displayText("don't", S.captions)).toBe("don't");
    expect(displayText('92%.', S.captions)).toBe('92%');
    expect(displayText('budget.', { ...S.captions, punctuation: true, uppercase: true })).toBe('BUDGET.');
  });

  it('spelling fixes are whole-word and case-insensitive', () => {
    const w = applyReplacements(fakeWords('anyesh said anyeshly, Anyesh.'), { anyesh: 'Anyash' });
    expect(w.map((x) => x.text)).toEqual(['Anyash', 'said', 'anyeshly,', 'Anyash.']);
  });
});

describe('timeline', () => {
  const imgs = ['01-studio', '02-desk', '03-city', '04-street', '05-room', '06-light'];

  it('follows script.md: images, times, options; covers the reel with no gaps', () => {
    const script = '0:00 01\n0:02.0 02-desk zoom-out\n0:04 03 whip focus=top\n';
    const { timeline, report } = buildTimeline('t', prepFor(TEXT, imgs), script, S);
    const sh = timeline.shots;
    expect(sh.map((x) => x.src)).toEqual(['images/01-studio.jpg', 'images/02-desk.jpg', 'images/03-city.jpg']);
    expect(sh[0].startMs).toBe(0);
    expect(sh[0].transition).toBe('cut');
    expect(sh[1].motion).toBe('zoom-out');
    expect(sh[2]).toMatchObject({ transition: 'whip', focus: 'top' });
    for (let i = 1; i < sh.length; i++) expect(sh[i].startMs).toBe(sh[i - 1].endMs);
    expect(sh[sh.length - 1].endMs).toBe(timeline.durationMs);
    expect(report.unusedImages).toEqual(['04-street', '05-room', '06-light']);
    expect(report.auto).toBe(false);
  });

  it('snaps cuts onto a nearby word start', () => {
    const prep = prepFor(TEXT, imgs);
    const word = prep.words[5].startMs;
    const { timeline } = buildTimeline('t', prep, `0:00 01\n${((word + 90) / 1000).toFixed(3)} 02`, S);
    expect(timeline.shots[1].startMs).toBe(word);
  });

  it('maps script times through removed pauses', () => {
    const prep = prepFor(TEXT, imgs);
    // pretend 1 s of silence was removed at 2–3 s of the original recording
    prep.pieces = [{ name: 'voice', offsetMs: 0, durationMs: 9000, originalMs: 10000, cutMap: { keep: [[0, 2000], [3000, 10000]] } }];
    const s = resolveSettings({ images: { snapToWordMs: 0 } });
    const { timeline } = buildTimeline('t', prep, '0:00 01\n0:05 02', s);
    expect(timeline.shots[1].startMs).toBe(4000);
  });

  it('spreads images automatically when script.md has no image lines', () => {
    const { timeline, report } = buildTimeline('t', prepFor(TEXT, ['a', 'b', 'c']), null, S);
    expect(report.auto).toBe(true);
    expect(timeline.shots.map((x) => x.src)).toEqual(['images/a.jpg', 'images/b.jpg', 'images/c.jpg']);
  });

  it('warns about unknown images and keeps going', () => {
    const { timeline, report } = buildTimeline('t', prepFor(TEXT, imgs), '0:00 01\n0:02 nope\n0:04 02', S);
    expect(timeline.shots).toHaveLength(2);
    expect(report.warnings.some((w) => w.includes('"nope"'))).toBe(true);
  });

  it('is deterministic; motions and transitions never repeat back to back', () => {
    const prep = prepFor(TEXT, imgs);
    const script = imgs.map((n, i) => `0:0${i * 1.5} ${n}`).join('\n');
    const a = buildTimeline('t', prep, script, S);
    const b = buildTimeline('t', prep, script, S);
    expect(JSON.stringify(a.timeline)).toBe(JSON.stringify(b.timeline));
    const sh = a.timeline.shots;
    for (let i = 1; i < sh.length; i++) {
      expect(sh[i].motion).not.toBe(sh[i - 1].motion);
      if (sh[i].transition !== 'cut') expect(sh[i].transition).not.toBe(sh[i - 1].transition);
    }
  });

  it('the example reel plans cleanly', () => {
    const { timeline, report } = buildTimeline('example', prepFor(TEXT + ' ' + TEXT + ' ' + TEXT, imgs), EXAMPLE_SCRIPT, S);
    expect(report.warnings).toEqual([]);
    expect(timeline.shots.length).toBe(7);
  });

  it('whooshes only when asked', () => {
    const prep = prepFor(TEXT, imgs);
    const script = '0:00 01\n0:03 02 push\n0:06 03 push';
    expect(buildTimeline('t', prep, script, S).timeline.sfx).toEqual([]);
    const on = resolveSettings({ audio: { whoosh: true } });
    expect(buildTimeline('t', prep, script, on).timeline.sfx.length).toBe(2);
  });

  it('settings: project config < reel.json < CLI', () => {
    const p = resolveSettings({ whisper: { model: 'base.en' } }, { seed: 4 }, { whisper: { model: 'tiny.en' }, look: { brandLine: '@x' } });
    expect(p.whisper.model).toBe('base.en');
    expect(p.look.brandLine).toBe('@x');
    expect(p.seed).toBe(4);
    expect(resolveSettings().whisper.model).toBe('small.en');
    expect(resolveImage('2nd', [{ name: '2nd', src: 'x' }])).toBeTruthy();
  });
});

describe('captions from your own text (> lines)', () => {
  it('parses > lines onto the image above them', () => {
    const r = parseScript(`> said before any image
0:00 1st zoom-in
> Last weeks mein baby kam move karta hai?
> Yeh bilkul galat hai.
0:07.5 2nd
# a comment
0:10 3rd
> ab woh rolling`);
    expect(r.hasText).toBe(true);
    expect(r.lines[0].text).toBe('said before any image Last weeks mein baby kam move karta hai? Yeh bilkul galat hai.');
    expect(r.lines[1].text).toBeUndefined();
    expect(r.lines[2].text).toBe('ab woh rolling');
  });

  it('weights long words more than short ones', () => {
    expect(wordWeight('mehsoos')).toBeGreaterThan(wordWeight('ka'));
    expect(wordWeight('15000')).toBeGreaterThan(wordWeight('ek'));
  });

  it('finds speaking stretches between silences', () => {
    expect(speechIn(0, 5000, [[1000, 1500], [3000, 3200]])).toEqual([[0, 1000], [1500, 3000], [3200, 5000]]);
  });

  it('puts sentence breaks on the real pauses', () => {
    // two sentences, a pause from 2000 to 2600
    const words = distribute('Yeh bilkul galat hai. Delivery paas aane par'.split(' '), [[0, 2000], [2600, 4600]]);
    expect(words).toHaveLength(8);
    expect(words[3].endMs).toBe(2000); // "hai." ends where the pause starts
    expect(words[4].startMs).toBe(2600); // "Delivery" starts where it ends
    for (let i = 1; i < words.length; i++) expect(words[i].startMs).toBeGreaterThanOrEqual(words[i - 1].endMs);
  });

  it('moves block boundaries onto the nearest pause', () => {
    // the image time says 3.0 s, the speaker actually pauses 3.3–3.6 s
    const w = timeTextBlocks(
      [
        { startMs: 0, endMs: 3000, text: 'pehli line yahan' },
        { startMs: 3000, endMs: 6000, text: 'doosri line' },
      ],
      [[3300, 3600]],
    );
    expect(w.find((x) => x.text === 'doosri')!.startMs).toBe(3600);
    expect(w.find((x) => x.text === 'yahan')!.endMs).toBe(3300);
  });

  it('plan uses the script text instead of the transcript', () => {
    const prep = prepFor(TEXT, ['1st', '2nd']);
    prep.silences = [[2500, 3000]];
    const { timeline, report } = buildTimeline('t', prep, '0:00 1st\n> Pehle jo kicks\n0:03 2nd\n> mehsoos hoti thi', S);
    expect(report.captionSource).toBe('script');
    expect(timeline.words.map((w) => w.text)).toEqual(['Pehle', 'jo', 'kicks', 'mehsoos', 'hoti', 'thi']);
    expect(timeline.words[3].startMs).toBe(3000);
  });
});

describe('timeline.json as input', () => {
  it('reads shots with seconds, m:ss strings and ms; options; text', () => {
    const r = parseUserTimeline({
      shots: [
        { time: '0:00', image: '1st', motion: 'zoom-in', focus: 'center', text: 'Last weeks mein' },
        { time: 7.5, image: 'images/2nd.png', transition: 'crossfade', text: ['Pehle jo', 'kicks'] },
        { startMs: 10000, image: '3rd', motion: 'sparkle' },
        { image: 'no-time' },
        { time: 12, hook: true, image: '4th' },
      ],
    });
    expect(r.lines.map((l) => [l.timeMs, l.image])).toEqual([[0, '1st'], [7500, '2nd.png'], [10000, '3rd'], [12000, '4th']]);
    expect(r.lines[0]).toMatchObject({ motion: 'zoom-in', focus: 'center', text: 'Last weeks mein' });
    expect(r.lines[1]).toMatchObject({ transition: 'crossfade', text: 'Pehle jo kicks' });
    expect(r.lines[3].piece).toBe('hook');
    expect(r.hasText).toBe(true);
    expect(r.warnings.some((w) => w.includes('sparkle'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('no "time"'))).toBe(true);
  });

  it('accepts a bare array and explicit word timings', () => {
    const r = parseUserTimeline([{ time: 0, image: 'a' }]);
    expect(r.lines).toHaveLength(1);
    const w = parseUserTimeline({ shots: [{ time: 0, image: 'a' }], words: [{ text: 'Hi', start: 0.5, end: 0.8 }, { word: 'there', startMs: 900 }] });
    expect(w.words).toEqual([
      { text: 'Hi', startMs: 500, endMs: 800, piece: 'voice' },
      { text: 'there', startMs: 900, endMs: 1200, piece: 'voice' },
    ]);
  });

  it('recognises the old auto-generated file', () => {
    expect(isGeneratedTimeline({ version: 2, voice: {}, speech: [], shots: [] })).toBe(true);
    expect(isGeneratedTimeline({ shots: [] })).toBe(false);
  });

  it('plans from timeline.json: text captions, word captions, voice-clock times', () => {
    const prep = prepFor(TEXT, ['1st', '2nd', '3rd']);
    prep.pieces = [{ name: 'voice', offsetMs: 0, durationMs: 9000, originalMs: 10000, cutMap: { keep: [[0, 2000], [3000, 10000]] } }];
    const s = resolveSettings({ images: { snapToWordMs: 0 } });
    const a = buildTimeline('t', prep, null, s, { shots: [{ time: 0, image: '1st', text: 'Pehle jo' }, { time: 5, image: '2nd', motion: 'tilt', text: 'kicks thi' }] });
    expect(a.report.input).toBe('timeline.json');
    expect(a.report.captionSource).toBe('script');
    expect(a.timeline.shots[1]).toMatchObject({ startMs: 4000, motion: 'tilt', src: 'images/2nd.jpg' });
    expect(a.timeline.words.map((w) => w.text)).toEqual(['Pehle', 'jo', 'kicks', 'thi']);
    const b = buildTimeline('t', prep, null, s, { shots: [{ time: 0, image: '1st' }], words: [{ text: 'Hi', start: 5, end: 5.4 }] });
    expect(b.report.captionSource).toBe('words');
    expect(b.timeline.words).toEqual([{ text: 'Hi', startMs: 4000, endMs: 4400 }]);
  });
});
