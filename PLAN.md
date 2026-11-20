# Reel Maker — Build Plan (v1)

A local Mac tool. You give it **voice + images**. It produces a polished 1080×1920 Instagram reel with
kinetic word-by-word captions, motion, transitions and SFX. No AI at render time: every decision comes
from rules plus your settings, so the same inputs always give the same video.

Whisper (whisper.cpp, running on your Mac) is the only model involved, and it only gets the word timings.

---

## 1. Your workflow (the whole thing)

```bash
reel new london-dentist          # creates reels/london-dentist/ with a template
# drop in: hook.m4a (optional), voice.m4a, images/01-bigben.jpg ...
reel prep london-dentist         # clean audio, transcribe, align, write script.md if missing
# (optional) edit reels/london-dentist/script.md: add [img ...] markers, *keywords*
reel preview london-dentist      # Remotion Studio: scrub, play, tweak settings live
reel render london-dentist       # out/reel.mp4 + contact sheet + report
```

`reel make london-dentist` runs prep, plan and render in one go.

* **Minimum effort:** voice and images, nothing else. Images are spread across sentences in filename
  order, and every beat is chosen automatically.
* **Normal effort:** add `[img name]` markers to the auto-generated `script.md`, then re-run. Whisper
  is cached, so re-planning takes seconds.

---

## 2. Inputs: one folder per reel

```
reels/london-dentist/
  hook.m4a        optional. Separate hook recording, played first and styled as the hook
  voice.m4a       main voiceover (m4a, mp3, wav: anything ffmpeg reads)
  images/         jpg, png, heic. Filename order is the default order
  music.mp3       optional. Auto-ducked under the voice
  script.md       optional. Generated from the transcript if missing
  reel.json       per-reel settings (theme, preset, end-card text, overrides)
```

### `script.md`: the one file you edit by hand

```md
# hook
A *£15,000* smile starts with one X-ray.

# body
[img 01-bigben] This _central London_ practice sees 40 patients a day.
[text] Here's what nobody tells you.
[stat] *92%* of them never needed the expensive option.
[img 02-clinic split] The whole journey takes _six weeks._
[end] Follow for more.
```

| Mark | Meaning |
|---|---|
| `# hook` / `# body` | Sections. If `hook.m4a` exists, the hook section maps to it. |
| `*word*` | Force this word as the keyword: heavy weight, accent colour or bar. |
| `_words_` | Force italic serif (the "closer" style). |
| `[img name]` | Cut to this image on the next word. It holds until the next marker. |
| `[img name split]` | Split layout: rounded image on top, text below. |
| `[img name bw]` / `warm` / `duo` | Image treatment. |
| `[img name focus=top]` | Ken Burns focal point: `top`, `bottom`, `left`, `right` or `center`. |
| `[text]` / `[text dark]` / `[text brand]` | Text-only kinetic beat on paper, dark or terracotta. |
| `[stat]` | Big-number beat. The number is detected in the phrase. |
| `[end]` | The end card starts here. Otherwise it is appended after the voice. |
| `\|` | Force a caption page break. |

The text in `script.md` wins over Whisper's spelling (brand names, £ signs and so on). Whisper's
timings win for timing.

---

## 3. Pipeline (all Node/TypeScript, one runtime)

```
doctor → ingest → audio → transcribe → align → plan → render → finalize
```

1. **doctor**: checks and installs dependencies (section 7).
2. **ingest**: converts images with macOS `sips` (handles HEIC and EXIF rotation, caps the long edge
   at 2160 px, writes JPEG). Validates the audio with `ffprobe`.
3. **audio** (system ffmpeg), for hook and voice separately:
   * `highpass=80`, light `afftdn` denoise, `acompressor` (3:1), then two-pass `loudnorm`
     (I=-14 LUFS, TP=-1.5).
   * **Pause tightening:** `silencedetect` finds pauses. Any pause over 450 ms is shortened to 300 ms
     with 10 ms crossfades. The cut map is saved. This removes dead air, which matters for retention.
     It runs before transcription so all timings refer to the final audio.
   * Concatenates `hook + 150 ms gap + voice` into `voice.final.wav` (48 kHz) and a 16 kHz copy for
     Whisper.
4. **transcribe**: `@remotion/install-whisper-cpp` builds whisper.cpp with Metal on your Mac and
   downloads the model (`medium.en` by default, `large-v3-turbo` as an option). It runs with
   token-level timestamps and `splitOnWord`, and converts the result with `toCaptions()` into
   `words.raw.json` (`{text, startMs, endMs, confidence}`). Results are cached by audio hash.
5. **align**: word-level dynamic-programming alignment of script tokens against Whisper tokens.
   * Matching is fuzzy: lowercase, punctuation stripped, numbers normalised so "fifteen thousand"
     matches "15,000", and £/$ are handled.
   * One script token can match several Whisper tokens, and the reverse.
   * Unmatched script words get timings interpolated from their neighbours.
   * Word ends are snapped to detected silences, overlaps are fixed, and every word lasts at least
     60 ms.
   * Writes `words.json`. Prints the alignment score and warns if it is below 85% (wrong script?) or
     if any words have low confidence.
6. **plan**: the rules engine (section 4) writes `timeline.json`.
7. **render**: `@remotion/renderer` reads only `timeline.json` plus the settings.
8. **finalize**:
   * `ffmpeg -c copy -movflags +faststart`.
   * If the file is over the size cap, one re-encode at a lower maxrate.
   * A contact sheet: one still per beat, as a JPEG grid.
   * `report.txt`: beats, keywords, alignment score, LUFS, file size, render time.

**`timeline.json` is the contract.** It is deterministic (seeded PRNG; change `seed` to reshuffle the
variants). You can hand-edit it and render with `reel render --no-plan`. It is also where AI plugs in
later: a model only has to write markers or a timeline, and the renderer stays the same.

---

## 4. Rules engine (the "no AI" brain)

### 4.1 Caption pages (phrases)

* Break a page on:
  * a pause of 220 ms or more,
  * `. , ? ! : ;`,
  * 4 words (3 in the hook),
  * about 18 characters per line, with 2 lines maximum,
  * a `|` mark.
* No orphan one-word pages, unless that word is a keyword.
* Minimum page time is 350 ms, extended into the following gap. The caption appears 60 ms before the
  word (setting: `leadInMs`).

### 4.2 Word roles: the 3-slot look from your references

Every word gets one role: `lead` (light, smaller), `key` (heavy, accent or bar), `closer` (italic
serif) or `normal`.

* **Keyword pick order:**
  1. `*marked*` in the script
  2. Numbers, currency and percentages
  3. The theme's keyword list
  4. Capitalised words that are not at the start of a sentence
  5. The longest content word (stop-words excluded)
* At most one keyword per page.
* **Closer:** `_marked_` words, or the last 1–2 words of a sentence-final page of 3 or more words.
* **Emphasis ratio** (default 0.25): only about a quarter of pages get the full "editorial stack"
  treatment. They are chosen by keyword strength and spaced at least 2 pages apart. The rest use the
  calmer inline style. Highlights stay rare enough to mean something.

### 4.3 Two caption styles

* **Inline karaoke** (default over images): 1–2 centred lines, heavy sans. The active word changes
  colour, the keyword gets an amber bar behind it, and the text sits on a soft scrim gradient.
* **Editorial stack** (emphasis pages and text beats): words stacked by role. For example,
  "central" (light, small) / "LONDON" (heavy, large) / "practice" (italic serif). Each line animates
  in separately.

### 4.4 Beat planner (what is on screen)

1. **Segments from markers.** Each marker opens a beat on the next word.
2. **Hook beat:** covers `hook.m4a`, or the first sentence capped at 3.5 s. Frame 0 already shows
   text, with no fade from black, because the first frame is your first impression.
3. **No markers:** images are distributed in filename order over sentence boundaries. If there are no
   images, text beats are used.
4. **Max hold 3.0 s.** Longer segments are split at page boundaries into a different camera move or
   reframe, a 1.0→1.08 punch-in, or a text or stat beat when that page is an emphasis or number page.
5. **Min hold 1.0 s.** Shorter segments are merged into a neighbour.
6. **Number pages** become a stat beat, at most one every 8 s, unless a marker overrides it.
7. **Variety pass:** no beat kind or camera move more than twice in a row. Variants are picked with
   the seeded RNG.
8. **Transitions:** chosen per beat pair from the theme's set, scaled by `intensity`. Every cut lands
   on a word start, so the new visual is fully in at the stressed word.
9. **End card:** at `[end]`, or 2.0 s appended after the voice.
10. **SFX placement:**
    * Whoosh on animated transitions, at most one every 1.2 s.
    * Pop on keyword bar-wipes in emphasis pages.
    * Tick on a stat count-up and a hit when it lands.
    * Riser into the end card.
    * All around -20 dB, about 10%.

---

## 5. Visual library (Remotion components)

**Beats**

| Beat | What it does |
|---|---|
| `HookBeat` | Big kinetic type (word stagger and letter stagger), over the first image darkened or a brand background. |
| `ImageBeat` | Ken Burns moves: zoom-in, zoom-out, pan-left, pan-right and parallax drift (slow scale plus counter-translate), with a focal point. Treatments: none, b&w, warm grade or brand duotone. Scrim under the text. |
| `SplitBeat` | Rounded image card in the top 55% (with a slow drift), and an editorial-stack caption on paper below. |
| `TextBeat` | Text-only kinetic editorial stack on a paper-grid, dark or terracotta background, with a subtle grid drift so nothing is static. |
| `StatBeat` | Huge number with a count-up and a layered "extruded" look (stacked offset shadows in terracotta and amber, plain CSS with no 3D library), an amber bar wipe behind the label, and a hit SFX. |
| `EndCard` | Logo, handle and CTA line, with a spring-in and a slow background drift. |

**Word animations** (picked per theme, scaled by intensity):

* Spring pop with overshoot
* Masked slide-up
* Blur-to-sharp (small text only)
* Scale punch on the keyword
* Amber bar wipe
* Letter stagger (hook only)

**Transitions:** cut, zoom-punch, slide, clip-path wipe, quick fade and whip (translate plus slight
scale, with no expensive blur). These are our own in-sequence transitions, not `TransitionSeries`,
so the overlap never shifts audio sync.

**Overlays:**

* Film grain (subtle by default: 4% opacity, since Instagram recompression turns heavy grain into
  blocks)
* Vignette
* Scrim
* Brand line at 73% height
* Optional thin progress bar
* Micro-shake on impact words (off by default)

**Audio:** voice, SFX and music are all mixed inside the Remotion composition, so the preview and the
final render sound identical. Music ducking is computed from word timings: low while words are spoken
and back up in the gaps.

---

## 6. Settings (zod schema, shown in Studio, saved in `reel.json`)

```jsonc
{
  "preset": "anyash-light",            // anyash-light | anyash-dark | minimal
  "seed": 1,
  "intensity": 0.5,                    // 0..1 scales every motion, overshoot and shake
  "type":   { "sans": "Inter", "heavy": "Inter", "serif": "Instrument Serif",
              "captionSize": 72, "stackKeySize": 150 },
  "colors": { "bg": "#F5EFE6", "ink": "#1C1410", "primary": "#9B421A",
              "accent": "#E8A04C", "dark": "#17110D" },
  "captions": { "style": "auto",       // auto | inline | stack
                "maxWords": 4, "pauseBreakMs": 220, "leadInMs": 60,
                "y": 0.58, "emphasisRatio": 0.25, "wordAnim": "pop" },
  "pacing": { "minHoldS": 1.0, "maxHoldS": 3.0, "statEveryS": 8,
              "transitions": ["zoom-punch","slide","wipe","whip"], "autoTextBeats": true },
  "look":   { "grain": 0.04, "vignette": 0.25, "progressBar": false,
              "brandLine": "@anyash", "brandLineY": 0.73 },
  "audio":  { "lufs": -14, "tightenPauses": true, "maxPauseMs": 450,
              "sfxVolume": 0.1, "musicVolume": 0.12, "hookGapMs": 150 },
  "endCard": { "enabled": true, "durationS": 2.0, "cta": "Follow for more", "logo": "brand/logo.png" },
  "export": { "crf": 20, "maxrate": "10M", "x264Preset": "slow", "sizeCapMB": 30,
              "concurrency": 3, "draftScale": 0.5 },
  "safeZone": { "top": 220, "bottom": 480, "right": 150 }   // px. Instagram UI areas
}
```

### Anyash theme rules

* **Terracotta `#9B421A`:** keyword text on paper (about 6.6:1 contrast, readable), the brand
  background for text beats, and the extrude layers.
* **Amber `#E8A04C`:** used only as a bar or fill behind dark text, or as text on dark or scrimmed
  backgrounds. Amber text on paper is about 2:1 contrast and unreadable, so the theme never does it.
* **Fonts** (bundled woff2, all OFL, offline): Inter (300, 500, 800, 900) and Instrument Serif
  Italic, plus Bricolage Grotesque and Anton as alternates.
* **Light weight only at 64 px or larger:** thin strokes smear after Instagram compression.

---

## 7. `doctor` on your Mac (`./setup.sh` then `reel doctor --fix`)

| Check | Fix if missing |
|---|---|
| Apple Silicon, macOS version, free disk ≥ 5 GB, RAM (warns at 8 GB and sets concurrency to 2–3) | n/a |
| Xcode Command Line Tools (needed to compile whisper.cpp) | `xcode-select --install` |
| Homebrew | prints the official install command (it needs your password, so it is not automated) |
| Node ≥ 20 | `brew install node` |
| ffmpeg and ffprobe, plus the filters `libx264`, `loudnorm`, `silencedetect`, `afftdn`, `sidechaincompress` | `brew install ffmpeg` |
| Remotion's Chrome Headless Shell | `npx remotion browser ensure` |
| whisper.cpp built and the model downloaded | `installWhisperCpp` plus `downloadWhisperModel` |
| Bundled fonts present, SFX set generated | Generates the SFX with ffmpeg |

Every fix asks before it runs (y/N). `reel doctor` without `--fix` only reports.

### SFX: synthesised once with ffmpeg

Written to `assets/sfx/`, and swappable with your own files under the same names.

* **Whoosh:** band-passed noise with a frequency sweep and fade
* **Pop:** short sine with a pitch drop
* **Tick:** a click
* **Riser:** a noise and sine swell
* **Hit:** a low sine thump plus a noise burst

Whoosh, pop and tick sound good. The riser and hit are usable but thinner than recorded ones, so drop
in a free pack (Pixabay or Mixkit, and check the licence) when you want more punch.

---

## 8. Export (Instagram-ready)

* **Video:** 1080×1920, 30 fps, H.264 High, `yuv420p`, bt709, CRF 20, maxrate 10M, x264 `slow`.
* **Audio:** AAC 48 kHz 192k.
* **Container:** faststart.
* **Size:** capped at 30 MB with one auto re-encode if over.
* **Draft mode** (`--draft`): 540×960 with a fast preset, for quick checks.
* **8 GB rules:**
  * concurrency 2–3
  * images capped at 2160 px
  * no large CSS blur layers
  * a single encode (Remotion encodes the final file directly, and the finalize step only remuxes)

---

## 9. Code layout

```
reel-maker/
  setup.sh                    brew/node check → npm install → reel doctor
  package.json
  bin/reel.ts                 CLI: doctor | new | prep | plan | preview | render | make
  pipeline/
    doctor.ts  ingest.ts  audio.ts  transcribe.ts  script.ts  align.ts
    phrases.ts  roles.ts  beats.ts  sfx.ts  timeline.ts  render.ts  finalize.ts
    util/ ffmpeg.ts  rng.ts  numbers.ts  log.ts
  shared/schema.ts            zod: Settings + Timeline (used by the pipeline AND Remotion)
  remotion/
    index.ts  Root.tsx  Reel.tsx
    beats/    HookBeat ImageBeat SplitBeat TextBeat StatBeat EndCard
    captions/ CaptionLayer InlineKaraoke EditorialStack
    fx/       Transition KenBurns Grain Vignette Scrim ProgressBar
    theme/    presets.ts fonts.ts
  assets/fonts/  assets/sfx/  assets/brand/anyash/
  reels/_example/             a working sample reel
  tests/                      vitest: script parser, alignment, phrases, roles, beats (snapshot)
```

---

## 10. Scope

### v1 (this build, delivered as branch and zip)

* Everything in sections 1–9.
* Two Anyash themes (light and dark) and a minimal theme.
* An example reel.
* Rules-engine tests.
* README.

### v2 (later)

* **Reel Desk:** a local web UI with `@remotion/player` preview, a settings form, drag-and-drop
  uploads and a render button with progress. In v1, Studio is the preview and settings are saved in
  `reel.json`.
* Video clips (`OffthreadVideo`) and talking-head punch-ins.
* Text-behind-subject cutouts (you supply a transparent PNG).
* Real 3D numbers (`@remotion/three`).
* Batch mode (`reel make --all`).
* AI on top: auto markers, keyword picking and image matching, all of which only write
  `script.md` or `timeline.json`.

### Honest limits

* I build and test here on Linux: the full render pipeline, rules, ffmpeg chain and a synthetic test
  voice. I can't run `brew`, `sips`, Metal whisper.cpp or measure render speed on your M3 from here.
  Those paths are written for macOS and will be verified on your first `reel doctor` and render.
* Remotion is free for individuals and companies of up to 3 people. At 4 or more you need a company
  licence.
