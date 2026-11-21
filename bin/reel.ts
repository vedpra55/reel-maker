#!/usr/bin/env -S npx tsx
/**
 * reel — voice + images + timeline.json in, Instagram reel out.
 *
 *   reel make <name>            make the video  (--draft for a quick low-res one)
 *   reel preview <name>         open it in Remotion Studio
 *   reel still <name> 3 8.5     single frames, for a quick look
 *   reel new <name>             create a reel folder
 *   reel example                a demo reel to try everything
 *   reel doctor [--fix]         check / install ffmpeg and headless Chrome
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { writeActive } from '../pipeline/active';
import { doctor } from '../pipeline/doctor';
import { makeExample } from '../pipeline/example';
import { finalize, writeReport } from '../pipeline/finalize';
import { convertScriptMd, isGeneratedTimeline, parseInput, starterTimeline } from '../pipeline/input';
import { AUDIO_EXT, ROOT, REELS_DIR, ensureDir, findAudio, readJson, reelImages, reelPaths, writeJson, type ReelPaths } from '../pipeline/paths';
import { buildTimeline, type PlanReport } from '../pipeline/plan';
import { audioKeyOf, prep, toOriginal, type Prep } from '../pipeline/prep';
import { preparePublic, renderReel, renderStills } from '../pipeline/render';
import { deepMerge, loadSettings, parseOverride } from '../pipeline/settings';
import { speechIn } from '../pipeline/textwords';
import { color, log } from '../pipeline/util/log';
import type { Settings } from '../shared/schema';

type Opts = { set?: string[]; seed?: string; captions?: string; draft?: boolean };

const rel = (f: string) => path.relative(process.cwd(), f);

const existing = (name: string) => {
  const p = reelPaths(name);
  if (!fs.existsSync(p.dir)) throw new Error(`There is no reel folder ${rel(p.dir)}/ – create it with: ./reel new ${name}`);
  return p;
};

/* ---------------- timeline.json ---------------- */

/** your timeline.json (or one made from an old script.md); null when there is none yet */
const readInputFile = (p: ReelPaths): unknown | null => {
  if (fs.existsSync(p.input)) {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(p.input, 'utf8'));
    } catch (e) {
      throw new Error(`timeline.json has a typo: ${(e as Error).message}\n    (check for a missing comma or quote near that spot)`);
    }
    if (!isGeneratedTimeline(data)) return data;
    ensureDir(p.build);
    fs.renameSync(p.input, path.join(p.build, 'timeline.old.json'));
    log.info('(Moved away an old file made by the previous version – nothing for you to do.)');
  }
  if (fs.existsSync(p.oldScript)) {
    const converted = convertScriptMd(fs.readFileSync(p.oldScript, 'utf8'));
    if (converted) {
      writeJson(p.input, converted);
      log.ok('Made timeline.json from your script.md. From now on edit timeline.json (script.md is no longer used).');
      return converted;
    }
  }
  return null;
};

/** prep again only when audio, images, sound files or audio settings changed */
const needsPrep = (p: ReelPaths, s: Settings) => {
  if (!fs.existsSync(p.prep)) return true;
  const old = readJson<Partial<Prep>>(p.prep);
  if (old.version !== 3 || old.audioKey !== audioKeyOf(s)) return true;
  const t = fs.statSync(p.prep).mtimeMs;
  const sfxDir = path.join(p.dir, 'sfx');
  const inputs = [findAudio(p.dir, 'voice'), findAudio(p.dir, 'hook'), findAudio(p.dir, 'music'), p.images, sfxDir]
    .filter((x): x is string => !!x && fs.existsSync(x))
    .concat(reelImages(p))
    .concat(fs.existsSync(sfxDir) ? fs.readdirSync(sfxDir).map((f) => path.join(sfxDir, f)) : []);
  return inputs.some((f) => fs.statSync(f).mtimeMs > t);
};

/** write a starter timeline.json from the prepared audio + images */
const writeStarter = (p: ReelPaths, pr: Prep) => {
  const starts: Record<'hook' | 'voice', number[]> = { hook: [], voice: [] };
  const durations: Record<'hook' | 'voice', number | null> = { hook: null, voice: null };
  for (const pc of pr.pieces) {
    durations[pc.name] = pc.originalMs;
    starts[pc.name] = speechIn(pc.offsetMs, pc.offsetMs + pc.durationMs, pr.silences).map(([a]) => toOriginal(a, pr.pieces).ms);
  }
  writeJson(p.input, starterTimeline({ images: pr.images.map((i) => i.name), starts, durations }));
};

const printReport = (rep: PlanReport) => {
  const secs = (['hook', 'voice'] as const).filter((x) => rep.captions[x]);
  log.ok(`Images: ${rep.shots} shot(s)`);
  const cap = secs.map((x) => `${x}: ${{ words: 'your word timings', text: 'your text', none: 'none' }[rep.captions[x]!]}`).join(' · ');
  log.ok(`Captions – ${cap}`);
  log.ok(`Sound effects: ${rep.sfx}`);
  if (rep.unusedImages.length) log.warn(`These images are not used: ${rep.unusedImages.join(', ')}`);
  for (const w of rep.warnings) log.warn(w);
};

/** everything up to a ready render plan; null when a starter timeline.json was just written */
const ready = async (name: string, o: Opts) => {
  const p = existing(name);
  if (fs.existsSync(p.oldSettings)) log.warn('reel.json is no longer read – put those settings into timeline.json under "settings".');
  const raw = readInputFile(p);
  const input = raw ? parseInput(raw) : null;

  let over: Record<string, unknown> = {};
  for (const kv of o.set ?? []) over = deepMerge(over, parseOverride(kv));
  if (o.seed !== undefined) over.seed = Number(o.seed);
  if (o.captions) over = deepMerge(over, { captions: { mode: o.captions } });
  const s = loadSettings(input?.settings ?? {}, over);

  let pr: Prep;
  if (needsPrep(p, s)) {
    pr = await prep(p, s);
  } else {
    pr = readJson<Prep>(p.prep);
    log.dim('audio and images unchanged – reusing them');
  }

  if (!input) {
    writeStarter(p, pr);
    console.log(
      `\n  ${color.bold('Created')} ${rel(p.input)} with your images spread over the audio.\n` +
        `  Open it, fix the times, and write what you say in each "text".\n` +
        `  Then run:  ${color.cyan(`./reel make ${p.name}`)}\n`,
    );
    return null;
  }

  log.step('Reading timeline.json');
  const r = buildTimeline(p.name, pr, input, s);
  writeJson(p.timeline, r.timeline);
  printReport(r.report);
  log.ok(`Reel length: ${(r.timeline.durationMs / 1000).toFixed(1)} seconds`);
  return { p, s, r };
};

/* ---------------- commands ---------------- */

const program = new Command();
program.name('reel').description('voice + images + timeline.json → Instagram reel');

const common = (c: Command) =>
  c
    .option('-c, --captions <mode>', 'word | phrase | off')
    .option('--seed <n>', 'reshuffle automatic motion/transition picks')
    .option('-s, --set <key=value...>', 'override a setting, e.g. --set captions.size=130 audio.sfxVolume=0.8');

common(
  program
    .command('make <name>')
    .description('make the video: reels/<name>/out/reel.mp4')
    .option('-d, --draft', 'quick low-resolution version'),
).action(async (name: string, o: Opts) => {
  const res = await ready(name, o);
  if (!res) return;
  const { p, s, r } = res;
  log.step(o.draft ? 'Making a quick low-res video' : 'Making the video (a few minutes)');
  const out = await renderReel(p, s, { draft: o.draft });
  if (o.draft) {
    console.log(`\n  ${color.green(color.bold('Done!'))} Quick video: ${color.bold(rel(out.out))}\n`);
    return;
  }
  log.step('Finishing');
  const f = await finalize(p, s, out.out, out.timeline);
  writeReport(p, { plan: r.report, timeline: out.timeline, sizeMB: f.sizeMB, renderS: out.seconds, settings: s });
  log.ok(`${f.sizeMB.toFixed(1)} MB, made in ${out.seconds.toFixed(0)}s`);
  log.ok(`Overview (one frame per image): ${rel(f.sheet)}`);
  console.log(`\n  ${color.green(color.bold('Done!'))} Your video: ${color.bold(rel(f.out))}\n`);
});

common(program.command('preview <name>').description('open the reel in Remotion Studio')).action(async (name: string, o: Opts) => {
  const res = await ready(name, o);
  if (!res) return;
  const { p, s, r } = res;
  await preparePublic(p);
  writeActive({ settings: s, timeline: r.timeline });
  log.step('Opening Remotion Studio  (stop it with Ctrl + C)');
  log.info('Settings you change in the right panel are not saved – copy them into timeline.json → "settings".');
  const child = spawn('npx', ['remotion', 'studio', 'remotion/index.ts', `--public-dir=${p.pub}`], { cwd: ROOT, stdio: 'inherit' });
  await new Promise((done) => child.on('close', done));
});

common(program.command('still <name> <seconds...>').description('single frames to out/stills/')).action(
  async (name: string, seconds: string[], o: Opts) => {
    const res = await ready(name, o);
    if (!res) return;
    const files = await renderStills(res.p, res.s, seconds.map(Number));
    for (const f of files) log.ok(rel(f));
  },
);

program
  .command('new <name>')
  .description('create a reel folder')
  .action((name: string) => {
    const p = reelPaths(name);
    if (fs.existsSync(p.dir) && fs.readdirSync(p.dir).length) throw new Error(`${rel(p.dir)}/ already exists`);
    ensureDir(p.images);
    ensureDir(path.join(p.dir, 'sfx'));
    fs.writeFileSync(
      path.join(p.dir, 'README.txt'),
      [
        'Put in this folder:',
        '  voice.mp3     your voiceover',
        '  hook.mp3      optional: the hook, recorded separately (plays first)',
        '  images/       your images',
        '  sfx/          optional: your own sound effects (mp3 / wav)',
        '  music.mp3     optional: background music (quieter while you speak)',
        '',
        `Then run:  ./reel make ${name}`,
        'The first time, it creates timeline.json for you to fill in.',
      ].join('\n') + '\n',
    );
    log.ok(`Created ${rel(p.dir)}/ – put voice.mp3 and your images in it, then: ./reel make ${name}`);
  });

program
  .command('example')
  .description('create reels/example – a demo with everything filled in')
  .action(async () => {
    const p = await makeExample('example');
    log.ok(`Created ${rel(p.dir)}/ – now run: ./reel make example`);
  });

program
  .command('doctor')
  .description('check (and with --fix, install) ffmpeg and headless Chrome')
  .option('--fix', 'install what is missing (asks first)')
  .option('-y, --yes', 'answer yes to every question')
  .action(async (o) => {
    process.exitCode = (await doctor({ fix: !!o.fix, yes: !!o.yes })) ? 0 : 1;
  });

program
  .command('list')
  .description('list your reels')
  .action(() => {
    if (!fs.existsSync(REELS_DIR)) return;
    for (const d of fs.readdirSync(REELS_DIR)) {
      const p = reelPaths(d);
      if (!fs.statSync(p.dir).isDirectory()) continue;
      const state = fs.existsSync(path.join(p.out, 'reel.mp4'))
        ? color.green('video made')
        : fs.existsSync(p.input)
          ? 'timeline.json ready'
          : findAudio(p.dir, 'voice')
            ? 'needs timeline.json'
            : `needs voice (${AUDIO_EXT.slice(0, 3).join('/')})`;
      console.log(`  ${d.padEnd(28)} ${state}`);
    }
  });

program.parseAsync().catch((e: Error) => {
  log.err(e.message);
  if (process.env.REEL_DEBUG) console.error(e.stack);
  process.exit(1);
});
