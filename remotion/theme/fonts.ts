import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

/** Bundled OFL fonts, copied into each reel's public/fonts by the CLI. Works offline. */
const FONTS: { family: string; file: string; weight: string; style: 'normal' | 'italic' }[] = [
  { family: 'Montserrat', file: 'montserrat-latin-300-normal.woff2', weight: '300', style: 'normal' },
  { family: 'Montserrat', file: 'montserrat-latin-300-italic.woff2', weight: '300', style: 'italic' },
  { family: 'Montserrat', file: 'montserrat-latin-500-normal.woff2', weight: '500', style: 'normal' },
  { family: 'Montserrat', file: 'montserrat-latin-700-normal.woff2', weight: '700', style: 'normal' },
  { family: 'Montserrat', file: 'montserrat-latin-800-normal.woff2', weight: '800', style: 'normal' },
  { family: 'Montserrat', file: 'montserrat-latin-800-italic.woff2', weight: '800', style: 'italic' },
  { family: 'Montserrat', file: 'montserrat-latin-900-normal.woff2', weight: '900', style: 'normal' },
];

let loaded = false;
export const ensureFonts = () => {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  for (const f of FONTS) {
    loadFont({ family: f.family, url: staticFile(`fonts/${f.file}`), weight: f.weight, style: f.style }).catch((e) =>
      console.warn(`font ${f.file} failed to load`, e),
    );
  }
};
