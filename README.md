# Reel Maker

You give it **voice + images**. It gives you a polished 1080×1920 Instagram reel with:

* word-by-word kinetic captions
* Ken Burns motion on images
* stat beats, text-only beats and split layouts
* transitions and SFX
* loudness-normalised audio

Every visual decision comes from **rules and your settings**, so the same inputs always give the same video.
The only model involved is whisper.cpp, which runs locally on your Mac and only provides word timings.

```
voice.m4a + images/ ──► reel make ──► out/reel.mp4  + contact-sheet.jpg + report.txt
```

The tool is built on **Remotion** (React/Chromium) for visuals and **ffmpeg** for audio and the final file.
It also uses **whisper.cpp** for word timings.

---

## Setup (once, on your Mac)

```bash
./setup.sh
```

The script does the following:

1. Installs `node`, `ffmpeg` and `cmake` with Homebrew. It asks first.
2. Runs `npm install`.
3. Links the `reel` command.
4. Runs `reel doctor --fix`. That downloads Remotion's headless Chrome (about 100 MB), builds whisper.cpp with Metal
   and downloads the Whisper model set in `reel.config.json`. The default is `small.en` (about 466 MB), stored in
   `~/.reel-maker`.

Check your setup at any time:

```bash
reel doctor          # report only
reel doctor --fix    # install what's missing (asks before each step)
```

To try it without recording anything:

```bash
reel example && reel make example
```

That builds a demo reel. Its voice is a synthetic hum, so only the timing is real.

---

## Making a reel

```bash
reel new london-dentist
# drop into reels/london-dentist/:
#   voice.m4a        your voiceover (m4a / mp3 / wav / anything ffmpeg reads)
#   hook.m4a         optional – a separately recorded hook, played first
#   images/          01-bigben.jpg, 02-clinic.heic …   (filename order = default order)
#   music.mp3        optional – automatically ducked under the voice
reel prep london-dentist      # clean audio, transcribe, write script.md
reel render london-dentist    # → reels/london-dentist/out/reel.mp4
```

| Command | What it does |
|---|---|
| `reel make <name>` | prep (only if inputs changed) + plan + render |
| `reel render <name> --draft` | half resolution, fast encode, for checking timing |
| `reel still <name> 2.5 7` | single frames to `out/stills/`, takes seconds |
| `reel preview <name>` | Remotion Studio: scrub, play, tweak settings live |
| `reel plan <name>` | re-plan after editing `script.md` (no re-transcribe) |
| `reel render <name> --no-plan` | render your hand-edited `timeline.json` as-is |
| `reel list` | list your reels and their state |

Common flags: `--preset anyash-dark`, `--intensity 0.7`, `--seed 3` (reshuffles motion choices),
and `--set captions.y=0.55 look.grain=0` (any setting).

### Least effort

Give it voice and images only.
`prep` writes a `script.md` from the transcript, with your images spread over the sentences in filename order.
Render as it is.

### More control: edit `script.md`

```md
# hook
Nobody watches past the *first second.*

# body
[img 01-studio] So we rebuilt our whole process from the ground up.
We cut every video down to the _one idea_ that matters.
[stat] *10K* followers in just six weeks.
[img 02-desk split] The secret was not a bigger budget.
[text] Write the hook first. Then everything else.
[img 03-city bw focus=top] Our whole $15,000 journey started with one decision.
[end] Follow for more.
```

| Mark | Meaning |
|---|---|
| `# hook` / `# body` | The hook gets bigger kinetic type. With a `hook.m4a`, the hook section maps to that file. |
| `*word*` / `*two words*` | Force the keyword: heavy, accent colour or bar. |
| `_words_` | Force the italic-serif "closer" (like *practice* / *journey.* in the references). |
| `[img name]` | Cut to that image on the next word. Name prefixes work: `[img 01]`. |
| `[img name split]` | Rounded image on top, text panel below. |
| `[img name bw]` `warm` `duo` | Image treatment. `duo` is a terracotta duotone. |
| `[img name focus=top]` | Where the camera move centres: `top`, `bottom`, `left`, `right` or `center`. |
| `[img name zoom-out]` | Force a move: `zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `pan-up` or `drift`. |
| `[text]` `[text dark]` `[text brand]` | Text-only kinetic beat on paper, dark or terracotta. |
| `[stat]` | Big counting number beat. The number is found in the phrase. |
| `[end]` | The end card starts here. Without it, the end card is added after the voice. |
| `\|` | Force a caption break. |

How `script.md` and the audio combine:

* **The script's spelling wins**, for things like £ signs, brand names and capitals.
* **The audio's timing wins.**
* "fifteen thousand dollars" in the audio matches `$15,000` in the script.
* If you ad-lib words that aren't in the script, `plan` lists them.

### Already have word timings?

Put `voice.words.json` (and `hook.words.json`) next to the audio and Whisper is skipped.
Accepted formats:

* `[{text, startMs, endMs}]`
* `[{word, start, end}]` (seconds)
* whisper / whisperX JSON

Timings refer to the original file. Pause-tightening is mapped onto them automatically.

---

## What the rules do

**Audio** (ffmpeg)

1. High-pass at 80 Hz, light denoise and 3:1 compression.
2. Pauses longer than 450 ms are cut to 300 ms, which removes dead air.
3. Hook, a 150 ms gap and the voice are joined.
4. Two-pass loudnorm to **-14 LUFS**, true peak -1.5 dB.

**Captions**

* 1–4 words per page. Pages break on pauses, punctuation and length.
* Marked spans are never split. A page never ends on a dangling "the".
* Words appear as they are spoken, 60 ms early.
* Each page gets one keyword, picked in this order:
  1. `*marked*`
  2. numbers
  3. your keyword list
  4. proper nouns
  5. the longest word
* Two styles:
  * **inline**: calm, and the spoken word lights up
  * **stack**: the reference look. A small light lead line, a huge heavy keyword, and an italic serif closer tucked under it.
* `emphasisRatio` (default 30%) decides how many pages over images get the stack treatment, so emphasis stays rare.

**Beats** (what's on screen)

* The hook comes first, and frame 0 already shows text.
* After that, your markers decide.
* Unmarked stretches get your unused images.
* An image held longer than 3 s is split into a punch-in or reframe, or into a text beat on a strong keyword.
* Number phrases become stat beats, at most one every 8 s.
* No camera move repeats three times in a row.
* Transitions land so the new visual is fully in on the word.
* SFX are sparse: a whoosh on animated cuts, a pop on keyword bars, a tick and hit on stats, and a riser into the end card.

`timeline.json` is the contract between planning and rendering.
It is plain JSON you can hand-edit, and it is also where AI can plug in later without touching the renderer.

---

## Settings

Settings are resolved in this order, later ones winning:

1. schema defaults
2. preset
3. `reel.config.json` in the project root: your defaults for every reel
4. `reels/<name>/reel.json`: this reel only
5. CLI `--set`

`reel.config.json` is where project-wide choices go, such as the Whisper model, your brand line or your usual preset:

```json
{
  "whisper": { "model": "small.en" },
  "look": { "brandLine": "@anyash" }
}
```

### Whisper model

| Model | Download | Notes |
|---|---|---|
| `tiny.en` | ~75 MB | fastest; word timings drift noticeably |
| `base.en` | ~142 MB | fast; OK for clear, slow voiceovers |
| `small.en` (default) | ~466 MB | good balance |
| `medium.en` | ~1.5 GB | most accurate English-only option |
| `large-v3-turbo` | ~1.6 GB | multilingual |

There are also multilingual versions without `.en`: `tiny`, `base`, `small` and `medium`.

If you write `script.md`, the words on screen come from your script and Whisper only supplies timings,
so a small model is usually enough.
After changing the model, run `reel doctor --fix` to download it.
Transcripts are cached per model.

Your `reel.json` only needs what you change:

```json
{
  "preset": "anyash-light",
  "intensity": 0.6,
  "captions": { "y": 0.58, "emphasisRatio": 0.35, "keywords": ["Anyash", "London"] },
  "look": { "brandLine": "@anyash", "grain": 0.03 },
  "endCard": { "cta": "Follow for more", "sub": "new reel every week" }
}
```

| Group | Keys (defaults) |
|---|---|
| top level | `preset` (anyash-light), `seed` (1), `intensity` (0.5) |
| `type` | `serif` (Playfair Display \| Instrument Serif), `closer` (serif \| light-italic), `captionSize` 74, `keySize` 150, `leadSize` 58, `keyWeight` 800, `keyItalic`, `uppercaseKeys` |
| `colors` | `paper` #F4EEE6, `ink` #1C1410, `dark` #15100D, `primary` #9B421A, `accent` #E8A04C, `onImage` #FFFFFF |
| `captions` | `style` (auto \| inline \| stack), `maxWords` 4, `hookMaxWords` 3, `maxCharsPerLine` 18, `pauseBreakMs` 220, `leadInMs` 60, `y` 0.6, `emphasisRatio` 0.3, `wordAnim` (pop \| slide-up \| blur-in \| none), `karaoke`, `keyStyle` (auto \| color \| bar), `keywords` [] |
| `pacing` | `minHoldS` 1, `maxHoldS` 3, `hookMaxS` 3.5, `statEveryS` 8, `transitions` [zoom-punch, slide, wipe, whip] (+ cut, fade), `autoTextBeats`, `autoStatBeats` |
| `look` | `grain` 0.04, `vignette` 0.3, `glow` 0.35, `scrim` 0.55, `imageTreatment`, `surface` (light \| dark), `grid`, `progressBar`, `brandLine`, `brandLineY` 0.73 |
| `audio` | `lufs` -14, `tightenPauses`, `maxPauseMs` 450, `keepPauseMs` 300, `denoise`, `hookGapMs` 150, `sfx`, `sfxVolume` 0.1, `musicVolume` 0.12, `voiceVolume` 1 |
| `endCard` | `enabled`, `durationS` 2, `cta`, `sub`, `bg` (brand \| dark \| paper) |
| `whisper` | `model` (small.en) – see the table above |
| `export` | `fps` 30, `crf` 20, `maxrate` 10M, `x264Preset` slow, `audioBitrate` 192k, `sizeCapMB` 30, `concurrency` 3, `draftScale` 0.5 |
| `safeZone` | px kept clear of Instagram's UI: `top` 220, `bottom` 480, `sides` 70, `right` 150 |

There are three presets:

* `anyash-light`: paper-grid text beats, terracotta keywords, amber bars
* `anyash-dark`: near-black text beats, amber keywords, warm image grade
* `minimal`: colour-only keywords, gentle motion, no glow or grain

Add your own in `shared/presets.ts`.

**Colour rule:** amber `#E8A04C` is never used as text on paper, because the contrast is about 2:1.
It is used as a bar behind dark text, or as text on dark backgrounds and images.

### Tweaking in Studio

`reel preview <name>` opens Remotion Studio with the reel loaded.

* The right-hand panel edits settings live.
* To keep a change, switch the panel to **JSON**, copy the `settings` values you changed into `reel.json`, then
  `reel render`.
* Studio can't save back to your reel by itself, so it shows a "can't save default props" notice. You can ignore it.

---

## Output

`reels/<name>/out/` contains:

* `reel.mp4`: 1080×1920, 30 fps, H.264 High, yuv420p, bt709, AAC 192k, faststart. Re-encoded once if it is over the size cap.
* `contact-sheet.jpg`: one frame per beat, for a quick visual check.
* `report.txt`: beats, alignment score, warnings, size and render time.

On an 8 GB M-series Mac, renders run with concurrency 3.
The demo reel (32 s) takes about 1.5 minutes on a 4-core Linux box. Expect similar or faster on an M3.

---

## Project layout

```
bin/reel.ts            CLI
pipeline/              doctor, prep (audio, whisper, images), script parser, aligner,
                       phrases, roles, beats, sfx, plan, render, finalize, synth (SFX)
shared/schema.ts       zod schemas: Settings + Timeline (shared by pipeline and Remotion)
shared/presets.ts      presets
remotion/              Reel composition: beats/, captions/, fx/, theme/
assets/fonts/          Montserrat, Playfair Display, Instrument Serif (OFL, bundled, offline)
assets/sfx/            generated on first run – drop your own whoosh/pop/tick/riser/hit.wav to replace
reels/<name>/          your inputs, .build/ (cache), timeline.json, out/
tests/                 rules-engine tests (npm test)
```

## Swapping sounds

The default SFX are synthesised in code.
For more punch, drop `whoosh.wav`, `pop.wav`, `tick.wav`, `riser.wav` and `hit.wav` from a free pack into `assets/sfx/`.
Pixabay and Mixkit both have packs; check each pack's licence.

## Troubleshooting

* **`whisper.cpp … not installed`**: run `reel doctor --fix`.
  You can also supply `voice.words.json` and use `--no-whisper`.
* **"script matches only 60%"**: `script.md` belongs to different audio, or the read drifted a lot.
  Delete `script.md` and run `reel prep` to regenerate it.
* **A word is mistimed**: edit its times in `timeline.json`, then run `reel render --no-plan`.
* **Use your own Chrome**: `REEL_BROWSER=/path/to/chrome-headless-shell reel render …`
* **Debug output**: `REEL_DEBUG=1 reel …` prints stack traces.

## Licence notes

* Remotion is free for individuals and companies of up to 3 people. Beyond that you need a company licence.
* The fonts are SIL OFL; their licences are in `assets/fonts/`.
