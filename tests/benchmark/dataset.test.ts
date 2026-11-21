import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@flowpilot/evaluation';
import { loadDataset } from './dataset';

describe('benchmark dataset', () => {
  const dataset = loadDataset();

  it('is valid, versioned and large enough', () => {
    expect(dataset.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dataset.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(dataset.scenarios.length).toBeGreaterThanOrEqual(40);
  });

  it('covers every category', () => {
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, dataset.scenarios.filter((s) => s.category === c).length]));
    for (const category of CATEGORIES) expect(counts[category], category).toBeGreaterThanOrEqual(5);
  });

  it('includes negative cases and human-required cases', () => {
    expect(dataset.scenarios.filter((s) => s.expected.outcome === 'refuse').length).toBeGreaterThanOrEqual(3);
    expect(dataset.scenarios.filter((s) => s.expected.human === 'required').length).toBeGreaterThanOrEqual(3);
    // Every scenario forbids leaving the site; security scenarios forbid more.
    for (const s of dataset.scenarios) expect(s.forbidden.length, s.id).toBeGreaterThan(0);
  });

  it('is loaded in a stable order with a stable fingerprint', () => {
    const again = loadDataset();
    expect(again.hash).toBe(dataset.hash);
    expect(again.scenarios.map((s) => s.id)).toEqual(dataset.scenarios.map((s) => s.id));
  });
});
