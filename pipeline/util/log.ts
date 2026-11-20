/* Minimal coloured logging, no dependencies. */
const tty = process.stdout.isTTY;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

export const color = {
  dim: c(2),
  bold: c(1),
  red: c(31),
  green: c(32),
  yellow: c(33),
  blue: c(34),
  cyan: c(36),
};

export const log = {
  step: (s: string) => console.log(`\n${color.bold(color.cyan('▸'))} ${color.bold(s)}`),
  info: (s: string) => console.log(`  ${s}`),
  ok: (s: string) => console.log(`  ${color.green('✓')} ${s}`),
  warn: (s: string) => console.log(`  ${color.yellow('!')} ${s}`),
  err: (s: string) => console.error(`  ${color.red('✗')} ${s}`),
  dim: (s: string) => console.log(`  ${color.dim(s)}`),
};

/** single-line progress for TTYs, plain lines otherwise */
export const progress = (label: string) => {
  let last = -1;
  return (fraction: number) => {
    const pct = Math.floor(fraction * 100);
    if (pct === last) return;
    last = pct;
    if (tty) {
      const w = 28;
      const fill = Math.round((pct / 100) * w);
      process.stdout.write(`\r  ${label} [${'█'.repeat(fill)}${'·'.repeat(w - fill)}] ${pct}%   `);
      if (pct >= 100) process.stdout.write('\n');
    } else if (pct % 10 === 0) {
      console.log(`  ${label} ${pct}%`);
    }
  };
};
