import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Settings, TPage } from '../../shared/schema';
import { msToFrame, ramp } from '../theme/motion';
import type { Palette } from '../theme/palette';
import { AnimatedWord, KeyBar } from './Word';

/** Calm 1–2 line captions: words pop in as spoken, the spoken word lights up. */
export const Inline: React.FC<{ page: TPage; settings: Settings; palette: Palette; maxWidth: number; frames?: number }> = ({
  page,
  settings: s,
  palette: pal,
  maxWidth,
  frames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = frames ?? msToFrame(page.endMs - page.startMs, fps);
  const out = 1 - ramp(frame, total - 3, 3);
  const nowMs = page.startMs + (frame / fps) * 1000;
  const size = s.type.captionSize;

  return (
    <div
      style={{
        width: maxWidth,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        columnGap: '0.26em',
        rowGap: '0.02em',
        fontFamily: 'Montserrat',
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.1,
        letterSpacing: '-0.02em',
        textAlign: 'center',
        opacity: out,
      }}
    >
      {page.words.map((w, i) => {
        const appearAt = msToFrame(w.startMs - s.captions.leadInMs - page.startMs, fps);
        const speaking = s.captions.karaoke && nowMs >= w.startMs && nowMs < w.endMs + 80;
        const isKey = w.role === 'key';
        const bar = isKey && page.keyStyle === 'bar';
        const closer = w.role === 'closer';
        const color = bar ? pal.onBar : isKey || speaking ? pal.key : pal.text;
        return (
          <span key={i} style={{ position: 'relative', display: 'inline-block', zIndex: 0 }}>
            {bar ? <KeyBar appearAt={appearAt} color={pal.bar} /> : null}
            <AnimatedWord
              appearAt={appearAt}
              settings={s}
              emphasis={isKey ? 1 : 0}
              style={{
                color,
                textShadow: pal.shadow,
                fontFamily: closer ? `'${s.type.serif}', serif` : 'Montserrat',
                fontStyle: closer ? 'italic' : 'normal',
                fontWeight: closer ? 400 : 800,
                fontSize: closer ? '1.22em' : undefined,
                lineHeight: closer ? 0.9 : undefined,
              }}
            >
              {w.text}
            </AnimatedWord>
          </span>
        );
      })}
    </div>
  );
};
