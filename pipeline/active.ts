/**
 * Studio reads its default props from remotion/generated/active.json (git-ignored),
 * so the settings panel stays editable live (props passed with --props would lock it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { demoSettings, demoTimeline } from '../remotion/demo';
import { ROOT, writeJson } from './paths';

export const ACTIVE = path.join(ROOT, 'remotion', 'generated', 'active.json');

export const writeActive = (props: { settings: unknown; timeline: unknown }) => writeJson(ACTIVE, props);

export const ensureActive = () => {
  if (!fs.existsSync(ACTIVE)) writeActive({ settings: demoSettings, timeline: demoTimeline });
};

// `tsx pipeline/active.ts` (postinstall) creates the placeholder
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'pipeline', 'active.ts')) ensureActive();
