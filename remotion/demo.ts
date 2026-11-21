import { settingsSchema, type Timeline, type TShot } from '../shared/schema';

/** A tiny media-free timeline so Studio opens before any reel is prepared (gradients stand in for images). */
const shot = (id: number, startMs: number, endMs: number, motion: TShot['motion'], transition: TShot['transition']): TShot => ({
  id,
  startMs,
  endMs,
  src: '',
  motion,
  focus: 'center',
  treatment: 'none',
  transition,
});

const say = 'This is how every image moves and every word shows up in your reel'.split(' ');

export const demoTimeline: Timeline = {
  version: 3,
  name: 'demo',
  durationMs: 8000,
  voice: { src: '', durationMs: 8000 },
  speech: [[200, 7400]],
  shots: [
    shot(0, 0, 2000, 'zoom-in', 'cut'),
    shot(1, 2000, 4000, 'pan-left', 'push'),
    shot(2, 4000, 6000, 'zoom-out', 'zoom'),
    shot(3, 6000, 8000, 'tilt', 'whip'),
  ],
  words: say.map((text, i) => ({ text, startMs: 200 + i * 500, endMs: 200 + i * 500 + 420 })),
  sfx: [],
};

export const demoSettings = settingsSchema.parse({});
