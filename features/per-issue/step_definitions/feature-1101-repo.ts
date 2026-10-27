/**
 * The git side of the feature-1101 scenarios, on top of the feature-1100 fixture: a bare `origin`, a maintainer clone through
 * which every commit on `origin` is made, and the workspace of the target repository that the merge run clones. The branch of a
 * workflow is pushed off the base branch at the moment a step first needs it, so that the commits a step lands on the base
 * branch afterwards are ones the branch lacks. Every git call goes to the real binary.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { realGit } from '../../regression/support/fixtureWorktree.ts';
import { originBranchHolds, originBranchTip, pushFeatureBranch, sharedContents, type RepoFixture } from './feature-1100-repo.ts';
import { slugOf } from './feature-1101-standin.ts';
import type { Workflow } from './feature-1101-world.ts';

/** The cell of the commits table for a commit that changes no file the branch changed. */
export const NO_CONFLICT = 'no file';

function commitFiles(directory: string, files: Readonly<Record<string, string>>, message: string): void {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = join(directory, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents, 'utf-8');
    realGit(directory, 'add', '--', relativePath);
  }
  realGit(directory, 'commit', '-q', '-m', message);
}

/** The first step that needs the branch on `origin` puts it there, off the base branch as it is then. */
export function ensureBranchPushed(workflow: Workflow): void {
  if (workflow.branchPushed) return;
  pushFeatureBranch(workflow.repo, workflow.headBranch);
  workflow.branchPushed = true;
}

/** A commit conflicts with the branch in the file it names when it changes the line of the shared constant that the branch changed. Returns its sha. */
export function landOnBase(repo: RepoFixture, subject: string, conflictsIn: string): string {
  const { maintainerPath, baseBranch } = repo;
  const files = conflictsIn === NO_CONFLICT ? { [`docs/${slugOf(subject)}.md`]: `${subject}\n` } : { [conflictsIn]: sharedContents(baseBranch) };
  commitFiles(maintainerPath, files, subject);
  realGit(maintainerPath, 'push', '-q', 'origin', baseBranch);
  return realGit(maintainerPath, 'rev-parse', 'HEAD');
}

/** One commit on the branch as `origin` holds it now, which a merge run may have pushed to since; the maintainer ends on the base branch. */
export function commitOnBranch(repo: RepoFixture, branch: string, files: Readonly<Record<string, string>>, message: string): void {
  const { maintainerPath, baseBranch } = repo;
  realGit(maintainerPath, 'fetch', '-q', 'origin', branch);
  realGit(maintainerPath, 'checkout', '-q', '-B', branch, `origin/${branch}`);
  commitFiles(maintainerPath, files, message);
  realGit(maintainerPath, 'push', '-q', 'origin', branch);
  realGit(maintainerPath, 'checkout', '-q', baseBranch);
}

export function branchTipOnOrigin(workflow: Workflow): string {
  return originBranchTip(workflow.repo, workflow.headBranch).sha;
}

export function baseTipOnOrigin(repo: RepoFixture): string {
  return realGit(repo.originPath, 'rev-parse', repo.baseBranch);
}

export function branchHoldsBaseTip(workflow: Workflow): boolean {
  return originBranchHolds(workflow.repo, workflow.headBranch, baseTipOnOrigin(workflow.repo));
}

/** What `git log --oneline <old head>..<base tip>` prints in the workspace, newest first with merge commits left out. */
export function onelineBetween(repo: RepoFixture, oldHead: string): string[] {
  const printed = realGit(repo.workspacePath, 'log', '--oneline', '--no-merges', `${oldHead}..origin/${repo.baseBranch}`);
  return printed === '' ? [] : printed.split('\n');
}
