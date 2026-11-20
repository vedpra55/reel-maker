import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Settings, TPage, TStat } from '../../shared/schema';
import { EASE_OUT, msToFrame, pop, ramp } from '../theme/motion';
import type { Palette } from '../theme/palette';
import { fitSize } from './Stack';
import { AnimatedWord } from './Word';

const format = (st: TStat, v: number) =>
  st.prefix +
  v.toLocaleString('en-US', {
    minimumFractionDigits: st.decimals,
    maximumFractionDigits: st.decimals,
    useGrouping: st.grouping,
  }) +
  st.suffix;

/** layered offset shadows = cheap "extruded" 3D number */
const extrude = (color: string, depth: number) => {
  const layers: string[] = [];
  for (let i = 1; i <= depth; i++) layers.push(`${(i * 0.5).toFixed(1)}px ${(i * 0.85).toFixed(1)}px 0 ${color}`);
  layers.push(`0 ${depth * 2.2}px ${depth * 3}px rgba(0,0,0,0.28)`);
  return layers.join(', ');
};

/**
 *           cross
 *        ▇▇ 10K ▇▇      ← counts up, extruded, colour bar wipes in behind
 *     followers mark,
 */
export const StatType: React.FC<{ page: TPage; stat: TStat; settings: Settings; palette: Palette; maxWidth: number; frames?: number }> = ({
  page,
  stat,
  settings: s,
  palette: pal,
  maxWidth,
  frames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = (ms: number) => msToFrame(ms - s.captions.leadInMs - page.startMs, fps);
  const keyIdx = page.words.findIndex((w) => w.role === 'key');
  const key = page.words[Math.max(0, keyIdx)];
  const before = page.words.slice(0, Math.max(0, keyIdx));
  const after = page.words.slice(keyIdx + 1);
  const at = appear(key.startMs);

  const count = ramp(frame, at, Math.round(fps * 0.75), EASE_OUT);
  const shown = format(stat, stat.value * count);
  const finalText = format(stat, stat.value);
  const size = fitSize(finalText, s.type.keySize * 1.75, maxWidth * 0.92, 0.72, 0.4);
  const p = pop(frame, fps, s.intensity, at);
  const bar = ramp(frame, at + 2, 10, EASE_OUT);
  const total = frames ?? msToFrame(page.endMs - page.startMs, fps);
  const out = 1 - ramp(frame, total - 3, 3);
  const light = (ws: typeof before) =>
    ws.length ? (
      <div style={{ display: 'flex', gap: '0.24em', fontFamily: 'Montserrat', fontWeight: 300, fontSize: s.type.leadSize, color: pal.lead }}>
        {ws.map((w, i) => (
          <AnimatedWord key={i} appearAt={appear(w.startMs)} settings={s}>
            {w.text}
          </AnimatedWord>
        ))}
      </div>
    ) : null;

  return (
    <div style={{ width: maxWidth, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: out }}>
      {light(before)}
      <div style={{ position: 'relative', marginTop: '-0.05em', zIndex: 0 }}>
        <div
          style={{
            position: 'absolute',
            left: '-8%',
            right: '-8%',
            top: '46%',
            height: size * 0.3,
            background: pal.bar,
            transform: `scaleX(${bar})`,
            transformOrigin: 'left center',
            zIndex: -1,
          }}
        />
        <div
          style={{
            fontFamily: 'Montserrat',
            fontWeight: 900,
            fontSize: size,
            lineHeight: 1,
            letterSpacing: '-0.04em',
            color: pal.key,
            textShadow: extrude(pal.extrude, 10),
            fontVariantNumeric: 'tabular-nums',
            opacity: frame < at - 1 ? 0 : Math.min(1, p * 2),
            transform: `scale(${0.6 + 0.4 * p})`,
            whiteSpace: 'nowrap',
          }}
        >
          {/* keep the final width so the block does not breathe while counting */}
          <span style={{ visibility: 'hidden' }}>{finalText}</span>
          <span style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center' }}>{shown}</span>
        </div>
      </div>
      <div style={{ marginTop: '0.15em' }}>{light(after)}</div>
    </div>
  );
};
