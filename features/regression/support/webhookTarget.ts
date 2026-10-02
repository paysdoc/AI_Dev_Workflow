/**
 * What an in-process webhook dispatch acts on in a `@webhook` scenario: the throwaway workspace of
 * the target repository that the subprocess harness lays out, a real worktree in it for an issue,
 * and the boundary the dispatcher mints over it. The boundary holds a real `GitContext` bound to
 * that workspace, so the cancel handler's worktree removal runs real git there and never reaches the
 * checkout, and the recording mock forge, so its comment deletions reach the mock GitHub API.
 * No hooks and no import-time side effects, so any step file may import it.
 */

import { createLiteralTokenProvider, GitContext } from '@paysdoc/devplatform/git';
import assert from 'assert';
import { existsSync, readdirSync } from 'fs';
import { basename, join } from 'path';

import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import type { EventBoundaryMinter } from '../step_definitions/webhookCronSteps.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';
import { DEFAULT_BRANCH } from './fixtureTargetRepo.ts';
import { HARNESS_GIT_IDENTITY, realGit } from './fixtureWorktree.ts';
import { SURFACE_REPO, mockForgeProviders } from './mockForgeProviders.ts';
import { ensureTargetWorkspace, requireHarness } from './subprocessHarness.ts';

const WORKTREES_DIRECTORY = '.worktrees';

/** `frameworkRepoRoot` is the workspace as well, so no command the context runs can name the checkout. */
function gitContextFor(targetReposDir: string, workspacePath: string): GitContext {
  const { name, email } = HARNESS_GIT_IDENTITY;
  return new GitContext({
    owner: SURFACE_REPO.owner,
    repo: SURFACE_REPO.repo,
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('mock-token'),
    gitIdentity: { authorName: name, authorEmail: email, committerName: name, committerEmail: email },
    frameworkRepoRoot: workspacePath,
    targetReposDir,
  });
}

/** ADW names a branch `{type}-issue-{N}-{slug}`, and the cancel handler removes the worktrees whose directory name holds `-issue-<N>-`. */
function namesIssue(path: string, issueNumber: number): boolean {
  return basename(path).includes(`-issue-${issueNumber}-`);
}

/** A worktree on a new branch off `main`, at the path the workspace's `GitContext` gives the branch. */
export function addIssueWorktree(world: RegressionWorld, issueNumber: number, branch: string): string {
  assert.ok(namesIssue(branch, issueNumber), `Expected the branch "${branch}" to name issue ${issueNumber} as ADW's branches do (…-issue-${issueNumber}-…), since the cancel handler removes only such worktrees`);
  const workspace = ensureTargetWorkspace(world);
  const path = gitContextFor(requireHarness(world).targetReposDir, workspace).worktreePathFor(branch);
  realGit(workspace, 'worktree', 'add', '-q', '-b', branch, path, DEFAULT_BRANCH);
  return path;
}

/** The worktrees git lists for the workspace and the directories under its `.worktrees/`, whose name holds `-issue-<N>-`: a directory left on disk counts as much as a listing. */
export function issueWorktreesLeft(world: RegressionWorld, issueNumber: number): string[] {
  const workspace = ensureTargetWorkspace(world);
  const listed = realGit(workspace, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
  const directory = join(workspace, WORKTREES_DIRECTORY);
  const onDisk = existsSync(directory) ? readdirSync(directory).map((name) => join(directory, name)) : [];
  return [...new Set([...listed, ...onDisk])].filter((path) => namesIssue(path, issueNumber));
}

export function branchExists(world: RegressionWorld, branch: string): boolean {
  return realGit(ensureTargetWorkspace(world), 'branch', '--list', branch) !== '';
}

/** Mints the boundary for the target repository only; any other repository gets none, so the dispatcher answers `boundary_unavailable` and the Thens fail loudly. */
export function webhookTargetBoundary(world: RegressionWorld): EventBoundaryMinter {
  const workspace = ensureTargetWorkspace(world);
  const boundary: LaunchBoundary = {
    gitContext: gitContextFor(requireHarness(world).targetReposDir, workspace),
    repoId: SURFACE_REPO,
    providers: mockForgeProviders(SURFACE_REPO, workspace),
  };
  return (targetRepo) => (targetRepo?.owner === SURFACE_REPO.owner && targetRepo.repo === SURFACE_REPO.repo ? boundary : undefined);
}
