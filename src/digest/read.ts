import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNight } from './parse.js';
import type { ReadNight } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const file = join(runsDir, `${night}.jsonl`);
  if (!existsSync(file)) return null;
  return parseNight(night, readFileSync(file, 'utf8'));
};
