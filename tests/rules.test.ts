import { describe, expect, it } from 'vitest';
import { buildCues, displayText } from '../shared/captions';
import { convertScriptMd, isGeneratedTimeline, parseInput, parseTime, starterTimeline } from '../pipeline/input';
import { applyReplacements, buildTimeline, resolveImage } from '../pipeline/plan';
import { toFinal, toOriginal, type Prep, type PrepPiece } from '../pipeline/prep';
import { resolveSettings } from '../pipeline/settings';
import { distribute, speechIn, timeTextBlocks, wordWeight } from '../pipeline/textwords';
import { computeCutMap, mapTime, unmapTime } from '../pipeline/words';

const S = resolveSettings();
const IMGS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

const voiceOnly = (ms: number): PrepPiece[] => [{ name: 'voice', offsetMs: 0, durationMs: ms, originalMs: ms, cutMap: { keep: [[0, ms]] } }];

const prepWith = (opts: { pieces?: PrepPiece[]; silences?: [number, number][]; images?: string[]; sfx?: string[]; durationMs?: number } = {}): Prep => {
  const dur = opts.durationMs ?? 20000;
  return {
    version: 3,
    voice: { src: 'voice.wav', durationMs: dur },
    pieces: opts.pieces ?? voiceOnly(dur),
    silences: opts.silences ?? [],
    images: (opts.images ?? IMGS).map((n) => ({ name: n, src: `images/${n}.jpg`, w: 1080, h: 1920 })),
    sfx: opts.sfx ?? [],
    music: null,
    audioKey: '',
    stats: { inputLufs: -20, removedMs: 0 },
  };
};

const plan = (json: unknown, prep = prepWith(), s = S) => buildTimeline('t', prep, parseInput(json), s);

describe('timeline.json', () => {
  it('reads times as seconds, "m:ss.s" or milliseconds', () => {
    expect(parseTime('0:03.5')).toBe(3500);
    expect(parseTime('3.5')).toBe(3500);
    expect(parseTime('1:02')).toBe(62000);
    expect(parseTime('soon')).toBeNull();
    const inp = parseInput({ voice: { shots: [{ time: 7.5, image: 'a' }, { time: '0:09', image: 'b' }, { startMs: 12000, image: 'c' }] } });
    expect(inp.shots.map((x) => x.timeMs)).toEqual([7500, 9000, 12000]);
  });

  it('reads hook and voice sections, options, text and sfx', () => {
    const inp = parseInput({
      hook: { shots: [{ time: '0:00', image: '1st', motion: 'zoom-in', text: ['Last weeks', 'mein'] }] },
      voice: {
        shots: [
          { time: '0:00', image: '2nd', transition: 'push', sfx: 'whoosh', focus: 'top', treatment: 'bw', text: 'Pehle jo' },
          { time: '0:03', image: '3rd', sfx: { name: 'boom.mp3', volume: 0.5 } },
          { time: '0:05', image: '4th', sfx: 'none' },
        ],
        words: [{ text: 'Pehle', start: 0.1, end: 0.4 }],
      },
      settings: { captions: { size: 120 } },
    });
    expect(inp.warnings).toEqual([]);
    expect(inp.shots[0]).toMatchObject({ section: 'hook', label: 'hook shot 1', motion: 'zoom-in', text: 'Last weeks mein' });
    expect(inp.shots[1]).toMatchObject({ section: 'voice', transition: 'push', focus: 'top', treatment: 'bw', sfx: { name: 'whoosh', volume: 1 } });
    expect(inp.shots[2].sfx).toEqual({ name: 'boom.mp3', volume: 0.5 });
    expect(inp.shots[3].sfx).toBe('none');
    expect(inp.words.voice).toEqual([{ section: 'voice', text: 'Pehle', startMs: 100, endMs: 400 }]);
    expect(inp.settings).toEqual({ captions: { size: 120 } });
  });

  it('explains mistakes in plain words', () => {
    const inp = parseInput({
      voice: { shots: [{ time: '0:00', image: '1st', trnsition: 'push' }, { image: '2nd' }, { time: 3, image: '3rd', motion: 'spin' }] },
      extra: 1,
    });
    expect(inp.warnings).toContain('voice shot 1: unknown field "trnsition" (typo?)');
    expect(inp.warnings).toContain('voice shot 2: missing "time" (like "0:03.5") – skipped');
    expect(inp.warnings.some((w) => w.startsWith('voice shot 3: motion "spin" isn\'t one of'))).toBe(true);
    expect(inp.warnings.some((w) => w.includes('unknown top-level field "extra"'))).toBe(true);
  });

  it('still accepts the earlier one-list format', () => {
    const inp = parseInput({ shots: [{ time: 0, image: 'a', hook: true }, { time: 1, image: 'b' }] });
    expect(inp.shots.map((x) => x.section)).toEqual(['hook', 'voice']);
    expect(isGeneratedTimeline({ version: 2, voice: {}, speech: [] })).toBe(true);
    expect(isGeneratedTimeline({ voice: { shots: [] } })).toBe(false);
  });

  it('converts an old script.md once', () => {
    const out = convertScriptMd('# c\nhook 0:00 1st zoom-in\n> Last weeks\n0:00 2nd push focus=top\n> Pehle jo\n> kicks\n0:07.5 3rd bw') as {
      hook: { shots: Record<string, unknown>[] };
      voice: { shots: Record<string, unknown>[] };
    };
    expect(out.hook.shots).toEqual([{ time: '0:00.0', image: '1st', motion: 'zoom-in', text: 'Last weeks' }]);
    expect(out.voice.shots[0]).toEqual({ time: '0:00.0', image: '2nd', transition: 'push', focus: 'top', text: 'Pehle jo kicks' });
    expect(out.voice.shots[1]).toEqual({ time: '0:07.5', image: '3rd', treatment: 'bw' });
  });

  it('writes a starter file with images spread over the audio', () => {
    const st = starterTimeline({ images: ['a', 'b', 'c', 'd'], starts: { hook: [0], voice: [0, 3100, 6050, 9000] }, durations: { hook: 2000, voice: 9500 } }) as {
      hook: { shots: { image: string }[] };
      voice: { shots: { time: string; image: string }[] };
    };
    expect(st.hook.shots.map((x) => x.image)).toEqual(['a']);
    expect(st.voice.shots.map((x) => x.image)).toEqual(['b', 'c', 'd']);
    expect(st.voice.shots.map((x) => x.time)).toEqual(['0:00.0', '0:03.1', '0:06.0']);
  });
});

describe('time mapping (silences removed from the audio)', () => {
  it('maps times through removed pauses and back', () => {
    const map = computeCutMap(10000, [[0, 500], [3000, 5000], [9000, 10000]], { maxPauseMs: 450, keepPauseMs: 300 });
    expect(map.keep[0][0]).toBe(440);
    expect(mapTime(440, map)).toBe(0);
    for (const t of [440, 1000, 3100, 5200, 8000]) expect(unmapTime(mapTime(t, map), map)).toBeCloseTo(t, 5);
  });

  it('hook first, then voice', () => {
    const pieces: PrepPiece[] = [
      { name: 'hook', offsetMs: 0, durationMs: 2000, originalMs: 2000, cutMap: { keep: [[0, 2000]] } },
      { name: 'voice', offsetMs: 2150, durationMs: 9000, originalMs: 10000, cutMap: { keep: [[0, 4000], [5000, 10000]] } },
    ];
    expect(toFinal('voice', 0, pieces)).toBe(2150);
    expect(toFinal('voice', 6000, pieces)).toBe(7150);
    expect(toFinal('hook', 1000, pieces)).toBe(1000);
    expect(toOriginal(7150, pieces)).toEqual({ piece: 'voice', ms: 6000 });
  });
});

describe('captions from your text', () => {
  it('weights long words more than short ones', () => {
    expect(wordWeight('mehsoos')).toBeGreaterThan(wordWeight('ka'));
  });
  it('finds speaking stretches between silences', () => {
    expect(speechIn(0, 5000, [[1000, 1500], [3000, 3200]])).toEqual([[0, 1000], [1500, 3000], [3200, 5000]]);
  });
  it('puts sentence breaks on the real pauses', () => {
    const w = distribute('Yeh bilkul galat hai. Delivery paas aane par'.split(' '), [[0, 2000], [2600, 4600]]);
    expect(w[3].endMs).toBe(2000);
    expect(w[4].startMs).toBe(2600);
  });
  it('moves block boundaries onto the nearest pause', () => {
    const w = timeTextBlocks([{ startMs: 0, endMs: 3000, text: 'pehli line yahan' }, { startMs: 3000, endMs: 6000, text: 'doosri line' }], [[3300, 3600]]);
    expect(w.find((x) => x.text === 'doosri')!.startMs).toBe(3600);
  });
  it('word / phrase cues and display text', () => {
    const words = [
      { text: 'one', startMs: 0, endMs: 200 },
      { text: 'two.', startMs: 260, endMs: 500 },
      { text: 'three', startMs: 600, endMs: 900 },
    ];
    expect(buildCues(words, S.captions)).toHaveLength(3);
    const phrase = resolveSettings({ captions: { mode: 'phrase' } }).captions;
    expect(buildCues(words, phrase).map((c) => c.words.length)).toEqual([2, 1]);
    expect(displayText('budget.', S.captions)).toBe('budget');
    expect(displayText('$15,000,', S.captions)).toBe('$15,000');
  });
  it('spelling fixes', () => {
    expect(applyReplacements([{ text: 'Anyesh.', startMs: 0, endMs: 1 }], { anyesh: 'Anyash' })[0].text).toBe('Anyash.');
  });
});

describe('the plan', () => {
  it('places hook and voice shots on one clock, with text captions', () => {
    const prep = prepWith({
      pieces: [
        { name: 'hook', offsetMs: 0, durationMs: 3000, originalMs: 3000, cutMap: { keep: [[0, 3000]] } },
        { name: 'voice', offsetMs: 3150, durationMs: 10000, originalMs: 10000, cutMap: { keep: [[0, 10000]] } },
      ],
      durationMs: 13150,
      silences: [[2700, 3300]],
    });
    const { timeline, report } = plan(
      {
        hook: { shots: [{ time: 0, image: '1st', text: 'Last weeks mein' }] },
        voice: { shots: [{ time: 0, image: '2nd', text: 'Pehle jo kicks' }, { time: 5, image: '3rd', text: 'ab woh rolling' }] },
      },
      prep,
      resolveSettings({ images: { snapToWordMs: 0 } }),
    );
    expect(timeline.shots.map((x) => [x.startMs, x.src])).toEqual([[0, 'images/1st.jpg'], [3150, 'images/2nd.jpg'], [8150, 'images/3rd.jpg']]);
    expect(report.captions).toEqual({ hook: 'text', voice: 'text' });
    expect(timeline.words.map((w) => w.text)).toEqual(['Last', 'weeks', 'mein', 'Pehle', 'jo', 'kicks', 'ab', 'woh', 'rolling']);
    expect(timeline.words[3].startMs).toBeGreaterThanOrEqual(3150);
    for (let i = 1; i < timeline.shots.length; i++) expect(timeline.shots[i].startMs).toBe(timeline.shots[i - 1].endMs);
  });

  it('uses exact word timings when given', () => {
    const { timeline, report } = plan({ voice: { shots: [{ time: 0, image: '1st', text: 'ignored' }], words: [{ text: 'Hi', start: 1, end: 1.4 }] } });
    expect(report.captions.voice).toBe('words');
    expect(timeline.words).toEqual([{ text: 'Hi', startMs: 1000, endMs: 1400 }]);
  });

  it('maps times through removed silences', () => {
    const prep = prepWith({ pieces: [{ name: 'voice', offsetMs: 0, durationMs: 9000, originalMs: 10000, cutMap: { keep: [[0, 2000], [3000, 10000]] } }] });
    const { timeline } = plan({ voice: { shots: [{ time: 0, image: '1st' }, { time: 5, image: '2nd' }] } }, prep, resolveSettings({ images: { snapToWordMs: 0 } }));
    expect(timeline.shots[1].startMs).toBe(4000);
  });

  it('says what is wrong instead of failing', () => {
    const { timeline, report } = plan({
      hook: { shots: [{ time: 0, image: '1st' }] },
      voice: { shots: [{ time: 0, image: '1st' }, { time: 3, image: '7th' }, { time: 6, image: '2nd', sfx: 'kaboom' }] },
    });
    expect(timeline.shots).toHaveLength(2);
    expect(report.warnings.some((w) => w.startsWith('hook shot 1: there is no hook audio file'))).toBe(true);
    expect(report.warnings.some((w) => w.startsWith('voice shot 2: image "7th" not found – you have 1st'))).toBe(true);
    expect(report.warnings.some((w) => w.startsWith('voice shot 3: sound "kaboom" not found'))).toBe(true);
  });

  it('sound effects: automatic whoosh, chosen ones, your own files, none, volume 0', () => {
    const prep = prepWith({ sfx: ['boom.mp3'] });
    const json = {
      voice: {
        shots: [
          { time: 0, image: '1st', sfx: 'boom' },
          { time: 3, image: '2nd', transition: 'push' },
          { time: 6, image: '3rd', transition: 'zoom', sfx: 'none' },
          { time: 9, image: '4th', transition: 'crossfade' },
          { time: 12, image: '5th', transition: 'crossfade', sfx: { name: 'hit', volume: 0.5 } },
          { time: 15, image: '6th', transition: 'cut', sfx: 'riser' },
        ],
      },
    };
    const { timeline } = plan(json, prep, resolveSettings({ images: { snapToWordMs: 0 } }));
    const fx = timeline.sfx.map((x) => [x.src, x.atMs]);
    expect(fx).toEqual([
      ['sfx-user/boom.mp3', 0],
      ['sfx/whoosh.wav', 3000 - 190 - 60],
      ['sfx/hit.wav', 12000],
      ['sfx/riser.wav', 15000 - 1150],
    ]);
    expect(timeline.sfx.find((x) => x.src === 'sfx/hit.wav')!.volume).toBeCloseTo(S.audio.sfxVolume * 0.5);
    const off = plan(json, prep, resolveSettings({ audio: { sfxVolume: 0 } }));
    expect(off.timeline.sfx).toEqual([]);
  });

  it('is deterministic; automatic motions never repeat back to back', () => {
    const json = { voice: { shots: IMGS.map((n, i) => ({ time: i * 2.5, image: n })) } };
    const a = plan(json);
    expect(JSON.stringify(a.timeline)).toBe(JSON.stringify(plan(json).timeline));
    const sh = a.timeline.shots;
    for (let i = 1; i < sh.length; i++) expect(sh[i].motion).not.toBe(sh[i - 1].motion);
  });

  it('settings: reel.config.json < timeline.json settings < command line', () => {
    const s = resolveSettings({ captions: { size: 120 } }, { seed: 4 }, { captions: { size: 100, mode: 'phrase' }, look: { brandLine: '@x' } });
    expect(s.captions.size).toBe(120);
    expect(s.captions.mode).toBe('phrase');
    expect(s.look.brandLine).toBe('@x');
    expect(s.seed).toBe(4);
    expect(resolveImage('2nd', [{ name: '2nd', src: 'x' }])).toBeTruthy();
  });
});
