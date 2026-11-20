import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Role, Settings, TPage, TWord } from '../../shared/schema';
import { msToFrame, ramp } from '../theme/motion';
import type { Palette } from '../theme/palette';
import { AnimatedWord, KeyBar } from './Word';

/**
 * The editorial stack from the references:
 *        was i             ← lead   (light, small)
 *      started             ← key    (heavy, big, colour or bar)
 *            practice      ← closer (italic serif, tucked under / overlapping)
 */
type Line = { kind: 'light' | 'key' | 'closer'; words: TWord[] };

const lineKind = (r: Role): Line['kind'] => (r === 'key' ? 'key' : r === 'closer' ? 'closer' : 'light');

export const toLines = (words: TWord[]): Line[] => {
  const lines: Line[] = [];
  for (const w of words) {
    const k = lineKind(w.role);
    const last = lines[lines.length - 1];
    if (last && last.kind === k) last.words.push(w);
    else lines.push({ kind: k, words: [w] });
  }
  return lines;
};

const lineText = (l: Line) => l.words.map((w) => w.text).join(' ');

/** approximate width-fit for a single line (Montserrat heavy ≈ 0.64em per char) */
export const fitSize = (text: string, base: number, maxWidth: number, perChar: number, min = 0.5) =>
  Math.max(base * min, Math.min(base, maxWidth / Math.max(1, text.length * perChar)));

export const Stack: React.FC<{
  page: TPage;
  settings: Settings;
  palette: Palette;
  maxWidth: number;
  scale?: number;
  /** visible length in frames (for the exit) */
  frames?: number;
}> = ({ page, settings: s, palette: pal, maxWidth, scale = 1, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = s.type;
  const appear = (w: TWord) => msToFrame(w.startMs - s.captions.leadInMs - page.startMs, fps);
  const lines = toLines(page.words);
  const keySize = t.keySize * scale;
  const leadSize = t.leadSize * scale;
  const serif = t.closer === 'serif';

  // exit: quick fade on the last frames of the page
  const total = frames ?? msToFrame(page.endMs - page.startMs, fps);
  const out = 1 - ramp(frame, total - 3, 3);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        width: maxWidth,
        opacity: out,
        transform: `scale(${0.97 + 0.03 * out})`,
      }}
    >
      {lines.map((line, li) => {
        const text = lineText(line);
        if (line.kind === 'light') {
          const size = fitSize(text, leadSize, maxWidth, 0.56, 0.6);
          return (
            <div key={li} style={rowStyle(size, li > 0 ? -0.02 : 0)}>
              {line.words.map((w, i) => (
                <AnimatedWord key={i} appearAt={appear(w)} settings={s} style={{ fontFamily: 'Montserrat', fontWeight: 300, color: pal.lead, textShadow: pal.shadow }}>
                  {w.text}
                </AnimatedWord>
              ))}
            </div>
          );
        }
        if (line.kind === 'key') {
          const display = t.uppercaseKeys ? text.toUpperCase() : text;
          const size = fitSize(display, keySize, maxWidth, t.uppercaseKeys ? 0.74 : 0.64, 0.42);
          const bar = page.keyStyle === 'bar';
          return (
            <div key={li} style={{ ...rowStyle(size, -0.06), lineHeight: 0.98 }}>
              {line.words.map((w, i) => (
                <span key={i} style={{ position: 'relative', display: 'inline-block', zIndex: 0 }}>
                  {bar ? <KeyBar appearAt={appear(w)} color={pal.bar} /> : null}
                  <AnimatedWord
                    appearAt={appear(w)}
                    settings={s}
                    emphasis={1}
                    style={{
                      fontFamily: 'Montserrat',
                      fontWeight: t.keyWeight,
                      fontStyle: t.keyItalic ? 'italic' : 'normal',
                      letterSpacing: '-0.035em',
                      color: bar ? pal.onBar : page.keyStyle === 'none' ? pal.text : pal.key,
                      textShadow: pal.shadow,
                      textTransform: t.uppercaseKeys ? 'uppercase' : 'none',
                    }}
                  >
                    {w.text}
                  </AnimatedWord>
                </span>
              ))}
            </div>
          );
        }
        // closer: italic, tucked up under the key and nudged right
        const size = fitSize(text, keySize * (serif ? 0.66 : 0.5), maxWidth, serif ? 0.42 : 0.55, 0.5);
        const prevIsKey = lines[li - 1]?.kind === 'key';
        return (
          <div
            key={li}
            style={{
              ...rowStyle(size, prevIsKey ? -0.34 : 0),
              transform: prevIsKey ? 'translateX(12%)' : undefined,
            }}
          >
            {line.words.map((w, i) => (
              <AnimatedWord
                key={i}
                appearAt={appear(w)}
                settings={s}
                from="right"
                style={{
                  fontFamily: serif ? `'${t.serif}', serif` : 'Montserrat',
                  fontWeight: serif ? 400 : 300,
                  fontStyle: 'italic',
                  color: pal.closer,
                  textShadow: pal.shadow,
                  letterSpacing: serif ? '-0.01em' : '-0.02em',
                }}
              >
                {w.text}
              </AnimatedWord>
            ))}
          </div>
        );
      })}
    </div>
  );
};

const rowStyle = (size: number, marginTopEm: number): React.CSSProperties => ({
  fontSize: size,
  lineHeight: 1.05,
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  columnGap: '0.24em',
  marginTop: `${marginTopEm}em`,
  whiteSpace: 'nowrap',
});
