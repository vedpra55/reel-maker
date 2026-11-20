import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ReelProps, TBeat } from '../shared/schema';
import { AudioMix } from './AudioMix';
import { BeatView } from './beats/BeatView';
import { CaptionLayer, beatAt, surfaceOf } from './captions/CaptionLayer';
import { BrandLine, Grain, ProgressBar, Vignette } from './fx/Overlays';
import { TRANSITION_FRAMES, TransitionIn } from './fx/Transition';
import { ensureFonts } from './theme/fonts';
import { msToFrame } from './theme/motion';

ensureFonts();

export const Reel: React.FC<ReelProps> = ({ timeline: tl, settings: s }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const nowMs = (frame / fps) * 1000;
  const current = beatAt(tl.beats, nowMs);
  const surface = surfaceOf(current, s);

  const beats = useMemo(
    () =>
      tl.beats.map((b: TBeat, i: number) => {
        const start = msToFrame(b.startMs, fps);
        const end = i === tl.beats.length - 1 ? Math.max(start + 1, msToFrame(tl.durationMs, fps)) : msToFrame(b.endMs, fps);
        const t = i === 0 ? 0 : Math.min(TRANSITION_FRAMES[b.transition], start);
        const pages = tl.pages.filter((p) => p.startMs >= b.startMs - 1 && p.startMs < b.endMs);
        return { b, from: start - t, t, dur: end - start + t, pages };
      }),
    [tl, fps],
  );

  return (
    <AbsoluteFill style={{ background: s.colors.dark }}>
      {beats.map(({ b, from, t, dur, pages }) => (
        <Sequence key={b.id} from={from} durationInFrames={Math.max(1, dur)} name={`${b.kind} ${b.image?.src ?? b.bg ?? ''}`}>
          <TransitionIn type={b.transition} frames={t} intensity={s.intensity}>
            <BeatView beat={b} settings={s} durationInFrames={dur} pages={pages} />
          </TransitionIn>
        </Sequence>
      ))}
      <Vignette amount={surface === 'paper' ? s.look.vignette * 0.35 : s.look.vignette} />
      <CaptionLayer timeline={tl} settings={s} />
      <BrandLine settings={s} onLight={surface === 'paper'} />
      {s.look.progressBar ? <ProgressBar settings={s} /> : null}
      <Grain amount={s.look.grain} />
      <AudioMix timeline={tl} settings={s} />
    </AbsoluteFill>
  );
};
