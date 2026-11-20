/** Where sound effects go. Sparse on purpose: SFX should accent, not decorate. */
import type { Settings, TBeat, TPage, TSfx } from '../shared/schema';

const GAIN: Record<TSfx['kind'], number> = { whoosh: 1, pop: 0.7, tick: 0.55, riser: 0.75, hit: 1 };

export const planSfx = (beats: TBeat[], pages: TPage[], s: Settings): TSfx[] => {
  if (!s.audio.sfx || s.audio.sfxVolume <= 0) return [];
  const v = (k: TSfx['kind']) => +(s.audio.sfxVolume * GAIN[k]).toFixed(3);
  const out: TSfx[] = [];
  let lastWhoosh = -Infinity;

  for (const b of beats) {
    if (b.id > 0 && ['slide', 'whip', 'wipe', 'zoom-punch'].includes(b.transition) && b.kind !== 'end') {
      const at = Math.max(0, b.startMs - 180);
      if (at - lastWhoosh >= 1200) {
        out.push({ kind: 'whoosh', atMs: at, volume: v('whoosh') });
        lastWhoosh = at;
      }
    }
    if (b.kind === 'stat' && b.stat) {
      const page = pages.find((p) => p.startMs >= b.startMs - 1 && p.words.some((w) => w.role === 'key'));
      const keyWord = page?.words.find((w) => w.role === 'key');
      const t = keyWord ? keyWord.startMs : b.startMs;
      out.push({ kind: 'tick', atMs: t, volume: v('tick') });
      out.push({ kind: 'hit', atMs: t + 650, volume: v('hit') });
    }
    if (b.kind === 'end' && b.startMs > 1300) out.push({ kind: 'riser', atMs: b.startMs - 1150, volume: v('riser') });
  }

  // pops on stacked keyword pages over images
  let lastPop = -Infinity;
  for (const p of pages) {
    if (p.style !== 'stack' || p.keyStyle === 'none' || p.hook) continue;
    const beat = beats.find((b) => p.startMs >= b.startMs - 1 && p.startMs < b.endMs);
    if (!beat || beat.kind !== 'image') continue;
    const key = p.words.find((w) => w.role === 'key');
    if (!key) continue;
    const nearOther = out.some((x) => Math.abs(x.atMs - key.startMs) < 450);
    if (key.startMs - lastPop >= 2500 && !nearOther) {
      out.push({ kind: 'pop', atMs: key.startMs, volume: v('pop') });
      lastPop = key.startMs;
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
};
