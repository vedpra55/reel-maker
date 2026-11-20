import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import type { Focus, Motion, TShot } from '../../shared/schema';

const ORIGIN: Record<Focus, string> = {
  center: '50% 50%',
  top: '50% 25%',
  bottom: '50% 75%',
  left: '30% 50%',
  right: '70% 50%',
};

const FILTER: Record<TShot['treatment'], string | undefined> = {
  none: undefined,
  bw: 'grayscale(1) contrast(1.1)',
  warm: 'sepia(0.18) saturate(1.1) contrast(1.04)',
};

/** camera transform for a move at progress t (0..1); amount 0..1 */
export const cameraAt = (motion: Motion, t: number, amount: number) => {
  const z = 0.06 + 0.14 * amount; // zoom range
  const p = 2 + 4 * amount; // pan range in %
  const base = 1 + z * 0.55 + p / 100; // enough overscan that pans never show an edge
  switch (motion) {
    case 'zoom-in':
      return { scale: 1 + z * t, x: 0, y: 0, rot: 0 };
    case 'zoom-out':
      return { scale: 1 + z * (1 - t), x: 0, y: 0, rot: 0 };
    case 'pan-left':
      return { scale: base, x: p * (0.5 - t), y: 0, rot: 0 };
    case 'pan-right':
      return { scale: base, x: p * (t - 0.5), y: 0, rot: 0 };
    case 'pan-up':
      return { scale: base, x: 0, y: p * (0.5 - t), rot: 0 };
    case 'pan-down':
      return { scale: base, x: 0, y: p * (t - 0.5), rot: 0 };
    case 'drift':
      return { scale: 1.04 + z * 0.6 * t, x: p * 0.45 * (t - 0.5), y: p * 0.35 * (0.5 - t), rot: 0 };
    case 'tilt':
      return { scale: 1.08 + z * 0.5 * t, x: 0, y: 0, rot: (t - 0.5) * 2.4 * (0.5 + amount) };
  }
};

/**
 * Edge-to-edge still with a slow, continuous camera move. Progress runs over the whole
 * sequence (including transition overlap) so the move never stops mid-transition.
 */
export const KenBurns: React.FC<{ shot: TShot; durationInFrames: number; amount: number }> = ({ shot, durationInFrames, amount }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.sin),
  });
  const cam = cameraAt(shot.motion, t, amount);
  const transform = `translate(${cam.x.toFixed(3)}%, ${cam.y.toFixed(3)}%) scale(${cam.scale.toFixed(4)}) rotate(${cam.rot.toFixed(3)}deg)`;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      {shot.src ? (
        <Img
          src={staticFile(shot.src)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: ORIGIN[shot.focus],
            transformOrigin: ORIGIN[shot.focus],
            transform,
            filter: FILTER[shot.treatment],
          }}
        />
      ) : (
        // placeholder (Studio demo without images)
        <AbsoluteFill
          style={{
            background: `linear-gradient(${140 + shot.id * 40}deg, #9B421A, #E8A04C 55%, #1C1410)`,
            transform,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
