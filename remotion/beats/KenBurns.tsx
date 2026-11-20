import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import type { Settings, TBeat } from '../../shared/schema';
import { EASE_IN_OUT } from '../theme/motion';

type Img = NonNullable<TBeat['image']>;

const ORIGIN: Record<Img['focus'], string> = {
  center: '50% 50%',
  top: '50% 22%',
  bottom: '50% 78%',
  left: '25% 50%',
  right: '75% 50%',
};

const FILTER: Record<Img['treatment'], string | undefined> = {
  none: undefined,
  bw: 'grayscale(1) contrast(1.12) brightness(1.02)',
  warm: 'sepia(0.22) saturate(1.12) contrast(1.05)',
  duo: 'grayscale(1) contrast(1.15) brightness(1.08)',
};

/** slow camera move over a still: zoom, pan or parallax drift. Never fully static. */
export const KenBurns: React.FC<{
  image: Img;
  durationInFrames: number;
  settings: Settings;
  dim?: number;
}> = ({ image, durationInFrames, settings: s, dim = 0 }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_IN_OUT,
  });
  const k = 0.6 + s.intensity * 0.8; // movement amount
  const z = 0.1 * k;
  const p = 3.2 * k; // % pan
  let scale = 1;
  let x = 0;
  let y = 0;
  switch (image.motion) {
    case 'zoom-in':
      scale = 1 + z * t;
      break;
    case 'zoom-out':
      scale = 1 + z * (1 - t);
      break;
    case 'pan-left':
      scale = 1.1 + z * 0.3;
      x = p * (0.5 - t);
      break;
    case 'pan-right':
      scale = 1.1 + z * 0.3;
      x = p * (t - 0.5);
      break;
    case 'pan-up':
      scale = 1.1 + z * 0.3;
      y = p * (0.5 - t);
      break;
    case 'drift':
      scale = 1.05 + z * 0.5 * t;
      x = p * 0.4 * (t - 0.5);
      y = p * 0.3 * (0.5 - t);
      break;
  }
  scale *= image.punch;

  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <Img
        src={staticFile(image.src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: ORIGIN[image.focus],
          transform: `translate(${x.toFixed(3)}%, ${y.toFixed(3)}%) scale(${scale.toFixed(4)})`,
          transformOrigin: ORIGIN[image.focus],
          filter: FILTER[image.treatment],
        }}
      />
      {image.treatment === 'duo' ? (
        <>
          <AbsoluteFill style={{ background: s.colors.primary, mixBlendMode: 'multiply', opacity: 0.55 }} />
          <AbsoluteFill style={{ background: s.colors.accent, mixBlendMode: 'screen', opacity: 0.18 }} />
        </>
      ) : null}
      {dim > 0 ? <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} /> : null}
    </AbsoluteFill>
  );
};

/** dark gradient where captions sit, so white text always reads */
export const Scrim: React.FC<{ amount: number; center: number }> = ({ amount, center }) =>
  amount <= 0 ? null : (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, rgba(0,0,0,0) ${Math.max(0, center * 100 - 34)}%, rgba(0,0,0,${0.6 * amount}) ${center * 100}%, rgba(0,0,0,${0.75 * amount}) 100%)`,
      }}
    />
  );
