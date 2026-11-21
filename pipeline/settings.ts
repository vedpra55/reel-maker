import fs from 'node:fs';
import { settingsSchema, type Settings, type SettingsInput } from '../shared/schema';
import { PROJECT_CONFIG } from './paths';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const deepMerge = (base: Obj, over: Obj): Obj => {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Obj, v) : v;
  }
  return out;
};

/** "a.b.c=value" → { a: { b: { c: value } } } with JSON-ish value parsing */
export const parseOverride = (kv: string): Obj => {
  const i = kv.indexOf('=');
  if (i < 0) throw new Error(`--set expects key=value, got "${kv}"`);
  const keys = kv.slice(0, i).split('.');
  const raw = kv.slice(i + 1);
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    /* plain string */
  }
  return keys.reduceRight<unknown>((acc, k) => ({ [k]: acc }), value) as Obj;
};

/**
 * Resolution order (later wins):
 *   schema defaults ← reel.config.json (project) ← timeline.json "settings" ← CLI flags
 */
export const resolveSettings = (reelJson: SettingsInput = {}, overrides: Obj = {}, project: SettingsInput = {}): Settings =>
  settingsSchema.parse(deepMerge(deepMerge(project as Obj, reelJson as Obj), overrides));

const readJsonFile = (file: string): SettingsInput => {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SettingsInput;
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${(e as Error).message}`);
  }
};

/** project-wide defaults for every reel */
export const loadProjectConfig = (): SettingsInput => readJsonFile(PROJECT_CONFIG);

/** reel.config.json ← the "settings" block of the reel's timeline.json ← CLI overrides */
export const loadSettings = (reelSettings: Obj = {}, overrides: Obj = {}): Settings =>
  resolveSettings(reelSettings as SettingsInput, overrides, loadProjectConfig());
