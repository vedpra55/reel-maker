import React from 'react';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import type { Settings, TBeat, TPage, Timeline } from '../../shared/schema';
import { HEIGHT, WIDTH } from '../../shared/schema';
import { TRANSITION_FRAMES } from '../fx/Transition';
import { msToFrame } from '../theme/motion';
import { palette, type Surface } from '../theme/palette';
import { Inline } from './Inline';
import { Stack } from './Stack';
import { StatType } from './StatType';

export const beatAt = (beats: TBeat[], ms: number) =>
  beats.find((b) => ms >= b.startMs - 1 && ms < b.endMs) ?? beats[beats.length - 1];

/** what the text sits on during a beat */
export const surfaceOf = (b: TBeat, s: Settings): Surface => {
  if (b.kind === 'image') return 'image';
  if (b.kind === 'split') return 'dark';
  if (b.kind === 'hook') return b.image ? 'image' : (b.bg ?? 'brand');
  if (b.kind === 'end') return s.endCard.bg;
  return b.bg ?? 'paper';
};

/** vertical centre of the caption block for a beat (fraction of height) */
const anchorY = (b: TBeat, s: Settings) => {
  if (b.kind === 'image') return s.captions.y;
  if (b.kind === 'split') return 0.655;
  if (b.kind === 'hook' && b.image) return 0.5;
  return 0.47;
};

export const CaptionLayer: React.FC<{ timeline: Timeline; settings: Settings }> = ({ timeline, settings: s }) => {
  const { fps } = useVideoConfig();
  const sz = s.safeZone;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {timeline.pages.map((page: TPage) => {
        const beat = beatAt(timeline.beats, page.startMs + 1);
        const from = msToFrame(page.startMs, fps);
        // the last page of a beat leaves before the next beat's transition starts,
        // so text never sits on the wrong background mid-transition
        let to = msToFrame(page.endMs, fps);
        const next = timeline.beats[timeline.beats.indexOf(beat) + 1];
        if (next && page.endMs >= beat.endMs - 1) to = Math.min(to, msToFrame(next.startMs, fps) - TRANSITION_FRAMES[next.transition]);
        const dur = Math.max(1, to - from);
        const surface = surfaceOf(beat, s);
        const pal = palette(surface, s);
        const onImage = beat.captions === 'overlay';
        const maxWidth = WIDTH - 2 * Math.max(sz.sides, onImage ? 90 : 60);
        const isStat = beat.kind === 'stat' && beat.stat && page.words.some((w) => w.role === 'key' && /\d/.test(w.text));
        // keep the block centre inside the safe zone
        const y = Math.min(Math.max(anchorY(beat, s) * HEIGHT, sz.top + 160), HEIGHT - sz.bottom - 120);

        let body: React.ReactNode;
        if (isStat) body = <StatType page={page} stat={beat.stat!} settings={s} palette={pal} maxWidth={maxWidth} frames={dur} />;
        else if (page.style === 'stack') body = <Stack page={page} settings={s} palette={pal} maxWidth={maxWidth} scale={page.hook ? 1.12 : 1} frames={dur} />;
        else body = <Inline page={page} settings={s} palette={pal} maxWidth={maxWidth} frames={dur} />;

        return (
          <Sequence key={page.id} from={from} durationInFrames={dur} layout="none" name={page.words.map((w) => w.text).join(' ')}>
            {pal.glow && page.style === 'stack' ? (
              <div
                style={{
                  position: 'absolute',
                  left: WIDTH / 2 - 520,
                  top: y - 380,
                  width: 1040,
                  height: 760,
                  background: `radial-gradient(ellipse at center, ${pal.glow} 0%, rgba(0,0,0,0) 62%)`,
                }}
              />
            ) : null}
            <div style={{ position: 'absolute', left: WIDTH / 2, top: y, transform: 'translate(-50%, -50%)' }}>{body}</div>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
