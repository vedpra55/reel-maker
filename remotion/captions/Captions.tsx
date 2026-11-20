import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildCues, displayText, type Cue } from '../../shared/captions';
import { HEIGHT, WIDTH, type Settings, type TWord } from '../../shared/schema';
import { msToFrame } from '../theme/motion';

const SHADOW = '0 4px 20px rgba(0,0,0,0.55), 0 2px 5px rgba(0,0,0,0.45)';
const MAX_W = WIDTH - 140;

/** fit a line to the safe width (Montserrat heavy ≈ 0.62em per character) */
const fit = (text: string, size: number) => Math.min(size, MAX_W / Math.max(1, text.length * 0.62));

const useAppear = (localStartFrame: number, anim: Settings['captions']['anim']) => {
  const frame = useCurrentFrame();
  const f = frame - localStartFrame;
  if (anim === 'none') return { opacity: f >= 0 ? 1 : 0, transform: undefined };
  if (f < 0) return { opacity: 0, transform: undefined };
  // never start fully transparent: back-to-back words must not leave a blank frame between them
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  if (anim === 'fade') return { opacity: interpolate(f, [0, 3], [0.4, 1], clamp), transform: undefined };
  const o = interpolate(f, [0, 2], [0.6, 1], clamp);
  const sc = interpolate(f, [0, 2, 5], [0.88, 1.04, 1], clamp);
  return { opacity: o, transform: `scale(${sc})` };
};

const WordCue: React.FC<{ cue: Cue; s: Settings['captions'] }> = ({ cue, s }) => {
  const text = displayText(cue.words[0].text, s);
  const a = useAppear(0, s.anim);
  return (
    <div style={{ fontSize: fit(text, s.size), whiteSpace: 'nowrap', opacity: a.opacity, transform: a.transform }}>{text}</div>
  );
};

const PhraseWord: React.FC<{ w: TWord; cue: Cue; s: Settings['captions'] }> = ({ w, cue, s }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const local = msToFrame(Math.max(0, w.startMs - s.leadInMs) - cue.startMs, fps);
  const a = useAppear(local, s.anim);
  const nowMs = cue.startMs + (frame / fps) * 1000;
  const speaking = !!s.highlight && nowMs >= w.startMs && nowMs < w.endMs + 60;
  return (
    <span style={{ display: 'inline-block', opacity: a.opacity, transform: a.transform, color: speaking ? s.highlight : undefined }}>
      {displayText(w.text, s)}
    </span>
  );
};

const PhraseCue: React.FC<{ cue: Cue; s: Settings['captions'] }> = ({ cue, s }) => {
  const full = cue.words.map((w) => displayText(w.text, s)).join(' ');
  const size = Math.min(s.size, MAX_W / Math.max(1, (full.length / 2) * 0.62)); // allow two lines
  return (
    <div style={{ fontSize: size, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.25em', width: MAX_W, lineHeight: 1.1 }}>
      {cue.words.map((w, i) => (
        <PhraseWord key={i} w={w} cue={cue} s={s} />
      ))}
    </div>
  );
};

/** Plain word-by-word captions: white, bold, centred, inside Instagram's safe area. */
export const Captions: React.FC<{ words: TWord[]; settings: Settings }> = ({ words, settings }) => {
  const { fps } = useVideoConfig();
  const s = settings.captions;
  const cues = useMemo(() => buildCues(words, s), [words, s]);
  if (!cues.length) return null;
  const y = Math.min(Math.max(s.y * HEIGHT, settings.safeZone.top + s.size), HEIGHT - settings.safeZone.bottom - s.size);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {cues.map((cue, i) => {
        const from = msToFrame(cue.startMs, fps);
        const dur = Math.max(1, msToFrame(cue.endMs, fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none" name={cue.words.map((w) => w.text).join(' ')}>
            <div
              style={{
                position: 'absolute',
                left: WIDTH / 2,
                top: y,
                transform: 'translate(-50%, -50%)',
                fontFamily: 'Montserrat',
                fontWeight: s.weight,
                color: s.color,
                letterSpacing: '-0.01em',
                textAlign: 'center',
                textShadow: SHADOW,
              }}
            >
              {s.mode === 'word' ? <WordCue cue={cue} s={s} /> : <PhraseCue cue={cue} s={s} />}
            </div>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
