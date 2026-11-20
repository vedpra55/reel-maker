/**
 * The contract between the pipeline (Node) and the renderer (Remotion).
 *
 *  - `settingsSchema`  : everything a user can tweak (reel.json, presets, Studio panel)
 *  - `timelineSchema`  : what the rules engine produces (timeline.json). The renderer reads only this + settings.
 */
import { z } from 'zod';
import { zColor } from '@remotion/zod-types';

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const TRANSITIONS = ['cut', 'fade', 'slide', 'wipe', 'zoom-punch', 'whip'] as const;
export const WORD_ANIMS = ['pop', 'slide-up', 'blur-in', 'none'] as const;
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
  preset: z.string().default('anyash-light'),
  seed: z.number().int().default(1),
  /** 0..1 – scales every motion distance, overshoot and shake. */
  intensity: z.number().min(0).max(1).default(0.5),

  type: section({
      sans: z.string().default('Montserrat'),
      serif: z.enum(['Playfair Display', 'Instrument Serif']).default('Playfair Display'),
      /** closer style: italic serif ("practice") or light italic sans ("relocation") */
      closer: z.enum(['serif', 'light-italic']).default('serif'),
      /** inline caption size (px at 1080 wide) */
      captionSize: z.number().min(30).max(140).default(74),
      /** keyword size in stacked pages */
      keySize: z.number().min(60).max(260).default(150),
      /** lead/tail size in stacked pages */
      leadSize: z.number().min(30).max(120).default(58),
      /** keyword weight */
      keyWeight: z.union([z.literal(700), z.literal(800), z.literal(900)]).default(800),
      /** set the keyword in heavy italic ("largest") */
      keyItalic: z.boolean().default(false),
      uppercaseKeys: z.boolean().default(false),
  }),

  colors: section({
      paper: zColor().default('#F4EEE6'),
      ink: zColor().default('#1C1410'),
      dark: zColor().default('#15100D'),
      primary: zColor().default('#9B421A'),
      accent: zColor().default('#E8A04C'),
      /** text over images */
      onImage: zColor().default('#FFFFFF'),
  }),

  captions: section({
      /** auto = mix of inline and stacked pages (driven by emphasisRatio) */
      style: z.enum(['auto', 'inline', 'stack']).default('auto'),
      maxWords: z.number().int().min(1).max(8).default(4),
      hookMaxWords: z.number().int().min(1).max(6).default(3),
      maxCharsPerLine: z.number().int().min(8).max(40).default(18),
      pauseBreakMs: z.number().min(80).max(1000).default(220),
      /** captions appear this long before the word is spoken */
      leadInMs: z.number().min(0).max(300).default(60),
      /** vertical centre of the caption block, fraction of height */
      y: z.number().min(0.2).max(0.8).default(0.6),
      /** share of pages that get the big stacked "editorial" treatment */
      emphasisRatio: z.number().min(0).max(1).default(0.3),
      wordAnim: z.enum(WORD_ANIMS).default('pop'),
      /** inline pages: colour the word being spoken */
      karaoke: z.boolean().default(true),
      /** keyword treatment: colour, bar behind, or auto (numbers get a bar, words get colour) */
      keyStyle: z.enum(['auto', 'color', 'bar']).default('auto'),
      /** words that are always keywords (case-insensitive) */
      keywords: z.array(z.string()).default([]),
  }),

  pacing: section({
      minHoldS: z.number().min(0.4).max(4).default(1.0),
      maxHoldS: z.number().min(1).max(10).default(3.0),
      hookMaxS: z.number().min(1).max(8).default(3.5),
      /** at most one auto stat beat every N seconds */
      statEveryS: z.number().min(2).max(60).default(8),
      transitions: z.array(z.enum(TRANSITIONS)).default(['zoom-punch', 'slide', 'wipe', 'whip']),
      /** insert text-only beats on strong keyword pages when an image is held too long */
      autoTextBeats: z.boolean().default(true),
      /** turn number pages into stat beats automatically */
      autoStatBeats: z.boolean().default(true),
  }),

  look: section({
      grain: z.number().min(0).max(0.3).default(0.04),
      vignette: z.number().min(0).max(1).default(0.3),
      /** soft colour glow behind stacked captions over images */
      glow: z.number().min(0).max(1).default(0.35),
      /** dark gradient under captions over images */
      scrim: z.number().min(0).max(1).default(0.55),
      /** image treatment when none is given */
      imageTreatment: z.enum(['none', 'bw', 'warm', 'duo']).default('none'),
      /** light = text/stat beats on paper (grid), dark = on near-black */
      surface: z.enum(['light', 'dark']).default('light'),
      /** faint grid on paper backgrounds */
      grid: z.boolean().default(true),
      progressBar: z.boolean().default(false),
      brandLine: z.string().default(''),
      brandLineY: z.number().min(0.5).max(0.95).default(0.73),
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
      sfx: z.boolean().default(true),
      sfxVolume: z.number().min(0).max(1).default(0.1),
      musicVolume: z.number().min(0).max(1).default(0.12),
      voiceVolume: z.number().min(0).max(2).default(1),
  }),

  endCard: section({
      enabled: z.boolean().default(true),
      durationS: z.number().min(0.5).max(6).default(2.0),
      cta: z.string().default('Follow for more'),
      sub: z.string().default(''),
      bg: z.enum(['brand', 'dark', 'paper']).default('brand'),
  }),

  whisper: section({
    /** smaller = faster download and transcription; *.en = English only (more accurate per size) */
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

  /** Instagram UI areas to keep text out of (px at 1080x1920) */
  safeZone: section({
      top: z.number().default(220),
      bottom: z.number().default(480),
      sides: z.number().default(70),
      right: z.number().default(150),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export const ROLES = ['lead', 'key', 'closer', 'tail', 'normal'] as const;
export type Role = (typeof ROLES)[number];

export const wordSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  role: z.enum(ROLES),
  /** sentence ends after this word */
  sentenceEnd: z.boolean().default(false),
});
export type TWord = z.infer<typeof wordSchema>;

export const pageSchema = z.object({
  id: z.number(),
  startMs: z.number(),
  endMs: z.number(),
  style: z.enum(['inline', 'stack']),
  /** keyword treatment for this page */
  keyStyle: z.enum(['color', 'bar', 'none']),
  hook: z.boolean(),
  words: z.array(wordSchema),
});
export type TPage = z.infer<typeof pageSchema>;

export const BEAT_KINDS = ['hook', 'image', 'split', 'text', 'stat', 'end'] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];
export const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'drift'] as const;
export type Motion = (typeof MOTIONS)[number];
export const FOCI = ['center', 'top', 'bottom', 'left', 'right'] as const;
export const TREATMENTS = ['none', 'bw', 'warm', 'duo'] as const;
export const BACKGROUNDS = ['paper', 'dark', 'brand'] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const statSchema = z.object({
  /** text exactly as written, e.g. "$15,000" */
  raw: z.string(),
  prefix: z.string(),
  value: z.number(),
  decimals: z.number(),
  suffix: z.string(),
  /** keep thousands separators when counting */
  grouping: z.boolean(),
});
export type TStat = z.infer<typeof statSchema>;

export const beatSchema = z.object({
  id: z.number(),
  kind: z.enum(BEAT_KINDS),
  startMs: z.number(),
  endMs: z.number(),
  transition: z.enum(TRANSITIONS),
  image: z
    .object({
      src: z.string(),
      motion: z.enum(MOTIONS),
      focus: z.enum(FOCI),
      treatment: z.enum(TREATMENTS),
      /** extra scale applied on this beat (punch-in variants) */
      punch: z.number(),
    })
    .optional(),
  bg: z.enum(BACKGROUNDS).optional(),
  stat: statSchema.optional(),
  /** overlay = shared caption layer on top; embedded = the beat draws its own type */
  captions: z.enum(['overlay', 'embedded']),
});
export type TBeat = z.infer<typeof beatSchema>;

export const sfxSchema = z.object({
  kind: z.enum(SFX_KINDS),
  atMs: z.number(),
  volume: z.number(),
});
export type TSfx = z.infer<typeof sfxSchema>;

export const timelineSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  durationMs: z.number(),
  voice: z.object({ src: z.string(), durationMs: z.number() }),
  music: z.object({ src: z.string() }).optional(),
  /** speech regions, used for music ducking */
  speech: z.array(z.tuple([z.number(), z.number()])),
  pages: z.array(pageSchema),
  beats: z.array(beatSchema),
  sfx: z.array(sfxSchema),
});
export type Timeline = z.infer<typeof timelineSchema>;

/* ------------------------------------------------------------------ */
/* Remotion composition props                                          */
/* ------------------------------------------------------------------ */

export const reelPropsSchema = z.object({
  settings: settingsSchema,
  /** generated by `reel plan` – edit timeline.json, not this panel */
  timeline: z.any(),
});
export type ReelProps = { settings: Settings; timeline: Timeline };

export const WIDTH = 1080;
export const HEIGHT = 1920;
