/** Text helpers shared by the script parser, the aligner and the rules engine. */

export const STOPWORDS = new Set(
  (
    'a an the and or but if then so of to in on at by for with from as is are was were be been being am ' +
    'it its it’s it\'s this that these those there here i me my we our you your he she him her they them their ' +
    'do does did done have has had not no yes just very really can could will would should may might must ' +
    'what which who whom whose when where why how all any each every some such than too also only own same ' +
    'about into over under again further once up down out off more most other nor now get got let lets let’s'
  ).split(/\s+/),
);

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, a: 1,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9, bn: 1e9 };
const CURRENCY_WORDS = new Set(['dollar', 'dollars', 'pound', 'pounds', 'euro', 'euros', 'rupee', 'rupees', 'quid', 'bucks']);

/** strip everything but letters/digits/%/. – used to compare words */
export const norm = (t: string): string => {
  let s = t.toLowerCase().replace(/[’']/g, '');
  s = s.replace(/(\d),(?=\d{3})/g, '$1'); // 15,000 -> 15000
  s = s.replace(/[^a-z0-9%.]/g, '');
  s = s.replace(/\.+$/, '').replace(/^\.+/, '');
  if (s === 'percent' || s === 'per-cent') return '%';
  return s;
};

/** "fifteen thousand" -> 15000. Returns null when the tokens are not a number phrase. */
export const wordsToNumber = (tokens: string[]): number | null => {
  const t = tokens.map(norm).filter((x) => x && x !== 'and');
  if (!t.length) return null;
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of t) {
    if (/^\d+(\.\d+)?$/.test(w)) {
      current += parseFloat(w);
      seen = true;
    } else if (w in UNITS && !(w === 'a' && t.length === 1)) {
      current += UNITS[w];
      seen = true;
    } else if (w in SCALES && seen) {
      const sc = SCALES[w];
      if (sc === 100) current *= 100;
      else {
        total += current * sc;
        current = 0;
      }
    } else return null;
  }
  return seen ? total + current : null;
};

/**
 * Canonical form of a token span for alignment: numbers become digits,
 * "percent" becomes %, currency words drop out.
 */
export const canonical = (tokens: string[]): string => {
  const all = tokens.map(norm).filter(Boolean);
  // currency words only vanish next to a number ("fifteen thousand pounds" == "£15,000")
  const numeric = all.some((x) => /\d/.test(x) || x in UNITS || x in SCALES);
  const parts = numeric ? all.filter((x) => !CURRENCY_WORDS.has(x)) : all;
  if (!parts.length) return '';
  const hasPct = parts[parts.length - 1] === '%';
  const numParts = hasPct ? parts.slice(0, -1) : parts;
  // "15k" / "1.2m"
  if (numParts.length === 1) {
    const m = numParts[0].match(/^(\d+(?:\.\d+)?)(k|m|bn|b)?(%)?$/);
    if (m) {
      const v = parseFloat(m[1]) * (m[2] ? SCALES[m[2] === 'b' ? 'bn' : m[2]] : 1);
      return String(v) + (hasPct || m[3] ? '%' : '');
    }
  }
  const n = wordsToNumber(numParts);
  if (n !== null) return String(n) + (hasPct ? '%' : '');
  return parts.join('');
};

export const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
};

/** 0..1 similarity of two canonical strings */
export const similarity = (a: string, b: string): number => {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
};

export const isSentenceEnd = (t: string): boolean => /[.!?…]["'”’)]*$/.test(t);
export const isClauseEnd = (t: string): boolean => /[,;:—–-]["'”’)]*$/.test(t) || isSentenceEnd(t);

/** £15,000 · 10K · 92% · 3x · 1.2M · 40 */
export const NUMBER_RE = /^([£$€₹]?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)([kKmMbB]n?|%|x|\+)?([.,!?;:]*)$/;
export const isNumberToken = (t: string): boolean => NUMBER_RE.test(t.replace(/["“”]/g, ''));

export const parseStat = (raw: string) => {
  const clean = raw.replace(/["“”]/g, '');
  const m = clean.match(NUMBER_RE);
  if (!m) return null;
  const grouping = m[2].includes(',');
  const numStr = m[2].replace(/,/g, '');
  const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0;
  return {
    raw: (m[1] ?? '') + m[2] + (m[3] ?? ''),
    prefix: m[1] ?? '',
    value: parseFloat(numStr),
    decimals,
    suffix: m[3] ?? '',
    grouping,
  };
};

/** strip trailing/leading punctuation for display decisions (keeps the original for rendering) */
export const bare = (t: string): string => t.replace(/^[^\p{L}\p{N}£$€₹]+|[^\p{L}\p{N}%]+$/gu, '');

export const isCapitalised = (t: string): boolean => /^\p{Lu}/u.test(bare(t)) && bare(t) !== 'I';
