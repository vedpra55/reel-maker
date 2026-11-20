import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { Background, Settings } from '../../shared/schema';
import { rgba, shade } from '../theme/palette';

/** paper / dark / brand backgrounds with a slowly drifting grid, so text beats never sit still */
export const Surface: React.FC<{ bg: Background; settings: Settings }> = ({ bg, settings: s }) => {
  const frame = useCurrentFrame();
  const c = s.colors;
  const drift = frame * 0.35 * (0.5 + s.intensity);
  const base = bg === 'paper' ? c.paper : bg === 'dark' ? c.dark : c.primary;
  const line = bg === 'paper' ? rgba(c.ink, 0.075) : rgba('#FFFFFF', bg === 'dark' ? 0.05 : 0.08);
  const cross = bg === 'paper' ? rgba(c.ink, 0.22) : rgba('#FFFFFF', 0.18);
  const cell = 108;
  const light =
    bg === 'paper'
      ? `radial-gradient(ellipse 70% 50% at 50% 42%, ${rgba('#FFFFFF', 0.85)} 0%, ${rgba('#FFFFFF', 0)} 70%)`
      : bg === 'dark'
        ? `radial-gradient(ellipse 80% 55% at 50% 45%, ${rgba(c.primary, 0.32)} 0%, rgba(0,0,0,0) 70%)`
        : `radial-gradient(ellipse 75% 55% at 50% 42%, ${shade(c.primary, 0.18)} 0%, ${rgba(c.primary, 0)} 72%)`;

  return (
    <AbsoluteFill style={{ background: base }}>
      <AbsoluteFill style={{ background: light }} />
      {s.look.grid ? (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${line} 1.5px, transparent 1.5px), linear-gradient(90deg, ${line} 1.5px, transparent 1.5px)`,
            backgroundSize: `${cell}px ${cell}px`,
            backgroundPosition: `${(drift % cell).toFixed(2)}px ${((drift * 0.6) % cell).toFixed(2)}px`,
            maskImage: 'radial-gradient(ellipse 85% 60% at 50% 45%, black 30%, transparent 85%)',
            WebkitMaskImage: 'radial-gradient(ellipse 85% 60% at 50% 45%, black 30%, transparent 85%)',
          }}
        />
      ) : null}
      {s.look.grid ? (
        // small "+" marks on every 4th crossing, like a drafting sheet
        <AbsoluteFill
          style={{
            backgroundImage: `radial-gradient(circle, ${cross} 2.5px, transparent 3px)`,
            backgroundSize: `${cell * 4}px ${cell * 4}px`,
            backgroundPosition: `${((drift % (cell * 4)) - 3).toFixed(2)}px ${(((drift * 0.6) % (cell * 4)) - 3).toFixed(2)}px`,
            opacity: 0.7,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
