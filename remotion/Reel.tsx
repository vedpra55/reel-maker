import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import type { ReelProps, TShot } from '../shared/schema';
import { AudioMix } from './AudioMix';
import { Captions } from './captions/Captions';
import { KenBurns } from './fx/KenBurns';
import { BrandLine, Grain, Scrim, Vignette } from './fx/Overlays';
import { ShotTransition } from './fx/Transition';
import { ensureFonts } from './theme/fonts';
import { msToFrame } from './theme/motion';

ensureFonts();

/**
 * Images edge to edge, one after another. Each transition is centred on the cut:
 * the incoming shot starts half a transition early, the outgoing one ends half late.
 */
export const Reel: React.FC<ReelProps> = ({ timeline: tl, settings: s }) => {
  const { fps } = useVideoConfig();
  const total = Math.max(1, msToFrame(tl.durationMs, fps));
  const tFrames = Math.round((s.images.transitionMs / 1000) * fps);

  const shots = useMemo(() => {
    const half = (sh: TShot | undefined) => (!sh || sh.transition === 'cut' ? 0 : Math.floor(tFrames / 2));
    return tl.shots.map((sh: TShot, i: number) => {
      const next = tl.shots[i + 1];
      const cutIn = msToFrame(sh.startMs, fps);
      const cutOut = next ? msToFrame(next.startMs, fps) : total;
      const inHalf = i === 0 ? 0 : half(sh);
      const outHalf = half(next);
      const from = Math.max(0, cutIn - inHalf);
      const to = Math.min(total, cutOut + outHalf);
      return {
        sh,
        from,
        dur: Math.max(1, to - from),
        inFrames: (cutIn - from) * 2,
        exit: next && next.transition !== 'cut' ? next.transition : null,
        outFrames: (to - cutOut) * 2,
      };
    });
  }, [tl.shots, fps, total, tFrames]);

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {shots.map(({ sh, from, dur, inFrames, exit, outFrames }) => (
        <Sequence key={sh.id} from={from} durationInFrames={dur} name={`${sh.src} · ${sh.motion}`}>
          <ShotTransition enter={sh.transition} inFrames={inFrames} exit={exit} outFrames={outFrames} durationInFrames={dur}>
            <KenBurns shot={sh} durationInFrames={dur} amount={s.images.motion} />
          </ShotTransition>
        </Sequence>
      ))}
      <Vignette amount={s.look.vignette} />
      {s.captions.mode !== 'off' ? <Scrim amount={s.look.scrim} y={s.captions.y} /> : null}
      <Captions words={tl.words} settings={s} />
      <BrandLine settings={s} />
      <Grain amount={s.look.grain} />
      <AudioMix timeline={tl} settings={s} />
    </AbsoluteFill>
  );
};
