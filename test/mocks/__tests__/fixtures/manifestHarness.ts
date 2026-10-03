import { afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

const worktrees: string[] = [];

export function makeTempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-test-'));
  worktrees.push(dir);
  return dir;
}

export function gitOut(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trimEnd();
}

/** A git repository on `main` with one commit, so `commits` and `commitAll` have a HEAD to build on. */
export function makeTempRepo(): string {
  const dir = makeTempWorktree();
  gitOut(dir, 'init', '-q', '-b', 'main');
  gitOut(dir, 'config', 'user.email', 'test@adw.local');
  gitOut(dir, 'config', 'user.name', 'ADW Test');
  writeFileSync(join(dir, 'README.md'), 'readme\n');
  gitOut(dir, 'add', '-A');
  gitOut(dir, 'commit', '-q', '-m', 'init');
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
