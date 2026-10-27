/**
 * Runs the merge orchestrator's real `executeMerge` in this process: the launch boundary is the production one, built over the
 * workspace cloned from the fixture's `origin`, so ADW's git calls, its worktree and its state file are the real ones. Only the
 * forge is the stand-in, and the production merge loop is called with its code host and with a `wait` that records and returns
 * at once, which `MergeDeps` has no place for, so the dependency that calls the loop is replaced and nothing else.
 */

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';

import type { GitIdentity } from '@paysdoc/devplatform/git';

import { buildDefaultDeps, executeMerge, type MergeDeps } from '../../../adws/adwMerge.tsx';
import { buildLaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import { mergeWithConflictResolution } from '../../../adws/triggers/autoMergeHandler.ts';
import { cloneWorkspace } from './feature-1100-repo.ts';
import { OWNER, REPO, type Workflow } from './feature-1100-world.ts';

const BOT_IDENTITY: GitIdentity = {
  authorName: 'ADW Test Bot',
  authorEmail: 'bot@test.dev',
  committerName: 'ADW Test Bot',
  committerEmail: 'bot@test.dev',
};

/**
 * Under the `@regression` hooks PATH leads with the git mock, which answers `fetch` and `push` without reaching `origin`, and
 * what the merge run fetches and pushes is what these scenarios assert. REAL_GIT_PATH is set only while the mock is in place.
 */
async function withRealGitLeadingPath<T>(run: () => Promise<T>): Promise<T> {
  const realGitPath = process.env['REAL_GIT_PATH'];
  if (!realGitPath) return run();

  const binDir = mkdtempSync(join(tmpdir(), 'adw-1100-real-git-'));
  const wrapper = join(binDir, 'git');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${realGitPath}" "$@"\n`, 'utf-8');
  chmodSync(wrapper, 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = `${binDir}${delimiter}${savedPath ?? ''}`;
  try {
    return await run();
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    rmSync(binDir, { recursive: true, force: true });
  }
}

export async function runMergeOrchestrator(workflow: Workflow): Promise<void> {
  const { repo, forge } = workflow;
  // A workflow that is merged twice finds the workspace from the first run, with the worktree ADW added to it.
  if (!existsSync(repo.workspacePath)) cloneWorkspace(repo);

  const boundary = buildLaunchBoundary(
    { owner: OWNER, repo: REPO, cloneUrl: repo.originPath },
    {
      resolveToken: () => 'adw-1100-token',
      resolveGitIdentity: () => BOT_IDENTITY,
      frameworkRepoRoot: repo.root,
      targetReposDir: repo.targetReposDir,
      forgeProviders: () => forge.providers,
    },
  );
  const deps: MergeDeps = {
    ...buildDefaultDeps(boundary),
    mergeWithConflictResolution: (prNumber, headBranch, baseBranch, worktreePath, adwId, logsDir, specPath, rerunScenarios) =>
      mergeWithConflictResolution(
        prNumber, forge.providers.codeHost, headBranch, baseBranch, worktreePath, adwId, logsDir, specPath,
        boundary.gitContext, rerunScenarios, forge.recordWait,
      ),
  };
  await withRealGitLeadingPath(() =>
    executeMerge(workflow.issueNumber, workflow.adwId, boundary.repoId, boundary.gitContext.basePath, deps),
  );
}
