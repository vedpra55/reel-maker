/**
 * `reel doctor [--fix] [--yes]`: checks everything the pipeline needs on a Mac and
 * offers to install what's missing (ffmpeg via Homebrew, Remotion's headless Chrome).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { ensureBrowser } from '@remotion/renderer';
import { FONTS_DIR, ROOT, SFX_DIR } from './paths';
import { ensureSfx } from './synth';
import { run, runLive, which } from './util/exec';
import { FFMPEG, FFPROBE, listEncoders, listFilters } from './util/ffmpeg';
import { color, log } from './util/log';

type Check = {
  name: string;
  ok: boolean;
  detail: string;
  /** false = only a warning */
  required: boolean;
  fix?: { label: string; run: () => Promise<boolean> };
};

const isMac = process.platform === 'darwin';
const brew = (pkg: string) => async () => (await runLive('brew', ['install', pkg])) === 0;

const ask = async (q: string, yes: boolean) => {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`  ${q} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === 'y' || a === 'yes';
};

const freeDiskGB = async (dir: string) => {
  const r = await run('df', ['-k', dir]);
  const cols = r.stdout.trim().split('\n').pop()?.split(/\s+/) ?? [];
  const kb = Number(cols[3]);
  return Number.isFinite(kb) ? kb / 1024 / 1024 : NaN;
};

export const collectChecks = async (): Promise<Check[]> => {
  const checks: Check[] = [];
  const hasBrew = !!which('brew');

  // machine
  const arch = os.arch();
  checks.push({
    name: 'Machine',
    ok: true,
    detail: `${isMac ? 'macOS' : process.platform} ${arch}${isMac && arch !== 'arm64' ? ' (Intel – works, renders slower)' : ''}`,
    required: false,
  });
  const ram = os.totalmem() / 2 ** 30;
  checks.push({
    name: 'Memory',
    ok: ram >= 7.5,
    detail: `${ram.toFixed(0)} GB${ram <= 8.5 ? ' – renders use concurrency ≤ 3 to stay smooth' : ''}`,
    required: false,
  });
  const disk = await freeDiskGB(ROOT);
  checks.push({ name: 'Free disk', ok: !(disk < 5), detail: Number.isNaN(disk) ? 'unknown' : `${disk.toFixed(0)} GB free (need ~5 GB)`, required: false });

  // toolchain
  if (isMac) {
    checks.push({
      name: 'Homebrew',
      ok: hasBrew,
      detail: hasBrew ? 'installed' : 'missing – install from https://brew.sh, then run reel doctor --fix again',
      required: true,
    });
  }
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node.js',
    ok: nodeMajor >= 20,
    detail: `v${process.versions.node}${nodeMajor >= 20 ? '' : ' – need 20 or newer'}`,
    required: true,
    fix: hasBrew ? { label: 'brew install node', run: brew('node') } : undefined,
  });

  // ffmpeg
  const ff = which(FFMPEG);
  const fp = which(FFPROBE);
  if (!ff || !fp) {
    checks.push({
      name: 'ffmpeg + ffprobe',
      ok: false,
      detail: 'missing',
      required: true,
      fix: hasBrew ? { label: 'brew install ffmpeg', run: brew('ffmpeg') } : undefined,
    });
  } else {
    const ver = (await run(FFMPEG, ['-version'])).stdout.split('\n')[0].replace('ffmpeg version ', '').split(' ')[0];
    const filters = await listFilters();
    const need = ['loudnorm', 'silencedetect', 'afftdn', 'acompressor', 'aselect', 'aevalsrc', 'tile', 'highpass'];
    const missing = need.filter((f) => !new RegExp(`\\s${f}\\s`).test(filters));
    const x264 = /libx264/.test(await listEncoders());
    checks.push({
      name: 'ffmpeg + ffprobe',
      ok: missing.length === 0 && x264,
      detail: `${ver}${missing.length ? `, missing filters: ${missing.join(', ')}` : ''}${x264 ? '' : ', no libx264'}`,
      required: true,
      fix: hasBrew ? { label: 'brew reinstall ffmpeg', run: async () => (await runLive('brew', ['reinstall', 'ffmpeg'])) === 0 } : undefined,
    });
  }

  // Remotion's headless Chrome
  const custom = process.env.REEL_BROWSER;
  const remotionDir = path.join(ROOT, 'node_modules', '.remotion');
  const hasChrome = custom ? fs.existsSync(custom) : fs.existsSync(remotionDir) && fs.readdirSync(remotionDir).length > 0;
  checks.push({
    name: 'Headless Chrome (Remotion)',
    ok: hasChrome,
    detail: custom ? `REEL_BROWSER=${custom}` : hasChrome ? 'installed' : 'not downloaded yet (~100 MB)',
    required: true,
    fix: {
      label: 'download Remotion’s Chrome Headless Shell',
      run: async () => {
        const st = await ensureBrowser();
        return st.type !== 'no-browser';
      },
    },
  });

  // bundled assets
  const fonts = fs.existsSync(FONTS_DIR) ? fs.readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2')) : [];
  checks.push({ name: 'Bundled fonts', ok: fonts.length >= 5, detail: `${fonts.length} files in assets/fonts`, required: true });
  const made = ensureSfx(SFX_DIR);
  checks.push({ name: 'Sound effects', ok: true, detail: made.length ? `generated ${made.join(', ')}` : 'ready (assets/sfx – swap in your own any time)', required: false });

  return checks;
};

export const doctor = async (opts: { fix: boolean; yes: boolean }) => {
  log.step('Checking your setup');
  let checks = await collectChecks();
  const print = (cs: Check[]) => {
    for (const c of cs) {
      const mark = c.ok ? color.green('✓') : c.required ? color.red('✗') : color.yellow('!');
      console.log(`  ${mark} ${c.name.padEnd(30)} ${color.dim(c.detail)}`);
    }
  };
  print(checks);
  const broken = checks.filter((c) => !c.ok && c.fix);
  if (opts.fix && broken.length) {
    log.step('Fixing');
    for (const c of broken) {
      if (!(await ask(`${c.name}: ${c.fix!.label}?`, opts.yes))) continue;
      try {
        const ok = await c.fix!.run();
        if (ok) log.ok(c.name);
        else log.warn(`${c.name}: finish the installer, then run reel doctor again`);
      } catch (e) {
        log.err(`${c.name}: ${(e as Error).message}`);
      }
    }
    log.step('After fixes');
    checks = await collectChecks();
    print(checks);
  } else if (broken.length) {
    console.log(`\n  Run ${color.bold('reel doctor --fix')} to install what's missing.`);
  }
  const blocking = checks.filter((c) => !c.ok && c.required);
  console.log(blocking.length ? `\n  ${color.red(`${blocking.length} required item(s) missing.`)}` : `\n  ${color.green('All set.')} Try: ./reel example && ./reel make example`);
  return blocking.length === 0;
};
