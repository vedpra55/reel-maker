/** Word timings from whisper.cpp (runs locally, Metal on Apple Silicon). Results are cached by audio hash. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
  type WhisperModel,
} from '@remotion/install-whisper-cpp';
import { TOOLS_DIR, WHISPER_DIR, WHISPER_VERSION } from './paths';
import { normaliseWords, type RawWord } from './words';

export const DEFAULT_MODEL: WhisperModel = (process.env.REEL_WHISPER_MODEL as WhisperModel) || 'medium.en';
export const MODELS_DIR = path.join(TOOLS_DIR, 'models');

export const whisperBinary = () => {
  const cands = [path.join(WHISPER_DIR, 'build', 'bin', 'whisper-cli'), path.join(WHISPER_DIR, 'main')];
  return cands.find((c) => fs.existsSync(c)) ?? null;
};
export const modelFile = (model: WhisperModel = DEFAULT_MODEL) => path.join(MODELS_DIR, `ggml-${model}.bin`);
export const whisperReady = (model: WhisperModel = DEFAULT_MODEL) => !!whisperBinary() && fs.existsSync(modelFile(model));

export const installWhisper = async (model: WhisperModel = DEFAULT_MODEL) => {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  if (!whisperBinary()) {
    if (fs.existsSync(WHISPER_DIR)) fs.rmSync(WHISPER_DIR, { recursive: true, force: true }); // half-finished clone
    await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput: true });
  }
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  let last = -1;
  await downloadWhisperModel({
    model,
    folder: MODELS_DIR,
    printOutput: false,
    onProgress: (downloaded, total) => {
      const pct = Math.floor((downloaded / Math.max(1, total)) * 100);
      if (pct !== last && pct % 5 === 0) {
        last = pct;
        process.stdout.write(`\r  downloading ${model}: ${pct}%   `);
      }
    },
  });
  process.stdout.write('\n');
};

const hashFile = (file: string, extra: string) =>
  crypto.createHash('sha1').update(fs.readFileSync(file)).update(extra).digest('hex').slice(0, 16);

export const transcribeWords = async (file16k: string, cacheDir: string, model: WhisperModel = DEFAULT_MODEL): Promise<RawWord[]> => {
  const key = hashFile(file16k, model);
  const cache = path.join(cacheDir, `whisper-${key}.json`);
  if (fs.existsSync(cache)) return normaliseWords(JSON.parse(fs.readFileSync(cache, 'utf8')));
  if (!whisperReady(model)) {
    throw new Error(
      `whisper.cpp or the ${model} model is not installed. Run: reel doctor --fix\n` +
        `  (or put a <name>.words.json next to the audio to skip transcription)`,
    );
  }
  const json = await transcribe({
    inputPath: file16k,
    whisperPath: WHISPER_DIR,
    whisperCppVersion: WHISPER_VERSION,
    model,
    modelFolder: MODELS_DIR,
    tokenLevelTimestamps: true,
    splitOnWord: true,
    language: 'en',
    printOutput: false,
  });
  const { captions } = toCaptions({ whisperCppOutput: json });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(captions, null, 1));
  return normaliseWords(captions);
};
