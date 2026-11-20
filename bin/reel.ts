#!/usr/bin/env -S npx tsx
/**
 * reel — voice + images in, Instagram reel out.
 *
 *   reel doctor [--fix]          check / install ffmpeg, Chrome, whisper.cpp
 *   reel new <name>              create reels/<name>/
 *   reel prep <name>             clean audio, transcribe, ingest images, write script.md
 *   reel plan <name>             script.md + settings → timeline.json
 *   reel preview <name>          open Remotion Studio on the reel
 *   reel render <name>           timeline → out/reel.mp4 (+ contact sheet, report)
 *   reel make <name>             prep + plan + render
 *   reel still <name> 1.5 4      single frames for a quick look
 *   reel example                 build a demo reel (no recording needed)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { PRESET_NAMES } from '../shared/presets';
import { doctor } from '../pipeline/doctor';
import { makeExample } from '../pipeline/example';
import { finalize, writeReport } from '../pipeline/finalize';
import { ROOT, REELS_DIR, ensureDir, findAudio, readJson, reelImages, reelPaths, writeJson, type ReelPaths } from '../pipeline/paths';
import { writeActive } from '../pipeline/active';
import { plan, type PlanReport } from '../pipeline/plan';
import { prep } from '../pipeline/prep';
import { preparePublic, renderReel, renderStills } from '../pipeline/render';
import { loadSettings, parseOverride, deepMerge } from '../pipeline/settings';
import { color, log } from '../pipeline/util/log';

type Common = { preset?: string; set?: string[]; seed?: string; intensity?: string };

const settingsFor = (p: ReelPaths, o: Common) => {
  let over: Record<string, unknown> = {};
  for (const kv of o.set ?? []) over = deepMerge(over, parseOverride(kv));
  if (o.preset) over.preset = o.preset;
  if (o.seed !== undefined) over.seed = Number(o.seed);
  if (o.intensity !== undefined) over.intensity = Number(o.intensity);
  return loadSettings(p, over);
};

const existing = (name: string) => {
  const p = reelPaths(name);
  if (!fs.existsSync(p.dir)) throw new Error(`No reel folder ${p.dir}. Create it with: reel new ${name}`);
  return p;
};

const printPlan = (r: { report: PlanReport }) => {
  const rep = r.report;
  log.ok(
    `${rep.pages} caption pages (${rep.stackPages} stacked), beats: ${Object.entries(rep.beats).map(([k, v]) => `${v} ${k}`).join(', ')}`,
  );
  if (rep.alignScore !== null) log.ok(`script matches ${(rep.alignScore * 100).toFixed(0)}% of the spoken words`);
  if (rep.unmatched.length) log.warn(`spoken but not in script.md: ${rep.unmatched.slice(0, 12).join(' ')}`);
  for (const w of rep.warnings) log.warn(w);
};

const doPlan = (p: ReelPaths, o: Common) => {
  log.step('Planning');
  const s = settingsFor(p, o);
  const r = plan(p, s);
  printPlan(r);
  log.ok(`timeline.json written (${(r.timeline.durationMs / 1000).toFixed(1)}s)`);
  return { s, r };
};

const doRender = async (p: ReelPaths, o: Common & { draft?: boolean }, planReport: PlanReport | null) => {
  log.step(o.draft ? 'Rendering draft' : 'Rendering');
  const s = settingsFor(p, o);
  const res = await renderReel(p, s, { draft: o.draft });
  if (o.draft) {
    log.ok(`${path.relative(process.cwd(), res.out)} in ${res.seconds.toFixed(0)}s`);
    return;
  }
  log.step('Finishing');
  const f = await finalize(p, s, res.out, res.timeline);
  writeReport(p, { plan: planReport, timeline: res.timeline, sizeMB: f.sizeMB, renderS: res.seconds, settings: s });
  log.ok(`${color.bold(path.relative(process.cwd(), f.out))}  ${f.sizeMB.toFixed(1)} MB, rendered in ${res.seconds.toFixed(0)}s`);
  log.ok(`contact sheet: ${path.relative(process.cwd(), f.sheet)}`);
  log.ok(`report: ${path.relative(process.cwd(), path.join(p.out, 'report.txt'))}`);
};

const program = new Command();
program.name('reel').description('Voice + images → polished Instagram reel. No AI in the render path.');

const common = (c: Command) =>
  c
    .option('-p, --preset <name>', `settings preset (${PRESET_NAMES.join(', ')})`)
    .option('--seed <n>', 'reshuffle motion/transition choices')
    .option('--intensity <0..1>', 'motion amount')
    .option('-s, --set <key=value...>', 'override any setting, e.g. --set captions.y=0.55 look.grain=0');

program
  .command('doctor')
  .description('check (and with --fix, install) ffmpeg, headless Chrome, whisper.cpp')
  .option('--fix', 'install what is missing (asks first)')
  .option('-y, --yes', 'answer yes to every install question')
  .option('--no-whisper', 'skip whisper checks (if you always supply words.json)')
  .action(async (o) => {
    const ok = await doctor({ fix: !!o.fix, yes: !!o.yes, whisper: o.whisper !== false });
    process.exitCode = ok ? 0 : 1;
  });

program
  .command('new <name>')
  .description('create a reel folder')
  .option('-p, --preset <name>', 'preset to store in reel.json', 'anyash-light')
  .action((name: string, o) => {
    const p = reelPaths(name);
    if (fs.existsSync(p.dir) && fs.readdirSync(p.dir).length) throw new Error(`${p.dir} already exists`);
    ensureDir(p.images);
    writeJson(p.settings, { preset: o.preset, endCard: { cta: 'Follow for more' }, look: { brandLine: '' } });
    fs.writeFileSync(
      path.join(p.dir, 'README.txt'),
      [
        'Drop in:',
        '  voice.m4a      main voiceover (any audio format)',
        '  hook.m4a       optional separate hook recording (played first)',
        '  images/        01-name.jpg, 02-name.jpg … (filename order = default order)',
        '  music.mp3      optional, ducked under the voice',
        '',
        'Then:  reel prep ' + name + '   → edit script.md if you like →   reel render ' + name,
        'Settings for this reel live in reel.json (see README in the project root).',
      ].join('\n') + '\n',
    );
    log.ok(`created ${path.relative(process.cwd(), p.dir)}/`);
  });

common(
  program
    .command('prep <name>')
    .description('clean + tighten audio, transcribe, ingest images, write script.md if missing')
    .option('--no-whisper', 'require <piece>.words.json instead of transcribing'),
).action(async (name: string, o) => {
  const p = existing(name);
  await prep(p, settingsFor(p, o), { noWhisper: o.whisper === false });
  doPlan(p, o);
});

common(program.command('plan <name>').description('script.md + settings → timeline.json')).action((name: string, o) => {
  doPlan(existing(name), o);
});

common(
  program
    .command('render <name>')
    .description('render out/reel.mp4')
    .option('-d, --draft', 'half resolution, fast encode')
    .option('--no-plan', 'render timeline.json as-is (keep your hand edits)'),
).action(async (name: string, o) => {
  const p = existing(name);
  const r = o.plan === false ? null : doPlan(p, o).r.report;
  await doRender(p, o, r);
});

common(
  program
    .command('make <name>')
    .description('prep (if inputs changed) + plan + render')
    .option('-d, --draft', 'half resolution, fast encode')
    .option('--no-whisper', 'require <piece>.words.json instead of transcribing'),
).action(async (name: string, o) => {
  const p = existing(name);
  const stale = needsPrep(p);
  if (stale) await prep(p, settingsFor(p, o), { noWhisper: o.whisper === false });
  else log.dim('inputs unchanged – reusing prep (delete .build/ to force)');
  const { r } = doPlan(p, o);
  await doRender(p, o, r.report);
});

common(program.command('still <name> <seconds...>').description('render single frames to out/stills/')).action(
  async (name: string, seconds: string[], o) => {
    const p = existing(name);
    const { s } = doPlan(p, o);
    const files = await renderStills(p, s, seconds.map(Number));
    for (const f of files) log.ok(path.relative(process.cwd(), f));
  },
);

common(program.command('preview <name>').description('open Remotion Studio on this reel (live settings panel)')).action(
  async (name: string, o) => {
    const p = existing(name);
    const { s } = doPlan(p, o);
    await preparePublic(p);
    writeActive({ settings: s, timeline: readJson(p.timeline) });
    log.step('Opening Remotion Studio');
    log.info('Edit settings live in the right-hand panel (Props → settings).');
    log.info('To keep them: switch the panel to JSON, copy "settings" into reel.json, then reel render.');
    const child = spawn('npx', ['remotion', 'studio', 'remotion/index.ts', `--public-dir=${p.pub}`], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    await new Promise((res) => child.on('close', res));
  },
);

program
  .command('example')
  .description('create reels/example with a synthetic voice and generated images')
  .action(async () => {
    const p = await makeExample('example');
    log.ok(`created ${path.relative(process.cwd(), p.dir)}/  →  reel make example`);
  });

program
  .command('list')
  .description('list reels')
  .action(() => {
    if (!fs.existsSync(REELS_DIR)) return;
    for (const d of fs.readdirSync(REELS_DIR)) {
      const p = reelPaths(d);
      if (!fs.statSync(p.dir).isDirectory()) continue;
      const done = fs.existsSync(path.join(p.out, 'reel.mp4')) ? color.green('rendered') : fs.existsSync(p.timeline) ? 'planned' : fs.existsSync(p.prep) ? 'prepped' : 'new';
      console.log(`  ${d.padEnd(28)} ${done}`);
    }
  });

/** prep is stale when any input is newer than prep.json */
const needsPrep = (p: ReelPaths) => {
  if (!fs.existsSync(p.prep)) return true;
  const t = fs.statSync(p.prep).mtimeMs;
  const inputs = [findAudio(p.dir, 'voice'), findAudio(p.dir, 'hook'), findAudio(p.dir, 'music'), p.images, p.settings]
    .filter((x): x is string => !!x && fs.existsSync(x))
    .concat(reelImages(p))
    .concat(fs.readdirSync(p.dir).filter((f) => f.endsWith('.words.json')).map((f) => path.join(p.dir, f)));
  return inputs.some((f) => fs.statSync(f).mtimeMs > t);
};

program.parseAsync().catch((e: Error) => {
  log.err(e.message);
  if (process.env.REEL_DEBUG) console.error(e.stack);
  process.exit(1);
});

