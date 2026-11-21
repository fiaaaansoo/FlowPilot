import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect } from './fixtures';

/** Recovery backend started by a spec (own port, in-memory database, loopback only). */

export const API_DIR = path.resolve(import.meta.dirname, '../../apps/api');
const PYTHON =
  process.env.FLOWPILOT_PYTHON ??
  (process.platform === 'win32' ? path.join(API_DIR, '.venv', 'Scripts', 'python.exe') : path.join(API_DIR, '.venv', 'bin', 'python'));

export async function startBackend(env: Record<string, string>, port: number, token: string): Promise<ChildProcess> {
  const child = spawn(PYTHON, ['-m', 'flowpilot_api', 'serve', '--env-file', '.env.spec-unused'], {
    cwd: API_DIR,
    env: { ...process.env, ...env, FLOWPILOT_API_TOKEN: token, FLOWPILOT_PORT: String(port), FLOWPILOT_DB_PATH: ':memory:' },
    stdio: 'ignore',
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/healthz`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return child;
}
