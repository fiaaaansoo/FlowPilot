import { isRecord, parseWorkflow, type Workflow } from '@flowpilot/shared';
import type { KeyValueArea } from './area';
import { LOCAL_KEYS } from './keys';

export interface WorkflowList {
  workflows: Workflow[];
  /** Entrées présentes en stockage mais rejetées par le validateur (corrompues ou d'une version inconnue). */
  invalidCount: number;
}

/** Lit la liste persistée de façon défensive : une entrée invalide n'empêche pas de lire les autres. */
function readWorkflowList(raw: unknown): WorkflowList {
  if (!Array.isArray(raw)) return { workflows: [], invalidCount: 0 };
  const workflows: Workflow[] = [];
  let invalidCount = 0;
  for (const entry of raw) {
    const parsed = parseWorkflow(entry);
    if (parsed.ok) workflows.push(parsed.value);
    else invalidCount += 1;
  }
  return { workflows, invalidCount };
}

const idOf = (entry: unknown): unknown => (isRecord(entry) ? entry.id : undefined);

/** Workflows persistés (zone `chrome.storage.local`), du plus récent au plus ancien. */
export class WorkflowStore {
  constructor(private readonly area: KeyValueArea) {}

  async list(): Promise<WorkflowList> {
    return readWorkflowList(await this.area.get(LOCAL_KEYS.workflows));
  }

  /** Ne valide que l'entrée demandée, pas toute la liste. */
  async get(id: string): Promise<Workflow | null> {
    const entry = (await this.rawEntries()).find((e) => idOf(e) === id);
    if (entry === undefined) return null;
    const parsed = parseWorkflow(entry);
    return parsed.ok ? parsed.value : null;
  }

  /** Ajoute ou remplace (même id), puis place le workflow en tête. */
  async save(workflow: Workflow): Promise<void> {
    const entries = await this.rawEntries();
    const others = entries.filter((e) => idOf(e) !== workflow.id);
    await this.area.set(LOCAL_KEYS.workflows, [workflow, ...others]);
  }

  /** Renvoie `false` si aucun workflow ne portait cet id. */
  async remove(id: string): Promise<boolean> {
    const entries = await this.rawEntries();
    const kept = entries.filter((e) => idOf(e) !== id);
    if (kept.length === entries.length) return false;
    await this.area.set(LOCAL_KEYS.workflows, kept);
    return true;
  }

  /** Entrées brutes, invalides comprises : une écriture n'efface pas ce qu'elle ne sait pas lire. */
  private async rawEntries(): Promise<unknown[]> {
    const raw = await this.area.get(LOCAL_KEYS.workflows);
    return Array.isArray(raw) ? (raw as unknown[]) : [];
  }
}
