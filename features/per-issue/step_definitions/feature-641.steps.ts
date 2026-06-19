/**
 * BDD step definitions for feature-641.feature
 * Deterministic branch-identity fallback when adwId recovery fails.
 *
 * §1–§2 call the two pure primitives in-process and assert their return values.
 * §3–§6 build a real temp git repo with a linked worktree, seed real
 * agents/<adwId>/state.json files, and drive branch-identity resolution
 * via the _resolveWorkflowBranchNameForTest seam + recoverAdwIdForBranch.
 *
 * Steps NOT defined here (already registered globally):
 *  - Given 'the ADW codebase is checked out'       → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 *
 * Cleanup: temp dirs and seeded agent state dirs are removed in the After hook.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { deterministicBranchName, branchMatchesIssue } from '../../../adws/vcs/branchIdentity.ts';
import {
  findExistingBranchForIssue,
  recoverAdwIdForBranch,
  type BranchIdentityFallbackDeps,
} from '../../../adws/phases/branchIdentityFallback.ts';
import { _resolveWorkflowBranchNameForTest } from '../../../adws/phases/branchNameResolution.ts';
import { AgentStateManager, AGENTS_STATE_DIR } from '../../../adws/core/index.ts';
import { generateBranchName } from '../../../adws/vcs/branchOperations.ts';
import type { IssueClassSlashCommand, GitHubIssue, RecoveryState } from '../../../adws/core/index.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const GIT = process.env['REAL_GIT_PATH'] ?? 'git';

// ---------------------------------------------------------------------------
// Module-level per-scenario state (reset in Before/After hooks)
// ---------------------------------------------------------------------------

const ctx: {
  // §1 pure-predicate state
  deterministicIdentityResult: string | null;

  // §2 pure-predicate state
  matchVerdict: boolean | null;

  // §3–§6 integration state
  tempRepoDir: string;
  /** Branch name → absolute worktree path */
  existingWorktreePaths: Map<string, string>;
  /** adwIds seeded into AGENTS_STATE_DIR (for cleanup) */
  seededAdwIds: string[];
  /** Fresh adwId used for resolution in the When step (for cleanup) */
  usedAdwId: string;
  recoveryState: RecoveryState;
  agentSlug: string | null;
  resolvedBranch: string | null;
  resolvedAdwId: string | null;
} = {
  deterministicIdentityResult: null,
  matchVerdict: null,
  tempRepoDir: '',
  existingWorktreePaths: new Map(),
  seededAdwIds: [],
  usedAdwId: '',
  recoveryState: emptyRecoveryState(),
  agentSlug: null,
  resolvedBranch: null,
  resolvedAdwId: null,
};

const tempDirs: string[] = [];

function emptyRecoveryState(): RecoveryState {
  return {
    lastCompletedStage: null,
    adwId: null,
    branchName: null,
    planPath: null,
    prUrl: null,
    canResume: false,
  };
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-641
// ---------------------------------------------------------------------------

Before({ tags: '@adw-641' }, function (this: RegressionWorld) {
  ctx.deterministicIdentityResult = null;
  ctx.matchVerdict = null;
  ctx.tempRepoDir = '';
  ctx.existingWorktreePaths = new Map();
  ctx.seededAdwIds = [];
  ctx.usedAdwId = '';
  ctx.recoveryState = emptyRecoveryState();
  ctx.agentSlug = null;
  ctx.resolvedBranch = null;
  ctx.resolvedAdwId = null;
  tempDirs.length = 0;
});

After({ tags: '@adw-641' }, function (this: RegressionWorld) {
  // Remove temp git repos.
  for (const dir of tempDirs) {
    if (dir && fs.existsSync(dir)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  tempDirs.length = 0;

  // Remove seeded agent state dirs.
  for (const adwId of [...ctx.seededAdwIds, ctx.usedAdwId].filter(Boolean)) {
    const dir = path.join(AGENTS_STATE_DIR, adwId);
    if (dir && fs.existsSync(dir)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  ctx.seededAdwIds = [];
  ctx.usedAdwId = '';
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp(prefix: string): string {
  const p = fs.mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(p);
  return p;
}

function git(args: string, cwd: string): string {
  return execSync(`"${GIT}" ${args}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/** Create a minimal non-bare git repo with a single commit on main. */
function initLocalRepo(): string {
  const dir = mktemp('adw-641-repo-');
  git('init', dir);
  git('config user.email "test@adw.local"', dir);
  git('config user.name "ADW Test"', dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'test repo');
  git('add README.md', dir);
  git('commit -m "initial commit"', dir);
  git('branch -M main', dir);
  return dir;
}

/** Create a branch in the repo and add it as a linked worktree under .worktrees/. */
function createLinkedWorktree(repoDir: string, branchName: string): string {
  // Create the branch from HEAD
  git(`checkout -b "${branchName}"`, repoDir);
  git('checkout main', repoDir);

  const worktreesDir = path.join(repoDir, '.worktrees');
  fs.mkdirSync(worktreesDir, { recursive: true });
  const worktreePath = path.join(worktreesDir, branchName);
  git(`worktree add "${worktreePath}" "${branchName}"`, repoDir);
  return worktreePath;
}

/** Write a top-level state file to AGENTS_STATE_DIR for the given adwId. */
function seedAgentState(adwId: string, branchName: string): void {
  AgentStateManager.writeTopLevelState(adwId, { adwId, branchName });
  ctx.seededAdwIds.push(adwId);
}

/** Build finder deps that scan the temp repo's worktrees. */
function makeTempRepoFinderDeps(): BranchIdentityFallbackDeps {
  return {
    listCandidateBranches: () => {
      if (!ctx.tempRepoDir) return [];
      try {
        const output = execSync(`"${GIT}" worktree list --porcelain`, {
          encoding: 'utf-8',
          cwd: ctx.tempRepoDir,
        });
        const branches: string[] = [];
        for (const line of output.split('\n')) {
          if (line.startsWith('branch ')) {
            const branch = line.substring('branch '.length).replace('refs/heads/', '').trim();
            if (branch) branches.push(branch);
          }
        }
        return branches;
      } catch {
        return [];
      }
    },
    listAdwIds: () => ctx.seededAdwIds,
    readTopLevelState: (adwId) => AgentStateManager.readTopLevelState(adwId),
  };
}

const dummyIssue: GitHubIssue = {
  number: 641,
  title: 'feat: deterministic branch-identity fallback when adwId recovery fails',
  body: '',
  state: 'OPEN',
  author: { login: 'test', isBot: false },
  assignees: [],
  labels: [],
  comments: [],
  createdAt: '',
  updatedAt: '',
  closedAt: null,
  url: '',
};

// ---------------------------------------------------------------------------
// §1 — deterministicBranchName
// ---------------------------------------------------------------------------

When(
  'the deterministic branch identity for issue {int} classified {string} is computed',
  function (this: RegressionWorld, issueNumber: number, classification: string) {
    const classifier = classification as IssueClassSlashCommand;
    ctx.deterministicIdentityResult = deterministicBranchName(classifier, issueNumber);
  },
);

Then(
  'the deterministic branch identity is {string}',
  function (this: RegressionWorld, expectedIdentity: string) {
    assert.strictEqual(
      ctx.deterministicIdentityResult,
      expectedIdentity,
      `Expected deterministicBranchName to return "${expectedIdentity}" but got "${ctx.deterministicIdentityResult}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// §2 — branchMatchesIssue
// ---------------------------------------------------------------------------

When(
  'the branch {string} is tested for an identity match against issue {int} classified {string}',
  function (this: RegressionWorld, branchName: string, issueNumber: number, classification: string) {
    const classifier = classification as IssueClassSlashCommand;
    ctx.matchVerdict = branchMatchesIssue(branchName, classifier, issueNumber);
  },
);

Then(
  'the branch identity match verdict is {string}',
  function (this: RegressionWorld, expectedVerdict: string) {
    const expected = expectedVerdict === 'true';
    assert.strictEqual(
      ctx.matchVerdict,
      expected,
      `Expected branchMatchesIssue verdict to be ${expected} but got ${ctx.matchVerdict}`,
    );
  },
);

// ---------------------------------------------------------------------------
// §3–§6 Given — target repository setup
// ---------------------------------------------------------------------------

Given(
  'a target repository with an existing worktree on branch {string} for issue {int}',
  function (this: RegressionWorld, branchName: string, _issueNumber: number) {
    if (!ctx.tempRepoDir) {
      ctx.tempRepoDir = initLocalRepo();
    }
    const worktreePath = createLinkedWorktree(ctx.tempRepoDir, branchName);
    ctx.existingWorktreePaths.set(branchName, worktreePath);
  },
);

Given(
  'the existing worktree on branch {string} records adwId {string}',
  function (this: RegressionWorld, _branchName: string, adwId: string) {
    const branchName = _branchName;
    seedAgentState(adwId, branchName);
  },
);

Given(
  'the canonical adwId cannot be recovered from the issue comments',
  function (this: RegressionWorld) {
    ctx.recoveryState = emptyRecoveryState();
  },
);

Given(
  'the canonical adwId is recovered from the issue comments as adwId {string} on branch {string}',
  function (this: RegressionWorld, adwId: string, branchName: string) {
    ctx.recoveryState = {
      lastCompletedStage: null,
      adwId,
      branchName,
      planPath: null,
      prUrl: null,
      canResume: false,
    };
  },
);

Given(
  'the branch-name agent is stubbed to return the slug {string}',
  function (this: RegressionWorld, slug: string) {
    ctx.agentSlug = slug;
  },
);

// ---------------------------------------------------------------------------
// §3–§6 When — resolve workflow branch identity
// ---------------------------------------------------------------------------

When(
  'the workflow branch identity is resolved for issue {int} classified {string}',
  async function (this: RegressionWorld, issueNumber: number, classification: string) {
    const issueType = classification as IssueClassSlashCommand;
    const issue: GitHubIssue = { ...dummyIssue, number: issueNumber };

    // Simulate: adwId ?? recoveryState.adwId ?? generate fresh
    const adwId = ctx.recoveryState.adwId ?? `test-fresh-641-${issueType.replace('/', '')}-${issueNumber}`;
    ctx.usedAdwId = adwId;

    const deps = makeTempRepoFinderDeps();

    // Build a mock agentFn that returns a branch name using the stubbed slug
    const agentFn = async (
      type: IssueClassSlashCommand,
      iss: GitHubIssue,
      _logsDir: string,
    ) => {
      const slug = ctx.agentSlug ?? 'generated-slug';
      const branchName = generateBranchName(iss.number, slug, type);
      return {
        success: true,
        output: '',
        sessionId: 'mock-session',
        totalCostUsd: 0,
        modelUsage: {},
        branchName,
      };
    };

    // Finder injects the temp repo deps
    const finderFn = (t: IssueClassSlashCommand, n: number) =>
      findExistingBranchForIssue(t, n, deps);

    ctx.resolvedBranch = await _resolveWorkflowBranchNameForTest(
      {
        adwId,
        issueType,
        issue,
        logsDir: tmpdir(),
        recoveryState: ctx.recoveryState,
      },
      agentFn,
      finderFn,
    );

    // Recover adwId from the resolved branch (simulating workflowInit fallback).
    // When adwId was already recovered from comments, use that directly.
    if (ctx.recoveryState.adwId) {
      ctx.resolvedAdwId = ctx.recoveryState.adwId;
    } else {
      ctx.resolvedAdwId = recoverAdwIdForBranch(ctx.resolvedBranch, deps);
    }
  },
);

// ---------------------------------------------------------------------------
// §3–§6 Then — assertions
// ---------------------------------------------------------------------------

Then(
  'the resolved branch is {string}',
  function (this: RegressionWorld, expectedBranch: string) {
    assert.strictEqual(
      ctx.resolvedBranch,
      expectedBranch,
      `Expected resolved branch to be "${expectedBranch}" but got "${ctx.resolvedBranch}"`,
    );
  },
);

Then(
  'the resolved branch is not {string}',
  function (this: RegressionWorld, unexpectedBranch: string) {
    assert.notStrictEqual(
      ctx.resolvedBranch,
      unexpectedBranch,
      `Expected resolved branch to NOT be "${unexpectedBranch}" but it was`,
    );
  },
);

Then(
  'the resolved branch carries the {string} prefix',
  function (this: RegressionWorld, prefix: string) {
    assert.ok(
      ctx.resolvedBranch?.startsWith(`${prefix}-`),
      `Expected resolved branch "${ctx.resolvedBranch}" to start with "${prefix}-"`,
    );
  },
);

Then(
  'the resolved adwId is {string}',
  function (this: RegressionWorld, expectedAdwId: string) {
    assert.strictEqual(
      ctx.resolvedAdwId,
      expectedAdwId,
      `Expected resolved adwId to be "${expectedAdwId}" but got "${ctx.resolvedAdwId}"`,
    );
  },
);

Then(
  'the existing worktree on branch {string} is left intact',
  function (this: RegressionWorld, branchName: string) {
    const worktreePath = ctx.existingWorktreePaths.get(branchName);
    assert.ok(
      worktreePath,
      `No worktree path recorded for branch "${branchName}" — check the Given steps`,
    );
    assert.ok(
      fs.existsSync(worktreePath),
      `Expected worktree at "${worktreePath}" (branch "${branchName}") to still exist but it was removed`,
    );
  },
);
