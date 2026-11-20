import React from 'react';
import { AbsoluteFill, random, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Settings } from '../../shared/schema';
import { rgba } from '../theme/palette';

export const Vignette: React.FC<{ amount: number }> = ({ amount }) =>
  amount <= 0 ? null : (
    <AbsoluteFill
      style={{ background: `radial-gradient(ellipse 80% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,${0.75 * amount}) 100%)` }}
    />
  );

/** film grain from a pre-made noise tile, jittered every frame (cheap: no SVG filters) */
export const Grain: React.FC<{ amount: number }> = ({ amount }) => {
  const frame = useCurrentFrame();
  if (amount <= 0) return null;
  const x = Math.floor(random(`gx${frame}`) * 256);
  const y = Math.floor(random(`gy${frame}`) * 256);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${staticFile('fx/grain.png')})`,
        backgroundPosition: `${x}px ${y}px`,
        mixBlendMode: 'overlay',
        opacity: Math.min(1, amount * 4),
      }}
    />
  );
};

export const ProgressBar: React.FC<{ settings: Settings }> = ({ settings: s }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        height: 8,
        width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`,
        background: s.colors.accent,
      }}
    />
  );
};

export const BrandLine: React.FC<{ settings: Settings; onLight: boolean }> = ({ settings: s, onLight }) =>
  s.look.brandLine ? (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: `${s.look.brandLineY * 100}%`,
        textAlign: 'center',
        fontFamily: 'Montserrat',
        fontWeight: 700,
        fontSize: 30,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: onLight ? rgba(s.colors.ink, 0.7) : rgba('#FFFFFF', 0.82),
        textShadow: onLight ? 'none' : '0 2px 10px rgba(0,0,0,0.5)',
      }}
    >
      {s.look.brandLine}
    </div>
  ) : null;
