/**
 * The git side of the feature-1100 scenarios: a bare `origin`; a "maintainer" clone that stands for everyone else who pushes
 * to it, and through which every branch and every commit on `origin` is made; and the workspace of the target repository,
 * cloned from `origin` when the merge runs, as the workspace of a target repository is cloned on first use.
 *
 * A feature branch changes the one line of `src/shared.ts` that a commit on the base branch can also change, which is what
 * makes it conflict. Every git call goes to the real binary, whatever the PATH leads with.
 */

import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { commitFileOnBranch, HARNESS_GIT_IDENTITY, realGit } from '../../regression/support/fixtureWorktree.ts';

export const SHARED_FILE = 'src/shared.ts';

export function sharedContents(value: string): string {
  return `export const shared = '${value}';\n`;
}

/** What the stand-in `/resolve_conflict` agent writes over the conflicting file. */
export const RESOLVED_SHARED_CONTENTS = sharedContents('resolved');

export interface RepoFixture {
  /** Holds everything below; removing it removes all of it. */
  readonly root: string;
  readonly originPath: string;
  readonly maintainerPath: string;
  /** Holds the workspace, and above every worktree ADW adds to it, the marker that programs the Claude CLI stub. */
  readonly targetReposDir: string;
  readonly workspacePath: string;
  readonly baseBranch: string;
}

export interface BranchTip {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly subject: string;
}

function configureIdentity(repositoryPath: string): void {
  realGit(repositoryPath, 'config', 'user.name', HARNESS_GIT_IDENTITY.name);
  realGit(repositoryPath, 'config', 'user.email', HARNESS_GIT_IDENTITY.email);
  realGit(repositoryPath, 'config', 'commit.gpgsign', 'false');
}

/** `origin` holds `baseBranch` with one commit, and the maintainer has it checked out. */
export function createRepoFixture(owner: string, repo: string, baseBranch: string): RepoFixture {
  const root = mkdtempSync(join(tmpdir(), 'adw-1100-'));
  const originPath = join(root, 'origin.git');
  const maintainerPath = join(root, 'maintainer');
  const targetReposDir = join(root, 'target-repos');
  mkdirSync(maintainerPath, { recursive: true });
  mkdirSync(targetReposDir, { recursive: true });

  realGit(root, 'init', '-q', '--bare', '-b', baseBranch, originPath);
  realGit(maintainerPath, 'init', '-q', '-b', baseBranch);
  configureIdentity(maintainerPath);
  realGit(maintainerPath, 'remote', 'add', 'origin', originPath);
  commitFileOnBranch(maintainerPath, SHARED_FILE, sharedContents('base'), 'Add the shared constant');
  commitFileOnBranch(maintainerPath, 'README.md', '# widgets\n', 'Add the readme');
  realGit(maintainerPath, 'push', '-q', 'origin', baseBranch);

  return { root, originPath, maintainerPath, targetReposDir, workspacePath: join(targetReposDir, owner, repo), baseBranch };
}

/** The branch is off the base branch's first commits and has changed the shared constant; the maintainer is back on the base branch. */
export function pushFeatureBranch(fixture: RepoFixture, branch: string): void {
  const { maintainerPath, baseBranch } = fixture;
  realGit(maintainerPath, 'checkout', '-q', '-b', branch);
  commitFileOnBranch(maintainerPath, SHARED_FILE, sharedContents('feature'), 'Change the shared constant');
  commitFileOnBranch(maintainerPath, `src/${branch}.ts`, `export const branch = '${branch}';\n`, `Add ${branch}`);
  realGit(maintainerPath, 'push', '-q', 'origin', branch);
  realGit(maintainerPath, 'checkout', '-q', baseBranch);
}

/** The base branch moves on without touching a file the branch changed, so the branch is behind it and still merges cleanly. */
export function addBranchMergingCleanly(fixture: RepoFixture, branch: string): void {
  pushFeatureBranch(fixture, branch);
  commitFileOnBranch(fixture.maintainerPath, 'docs/changelog.md', '# changelog\n', 'Add the changelog');
  realGit(fixture.maintainerPath, 'push', '-q', 'origin', fixture.baseBranch);
}

/** The base branch moves on by changing the same line of the shared constant as the branch did. */
export function addBranchConflicting(fixture: RepoFixture, branch: string): void {
  pushFeatureBranch(fixture, branch);
  landConflictingCommit(fixture);
}

/** Returns the commit that landed. */
export function landConflictingCommit(fixture: RepoFixture): string {
  const { maintainerPath, baseBranch } = fixture;
  commitFileOnBranch(maintainerPath, SHARED_FILE, sharedContents(baseBranch), `Change the shared constant on ${baseBranch}`);
  realGit(maintainerPath, 'push', '-q', 'origin', baseBranch);
  return realGit(maintainerPath, 'rev-parse', 'HEAD');
}

/** The workspace is on the base branch, with every branch of `origin` as a remote-tracking ref. */
export function cloneWorkspace(fixture: RepoFixture): void {
  mkdirSync(dirname(fixture.workspacePath), { recursive: true });
  realGit(fixture.root, 'clone', '-q', fixture.originPath, fixture.workspacePath);
  configureIdentity(fixture.workspacePath);
}

export function originBranchTip(fixture: RepoFixture, branch: string): BranchTip {
  const [sha, parents, subject] = realGit(fixture.originPath, 'log', '-1', '--format=%H%n%P%n%s', branch).split('\n');
  return { sha, parents: parents.split(' ').filter(Boolean), subject };
}

export function originBranchHolds(fixture: RepoFixture, branch: string, sha: string): boolean {
  return realGit(fixture.originPath, 'rev-list', branch).split('\n').includes(sha);
}
