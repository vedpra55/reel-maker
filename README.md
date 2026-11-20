# Reel Maker

You give it **voice + images (+ an optional script.md saying which image shows when, and what you say)**.
It gives you a 1080×1920 Instagram reel:

* images edge to edge with smooth camera motion
* transitions where both images move
* simple word-by-word captions
* cleaned voice at -14 LUFS

There's no AI in the render. Whisper (whisper.cpp, local) only supplies word timings for English reels.
If you write your captions in `script.md`, Whisper isn't needed at all.

```
voice.m4a + images/ + script.md ──► reel make ──► out/reel.mp4
```

---

## Setup (once, on your Mac)

```bash
./setup.sh
```

The script does the following:

1. Installs `node`, `ffmpeg` and `cmake` with Homebrew. It asks first.
2. Runs `npm install`.
3. Links the `reel` command.
4. Runs `reel doctor --fix`. That downloads Remotion's headless Chrome (~100 MB), builds whisper.cpp and downloads
   the Whisper model (`small.en`, ~466 MB, saved in `~/.reel-maker/`).

If `reel` says *command not found*, use `./reel …` from the project folder, or add an alias:
`echo "alias reel='$PWD/reel'" >> ~/.bash_profile`.

To try it without recording anything:

```bash
./reel example && ./reel make example
```

---

## Making a reel

```bash
reel new my-reel
# put into reels/my-reel/:
#   voice.mp3      your voiceover (mp3 / m4a / wav …)
#   images/        your images (images placed straight in the reel folder also work)
#   script.md      which image shows when (optional – see below)
#   hook.m4a       optional separately recorded hook, played first
#   music.mp3      optional background music, ducked under the voice
reel make my-reel             # → reels/my-reel/out/reel.mp4
```

| Command | What it does |
|---|---|
| `reel make <name>` | prep (only if inputs changed) + plan + render |
| `reel render <name> --draft` | half resolution, fast, for checking timing |
| `reel still <name> 2.5 7` | single frames to `out/stills/`, takes seconds |
| `reel plan <name>` | re-read script.md (instant; no re-transcribing) |
| `reel preview <name>` | Remotion Studio: play, scrub, try settings live |
| `reel doctor [--fix]` | check / install ffmpeg, Chrome, whisper.cpp |

Common flags: `--captions phrase`, `--seed 3` (reshuffles the automatic motion and transition picks),
and `--set captions.size=130 images.motion=0.8` (any setting).

---

## script.md: which image shows when

One line per image: **time**, **image**, then any **options** in any order.

```
# my-reel
0:00     1st
0:03.5   2nd     zoom-out
0:07     3rd     push      focus=top
0:12.2   4th.png whip
0:16     5th     bw        pan-up
0:21     1st     crossfade
```

**Time**
* Write `0:03.5`, `3.5` or `[0:03]`.
* It means where you are **in your original voice file**, as shown in any audio player.
* The tool removes dead air from the voice, and it moves your times to match, so you never have to adjust for it.
* If a cut is within 0.15 s of a word, it lands on that word.
* With a separate hook recording, `hook 0:01  1st` means 1 second into `hook.m4a`.

**Image**
* A file name, with or without extension.
* A unique start of the name is enough: `1st`, `02`.
* The same image can appear more than once.

**Options**
* Camera move: `zoom-in` `zoom-out` `pan-left` `pan-right` `pan-up` `pan-down` `drift` `tilt`
* Transition into this image: `cut` `crossfade` `push` `push-up` `zoom` `whip` `slide-up`
* `focus=top|bottom|left|right|center`: which part of the photo the move stays on
* `bw` or `warm`: colour treatment

Options you leave out are picked automatically, and the same move or transition never comes twice in a row.

### Captions in your own words (Hinglish, brand names, exact spelling)

Put what you say under each image as `>` lines:

```
0:00     1st     zoom-in
> Last weeks mein baby kam move karta hai? Yeh bilkul galat hai.

0:07.5   2nd     crossfade
> Pehle jo kicks mehsoos hoti thi,
```

* The captions show your text **exactly as you wrote it**. Hinglish in English letters works.
* Word timing comes from the audio:
  * each line's words are spread over the moments you're actually speaking
  * full stops and commas are matched to your real pauses
  * a line's start is moved onto the nearest pause if your image time is a little off
* When `script.md` has `>` lines, **Whisper isn't used at all**, so no model download and no transcription wait.
* Write every spoken word, in order, or the timing drifts.
* Without `>` lines, captions come from Whisper (English) as before.

Lines starting with `#` or `//` are comments.
**No script.md, or no image lines in it:** `reel prep` writes a draft that spreads your images evenly over the voice,
landing each one on a sentence start. Edit the times, then run `reel make`.

---

## Settings

Settings are resolved in this order, later ones winning:

1. built-in defaults
2. `reel.config.json` (project root, every reel)
3. `reels/<name>/reel.json` (this reel)
4. `--set` on the command line

Only write what you change:

```json
{
  "captions": { "mode": "phrase", "size": 120, "highlight": "#E8A04C", "replace": { "anyesh": "Anyash" } },
  "images": { "motion": 0.7, "transitions": ["push", "zoom", "whip"] },
  "whisper": { "model": "small.en" }
}
```

| Group | Keys (defaults) |
|---|---|
| `captions` | `mode` (**word** = one word at a time · phrase = a few words appearing one by one · off), `size` 110, `weight` 800, `color` #FFFFFF, `highlight` '' (phrase mode: colour of the spoken word), `uppercase` false, `punctuation` false, `y` 0.64 (vertical position), `maxWords` 3, `pauseBreakMs` 300, `leadInMs` 40, `holdMs` 500, `anim` (pop \| fade \| none), `replace` {} (spelling fixes) |
| `images` | `motion` 0.55 (how far the camera moves, 0–1), `motions` [auto rotation], `transitions` [push, zoom, crossfade, whip, slide-up], `transitionMs` 380, `snapToWordMs` 150, `treatment` none |
| `look` | `scrim` 0.45 (shade behind captions), `vignette` 0.25, `grain` 0, `brandLine` '', `brandLineY` 0.9 |
| `audio` | `lufs` -14, `tightenPauses` true, `maxPauseMs` 450, `keepPauseMs` 300, `denoise` true, `whoosh` false, `sfxVolume` 0.12, `musicVolume` 0.12, `voiceVolume` 1, `tailMs` 500, `hookGapMs` 150 |
| `whisper` | `model`: tiny.en (75 MB) · base.en (142 MB) · **small.en** (466 MB) · medium.en (1.5 GB) · large-v3-turbo (multilingual) |
| `export` | `fps` 30, `crf` 20, `maxrate` 10M, `x264Preset` slow, `audioBitrate` 192k, `sizeCapMB` 30, `concurrency` 3, `draftScale` 0.5 |
| `safeZone` | px kept clear of Instagram's UI: `top` 220, `bottom` 420 |

**Fixing a misheard word:** add it to `captions.replace`, for example `{ "anyesh": "Anyash" }`. This applies to every
reel if you put it in `reel.config.json`.

**After changing the Whisper model**, run `reel doctor --fix` to download it.
Models live in `~/.reel-maker/models/`.

**Studio** (`reel preview <name>`): the settings panel changes the preview live.
To keep a change, copy the values from the panel's JSON view into `reel.json`.
You can ignore Studio's "can't save default props" notice.

---

## Output

`reels/<name>/out/` contains:

* `reel.mp4`: 1080×1920, 30 fps, H.264 High, yuv420p, AAC 192k, faststart. Re-encoded once if it is over the size cap.
* `contact-sheet.jpg`: one frame per image shot.
* `report.txt`: every shot with its time in the finished reel, plus any warnings (unknown image names, unused images).

---

## Project layout

```
bin/reel.ts           CLI
pipeline/             doctor, prep (audio, whisper, images), script.md parser, plan, render, finalize
shared/schema.ts      settings + timeline schemas (shared with the renderer)
shared/captions.ts    word / phrase caption timing
remotion/             the video: fx/KenBurns (camera moves), fx/Transition, captions/Captions
assets/fonts/         Montserrat (OFL, bundled, works offline)
reels/<name>/         your inputs, .build/ (cache), timeline.json, out/
tests/                npm test
```

## Troubleshooting

* **`whisper.cpp … not installed`**: run `reel doctor --fix`.
  Or put your own `voice.words.json` next to the audio and use `--no-whisper`.
* **"no image matches …"**: check the name in `script.md` against the files in `images/`.
* **A cut feels a little early or late**: change its time in `script.md` and run `reel make` again.
  Only planning and rendering re-run.
* **Use your own Chrome**: `REEL_BROWSER=/path/to/chrome-headless-shell reel render …`
* **Debug output**: `REEL_DEBUG=1 reel …` prints stack traces.

Remotion is free for individuals and companies of up to 3 people. Beyond that you need a company licence.
