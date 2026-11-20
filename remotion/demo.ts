import { settingsSchema, type Timeline, type TWord } from '../shared/schema';

/** A tiny media-free timeline so Studio opens even before any reel is prepared. */
const w = (text: string, startMs: number, endMs: number, role: TWord['role']): TWord => ({
  text,
  startMs,
  endMs,
  role,
  sentenceEnd: /[.!?]$/.test(text),
});

export const demoTimeline: Timeline = {
  version: 1,
  name: 'demo',
  durationMs: 9000,
  voice: { src: '', durationMs: 7000 },
  speech: [[0, 7000]],
  pages: [
    { id: 0, startMs: 0, endMs: 1600, style: 'stack', keyStyle: 'color', hook: true, words: [w('was', 100, 400, 'lead'), w('I', 400, 600, 'lead'), w('started', 650, 1400, 'key')] },
    { id: 1, startMs: 1600, endMs: 3300, style: 'stack', keyStyle: 'color', hook: false, words: [w('central', 1650, 2100, 'lead'), w('London', 2100, 2700, 'key'), w('practice.', 2700, 3200, 'closer')] },
    { id: 2, startMs: 3300, endMs: 5200, style: 'stack', keyStyle: 'bar', hook: false, words: [w('cross', 3350, 3700, 'lead'), w('10K', 3750, 4400, 'key'), w('followers', 4400, 4800, 'tail'), w('mark,', 4800, 5100, 'tail')] },
    { id: 3, startMs: 5200, endMs: 7000, style: 'stack', keyStyle: 'bar', hook: false, words: [w('in', 5250, 5400, 'lead'), w('its', 5400, 5550, 'lead'), w('whole', 5550, 5800, 'lead'), w('$15,000', 5800, 6400, 'key'), w('journey.', 6400, 6900, 'closer')] },
  ],
  beats: [
    { id: 0, kind: 'hook', startMs: 0, endMs: 1600, transition: 'cut', bg: 'brand', captions: 'embedded' },
    { id: 1, kind: 'text', startMs: 1600, endMs: 3300, transition: 'wipe', bg: 'dark', captions: 'embedded' },
    {
      id: 2,
      kind: 'stat',
      startMs: 3300,
      endMs: 5200,
      transition: 'slide',
      bg: 'paper',
      captions: 'embedded',
      stat: { raw: '10K', prefix: '', value: 10, decimals: 0, suffix: 'K', grouping: false },
    },
    { id: 3, kind: 'text', startMs: 5200, endMs: 7000, transition: 'zoom-punch', bg: 'paper', captions: 'embedded' },
    { id: 4, kind: 'end', startMs: 7000, endMs: 9000, transition: 'slide', captions: 'embedded' },
  ],
  sfx: [],
};

export const demoSettings = settingsSchema.parse({});
