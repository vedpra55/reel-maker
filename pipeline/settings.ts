import fs from 'node:fs';
import { PRESETS } from '../shared/presets';
import { settingsSchema, type Settings, type SettingsInput } from '../shared/schema';
import type { ReelPaths } from './paths';

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

export const resolveSettings = (reelJson: SettingsInput = {}, overrides: Obj = {}): Settings => {
  const presetName = (overrides.preset as string) ?? reelJson.preset ?? 'anyash-light';
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`Unknown preset "${presetName}". Available: ${Object.keys(PRESETS).join(', ')}`);
  const merged = deepMerge(deepMerge(preset as Obj, reelJson as Obj), overrides);
  merged.preset = presetName;
  return settingsSchema.parse(merged);
};

export const loadSettings = (p: ReelPaths, overrides: Obj = {}): Settings => {
  const reelJson = fs.existsSync(p.settings) ? (JSON.parse(fs.readFileSync(p.settings, 'utf8')) as SettingsInput) : {};
  return resolveSettings(reelJson, overrides);
};
