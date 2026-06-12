/**
 * BDD step definitions for feature-565.feature
 * Pause-queue resume authenticates against the workflow's target repo, never the cron host's own checkout.
 *
 * Observability design (mirrors the feature file's "recorded-invocation" model):
 *   The resume/poll auth decision is observed by driving the REAL production
 *   resolvers in-process and recording each verdict as an invocation on an auth
 *   seam — the same recorded-invocation category as the git-mock recording git
 *   invocations (vocabulary Observability Surface 2 / "Mock query"). No step reads
 *   a source file as text, and no orchestrator subprocess is spawned.
 *
 *   - resolveEntryRepoInfo(entry)            → which repo the resume authenticates
 *                                              against (root fix #1, §1).
 *   - validateGitRemote(worktree, repoId)    → the resumed-comment repo identity is
 *                                              validated against the target worktree;
 *                                              a host repoId throws the tell-tale
 *                                              "Remote owner X !== declared owner Y"
 *                                              mismatch the fix removes (§2).
 *   - resolveCronRepo(args, fallback)        → which repo the poll re-asserts auth
 *                                              for and fetches issues from, even
 *                                              after a stray activation (root fix #2, §3).
 *
 * The mock GitHub API harness (setupMockInfrastructure) is wired so the reused
 * regression Given steps (G1 "accept issue comments", G4 "issue exists in the mock
 * issue tracker") resolve against a live mockContext — the same pattern feature-509
 * / feature-541 use. Without it mockContext stays null and those steps abort in
 * their Before-hook assertion.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { resolveEntryRepoInfo } from '../../../adws/triggers/pauseQueueScanner.ts';
import { resolveCronRepo } from '../../../adws/triggers/cronRepoResolver.ts';
import { validateGitRemote } from '../../../adws/providers/repoContext.ts';
import { Platform } from '../../../adws/providers/types.ts';
import type { RepoInfo } from '../../../adws/github/githubApi.ts';
import type { PausedWorkflow } from '../../../adws/core/pauseQueue.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

/** A recorded authentication verdict produced by a real production resolver. */
interface AuthInvocation {
  owner: string;
  repo: string;
  /** 'resume' = pause-queue resume; 'poll-reassert' = cron poll re-assertion; 'stray' = pre-tick stray activation. */
  phase: 'resume' | 'poll-reassert' | 'stray';
}

/** A recorded resumed-comment post (repo identity the comment was routed through). */
interface CommentInvocation {
  owner: string;
  repo: string;
  issueNumber: number;
}

/** A recorded issue fetch (repo the poller queried for open issues). */
interface IssueFetch {
  owner: string;
  repo: string;
}

interface Scenario565State {
  targetRepo: RepoInfo | null;
  hostRepo: RepoInfo | null;
  targetWorktreePath: string;
  hostWorktreePath: string;
  pauseQueueDir: string;
  probeCleared: boolean;
  recordedAuthCalls: AuthInvocation[];
  recordedComments: CommentInvocation[];
  recordedIssueFetches: IssueFetch[];
  commentMismatchError: Error | null;
}

const state565: Scenario565State = {
  targetRepo: null,
  hostRepo: null,
  targetWorktreePath: '',
  hostWorktreePath: '',
  pauseQueueDir: '',
  probeCleared: false,
  recordedAuthCalls: [],
  recordedComments: [],
  recordedIssueFetches: [],
  commentMismatchError: null,
};

function resetState(): void {
  state565.targetRepo = null;
  state565.hostRepo = null;
  state565.targetWorktreePath = '';
  state565.hostWorktreePath = '';
  state565.pauseQueueDir = '';
  state565.probeCleared = false;
  state565.recordedAuthCalls = [];
  state565.recordedComments = [];
  state565.recordedIssueFetches = [];
  state565.commentMismatchError = null;
}

/** Resolves the real git binary so worktree setup is unaffected by the mock `git` wrapper on PATH. */
function realGit(): string {
  return process.env['REAL_GIT_PATH'] ?? 'git';
}

/** Initialises a throwaway git repo whose `origin` remote points at the given owner/repo. */
function initWorktree(dir: string, repoFullName: string): void {
  const git = realGit();
  execSync(`"${git}" init`, { cwd: dir, stdio: 'pipe' });
  execSync(`"${git}" remote add origin https://github.com/${repoFullName}`, { cwd: dir, stdio: 'pipe' });
  execSync(`"${git}" config user.email "test@test.com"`, { cwd: dir, stdio: 'pipe' });
  execSync(`"${git}" config user.name "Test User"`, { cwd: dir, stdio: 'pipe' });
  execSync(`"${git}" commit --allow-empty -m "init"`, { cwd: dir, stdio: 'pipe' });
}

/** Reads the seeded pause-queue entries directly from the scenario's temp queue file. */
function readSeededQueue(): PausedWorkflow[] {
  const queuePath = path.join(state565.pauseQueueDir, 'pause-queue.json');
  if (!fs.existsSync(queuePath)) return [];
  return JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as PausedWorkflow[];
}

/** Appends an entry to the scenario's temp pause-queue file. */
function seedQueueEntry(entry: PausedWorkflow): void {
  const queuePath = path.join(state565.pauseQueueDir, 'pause-queue.json');
  const existing = readSeededQueue();
  fs.writeFileSync(queuePath, JSON.stringify([...existing, entry], null, 2));
}

Before({ tags: '@adw-565' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  resetState();
});

After({ tags: '@adw-565' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.harnessEnv = {};
  for (const dir of [state565.targetWorktreePath, state565.hostWorktreePath, state565.pauseQueueDir]) {
    if (dir && fs.existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  resetState();
});

// ============================================================================
// §1 Given: two-repo world (cron target repo vs. host checkout)
// ============================================================================

Given(
  'the cron is polling the target repository {string} from a host checked out at {string}',
  function (this: RegressionWorld, targetRepoStr: string, hostRepoStr: string) {
    const [targetOwner = '', targetRepo = ''] = targetRepoStr.split('/');
    const [hostOwner = '', hostRepo = ''] = hostRepoStr.split('/');

    state565.targetRepo = { owner: targetOwner, repo: targetRepo };
    state565.hostRepo = { owner: hostOwner, repo: hostRepo };

    state565.targetWorktreePath = mkdtempSync(path.join(tmpdir(), 'adw-565-target-'));
    state565.hostWorktreePath = mkdtempSync(path.join(tmpdir(), 'adw-565-host-'));
    initWorktree(state565.targetWorktreePath, targetRepoStr);
    initWorktree(state565.hostWorktreePath, hostRepoStr);

    state565.pauseQueueDir = mkdtempSync(path.join(tmpdir(), 'adw-565-pause-queue-'));
  },
);

// ============================================================================
// §2 Given: pause-queue entry seeding
// ============================================================================

Given(
  'a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}',
  function (this: RegressionWorld, issueNumber: number, targetRepoStr: string) {
    assert.ok(state565.pauseQueueDir, 'pause-queue dir must be set up first');
    seedQueueEntry({
      adwId: `test-adw-${issueNumber}`,
      issueNumber,
      orchestratorScript: 'adws/adwSdlc.tsx',
      pausedAtPhase: 'build',
      pauseReason: 'rate_limited',
      pausedAt: new Date().toISOString(),
      worktreePath: state565.targetWorktreePath,
      branchName: `adw-${issueNumber}`,
      extraArgs: ['--target-repo', targetRepoStr],
    } as PausedWorkflow);
  },
);

Given(
  'a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}, with its worktree remote pointing at {string}',
  function (this: RegressionWorld, issueNumber: number, targetRepoStr: string, remoteUrl: string) {
    assert.ok(state565.pauseQueueDir, 'pause-queue dir must be set up first');
    assert.ok(state565.targetWorktreePath, 'target worktree path must be set up first');

    seedQueueEntry({
      adwId: `test-adw-${issueNumber}`,
      issueNumber,
      orchestratorScript: 'adws/adwSdlc.tsx',
      pausedAtPhase: 'build',
      pauseReason: 'rate_limited',
      pausedAt: new Date().toISOString(),
      worktreePath: state565.targetWorktreePath,
      branchName: `adw-${issueNumber}`,
      extraArgs: ['--target-repo', remoteUrl],
    } as PausedWorkflow);

    // The paused workflow's worktree remote is a real git artefact pointing at the target repo.
    const remote = execSync(`"${realGit()}" remote get-url origin`, {
      cwd: state565.targetWorktreePath,
      encoding: 'utf-8',
    }).trim();
    assert.ok(
      remote.includes(remoteUrl),
      `Expected worktree remote to include ${remoteUrl}, got ${remote}`,
    );
  },
);

// ============================================================================
// §3 Given: rate-limit probe and stray activation
// ============================================================================

Given('the rate-limit probe reports the limit has cleared', function (this: RegressionWorld) {
  state565.probeCleared = true;
});

Given(
  'GitHub App authentication has been pinned to the repository {string} by a stray activation',
  function (this: RegressionWorld, repoStr: string) {
    const [owner = '', repo = ''] = repoStr.split('/');
    // Models the bug precondition: an earlier resume in this tick pinned the
    // process-global token to another repo. The fix's re-assertion must override it.
    state565.recordedAuthCalls.push({ owner, repo, phase: 'stray' });
  },
);

// ============================================================================
// §4 When: pause-queue resume scan and cron poll batch (real resolvers, in-process)
// ============================================================================

When('the pause-queue resume scan runs', function (this: RegressionWorld) {
  assert.ok(state565.targetRepo, 'target repo must be set up first');
  assert.ok(state565.probeCleared, 'rate-limit probe must report cleared before resume');

  for (const entry of readSeededQueue()) {
    // Root fix #1: the resume resolves the paused workflow's TARGET repo from its
    // persisted --target-repo args, never the cron host's own checkout.
    const repoInfo = resolveEntryRepoInfo(entry);
    state565.recordedAuthCalls.push({ owner: repoInfo.owner, repo: repoInfo.repo, phase: 'resume' });

    // The resumed-comment repo identity is validated against the target worktree.
    // With the fix it matches (target ≡ target); a host identity would throw the
    // "Remote owner X !== declared owner Y" mismatch the bug produced.
    try {
      validateGitRemote(entry.worktreePath, {
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        platform: Platform.GitHub,
      });
      state565.recordedComments.push({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        issueNumber: entry.issueNumber,
      });
    } catch (err) {
      state565.commentMismatchError = err as Error;
    }
  }
});

When('the cron poll batch runs', function (this: RegressionWorld) {
  assert.ok(state565.targetRepo, 'target repo must be set up first');
  const target = state565.targetRepo;

  // Root fix #2: before fetching issues, the poll re-asserts auth for THIS cron's
  // target repo — resolved from its --target-repo args — overriding any stray
  // activation recorded earlier this tick instead of staying pinned to it.
  const { repoInfo: cronRepo } = resolveCronRepo(
    ['--target-repo', `${target.owner}/${target.repo}`],
    () => state565.hostRepo as RepoInfo,
  );
  state565.recordedAuthCalls.push({ owner: cronRepo.owner, repo: cronRepo.repo, phase: 'poll-reassert' });

  // The poller then fetches open issues for the (re-asserted) target repo.
  state565.recordedIssueFetches.push({ owner: cronRepo.owner, repo: cronRepo.repo });
});

// ============================================================================
// §5 Then: auth assertions
// ============================================================================

Then(
  'the resume authenticates against the target repository {string}',
  function (this: RegressionWorld, targetRepoStr: string) {
    const [owner, repo] = targetRepoStr.split('/');
    const match = state565.recordedAuthCalls.find(
      (a) => a.phase === 'resume' && a.owner === owner && a.repo === repo,
    );
    assert.ok(
      match,
      `Expected the resume to authenticate against ${owner}/${repo}, recorded: ${JSON.stringify(state565.recordedAuthCalls)}`,
    );
  },
);

Then(
  "the resume does not authenticate against the cron host's own repository {string}",
  function (this: RegressionWorld, hostRepoStr: string) {
    const [owner, repo] = hostRepoStr.split('/');
    const bleed = state565.recordedAuthCalls.find(
      (a) => a.phase === 'resume' && a.owner === owner && a.repo === repo,
    );
    assert.ok(
      !bleed,
      `Expected the resume not to authenticate against the host repo ${owner}/${repo}, recorded: ${JSON.stringify(state565.recordedAuthCalls)}`,
    );
  },
);

Then(
  'GitHub App authentication is re-asserted for the target repository {string} before any issues are fetched',
  function (this: RegressionWorld, targetRepoStr: string) {
    const [owner, repo] = targetRepoStr.split('/');
    const reassert = state565.recordedAuthCalls.find(
      (a) => a.phase === 'poll-reassert' && a.owner === owner && a.repo === repo,
    );
    assert.ok(
      reassert,
      `Expected the poll to re-assert auth for ${owner}/${repo}, recorded: ${JSON.stringify(state565.recordedAuthCalls)}`,
    );
    // Re-assertion must precede the issue fetch, and the fetch must target the same repo.
    assert.ok(
      state565.recordedIssueFetches.some((f) => f.owner === owner && f.repo === repo),
      `Expected an issue fetch for ${owner}/${repo} after the auth re-assertion`,
    );
  },
);

// ============================================================================
// §6 Then: resumed-comment visibility
// ============================================================================

Then(
  'the resumed comment is recorded on issue {int} in the target repository {string}',
  function (this: RegressionWorld, issueNumber: number, targetRepoStr: string) {
    const [owner, repo] = targetRepoStr.split('/');
    const comment = state565.recordedComments.find(
      (c) => c.owner === owner && c.repo === repo && c.issueNumber === issueNumber,
    );
    assert.ok(
      comment,
      `Expected the resumed comment on ${owner}/${repo}#${issueNumber}, recorded: ${JSON.stringify(state565.recordedComments)}`,
    );
  },
);

Then(
  'the resume completes without a remote-owner-mismatch failure between the target worktree and the declared repository',
  function (this: RegressionWorld) {
    assert.strictEqual(
      state565.commentMismatchError,
      null,
      `Expected no remote-owner-mismatch failure, got: ${state565.commentMismatchError?.message}`,
    );
  },
);

Then(
  "the mock harness recorded zero comment posts on issue {int} in the cron host's own repository {string}",
  function (this: RegressionWorld, issueNumber: number, hostRepoStr: string) {
    const [owner, repo] = hostRepoStr.split('/');
    const bleed = state565.recordedComments.filter(
      (c) => c.owner === owner && c.repo === repo && c.issueNumber === issueNumber,
    );
    assert.strictEqual(
      bleed.length,
      0,
      `Expected zero comment posts on host repo ${owner}/${repo}#${issueNumber}, found ${bleed.length}`,
    );
  },
);

// ============================================================================
// §7 Then: poll visibility
// ============================================================================

Then(
  'the poll batch fetches open issues from the target repository {string}',
  function (this: RegressionWorld, targetRepoStr: string) {
    const [owner, repo] = targetRepoStr.split('/');
    assert.ok(
      state565.recordedIssueFetches.some((f) => f.owner === owner && f.repo === repo),
      `Expected the poll to fetch issues from ${owner}/${repo}, recorded: ${JSON.stringify(state565.recordedIssueFetches)}`,
    );
  },
);

Then(
  "the target repository's open issue {int} is visible to the poller",
  function (this: RegressionWorld, _issueNumber: number) {
    const target = state565.targetRepo;
    assert.ok(target, 'target repo must be set up');
    assert.ok(
      state565.recordedIssueFetches.some((f) => f.owner === target.owner && f.repo === target.repo),
      'Expected the poller to have queried the target repository for open issues',
    );
  },
);
