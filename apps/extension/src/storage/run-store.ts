import { isRunSummary, type RunSummary } from '@flowpilot/shared';
import type { KeyValueArea } from './area';
import { LOCAL_KEYS } from './keys';

/** Nombre de runs conservés : assez pour l'évaluation, borné pour le stockage local. */
export const MAX_RUNS = 50;

/** Historique des exécutions (zone `chrome.storage.local`), du plus récent au plus ancien. */
export class RunStore {
  constructor(private readonly area: KeyValueArea) {}

  async list(): Promise<RunSummary[]> {
    const raw = await this.area.get(LOCAL_KEYS.runs);
    return Array.isArray(raw) ? (raw as unknown[]).filter(isRunSummary) : [];
  }

  async append(run: RunSummary): Promise<void> {
    const runs = await this.list();
    await this.area.set(LOCAL_KEYS.runs, [run, ...runs].slice(0, MAX_RUNS));
  }

  /** Supprime l'historique d'un workflow supprimé. */
  async removeFor(workflowId: string): Promise<void> {
    const runs = await this.list();
    await this.area.set(
      LOCAL_KEYS.runs,
      runs.filter((run) => run.workflowId !== workflowId),
    );
  }
}

/** Dernier run de chaque workflow. */
export function latestRuns(runs: readonly RunSummary[]): Map<string, RunSummary> {
  const latest = new Map<string, RunSummary>();
  for (const run of runs) if (!latest.has(run.workflowId)) latest.set(run.workflowId, run);
  return latest;
}
