import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { TBeat } from '../../shared/schema';
import { EASE_OUT, EASE_OUT_EXPO, ramp } from '../theme/motion';

type T = TBeat['transition'];

/** frames the incoming beat needs to arrive; it starts this early so it is fully in on the word */
export const TRANSITION_FRAMES: Record<T, number> = {
  cut: 0,
  fade: 6,
  slide: 9,
  wipe: 9,
  'zoom-punch': 7,
  whip: 8,
};

/**
 * Animates the incoming beat over the outgoing one. Our own in-sequence transitions
 * (not TransitionSeries) so beat timing — and audio sync — never shifts.
 */
export const TransitionIn: React.FC<{ type: T; frames: number; intensity: number; children: React.ReactNode }> = ({
  type,
  frames,
  intensity,
  children,
}) => {
  const frame = useCurrentFrame();
  if (type === 'cut' || frames <= 0 || frame >= frames) return <AbsoluteFill>{children}</AbsoluteFill>;
  const k = 0.5 + intensity;
  let style: React.CSSProperties = {};
  switch (type) {
    case 'fade':
      style = { opacity: ramp(frame, 0, frames) };
      break;
    case 'slide': {
      const r = ramp(frame, 0, frames, EASE_OUT_EXPO);
      style = { transform: `translateY(${(1 - r) * 100}%)`, boxShadow: '0 -30px 60px rgba(0,0,0,0.35)' };
      break;
    }
    case 'wipe': {
      const r = ramp(frame, 0, frames, EASE_OUT);
      const x = r * 125;
      style = { clipPath: `polygon(0 0, ${x}% 0, ${x - 25}% 100%, 0 100%)` };
      break;
    }
    case 'zoom-punch': {
      const r = ramp(frame, 0, frames, EASE_OUT_EXPO);
      style = { transform: `scale(${1 + (1 - r) * 0.35 * k})`, opacity: Math.min(1, r * 1.6) };
      break;
    }
    case 'whip': {
      const r = ramp(frame, 0, frames, EASE_OUT_EXPO);
      style = { transform: `translateX(${(1 - r) * 100}%) skewX(${(1 - r) * -8 * k}deg)` };
      break;
    }
  }
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};
