/** Small seeded PRNG (mulberry32) so the same inputs always give the same reel. */
export type Rng = {
  next: () => number;
  int: (min: number, maxInclusive: number) => number;
  pick: <T>(arr: readonly T[]) => T;
  /** pick, avoiding the given values when possible */
  pickNot: <T>(arr: readonly T[], avoid: readonly (T | undefined)[]) => T;
};

export const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const createRng = (seed: number | string): Rng => {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)];
  const pickNot = <T,>(arr: readonly T[], avoid: readonly (T | undefined)[]) => {
    const ok = arr.filter((x) => !avoid.includes(x));
    return pick(ok.length ? ok : arr);
  };
  return { next, int, pick, pickNot };
};
