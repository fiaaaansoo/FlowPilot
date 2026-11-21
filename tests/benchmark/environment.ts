import { execFileSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import path from 'node:path';
import type { Manifest } from '@flowpilot/evaluation';

/** Facts about the machine and the code a run used, for the run manifest. Missing facts are null, never guessed. */

const OLLAMA_URL = 'http://127.0.0.1:11434';
const ROOT = path.resolve(import.meta.dirname, '../..');

function run(command: string, args: string[], cwd = ROOT): string | null {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

export function gitState(): { commit: string; dirty: boolean } {
  return {
    commit: run('git', ['rev-parse', 'HEAD']) ?? 'unknown',
    dirty: (run('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests']) ?? '') !== '',
  };
}

export async function ollamaInfo(): Promise<{ version: string | null; digests: Record<string, string> }> {
  try {
    const version = (await (await fetch(`${OLLAMA_URL}/api/version`)).json()) as { version?: string };
    const tags = (await (await fetch(`${OLLAMA_URL}/api/tags`)).json()) as { models?: { name: string; digest: string }[] };
    return { version: version.version ?? null, digests: Object.fromEntries((tags.models ?? []).map((m) => [m.name, m.digest])) };
  } catch {
    return { version: null, digests: {} };
  }
}

export function environment(browser: string, ollama: string | null): Manifest['environment'] {
  const python = path.join(ROOT, 'apps', 'api', '.venv', platform() === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const gpu = run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
  return {
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model.trim() ?? 'unknown',
    cpuCores: cpus().length,
    ramMb: Math.round(totalmem() / 1_048_576),
    gpu,
    node: process.version,
    python: run(process.env.FLOWPILOT_PYTHON ?? python, ['--version']),
    ollama,
    browser,
  };
}
