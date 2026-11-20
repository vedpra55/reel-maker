import type { SettingsInput } from './schema';

/**
 * Presets are partial settings. Resolution order:
 *   schema defaults ← preset ← reel.json ← CLI flags
 */
export const PRESETS: Record<string, SettingsInput> = {
  /** Anyash, paper look: terracotta keywords, amber bars, paper-grid text beats */
  'anyash-light': {
    colors: {
      paper: '#F4EEE6',
      ink: '#1C1410',
      dark: '#15100D',
      primary: '#9B421A',
      accent: '#E8A04C',
      onImage: '#FFFFFF',
    },
    look: { surface: 'light', grid: true, imageTreatment: 'none', glow: 0.35 },
    endCard: { bg: 'brand' },
  },
  /** Anyash, night look: near-black text beats, amber keywords */
  'anyash-dark': {
    colors: {
      paper: '#F4EEE6',
      ink: '#1C1410',
      dark: '#140F0C',
      primary: '#9B421A',
      accent: '#E8A04C',
      onImage: '#FFFFFF',
    },
    look: { surface: 'dark', grid: true, imageTreatment: 'warm', glow: 0.45, vignette: 0.4 },
    endCard: { bg: 'dark' },
  },
  /** quiet: no glow, no grain, colour keywords only, gentle motion */
  minimal: {
    intensity: 0.3,
    colors: {
      paper: '#F5F5F2',
      ink: '#111111',
      dark: '#0E0E0E',
      primary: '#222222',
      accent: '#F2C14E',
      onImage: '#FFFFFF',
    },
    captions: { keyStyle: 'color', emphasisRatio: 0.2 },
    look: { surface: 'light', glow: 0, grain: 0, vignette: 0.15 },
    pacing: { transitions: ['fade', 'slide'] },
    endCard: { bg: 'paper' },
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);
