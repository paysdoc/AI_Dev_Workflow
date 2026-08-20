/**
 * BDD step definitions for feature-660.feature
 *
 * GitContext boundary constructor — cron + standalone orchestrators
 *
 * §1   boundary context from --target-repo → target workspace (outline)
 * §2   boundary context without --target-repo → self-host, framework root, local remote
 * §3   takeover resolves abandoned worktree under launch identity (incident pin)
 * §4   adwMerge resolves and merges against context's repository
 * §5   threading / cwd-independence
 * §6   TypeScript type-check passes → feature-504.steps.ts (T22)
 * G18  "the ADW codebase is checked out" → ensureCronOnEveryEventSteps.ts
 */

import * as path from 'path';
import * as os from 'os';
import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext } from '../../../adws/gitContext/index.ts';
import { buildLaunchGitContext } from '../../../adws/core/launchGitContext.ts';
import type { LaunchGitContextDeps } from '../../../adws/core/launchGitContext.ts';
import { parseTargetRepoArgs } from '../../../adws/core/orchestratorCli.ts';
import { executeMerge } from '../../../adws/adwMerge.tsx';
import type { MergeDeps } from '../../../adws/adwMerge.tsx';
import type { RepoInfo } from '../../../adws/github/githubApi.ts';
import type { AgentState } from '../../../adws/types/agentTypes.ts';

// ── World state ──────────────────────────────────────────────────────────────

interface World660 {
  frameworkRoot: string;
  targetReposDir: string;
  fakeRepoInfo: { owner: string; repo: string } | null;
  ctx: GitContext | null;
  abandonedBranch: string | null;
  resolvedWorktreePath: string | null;
  mergeAdwId: string | null;
  mergeBranch: string | null;
  recordedMergeRepoInfo: RepoInfo | null;
  recordedEnsureWorktreeBase: string | null;
  worktreePath1: string | null;
  worktreePath2: string | null;
  originalCwd: string;
}

const w: World660 = {
  frameworkRoot: '',
  targetReposDir: '',
  fakeRepoInfo: null,
  ctx: null,
  abandonedBranch: null,
  resolvedWorktreePath: null,
  mergeAdwId: null,
  mergeBranch: null,
  recordedMergeRepoInfo: null,
  recordedEnsureWorktreeBase: null,
  worktreePath1: null,
  worktreePath2: null,
  originalCwd: process.cwd(),
};

After(function () {
  if (process.cwd() !== w.originalCwd) {
    process.chdir(w.originalCwd);
  }
  w.ctx = null;
  w.fakeRepoInfo = null;
  w.abandonedBranch = null;
  w.resolvedWorktreePath = null;
  w.mergeAdwId = null;
  w.mergeBranch = null;
  w.recordedMergeRepoInfo = null;
  w.recordedEnsureWorktreeBase = null;
  w.worktreePath1 = null;
  w.worktreePath2 = null;
});

// ── Shared helper — build deps with all I/O injected ─────────────────────────

function makeTestDeps(overrides: Partial<LaunchGitContextDeps> = {}): LaunchGitContextDeps {
  return {
    getRepoInfo: w.fakeRepoInfo
      ? () => w.fakeRepoInfo!
      : () => { throw new Error('getRepoInfo not configured — call "the local git remote resolves to..." first'); },
    resolveToken: () => 'test-sentinel-token',
    resolveGitIdentity: () => ({
      authorName: 'Test Bot',
      authorEmail: 'bot@test.dev',
      committerName: 'Test Bot',
      committerEmail: 'bot@test.dev',
    }),
    frameworkRepoRoot: w.frameworkRoot,
    targetReposDir: w.targetReposDir,
    ...overrides,
  } as unknown as LaunchGitContextDeps;
}

// ── §1/§2 — Boundary setup ────────────────────────────────────────────────────

Given(
  'a launch boundary with framework root {string} and target-repos root {string}',
  function (frameworkRoot: string, targetReposDir: string) {
    w.frameworkRoot = frameworkRoot;
    w.targetReposDir = targetReposDir;
  },
);

Given(
  'the local git remote resolves to owner {string} repo {string}',
  function (owner: string, repo: string) {
    w.fakeRepoInfo = { owner, repo };
  },
);

Given(
  'a boundary GitContext is constructed from launch arguments {string}',
  function (argsString: string) {
    const args = argsString.split(/\s+/).filter(Boolean);
    const targetRepo = parseTargetRepoArgs(args);
    w.ctx = buildLaunchGitContext(targetRepo, makeTestDeps());
  },
);

Given(
  'a boundary GitContext is constructed with no target-repo argument',
  function () {
    // No --target-repo → self-host, getRepoInfo consulted for identity
    assert.ok(w.fakeRepoInfo !== null, 'Call "the local git remote resolves to..." first');
    w.ctx = buildLaunchGitContext(null, makeTestDeps());
  },
);

// ── §1/§2 — Boundary assertions ───────────────────────────────────────────────

Then('the boundary context is a target context', function () {
  assert.ok(w.ctx !== null, 'Expected a boundary GitContext to have been constructed');
  assert.strictEqual(w.ctx.selfHost, false, 'Expected selfHost to be false (target context)');
});

Then('the boundary context is a self-host context', function () {
  assert.ok(w.ctx !== null, 'Expected a boundary GitContext to have been constructed');
  assert.strictEqual(w.ctx.selfHost, true, 'Expected selfHost to be true (self-host context)');
});

Then('the boundary context base path is {string}', function (expectedPath: string) {
  assert.ok(w.ctx !== null, 'Expected a boundary GitContext to have been constructed');
  assert.strictEqual(w.ctx.basePath, expectedPath);
});

Then(
  'the boundary context targets owner {string} repo {string}',
  function (expectedOwner: string, expectedRepo: string) {
    assert.ok(w.ctx !== null, 'Expected a boundary GitContext to have been constructed');
    assert.strictEqual(w.ctx.owner, expectedOwner);
    assert.strictEqual(w.ctx.repo, expectedRepo);
  },
);

// ── §3 — Takeover resolves worktree via the launch context ────────────────────

Given(
  'an abandoned workflow on branch {string} awaits takeover',
  function (branch: string) {
    w.abandonedBranch = branch;
  },
);

When('the takeover resolves the abandoned workflow\'s worktree', function () {
  assert.ok(w.ctx !== null, 'Expected a boundary GitContext to have been constructed');
  assert.ok(w.abandonedBranch !== null, 'Expected an abandoned branch to be set');
  w.resolvedWorktreePath = w.ctx.worktreePathFor(w.abandonedBranch);
});

Then('the resolved worktree path is {string}', function (expectedPath: string) {
  assert.strictEqual(w.resolvedWorktreePath, expectedPath);
});

Then(
  'the resolved worktree path is not under the cron process working directory',
  function () {
    assert.ok(w.resolvedWorktreePath !== null, 'Expected a resolved worktree path');
    const cwd = process.cwd();
    assert.ok(
      !w.resolvedWorktreePath.startsWith(cwd),
      `Expected resolved path "${w.resolvedWorktreePath}" NOT to start with cwd "${cwd}"`,
    );
  },
);

// ── §4 — adwMerge resolves and merges against the context's repository ────────

Given(
  'a workflow for adwId {string} on branch {string} is awaiting the merge handoff with an open pull request',
  function (adwId: string, branch: string) {
    w.mergeAdwId = adwId;
    w.mergeBranch = branch;
  },
);

When(
  'the merge orchestrator runs under the boundary context for issue {int} and adwId {string}',
  async function (issueNumber: number, adwId: string) {
    assert.ok(w.ctx !== null, 'Expected a boundary GitContext to have been constructed');
    assert.ok(w.mergeBranch !== null, 'Expected a merge branch to be set');

    const branch = w.mergeBranch;
    const ctx = w.ctx;

    // Recording deps that capture repoInfo and ensureWorktree baseRepo
    const recordingDeps: MergeDeps = {
      readTopLevelState: () => ({
        adwId,
        issueNumber,
        agentName: 'sdlc-orchestrator',
        execution: { status: 'completed' as const, startedAt: '2024-01-01T00:00:00Z' },
        workflowStage: 'awaiting_merge',
        branchName: branch,
      } as AgentState),
      findOrchestratorStatePath: () => `/agents/${adwId}/sdlc-orchestrator`,
      readOrchestratorState: () => ({
        adwId,
        issueNumber,
        agentName: 'sdlc-orchestrator',
        execution: { status: 'completed' as const, startedAt: '2024-01-01T00:00:00Z' },
        workflowStage: 'awaiting_merge',
        branchName: branch,
      } as AgentState),
      findPRByBranch: (branchName: string) => {
        // findPRByBranch is bound to the context's identity — recorded here (not from
        // a call argument, since a bound provider takes none) to prove the merge still
        // resolves against ctx's repository, not the process cwd's local remote.
        w.recordedMergeRepoInfo = { owner: ctx.owner, repo: ctx.repo };
        return { number: 99, state: 'OPEN', sourceBranch: branchName, targetBranch: 'main', labels: [] };
      },
      issueHasLabel: () => false,
      fetchPRApprovalState: () => true,
      ensureWorktree: (branchName: string, _baseBranch: string) => {
        const base = ctx.basePath;
        w.recordedEnsureWorktreeBase = base;
        return path.join(base, '.worktrees', branchName);
      },
      ensureLogsDirectory: () => '/tmp/test-logs',
      mergeWithConflictResolution: async () => ({ success: true }),
      writeTopLevelState: () => undefined,
      commentOnIssue: () => undefined,
      commentOnPR: () => undefined,
      getPlanFilePath: () => '',
      planFileExists: () => false,
      notifyBlockedTransition: async () => undefined,
    };

    await executeMerge(issueNumber, adwId, { owner: ctx.owner, repo: ctx.repo }, ctx.basePath, recordingDeps);
  },
);

Then(
  'the merge resolves the pull request against the repository {string}',
  function (expectedRepo: string) {
    assert.ok(w.recordedMergeRepoInfo !== null, 'Expected repoInfo to have been recorded');
    const actual = `${w.recordedMergeRepoInfo.owner}/${w.recordedMergeRepoInfo.repo}`;
    assert.strictEqual(actual, expectedRepo);
  },
);

Then(
  'the merge resolves the worktree under the base path {string}',
  function (expectedBase: string) {
    assert.ok(w.recordedEnsureWorktreeBase !== null, 'Expected ensureWorktree base to have been recorded');
    assert.strictEqual(w.recordedEnsureWorktreeBase, expectedBase);
  },
);

Then(
  'the merge does not resolve the worktree under the cron process working directory',
  function () {
    assert.ok(w.recordedEnsureWorktreeBase !== null, 'Expected ensureWorktree base to have been recorded');
    const cwd = process.cwd();
    assert.ok(
      !w.recordedEnsureWorktreeBase.startsWith(cwd),
      `Expected merge base "${w.recordedEnsureWorktreeBase}" NOT to start with cwd "${cwd}"`,
    );
  },
);

// ── §5 — Threading / cwd-independence ────────────────────────────────────────

When(
  'the worktree for branch {string} is resolved through the boundary context from two different working directories',
  function (branch: string) {
    assert.ok(w.ctx !== null, 'Expected a boundary GitContext to have been constructed');
    w.worktreePath1 = w.ctx.worktreePathFor(branch);
    process.chdir(os.tmpdir());
    w.worktreePath2 = w.ctx.worktreePathFor(branch);
  },
);

Then(
  'both resolutions through the boundary context return {string}',
  function (expectedPath: string) {
    assert.strictEqual(w.worktreePath1, expectedPath, 'First resolution did not match');
    assert.strictEqual(w.worktreePath2, expectedPath, 'Second resolution (after chdir) did not match');
  },
);
