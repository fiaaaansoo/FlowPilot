import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGrantablePattern } from '@flowpilot/shared';

interface Manifest {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: unknown[];
}

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../manifest.json'), 'utf8')) as Manifest;

/** Garde-fous du manifest distribué : toute extension de permission doit faire échouer ce test. */
describe('manifest.json', () => {
  it('est en Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('ne demande que les permissions nécessaires', () => {
    expect([...(manifest.permissions ?? [])].sort()).toEqual(['scripting', 'sidePanel', 'storage']);
  });

  it('n’accorde aucun site à l’installation et ne déclare aucun content script', () => {
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
  });

  it('reste cohérent avec isGrantablePattern (UI de saisie des sites)', () => {
    expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
    expect(isGrantablePattern('http://localhost/*')).toBe(true);
    expect(isGrantablePattern('http://exemple.fr/*')).toBe(false);
  });
});
