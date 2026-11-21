import React, { useMemo } from 'react';
import { Audio, Sequence, staticFile, useVideoConfig } from 'remotion';
import type { Settings, Timeline } from '../shared/schema';
import { msToFrame } from './theme/motion';

/**
 * Voice + SFX + optional music, all mixed inside the composition so Studio preview
 * sounds exactly like the render. Music ducks under speech using the word timings.
 */
export const AudioMix: React.FC<{ timeline: Timeline; settings: Settings }> = ({ timeline: tl, settings: s }) => {
  const { fps, durationInFrames } = useVideoConfig();

  const musicCurve = useMemo(() => {
    if (!tl.music) return null;
    const low = s.audio.musicVolume;
    const high = Math.min(0.6, low * 2.2);
    const curve = new Float32Array(durationInFrames);
    let si = 0;
    let v = high;
    for (let f = 0; f < durationInFrames; f++) {
      const ms = (f / fps) * 1000;
      while (si < tl.speech.length && tl.speech[si][1] + 150 < ms) si++;
      const speaking = si < tl.speech.length && ms >= tl.speech[si][0] - 120;
      const target = speaking ? low : high;
      v += (target - v) * (target < v ? 0.35 : 0.08); // fast duck, slow recovery
      const fadeIn = Math.min(1, f / (fps * 0.3));
      const fadeOut = Math.min(1, (durationInFrames - f) / (fps * 1.2));
      curve[f] = v * fadeIn * fadeOut;
    }
    return curve;
  }, [tl.music, tl.speech, s.audio.musicVolume, fps, durationInFrames]);

  return (
    <>
      {tl.voice.src ? <Audio src={staticFile(tl.voice.src)} volume={s.audio.voiceVolume} /> : null}
      {tl.music && musicCurve ? (
        <Audio src={staticFile(tl.music.src)} loop volume={(f) => musicCurve[Math.min(musicCurve.length - 1, Math.max(0, f))]} />
      ) : null}
      {tl.sfx.map((fx, i) => (
        // runs to the end of the reel so long sounds (your own files) are never cut short
        <Sequence key={i} from={msToFrame(fx.atMs, fps)} durationInFrames={Math.max(1, durationInFrames - msToFrame(fx.atMs, fps))} layout="none" name={fx.src}>
          <Audio src={staticFile(fx.src)} volume={fx.volume} />
        </Sequence>
      ))}
    </>
  );
};
