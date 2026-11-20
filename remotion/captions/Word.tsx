import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Settings } from '../../shared/schema';
import { EASE_OUT, pop, ramp } from '../theme/motion';

/**
 * One word that appears when it is spoken. Layout space is reserved from the start
 * (opacity 0), so the block never jumps as words arrive.
 */
export const AnimatedWord: React.FC<{
  appearAt: number; // local frame
  settings: Settings;
  emphasis?: number; // extra overshoot for keywords (0..1)
  from?: 'below' | 'right';
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ appearAt, settings, emphasis = 0, from = 'below', style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = 0.5 + settings.intensity;
  const anim = settings.captions.wordAnim;

  if (frame < appearAt - 1) return <span style={{ ...style, opacity: 0 }}>{children}</span>;

  if (anim === 'none') return <span style={style}>{children}</span>;

  if (anim === 'slide-up') {
    const r = ramp(frame, appearAt, 7, EASE_OUT);
    return (
      <span style={{ ...style, display: 'inline-block', overflow: 'hidden', padding: '0.12em 0.04em', margin: '-0.12em -0.04em', verticalAlign: 'bottom' }}>
        <span style={{ display: 'inline-block', transform: `translateY(${(1 - r) * 105}%)` }}>{children}</span>
      </span>
    );
  }

  if (anim === 'blur-in') {
    const r = ramp(frame, appearAt, 8, EASE_OUT);
    return (
      <span
        style={{
          ...style,
          display: 'inline-block',
          opacity: r,
          filter: r < 1 ? `blur(${(1 - r) * 10}px)` : undefined,
          transform: `translateY(${(1 - r) * 14 * k}px)`,
        }}
      >
        {children}
      </span>
    );
  }

  // pop (default): spring with overshoot, keywords punch harder
  const p = pop(frame, fps, Math.min(1, settings.intensity + emphasis * 0.4), appearAt);
  // keywords travel further, so the spring overshoot reads as a punch
  const from0 = emphasis > 0 ? 0.45 : 0.72;
  const scale = from0 + (1 - from0) * p;
  const dx = from === 'right' ? (1 - p) * 40 * k : 0;
  const dy = from === 'below' ? (1 - p) * 22 * k : 0;
  return (
    <span
      style={{
        ...style,
        display: 'inline-block',
        opacity: Math.min(1, p * 2.2),
        transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
        transformOrigin: '50% 80%',
      }}
    >
      {children}
    </span>
  );
};

/** bar behind a keyword that wipes in from the left */
export const KeyBar: React.FC<{ appearAt: number; color: string; height?: number; top?: number }> = ({
  appearAt,
  color,
  height = 0.36,
  top = 0.5,
}) => {
  const frame = useCurrentFrame();
  const r = ramp(frame, appearAt - 2, 8, EASE_OUT);
  return (
    <span
      style={{
        position: 'absolute',
        left: '-6%',
        width: '112%',
        top: `${top * 100}%`,
        height: `${height}em`,
        background: color,
        transform: `scaleX(${r})`,
        transformOrigin: 'left center',
        zIndex: -1,
        borderRadius: 2,
      }}
    />
  );
};
