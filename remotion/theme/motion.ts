import { Easing, interpolate, spring } from 'remotion';

export const msToFrame = (ms: number, fps: number) => Math.round((ms / 1000) * fps);

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** eased 0→1 over [start, start+dur) frames */
export const ramp = (frame: number, start: number, dur: number, ease: (t: number) => number = Easing.out(Easing.cubic)) =>
  interpolate(frame, [start, start + Math.max(1, dur)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });

/** a spring whose overshoot grows with intensity */
export const pop = (frame: number, fps: number, intensity: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 10 + (1 - intensity) * 18, stiffness: 170, mass: 0.6 },
  });

export const EASE_OUT = Easing.out(Easing.cubic);
export const EASE_OUT_EXPO = Easing.out(Easing.exp);
export const EASE_IN_OUT = Easing.inOut(Easing.cubic);
