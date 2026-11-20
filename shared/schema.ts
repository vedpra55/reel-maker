/**
 * The contract between the pipeline (Node) and the renderer (Remotion).
 *
 *  - `settingsSchema` : what you can tweak (reel.config.json, reel.json, Studio panel)
 *  - `timelineSchema` : what `reel plan` produces (timeline.json). The renderer reads only this + settings.
 */
import { z } from 'zod';
import { zColor } from '@remotion/zod-types';

export const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'drift', 'tilt'] as const;
export type Motion = (typeof MOTIONS)[number];
export const TRANSITIONS = ['cut', 'crossfade', 'push', 'push-up', 'zoom', 'whip', 'slide-up'] as const;
export type Transition = (typeof TRANSITIONS)[number];
export const FOCI = ['center', 'top', 'bottom', 'left', 'right'] as const;
export type Focus = (typeof FOCI)[number];
export const TREATMENTS = ['none', 'bw', 'warm'] as const;
export const SFX_KINDS = ['whoosh', 'pop', 'tick', 'riser', 'hit'] as const;
export const WHISPER_MODELS = [
  'tiny.en', 'base.en', 'small.en', 'medium.en',
  'tiny', 'base', 'small', 'medium', 'large-v3-turbo',
] as const;

/** an object whose missing keys fall back to their defaults (zod 4 `.default` does not parse) */
const section = <T extends z.ZodRawShape>(shape: T) => {
  const o = z.object(shape);
  return o.default(o.parse({}) as z.output<typeof o> as never);
};

export const settingsSchema = z.object({
  /** reshuffles automatic motion / transition picks */
  seed: z.number().int().default(1),

  captions: section({
    /** word = one word at a time · phrase = a few words, each appearing as it is spoken · off = none */
    mode: z.enum(['word', 'phrase', 'off']).default('word'),
    /** phrase mode: max words on screen */
    maxWords: z.number().int().min(2).max(6).default(3),
    /** phrase mode: start a new phrase after a pause this long */
    pauseBreakMs: z.number().min(80).max(1500).default(300),
    size: z.number().min(30).max(200).default(110),
    /** 300 · 500 · 700 · 800 · 900 are bundled */
    weight: z.number().int().min(300).max(900).default(800),
    color: zColor().default('#FFFFFF'),
    /** phrase mode: colour of the word being spoken ('' = same colour) */
    highlight: z.string().default(''),
    uppercase: z.boolean().default(false),
    /** keep commas and full stops on screen */
    punctuation: z.boolean().default(false),
    /** vertical centre, fraction of the height */
    y: z.number().min(0.15).max(0.85).default(0.64),
    /** appear this long before the word is spoken */
    leadInMs: z.number().min(0).max(300).default(40),
    /** keep a word up through pauses shorter than this */
    holdMs: z.number().min(0).max(2000).default(500),
    anim: z.enum(['pop', 'fade', 'none']).default('pop'),
    /** fix transcription spellings: { "anyesh": "Anyash" } (whole words, case-insensitive) */
    replace: z.record(z.string(), z.string()).default({}),
  }),

  images: section({
    /** 0..1 – how far the camera moves */
    motion: z.number().min(0).max(1).default(0.55),
    /** automatic picks rotate through these when a line has no motion */
    motions: z.array(z.enum(MOTIONS)).default(['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'drift', 'pan-up', 'tilt']),
    /** automatic picks rotate through these when a line has no transition */
    transitions: z.array(z.enum(TRANSITIONS)).default(['push', 'zoom', 'crossfade', 'whip', 'slide-up']),
    /** transition length */
    transitionMs: z.number().min(0).max(1500).default(380),
    /** move a cut onto the nearest word start if one is this close */
    snapToWordMs: z.number().min(0).max(500).default(150),
    treatment: z.enum(TREATMENTS).default('none'),
  }),

  look: section({
    /** dark gradient behind captions */
    scrim: z.number().min(0).max(1).default(0.45),
    vignette: z.number().min(0).max(1).default(0.25),
    grain: z.number().min(0).max(0.3).default(0.0),
    brandLine: z.string().default(''),
    brandLineY: z.number().min(0.05).max(0.95).default(0.9),
  }),

  audio: section({
    lufs: z.number().min(-24).max(-9).default(-14),
    tightenPauses: z.boolean().default(true),
    /** pauses longer than this get shortened… */
    maxPauseMs: z.number().min(150).max(3000).default(450),
    /** …to this length */
    keepPauseMs: z.number().min(80).max(1500).default(300),
    denoise: z.boolean().default(true),
    hookGapMs: z.number().min(0).max(2000).default(150),
    /** whoosh on animated transitions */
    whoosh: z.boolean().default(false),
    sfxVolume: z.number().min(0).max(1).default(0.12),
    musicVolume: z.number().min(0).max(1).default(0.12),
    voiceVolume: z.number().min(0).max(2).default(1),
    /** silence kept after the last word */
    tailMs: z.number().min(0).max(5000).default(500),
  }),

  whisper: section({
    /** smaller = faster; *.en = English only (more accurate for its size) */
    model: z.enum(WHISPER_MODELS).default('small.en'),
  }),

  export: section({
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
    crf: z.number().int().min(10).max(35).default(20),
    maxrate: z.string().default('10M'),
    x264Preset: z.enum(['ultrafast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower']).default('slow'),
    audioBitrate: z.string().default('192k'),
    sizeCapMB: z.number().min(5).max(500).default(30),
    concurrency: z.number().int().min(1).max(16).default(3),
    draftScale: z.number().min(0.25).max(1).default(0.5),
  }),

  /** Instagram UI areas to keep captions out of (px at 1080x1920) */
  safeZone: section({
    top: z.number().default(220),
    bottom: z.number().default(420),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export const wordSchema = z.object({ text: z.string(), startMs: z.number(), endMs: z.number() });
export type TWord = z.infer<typeof wordSchema>;

export const shotSchema = z.object({
  id: z.number(),
  /** when the cut lands (the transition is centred here) */
  startMs: z.number(),
  endMs: z.number(),
  src: z.string(),
  motion: z.enum(MOTIONS),
  focus: z.enum(FOCI),
  treatment: z.enum(TREATMENTS),
  /** transition INTO this shot */
  transition: z.enum(TRANSITIONS),
});
export type TShot = z.infer<typeof shotSchema>;

export const sfxSchema = z.object({ kind: z.enum(SFX_KINDS), atMs: z.number(), volume: z.number() });
export type TSfx = z.infer<typeof sfxSchema>;

export const timelineSchema = z.object({
  version: z.literal(2),
  name: z.string(),
  durationMs: z.number(),
  voice: z.object({ src: z.string(), durationMs: z.number() }),
  music: z.object({ src: z.string() }).optional(),
  /** speech regions, used for music ducking */
  speech: z.array(z.tuple([z.number(), z.number()])),
  shots: z.array(shotSchema),
  words: z.array(wordSchema),
  sfx: z.array(sfxSchema),
});
export type Timeline = z.infer<typeof timelineSchema>;

/* ------------------------------------------------------------------ */
/* Remotion composition props                                          */
/* ------------------------------------------------------------------ */

export const reelPropsSchema = z.object({
  settings: settingsSchema,
  /** generated by `reel plan` – edit script.md / timeline.json, not this panel */
  timeline: z.any(),
});
export type ReelProps = { settings: Settings; timeline: Timeline };

export const WIDTH = 1080;
export const HEIGHT = 1920;
