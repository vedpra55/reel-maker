import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import type { Transition } from '../../shared/schema';

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const inOut = Easing.inOut(Easing.cubic);
const fast = Easing.inOut(Easing.poly(4));
const outExpo = Easing.out(Easing.exp);
const inQuad = Easing.in(Easing.quad);

/**
 * Both shots move: the outgoing one leaves while the incoming one arrives, over the same
 * window centred on the cut. p = 0..1 through that window.
 */
export const enterStyle = (type: Transition, p: number): React.CSSProperties => {
  switch (type) {
    case 'cut':
      return {};
    case 'crossfade':
      return { opacity: inOut(p) };
    case 'push':
      return { transform: `translateX(${(1 - inOut(p)) * 100}%)` };
    case 'push-up':
      return { transform: `translateY(${(1 - inOut(p)) * 100}%)` };
    case 'zoom': {
      // the new image lands from slightly too close, as if we flew through the old one
      const e = Easing.out(Easing.cubic)(p);
      return { opacity: clamp((p - 0.3) / 0.35), transform: `scale(${1.35 - 0.35 * e})` };
    }
    case 'whip': {
      const e = fast(p);
      const blur = Math.sin(Math.PI * p) * 10;
      return { transform: `translateX(${(1 - e) * 100}%)`, filter: blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : undefined };
    }
    case 'slide-up':
      return { transform: `translateY(${(1 - outExpo(p)) * 100}%)`, boxShadow: '0 -40px 80px rgba(0,0,0,0.45)' };
  }
};

export const exitStyle = (type: Transition, p: number): React.CSSProperties => {
  switch (type) {
    case 'cut':
    case 'crossfade':
      return {};
    case 'push':
      return { transform: `translateX(${-inOut(p) * 100}%)` };
    case 'push-up':
      return { transform: `translateY(${-inOut(p) * 100}%)` };
    case 'zoom': {
      const e = inQuad(p);
      const blur = e * 8;
      return { transform: `scale(${1 + 0.9 * e})`, opacity: 1 - clamp((p - 0.45) / 0.4), filter: blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : undefined };
    }
    case 'whip': {
      const e = fast(p);
      const blur = Math.sin(Math.PI * p) * 10;
      return { transform: `translateX(${-e * 100}%)`, filter: blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : undefined };
    }
    case 'slide-up': {
      const e = outExpo(p);
      return { transform: `translateY(${-e * 12}%) scale(${1 - 0.06 * e})`, filter: `brightness(${1 - 0.4 * e})` };
    }
  }
};

/** wraps one shot: entry animation over its first `inFrames`, exit over its last `outFrames` */
export const ShotTransition: React.FC<{
  enter: Transition;
  inFrames: number;
  exit: Transition | null;
  outFrames: number;
  durationInFrames: number;
  children: React.ReactNode;
}> = ({ enter, inFrames, exit, outFrames, durationInFrames, children }) => {
  const frame = useCurrentFrame();
  const enterP = inFrames > 0 && frame < inFrames ? frame / inFrames : 1;
  const exitStart = durationInFrames - outFrames;
  const exitP = exit && outFrames > 0 && frame >= exitStart ? (frame - exitStart) / outFrames : 0;
  return (
    <AbsoluteFill style={exit && exitP > 0 ? exitStyle(exit, exitP) : undefined}>
      <AbsoluteFill style={enterP < 1 ? enterStyle(enter, enterP) : undefined}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};
