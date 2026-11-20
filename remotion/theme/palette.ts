import type { Settings } from '../../shared/schema';

/** Where text sits decides its colours. Amber is never used as text on paper (≈2:1 contrast). */
export type Surface = 'image' | 'paper' | 'dark' | 'brand';

export type Palette = {
  text: string;
  lead: string;
  key: string;
  bar: string;
  /** key text colour when sitting on the bar */
  onBar: string;
  closer: string;
  shadow: string;
  glow: string | null;
  extrude: string;
};

export const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};
export const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
export const shade = (hex: string, amount: number) => {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

export const palette = (surface: Surface, s: Settings): Palette => {
  const c = s.colors;
  switch (surface) {
    case 'image':
      return {
        text: c.onImage,
        lead: rgba(c.onImage, 0.94),
        key: c.accent,
        bar: rgba(c.primary, 0.88),
        onBar: c.onImage,
        closer: c.onImage,
        shadow: '0 6px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35)',
        glow: s.look.glow > 0 ? rgba(c.primary, 0.55 * s.look.glow) : null,
        extrude: shade(c.accent, -0.45),
      };
    case 'paper':
      return {
        text: c.ink,
        lead: rgba(c.ink, 0.86),
        key: c.primary,
        bar: rgba(c.accent, 0.85),
        onBar: c.primary,
        closer: c.ink,
        shadow: 'none',
        glow: null,
        extrude: shade(c.primary, -0.45),
      };
    case 'dark':
      return {
        text: c.paper,
        lead: rgba(c.paper, 0.88),
        key: c.accent,
        bar: rgba(c.primary, 0.9),
        onBar: c.paper,
        closer: c.paper,
        shadow: '0 4px 20px rgba(0,0,0,0.5)',
        glow: s.look.glow > 0 ? rgba(c.primary, 0.45 * s.look.glow) : null,
        extrude: shade(c.accent, -0.5),
      };
    case 'brand':
      return {
        text: c.paper,
        lead: rgba(c.paper, 0.9),
        key: c.paper,
        bar: rgba(c.accent, 0.92),
        onBar: c.ink,
        closer: c.paper,
        shadow: '0 4px 18px rgba(0,0,0,0.22)',
        glow: null,
        extrude: shade(c.primary, -0.5),
      };
  }
};
