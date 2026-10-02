import { afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const worktrees: string[] = [];

export function makeTempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-test-'));
  worktrees.push(dir);
  return dir;
}

/** Registers an afterEach hook that removes every temp dir `makeTempWorktree` handed out. */
export function useTempDirCleanup(): void {
  afterEach(() => {
    for (const dir of worktrees.splice(0)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });
}

export function writeManifest(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}
