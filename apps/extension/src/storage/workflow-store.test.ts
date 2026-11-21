import { describe, expect, it } from 'vitest';
import type { Workflow } from '@flowpilot/shared';
import { memoryArea } from './area';
import { LOCAL_KEYS } from './keys';
import { WorkflowStore } from './workflow-store';

const make = (id: string): Workflow => ({
  schemaVersion: 2,
  id,
  name: id,
  origin: 'http://localhost:5173',
  createdAt: '2026-11-21T10:00:00.000Z',
  steps: [],
});

describe('WorkflowStore', () => {
  it('place le dernier enregistré en tête et remplace un id existant', async () => {
    const store = new WorkflowStore(memoryArea());
    await store.save(make('a'));
    await store.save(make('b'));
    await store.save({ ...make('a'), name: 'a2' });
    const { workflows } = await store.list();
    expect(workflows.map((w) => w.name)).toEqual(['a2', 'b']);
  });

  it('ignore les entrées corrompues sans perdre les autres', async () => {
    const area = memoryArea({ [LOCAL_KEYS.workflows]: [make('ok'), { schemaVersion: 42 }, 'junk'] });
    const { workflows, invalidCount } = await new WorkflowStore(area).list();
    expect(workflows.map((w) => w.id)).toEqual(['ok']);
    expect(invalidCount).toBe(2);
  });

  it('supprime par id', async () => {
    const store = new WorkflowStore(memoryArea());
    await store.save(make('a'));
    expect(await store.remove('a')).toBe(true);
    expect(await store.remove('a')).toBe(false);
    expect(await store.get('a')).toBeNull();
  });
});
