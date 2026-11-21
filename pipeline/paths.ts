import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REELS_DIR = process.env.REEL_HOME ? path.resolve(process.env.REEL_HOME) : path.join(ROOT, 'reels');
export const ASSETS = path.join(ROOT, 'assets');
/** project-wide settings applied to every reel (reel.json still wins) */
export const PROJECT_CONFIG = path.join(ROOT, 'reel.config.json');
export const FONTS_DIR = path.join(ASSETS, 'fonts');
export const SFX_DIR = path.join(ASSETS, 'sfx');

export const AUDIO_EXT = ['.m4a', '.mp3', '.wav', '.aac', '.flac', '.ogg', '.aiff', '.aif', '.mp4', '.mov', '.caf'];
export const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff', '.avif'];

export type ReelPaths = ReturnType<typeof reelPaths>;

export const reelPaths = (nameOrDir: string) => {
  const dir = fs.existsSync(nameOrDir) && fs.statSync(nameOrDir).isDirectory()
    ? path.resolve(nameOrDir)
    : path.join(REELS_DIR, nameOrDir);
  const build = path.join(dir, '.build');
  const pub = path.join(build, 'public');
  return {
    name: path.basename(dir),
    dir,
    images: path.join(dir, 'images'),
    /** the one file you write */
    input: path.join(dir, 'timeline.json'),
    /** files from older versions (only read to help you move over) */
    oldScript: path.join(dir, 'script.md'),
    oldSettings: path.join(dir, 'reel.json'),
    build,
    pub,
    pubImages: path.join(pub, 'images'),
    prep: path.join(build, 'prep.json'),
    words: path.join(build, 'words.json'),
    /** what the renderer reads – generated, never hand-edit */
    timeline: path.join(build, 'timeline.json'),
    out: path.join(dir, 'out'),
  };
};

/** find `<base>.<audio ext>` in a reel folder */
export const findAudio = (dir: string, base: string): string | null => {
  for (const ext of AUDIO_EXT) {
    const p = path.join(dir, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

export const listImages = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => IMAGE_EXT.includes(path.extname(f).toLowerCase()) && !f.startsWith('.'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => path.join(dir, f))
    : [];

/** images/ first; images dropped straight into the reel folder also count */
export const reelImages = (p: { dir: string; images: string }): string[] => {
  const inFolder = listImages(p.images);
  return inFolder.length ? inFolder : listImages(p.dir);
};

export const ensureDir = (d: string) => fs.mkdirSync(d, { recursive: true });

export const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;
export const writeJson = (p: string, data: unknown) => {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
};
