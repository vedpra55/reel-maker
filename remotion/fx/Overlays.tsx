import React from 'react';
import { AbsoluteFill, random, staticFile, useCurrentFrame } from 'remotion';
import type { Settings } from '../../shared/schema';

export const Vignette: React.FC<{ amount: number }> = ({ amount }) =>
  amount <= 0 ? null : (
    <AbsoluteFill
      style={{ background: `radial-gradient(ellipse 80% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,${0.75 * amount}) 100%)` }}
    />
  );

/** soft dark band behind the captions so white text reads on bright images */
export const Scrim: React.FC<{ amount: number; y: number }> = ({ amount, y }) =>
  amount <= 0 ? null : (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, rgba(0,0,0,0) ${Math.max(0, y * 100 - 22)}%, rgba(0,0,0,${0.55 * amount}) ${y * 100}%, rgba(0,0,0,${0.3 * amount}) ${Math.min(100, y * 100 + 20)}%, rgba(0,0,0,${0.15 * amount}) 100%)`,
      }}
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

export const BrandLine: React.FC<{ settings: Settings }> = ({ settings: s }) =>
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
        color: 'rgba(255,255,255,0.85)',
        textShadow: '0 2px 10px rgba(0,0,0,0.5)',
      }}
    >
      {s.look.brandLine}
    </div>
  ) : null;
