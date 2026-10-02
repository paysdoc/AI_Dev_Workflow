/**
 * A throwaway bare repository that stands in for a repository's remote, and the clone ADW works from.
 *
 * The bare repository lets a push delete the branch its HEAD names. git refuses that by default, which
 * would let a scenario pass for git's reason; allowing it makes a scenario observe ADW's own decision
 * to leave the default branch alone.
 */

import { execFileSync } from 'child_process';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';

import { makeTempDir } from './feature-933-fixture.ts';

export interface Remote {
  readonly bareDir: string;
  readonly seedDir: string;
  readonly clonePath: string;
}

const SEED_IDENTITY = ['-c', 'user.name=ADW BDD', '-c', 'user.email=bdd@adw.invalid', '-c', 'commit.gpgsign=false'];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/** Seeds `defaultBranch` with one commit and clones the remote to `<targetReposDir>/<owner>/<repo>`, so the clone's `origin/HEAD` names it. */
export function createRemote(targetReposDir: string, owner: string, repo: string, defaultBranch: string): Remote {
  const bareDir = makeTempDir('adw-933-remote-');
  const seedDir = makeTempDir('adw-933-seed-');
  git(bareDir, 'init', '-q', '--bare', `--initial-branch=${defaultBranch}`);
  git(bareDir, 'config', 'receive.denyDeleteCurrent', 'ignore');
  git(seedDir, 'init', '-q', `--initial-branch=${defaultBranch}`);
  git(seedDir, ...SEED_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'seed');
  git(seedDir, 'push', '-q', bareDir, defaultBranch);

  const clonePath = join(targetReposDir, owner, repo);
  mkdirSync(dirname(clonePath), { recursive: true });
  git(targetReposDir, 'clone', '-q', bareDir, clonePath);
  return { bareDir, seedDir, clonePath };
}

/** The branch names the remote holds, read with `git ls-remote --heads`. */
export function remoteBranches(remote: Remote): string[] {
  return git(remote.bareDir, 'ls-remote', '--heads', remote.bareDir)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1].replace(/^refs\/heads\//, ''));
}

/** Pushes `branch` to the remote when the remote lacks it. */
export function ensureRemoteBranch(remote: Remote, branch: string): void {
  if (remoteBranches(remote).includes(branch)) return;
  git(remote.seedDir, 'push', '-q', remote.bareDir, `HEAD:refs/heads/${branch}`);
}
