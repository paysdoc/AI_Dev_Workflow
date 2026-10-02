/**
 * The worktree G11 materialises: the cli-tool fixture committed on `main` under the harness
 * identity, a bare clone of it as `origin` (fetched, so `refs/remotes/origin/main` exists), and the
 * scenario's branch checked out.
 *
 * Every git call goes to the real binary. Under the @regression hooks PATH starts with the
 * git-mock, which turns `clone` and `fetch` into no-ops and would leave `origin/main` unborn;
 * outside them REAL_GIT_PATH is unset and plain `git` is the real one.
 */

import { execFileSync } from 'child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE_DIR = join(REPO_ROOT, 'test/fixtures/cli-tool');

export const HARNESS_GIT_IDENTITY = { name: 'ADW Regression', email: 'test@adw.local' } as const;

/** What the Claude CLI stub leaves in the worktree, which a commit that stages everything must never sweep up. */
export const STUB_FILES: readonly string[] = ['.adw-stub-manifest.json', '.adw-stub-payload.json', '.adw-stub-invocations'];

export interface FixtureWorktree {
  /** Holds the worktree and its origin; removing it removes both. */
  readonly base: string;
  readonly worktreePath: string;
  readonly originPath: string;
}

export function realGit(cwd: string, ...args: string[]): string {
  return execFileSync(process.env['REAL_GIT_PATH'] ?? 'git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trimEnd();
}

/** Turns `directory` into a repository on `main` that ignores the stub's files and holds everything it contains in one commit. */
export function initialiseRepository(directory: string): void {
  writeFileSync(join(directory, '.gitignore'), `${STUB_FILES.join('\n')}\n`, 'utf-8');

  realGit(directory, 'init', '-q', '-b', 'main');
  realGit(directory, 'config', 'user.name', HARNESS_GIT_IDENTITY.name);
  realGit(directory, 'config', 'user.email', HARNESS_GIT_IDENTITY.email);
  realGit(directory, 'config', 'commit.gpgsign', 'false');
  realGit(directory, 'add', '-A');
  realGit(directory, 'commit', '-q', '-m', 'Initial fixture commit');
}

/** The adwId stays in the base directory's name, which is how a failure message ties a path to its workflow. */
export function initialiseFixtureWorktree(adwId: string, branch: string): FixtureWorktree {
  const base = mkdtempSync(join(tmpdir(), `adw-wt-${adwId}-`));
  const worktreePath = join(base, 'worktree');
  const originPath = join(base, 'origin.git');

  cpSync(FIXTURE_DIR, worktreePath, { recursive: true });
  initialiseRepository(worktreePath);

  realGit(worktreePath, 'clone', '-q', '--bare', worktreePath, originPath);
  realGit(worktreePath, 'remote', 'add', 'origin', originPath);
  realGit(worktreePath, 'fetch', '-q', 'origin');

  if (branch !== 'main') realGit(worktreePath, 'checkout', '-q', '-b', branch);
  return { base, worktreePath, originPath };
}

export function commitFileOnBranch(worktreePath: string, relPath: string, contents: string, message: string): void {
  const absolutePath = join(worktreePath, relPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, 'utf-8');
  realGit(worktreePath, 'add', '--', relPath);
  realGit(worktreePath, 'commit', '-q', '-m', message);
}
