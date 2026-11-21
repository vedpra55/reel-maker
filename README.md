# Reel Maker

Voice + images + one `timeline.json` → a 1080×1920 Instagram reel.

What you get:

* images edge to edge, always slowly moving
* smooth transitions
* word-by-word captions in your own spelling (Hinglish works)
* sound effects
* clean voice at -14 LUFS

No AI and no transcription. Everything comes from what you give it.

---

## Setup (once, on your Mac)

```bash
./setup.sh
```

This installs ffmpeg (with Homebrew, asking first), the project packages, and Remotion's headless Chrome (~100 MB).
To check your setup later, run `./reel doctor`.

To try a finished demo: `./reel example` then `./reel make example`.

---

## Make a reel

**1. Create the folder**

```bash
./reel new my-reel
```

**2. Put your files in `reels/my-reel/`**

```
reels/my-reel/
  hook.mp3        optional – the hook, recorded separately (plays first)
  voice.mp3       your voiceover
  images/         your images
  sfx/            optional – your own sound effects (mp3 / wav)
  music.mp3       optional – background music, quieter while you speak
```

**3. Make it**

```bash
./reel make my-reel
```

The first time, there's no `timeline.json` yet. The tool creates one with your images spread over the audio, then stops.
Open it, fix the times, write your text, and run `./reel make my-reel` again.

When it says **Done!**, your video is at `reels/my-reel/out/reel.mp4`.

---

## timeline.json

```json
{
  "hook": {
    "shots": [
      { "time": "0:00", "image": "1st", "motion": "zoom-in",
        "text": "Last weeks mein baby kam move karta hai? Yeh bilkul galat hai." }
    ]
  },
  "voice": {
    "shots": [
      { "time": "0:00",   "image": "2nd", "transition": "push",
        "text": "Pehle jo kicks mehsoos hoti thi," },
      { "time": "0:03.2", "image": "3rd", "transition": "zoom", "sfx": "boom.mp3",
        "text": "ab woh rolling ya stretching jaisi lag sakti hain." }
    ]
  },
  "settings": { "captions": { "size": 120 } }
}
```

* **`hook`**: shots shown while `hook.mp3` plays. Times are read off `hook.mp3`. Leave this out if you have no hook file.
* **`voice`**: shots shown while `voice.mp3` plays. Times are read off `voice.mp3`.
* **`settings`**: optional, for this reel only (see below).

**A shot**

| Field | | Values |
|---|---|---|
| `time` | required | Where the image starts, as you see it in any audio player: `"0:03.2"` or `3.2`. |
| `image` | required | The file name or its start: `"2nd"`, `"2nd.jpg"`. |
| `text` | | What you say during this image. It becomes the captions. |
| `motion` | | `zoom-in` `zoom-out` `pan-left` `pan-right` `pan-up` `pan-down` `drift` `tilt` |
| `transition` | | How this image comes in: `cut` `crossfade` `push` `push-up` `zoom` `whip` `slide-up` |
| `sfx` | | A sound on this cut: `whoosh` `pop` `hit` `riser` `tick`, a file from your `sfx/` folder (`"boom.mp3"`), `{ "name": "hit", "volume": 0.5 }`, or `"none"`. |
| `focus` | | The part of the photo to keep in frame: `top` `bottom` `left` `right` `center` |
| `treatment` | | `bw` or `warm` |

Anything you leave out is picked automatically, and never the same motion twice in a row.

**How it works out timing**

* **Silence removal:** long pauses are removed from your audio. Your times are adjusted for it automatically, so always
  write the times as they are in your original files.
* **Captions:** each `text` is shown word by word.
  The words are spread over the moments you're actually speaking, and full stops and commas land on your real pauses.
  Write every spoken word, in order.
* **Exact word timings:** if you have them from another tool, add `"words": [ { "text": "Pehle", "start": 0.12, "end": 0.4 } ]`
  inside `hook` or `voice`. They are used instead of `text` timing.
* **Sound effects:** every `push` `push-up` `zoom` `whip` `slide-up` gets a whoosh automatically.
  A shot's `sfx` replaces it, and `"sfx": "none"` keeps that cut silent.

If something is wrong, the tool says so in one line, for example: `voice shot 3: image "7th" not found – you have 1st, 2nd, …`

---

## Settings

Put them in `timeline.json` → `"settings"` (this reel), or in `reel.config.json` (every reel).

| Setting | Default | What it does |
|---|---|---|
| `captions.mode` | `word` | `word` = one word at a time · `phrase` = 2–3 words appearing one by one · `off` |
| `captions.size` | 110 | text size |
| `captions.y` | 0.64 | height on screen (0 = top, 1 = bottom) |
| `captions.uppercase` | false | ALL CAPS |
| `captions.highlight` | `""` | phrase mode: colour of the word being spoken, like `"#E8A04C"` |
| `captions.replace` | `{}` | spelling fixes, like `{ "anyesh": "Anyash" }` |
| `images.motion` | 0.55 | how far the camera moves (0–1) |
| `images.transitionMs` | 380 | transition length in ms |
| `images.transitions` | push, zoom, crossfade, whip, slide-up | automatic picks |
| `audio.sfxVolume` | 0.5 | volume of all sound effects (0 = off) |
| `audio.autoWhoosh` | true | the automatic whoosh on animated transitions |
| `audio.musicVolume` | 0.12 | background music level |
| `audio.tightenPauses` | true | remove long silences |
| `look.scrim` | 0.45 | dark shade behind captions |
| `look.brandLine` | `""` | small text on every frame, like `"@anyash"` |

The built-in sounds are made in code. To use better ones, replace the files in `assets/sfx/` (same names), or put your
own files in the reel's `sfx/` folder and name them in `"sfx"`.

---

## Commands

| Command | What it does |
|---|---|
| `./reel make <name>` | make the video (`--draft` for a quick low-res one) |
| `./reel preview <name>` | open it in Remotion Studio to play and scrub (Ctrl + C to stop) |
| `./reel still <name> 3 8.5` | a few single frames, in seconds |
| `./reel new <name>` | create a reel folder |
| `./reel list` | your reels and their state |
| `./reel doctor [--fix]` | check / install ffmpeg and headless Chrome |

Tip: to type `reel` instead of `./reel`, run once: `echo "alias reel='$PWD/reel'" >> ~/.bash_profile`

---

## Output

`reels/<name>/out/` contains:

* `reel.mp4`: 1080×1920, 30 fps, H.264, AAC, ready for Instagram
* `contact-sheet.jpg`: one frame per image, for a quick check
* `report.txt`: every shot with its time in the finished video, plus any warnings

`.build/` inside a reel folder is the tool's own working space. Deleting it is always safe.

Remotion is free for individuals and companies of up to 3 people.
