import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Settings, TBeat, TPage } from '../../shared/schema';
import { pop, ramp } from '../theme/motion';
import { palette } from '../theme/palette';
import { Surface } from './Backgrounds';
import { KenBurns, Scrim } from './KenBurns';

/** Draws the visual layer of one beat. Captions are drawn on top by CaptionLayer. */
export const BeatView: React.FC<{
  beat: TBeat;
  settings: Settings;
  durationInFrames: number;
  /** pages spoken during this beat (end card uses them instead of its CTA) */
  pages: TPage[];
}> = ({ beat, settings: s, durationInFrames, pages }) => {
  switch (beat.kind) {
    case 'image':
      return (
        <AbsoluteFill>
          <KenBurns image={beat.image!} durationInFrames={durationInFrames} settings={s} />
          <Scrim amount={s.look.scrim} center={s.captions.y} />
        </AbsoluteFill>
      );
    case 'hook':
      return beat.image ? (
        <AbsoluteFill>
          <KenBurns image={beat.image} durationInFrames={durationInFrames} settings={s} dim={0.38} />
          <Scrim amount={s.look.scrim * 0.8} center={0.5} />
        </AbsoluteFill>
      ) : (
        <Surface bg={beat.bg ?? 'brand'} settings={s} />
      );
    case 'split':
      return <Split beat={beat} settings={s} durationInFrames={durationInFrames} />;
    case 'text':
    case 'stat':
      return <StatOrText beat={beat} settings={s} durationInFrames={durationInFrames} />;
    case 'end':
      return <EndCard settings={s} durationInFrames={durationInFrames} hasSpokenText={pages.length > 0} />;
  }
};

/** rounded media on top, dark panel with the text below (the Big Ben / staircase look) */
const Split: React.FC<{ beat: TBeat; settings: Settings; durationInFrames: number }> = ({ beat, settings: s, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const h = 0.56 * height;
  const rise = ramp(frame, 0, 10);
  return (
    <AbsoluteFill>
      <Surface bg="dark" settings={{ ...s, look: { ...s.look, grid: false } }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: h,
          overflow: 'hidden',
          borderBottomLeftRadius: 64,
          borderBottomRightRadius: 64,
          boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
          transform: `translateY(${(1 - rise) * -30}px)`,
        }}
      >
        <KenBurns image={beat.image!} durationInFrames={durationInFrames} settings={s} />
      </div>
    </AbsoluteFill>
  );
};

/** paper/dark/brand surface with a slow push-in */
const StatOrText: React.FC<{ beat: TBeat; settings: Settings; durationInFrames: number }> = ({ beat, settings: s, durationInFrames }) => {
  const frame = useCurrentFrame();
  const push = 1 + 0.035 * (0.5 + s.intensity) * (frame / Math.max(1, durationInFrames));
  return (
    <AbsoluteFill style={{ transform: `scale(${push})` }}>
      <Surface bg={beat.bg ?? 'paper'} settings={s} />
    </AbsoluteFill>
  );
};

/** brand card with the CTA (only drawn when the voice doesn't already say it) */
const EndCard: React.FC<{ settings: Settings; durationInFrames: number; hasSpokenText: boolean }> = ({ settings: s, hasSpokenText }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const pal = palette(s.endCard.bg, s);
  const p = pop(frame, fps, s.intensity, 4);
  const sub = ramp(frame, 12, 10);
  return (
    <AbsoluteFill>
      <Surface bg={s.endCard.bg} settings={s} />
      {!hasSpokenText ? (
        <div
          style={{
            position: 'absolute',
            left: width / 2,
            top: height * 0.46,
            transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * p})`,
            opacity: Math.min(1, p * 2),
            width: width - 160,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'Montserrat',
              fontWeight: 800,
              fontSize: Math.min(120, (width - 160) / Math.max(1, s.endCard.cta.length * 0.6)),
              letterSpacing: '-0.03em',
              lineHeight: 1.02,
              color: pal.key,
              textShadow: pal.shadow,
            }}
          >
            {s.endCard.cta}
          </div>
          {s.endCard.sub ? (
            <div
              style={{
                marginTop: 24,
                fontFamily: `'${s.type.serif}', serif`,
                fontStyle: 'italic',
                fontSize: 64,
                color: pal.closer,
                opacity: sub,
                transform: `translateY(${(1 - sub) * 20}px)`,
              }}
            >
              {s.endCard.sub}
            </div>
          ) : null}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
