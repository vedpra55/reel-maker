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
import { doctor } from '../pipeline/doctor';
import { makeExample } from '../pipeline/example';
import { finalize, writeReport } from '../pipeline/finalize';
import { ROOT, REELS_DIR, ensureDir, findAudio, readJson, reelImages, reelPaths, writeJson, type ReelPaths } from '../pipeline/paths';
import { writeActive } from '../pipeline/active';
import { hasOwnCaptions } from '../pipeline/usertimeline';
import { plan, type PlanReport } from '../pipeline/plan';
import { prep } from '../pipeline/prep';
import { preparePublic, renderReel, renderStills } from '../pipeline/render';
import { loadSettings, parseOverride, deepMerge } from '../pipeline/settings';
import { color, log } from '../pipeline/util/log';

type Common = { set?: string[]; seed?: string; captions?: string };

const settingsFor = (p: ReelPaths, o: Common) => {
  let over: Record<string, unknown> = {};
  for (const kv of o.set ?? []) over = deepMerge(over, parseOverride(kv));
  if (o.seed !== undefined) over.seed = Number(o.seed);
  if (o.captions) over = deepMerge(over, { captions: { mode: o.captions } });
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
    rep.auto
      ? `Images: ${rep.shots}, spread evenly (your ${rep.input} has no image times yet)`
      : `Images: ${rep.shots}, at the times in your ${rep.input}`,
  );
  log.ok(
    rep.captionSource === 'words'
      ? 'Captions: your words, at the times you gave'
      : rep.captionSource === 'script'
        ? `Captions: your own text from ${rep.input}`
        : 'Captions: from the transcript of your voice',
  );
  if (rep.unusedImages.length) log.warn(`These images are not used anywhere: ${rep.unusedImages.join(', ')}`);
  for (const w of rep.warnings) log.warn(w);
};

/** after commands that only prepare, say what to run to get the video */
const nextStep = (p: ReelPaths) =>
  console.log(`\n  ${color.bold('Ready.')} To make the video, run:  ${color.cyan(`./reel make ${p.name}`)}\n`);

const doPlan = (p: ReelPaths, o: Common) => {
  log.step('Planning the reel');
  const s = settingsFor(p, o);
  const r = plan(p, s);
  printPlan(r);
  log.ok(`Reel length: ${(r.timeline.durationMs / 1000).toFixed(1)} seconds`);
  return { s, r };
};

const doRender = async (p: ReelPaths, o: Common & { draft?: boolean }, planReport: PlanReport | null) => {
  log.step(o.draft ? 'Making a quick low-res preview video' : 'Making the video (this takes a few minutes)');
  const s = settingsFor(p, o);
  const res = await renderReel(p, s, { draft: o.draft });
  if (o.draft) {
    log.ok(`Preview video: ${path.relative(process.cwd(), res.out)} (made in ${res.seconds.toFixed(0)}s)`);
    return;
  }
  log.step('Finishing');
  const f = await finalize(p, s, res.out, res.timeline);
  writeReport(p, { plan: planReport, timeline: res.timeline, sizeMB: f.sizeMB, renderS: res.seconds, settings: s });
  log.ok(`Video: ${path.relative(process.cwd(), f.out)} (${f.sizeMB.toFixed(1)} MB, made in ${res.seconds.toFixed(0)}s)`);
  log.ok(`Overview image (one frame per shot): ${path.relative(process.cwd(), f.sheet)}`);
  log.ok(`Details: ${path.relative(process.cwd(), path.join(p.out, 'report.txt'))}`);
  console.log(`\n  ${color.green(color.bold('Done!'))} Your video: ${color.bold(path.relative(process.cwd(), f.out))}\n`);
};

const program = new Command();
program.name('reel').description('Voice + images → Instagram reel: images edge to edge with motion, word-by-word captions.');

const common = (c: Command) =>
  c
    .option('-c, --captions <mode>', 'word | phrase | off')
    .option('--seed <n>', 'reshuffle automatic motion/transition picks')
    .option('-s, --set <key=value...>', 'override any setting, e.g. --set captions.y=0.7 images.motion=0.8');

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
  .action((name: string) => {
    const p = reelPaths(name);
    if (fs.existsSync(p.dir) && fs.readdirSync(p.dir).length) throw new Error(`${p.dir} already exists`);
    ensureDir(p.images);
    writeJson(p.settings, {});
    fs.writeFileSync(
      path.join(p.dir, 'README.txt'),
      [
        'Drop in:',
        '  voice.m4a      your voiceover (any audio format)',
        '  hook.m4a       optional separate hook recording (played first)',
        '  images/        your images (filename order = default order)',
        '  music.mp3      optional, ducked under the voice',
        '  script.md      optional: which image shows when, e.g.',
        '                   0:00    1st',
        '                   0:03.5  2nd   zoom-out',
        '',
        'Then:  reel make ' + name,
        'Per-reel settings go in reel.json (see README in the project root).',
      ].join('\n') + '\n',
    );
    log.ok(`created ${path.relative(process.cwd(), p.dir)}/`);
  });

common(
  program
    .command('prep <name>')
    .description('clean + tighten audio, transcribe, ingest images, write a script.md draft if missing')
    .option('--no-whisper', 'require <piece>.words.json instead of transcribing'),
).action(async (name: string, o) => {
  const p = existing(name);
  await prep(p, settingsFor(p, o), { noWhisper: o.whisper === false });
  doPlan(p, o);
  nextStep(p);
});

common(program.command('plan <name>').description('script.md + settings → timeline.json (instant)')).action((name: string, o) => {
  const p = existing(name);
  doPlan(p, o);
  nextStep(p);
});

common(
  program
    .command('render <name>')
    .description('render out/reel.mp4')
    .option('-d, --draft', 'half resolution, fast encode'),
).action(async (name: string, o) => {
  const p = existing(name);
  await doRender(p, o, doPlan(p, o).r.report);
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
  // prep skipped whisper because you had your own captions, but now you don't
  if (readJson<{ ownCaptions?: boolean }>(p.prep).ownCaptions && !hasOwnCaptions(p)) return true;
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

