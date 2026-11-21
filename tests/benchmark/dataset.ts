import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateDataset, type Scenario } from '@flowpilot/evaluation';
import { MUTATIONS } from '../../apps/demo-site/src/mutations';

/** Loads and validates the versioned benchmark dataset (`tests/benchmark/scenarios/`). */

const DIR = path.resolve(import.meta.dirname, 'scenarios');

export interface Dataset {
  name: string;
  version: string;
  /** sha256 of the scenario files, in manifest order: identifies the exact data a run used. */
  hash: string;
  scenarios: Scenario[];
}

export const KNOWN_MUTATIONS: ReadonlySet<string> = new Set(Object.keys(MUTATIONS));

export function loadDataset(): Dataset {
  const manifest = JSON.parse(readFileSync(path.join(DIR, 'dataset.json'), 'utf8')) as { name: string; version: string; files: string[] };
  const hash = createHash('sha256');
  const scenarios: unknown[] = [];
  for (const file of manifest.files) {
    const text = readFileSync(path.join(DIR, file), 'utf8');
    hash.update(text);
    scenarios.push(...(JSON.parse(text) as unknown[]));
  }
  const validation = validateDataset(scenarios, KNOWN_MUTATIONS);
  if (!validation.ok) throw new Error(`Invalid benchmark dataset:\n${validation.errors.join('\n')}`);
  return { name: manifest.name, version: manifest.version, hash: hash.digest('hex'), scenarios: scenarios as Scenario[] };
}
