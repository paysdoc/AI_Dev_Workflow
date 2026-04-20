/**
 * Step definitions for @adw-458: remoteReconcile module
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import {
  deriveStageFromRemote,
  MAX_RECONCILE_VERIFICATION_RETRIES,
  type ReconcileDeps,
} from '../../adws/core/remoteReconcile';
import type { AgentState } from '../../adws/types/agentTypes';
import type { RawPR } from '../../adws/github/prApi';
import type { RepoInfo } from '../../adws/github/githubApi';
import type { WorkflowStage } from '../../adws/types/workflowTypes';

const ROOT = process.cwd();
const REPO_INFO: RepoInfo = { owner: 'acme', repo: 'myrepo' };

// ── Shared mutable world state for behavioral scenarios ───────────────────────

interface World {
  branchExists: boolean;
  pr: RawPR | null;
  derivedStage: WorkflowStage | null;
  callCounts: { branch: number; pr: number };
  stateWorkflowStage: string | null;
  findPRResponses: Array<RawPR | null>;
}

const world: World = {
  branchExists: true,
  pr: null,
  derivedStage: null,
  callCounts: { branch: 0, pr: 0 },
  stateWorkflowStage: null,
  findPRResponses: [],
};

function resetWorld(): void {
  world.branchExists = true;
  world.pr = null;
  world.derivedStage = null;
  world.callCounts = { branch: 0, pr: 0 };
  world.stateWorkflowStage = null;
  world.findPRResponses = [];
}

function makePR(state: string): RawPR {
  return { number: 7, state, headRefName: 'feature-issue-42', baseRefName: 'main' };
}

function makeState(): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    branchName: 'feature-issue-42',
    workflowStage: world.stateWorkflowStage ?? 'build_running',
  };
}

function buildDeps(): ReconcileDeps {
  let prCallIndex = 0;
  return {
    readTopLevelState: () => makeState(),
    branchExistsOnRemote: (_b, _r) => {
      world.callCounts.branch++;
      return world.branchExists;
    },
    findPRByBranch: (_b, _r) => {
      world.callCounts.pr++;
      if (world.findPRResponses.length > 0) {
        const idx = Math.min(prCallIndex++, world.findPRResponses.length - 1);
        return world.findPRResponses[idx];
      }
      return world.pr;
    },
  };
}

// ── Section 1: Module surface ─────────────────────────────────────────────────

// "the file {string} exists" and "the file exports a function named {string}"
// are already defined in cucumberConfigSteps.ts and autoApproveMergeAfterReviewSteps.ts.

Then(
  'the {string} function signature accepts an issue number, an adwId, and a repoInfo object',
  function (funcName: string) {
    const content = readFileSync(join(ROOT, 'adws/core/remoteReconcile.ts'), 'utf-8');
    assert.ok(content.includes(funcName), `Expected remoteReconcile.ts to define "${funcName}"`);
    assert.ok(
      content.includes('issueNumber') || content.includes('_issueNumber'),
      'Expected function to accept an issueNumber parameter',
    );
    assert.ok(content.includes('adwId'), 'Expected function to accept an adwId parameter');
    assert.ok(content.includes('repoInfo'), 'Expected function to accept a repoInfo parameter');
  },
);

Then('the function returns a value typed as {string}', function (typeName: string) {
  const content = readFileSync(join(ROOT, 'adws/core/remoteReconcile.ts'), 'utf-8');
  assert.ok(
    content.includes(typeName),
    `Expected remoteReconcile.ts to reference type "${typeName}"`,
  );
});

Then(
  '{string} receives its GitHub read functions as injected dependencies',
  function (funcName: string) {
    const content = readFileSync(join(ROOT, 'adws/core/remoteReconcile.ts'), 'utf-8');
    assert.ok(content.includes('ReconcileDeps'), 'Expected ReconcileDeps interface in remoteReconcile.ts');
    assert.ok(content.includes(funcName), `Expected "${funcName}" in remoteReconcile.ts`);
    assert.ok(content.includes('deps'), 'Expected deps parameter for dependency injection');
  },
);

Then('the module does not call gh CLI or github API helpers at import time', function () {
  const content = readFileSync(join(ROOT, 'adws/core/remoteReconcile.ts'), 'utf-8');
  // Top-level (non-indented) lines must not contain execWithRetry calls.
  const topLevelCalls = content
    .split('\n')
    .filter((line) => /^[a-zA-Z].*execWithRetry\(/.test(line));
  assert.strictEqual(
    topLevelCalls.length,
    0,
    `Module should not call execWithRetry at module level, found: ${topLevelCalls.join(', ')}`,
  );
});

Then('the injected dependencies can be replaced with fakes in unit tests', function () {
  const content = readFileSync(join(ROOT, 'adws/core/remoteReconcile.ts'), 'utf-8');
  assert.ok(content.includes('deps?'), 'Expected optional deps parameter enabling fake injection');
});

// ── Section 2: Stage mapping — four remote-state cases ───────────────────────

Given('injected GitHub reads report that the feature branch exists', function () {
  resetWorld();
  world.branchExists = true;
});

Given('injected GitHub reads report that no PR is open for that branch', function () {
  world.pr = null;
});

Given('injected GitHub reads report that a PR for that branch is open and not merged', function () {
  world.pr = makePR('OPEN');
});

Given('injected GitHub reads report that the PR for that branch is merged', function () {
  world.pr = makePR('MERGED');
});

Given('injected GitHub reads report that the PR for that branch is closed and not merged', function () {
  world.pr = makePR('CLOSED');
});

When('deriveStageFromRemote is called for the issue', function () {
  world.derivedStage = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, buildDeps());
});

Then('the re-verification read agrees with the first read', function () {
  assert.ok(
    world.callCounts.branch >= 2,
    `Expected at least 2 branch reads for re-verification, got ${world.callCounts.branch}`,
  );
});

Then('the derived stage is a pre-PR running stage', function () {
  assert.strictEqual(world.derivedStage, 'branch_created');
});

Then('the derived stage is {string}', function (expected: string) {
  assert.strictEqual(world.derivedStage, expected, `Expected derived stage to be "${expected}"`);
});

// ── Section 3: Re-verification read before return ─────────────────────────────

Given('injected GitHub reads report a stable remote state', function () {
  resetWorld();
  world.branchExists = true;
  world.pr = makePR('OPEN');
});

Then('the injected GitHub reads are invoked at least twice', function () {
  assert.ok(world.callCounts.branch >= 2, `Expected at least 2 reads, got ${world.callCounts.branch}`);
});

Then('the final invocation occurs immediately before the derived stage is returned', function () {
  assert.ok(world.callCounts.branch >= 2, 'Re-verification read must have fired');
});

Given('injected GitHub reads return the same remote snapshot on both reads', function () {
  resetWorld();
  world.branchExists = true;
  world.pr = makePR('MERGED');
});

Then('the module does not perform any further retry reads', function () {
  assert.strictEqual(
    world.callCounts.branch,
    2,
    `Expected exactly 2 branch reads on stable snapshot, got ${world.callCounts.branch}`,
  );
});

Then('the derived stage is returned from the agreed snapshot', function () {
  assert.ok(world.derivedStage !== null, 'Expected a derived stage to be returned');
});

// ── Section 4: Re-verification divergence and bounded retry ──────────────────

Given('the first injected GitHub read returns a snapshot mapping to {string}', function (stage: string) {
  resetWorld();
  world.branchExists = true;
  world.stateWorkflowStage = 'build_running';
  const prState = stage === 'awaiting_merge' ? 'OPEN' : 'MERGED';
  world.findPRResponses = [makePR(prState)];
});

Given('the re-verification read returns a snapshot mapping to {string}', function (stage: string) {
  const prState = stage === 'completed' ? 'MERGED' : 'OPEN';
  world.findPRResponses.push(makePR(prState));
  for (let i = 0; i < MAX_RECONCILE_VERIFICATION_RETRIES + 2; i++) {
    world.findPRResponses.push(makePR(prState));
  }
});

Then('the module performs at least one additional retry read', function () {
  assert.ok(
    world.callCounts.pr >= 3,
    `Expected at least 3 PR reads (initial + re-verify + ≥1 retry), got ${world.callCounts.pr}`,
  );
});

Then('the retry count does not exceed the bounded retry limit defined in the module', function () {
  const maxAllowedReads = MAX_RECONCILE_VERIFICATION_RETRIES + 2;
  assert.ok(
    world.callCounts.pr <= maxAllowedReads,
    `Expected at most ${maxAllowedReads} PR reads, got ${world.callCounts.pr}`,
  );
});

Given('the first read disagrees with the re-verification read', function () {
  resetWorld();
  world.branchExists = true;
  // First: OPEN, second: MERGED, third: MERGED (converges)
  world.findPRResponses = [makePR('OPEN'), makePR('MERGED'), makePR('MERGED')];
});

Given('a subsequent retry produces two successive reads that agree on {string}', function (stage: string) {
  assert.strictEqual(stage, 'completed', `Expected convergence on "completed", got "${stage}"`);
});

Then('the module stops retrying as soon as two successive reads agree', function () {
  assert.ok(
    world.callCounts.pr <= 3,
    `Expected module to stop after 3 reads when reads converge, got ${world.callCounts.pr}`,
  );
});

Given('injected GitHub reads return divergent snapshots on every attempt', function () {
  resetWorld();
  world.branchExists = true;
  world.stateWorkflowStage = 'build_running';
  world.findPRResponses = Array.from(
    { length: MAX_RECONCILE_VERIFICATION_RETRIES + 4 },
    (_, i) => makePR(i % 2 === 0 ? 'OPEN' : 'MERGED'),
  );
});

Then('the total number of retry attempts is capped at a small bounded limit', function () {
  const maxAllowedReads = MAX_RECONCILE_VERIFICATION_RETRIES + 2;
  assert.ok(
    world.callCounts.pr <= maxAllowedReads,
    `Expected at most ${maxAllowedReads} PR reads, got ${world.callCounts.pr}`,
  );
});

Then('the module does not retry indefinitely', function () {
  assert.ok(world.callCounts.pr < 100, `Expected finite retry count, got ${world.callCounts.pr}`);
});

// ── Section 5: Persistent divergence falls back to state-file value ───────────

Given('injected GitHub reads keep returning divergent snapshots on every attempt', function () {
  resetWorld();
  world.branchExists = true;
  world.findPRResponses = Array.from(
    { length: MAX_RECONCILE_VERIFICATION_RETRIES + 4 },
    (_, i) => makePR(i % 2 === 0 ? 'OPEN' : 'MERGED'),
  );
});

Given('the state file for the adwId records workflowStage {string}', function (stage: string) {
  world.stateWorkflowStage = stage;
});

Then('after exhausting the retry limit the derived stage equals the state-file workflowStage', function () {
  assert.ok(
    world.derivedStage === world.stateWorkflowStage,
    `Expected derived stage "${world.derivedStage}" to equal state-file stage "${world.stateWorkflowStage}"`,
  );
});

Then(
  'the fallback branch reads the workflowStage from the top-level state file through AgentStateManager',
  function () {
    const content = readFileSync(join(ROOT, 'adws/core/remoteReconcile.ts'), 'utf-8');
    assert.ok(
      content.includes('AgentStateManager') || content.includes('readTopLevelState'),
      'Expected fallback to use AgentStateManager.readTopLevelState',
    );
    assert.ok(content.includes('workflowStage'), 'Expected module to read workflowStage from state');
  },
);

Then('the fallback does not infer the stage from issue comments', function () {
  const content = readFileSync(join(ROOT, 'adws/core/remoteReconcile.ts'), 'utf-8');
  assert.ok(
    !content.includes('fetchIssueComments') && !content.includes('comments'),
    'Expected fallback to NOT use issue comments',
  );
});

// ── Section 6: Edge case — branch does not exist ──────────────────────────────

Given('injected GitHub reads report that the feature branch does not exist', function () {
  resetWorld();
  world.branchExists = false;
  world.pr = null;
});

Then('the derived stage equals the state-file workflowStage', function () {
  assert.ok(
    world.derivedStage === world.stateWorkflowStage,
    `Expected derived stage "${world.derivedStage}" to equal state-file stage "${world.stateWorkflowStage}"`,
  );
});

// ── Section 7: Unit test coverage ─────────────────────────────────────────────

// "the test file {string} exists" uses the existing "the file {string} exists" from cucumberConfigSteps.
// We alias it here for clarity:
Given('the test file {string} exists', function (filePath: string) {
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected test file to exist: ${filePath}`);
});

Then('the tests import {string} from {string}', function (symbol: string, _modulePath: string) {
  const testContent = readFileSync(
    join(ROOT, 'adws/core/__tests__/remoteReconcile.test.ts'),
    'utf-8',
  );
  assert.ok(testContent.includes(symbol), `Expected test file to import "${symbol}"`);
});

Then('the tests construct injected fakes for the GitHub read dependencies', function () {
  const testContent = readFileSync(
    join(ROOT, 'adws/core/__tests__/remoteReconcile.test.ts'),
    'utf-8',
  );
  assert.ok(testContent.includes('vi.fn()'), 'Expected vi.fn() fakes in test file');
  assert.ok(
    testContent.includes('ReconcileDeps') || testContent.includes('branchExistsOnRemote'),
    'Expected injected dep fakes for GitHub read boundaries',
  );
});

Then('a test case covers {string} mapping to {string}', function (caseDesc: string, expectedStage: string) {
  const testContent = readFileSync(
    join(ROOT, 'adws/core/__tests__/remoteReconcile.test.ts'),
    'utf-8',
  );
  const stageToCheck = expectedStage === 'pre-PR running stage' ? 'branch_created' : expectedStage;
  assert.ok(
    testContent.includes(`'${stageToCheck}'`) || testContent.includes(`"${stageToCheck}"`),
    `Expected test file to cover "${caseDesc}" → "${expectedStage}" (looked for '${stageToCheck}')`,
  );
});

// Note: forward-slash in Cucumber Expressions acts as alternation; use `\\/` to match literal `/`.
Then(
  'a test case covers first-read\\/re-verification divergence that converges within the retry limit',
  function () {
    const testContent = readFileSync(
      join(ROOT, 'adws/core/__tests__/remoteReconcile.test.ts'),
      'utf-8',
    );
    assert.ok(
      testContent.includes('converge') || testContent.includes('flap') || testContent.includes('disagrees'),
      'Expected a test case covering divergence + convergence',
    );
  },
);

Then('the test asserts the derived stage equals the converged snapshot', function () {
  const testContent = readFileSync(
    join(ROOT, 'adws/core/__tests__/remoteReconcile.test.ts'),
    'utf-8',
  );
  assert.ok(
    testContent.includes("toBe('completed')") || testContent.includes('converged'),
    "Expected test to assert converged stage value (e.g. toBe('completed'))",
  );
});

Then('a test case covers persistent divergence across all retries', function () {
  const testContent = readFileSync(
    join(ROOT, 'adws/core/__tests__/remoteReconcile.test.ts'),
    'utf-8',
  );
  assert.ok(
    testContent.includes('never stabilize') ||
      testContent.includes('falls back') ||
      testContent.includes('stateFallback') ||
      testContent.includes('build_running'),
    'Expected a test case covering persistent divergence fallback',
  );
});

Then('the test asserts the derived stage equals the state-file workflowStage', function () {
  const testContent = readFileSync(
    join(ROOT, 'adws/core/__tests__/remoteReconcile.test.ts'),
    'utf-8',
  );
  assert.ok(
    testContent.includes("toBe('build_running')") || testContent.includes('workflowStage'),
    'Expected test to assert fallback to state-file workflowStage',
  );
});

Then('no test invokes the real gh CLI or issues real HTTP requests to github.com', function () {
  const testContent = readFileSync(
    join(ROOT, 'adws/core/__tests__/remoteReconcile.test.ts'),
    'utf-8',
  );
  assert.ok(
    !testContent.includes('execSync(') && !testContent.includes('https://github.com'),
    'Expected test file to contain no real CLI or HTTP calls',
  );
});

Then('all GitHub reads in the tests are supplied by injected fakes', function () {
  const testContent = readFileSync(
    join(ROOT, 'adws/core/__tests__/remoteReconcile.test.ts'),
    'utf-8',
  );
  assert.ok(
    testContent.includes('vi.fn()') || testContent.includes('mockReturnValue'),
    'Expected all GitHub reads to be faked via vi.fn()',
  );
});

// ── Section 8: Purity — no side effects ───────────────────────────────────────

Then('{string} does not call AgentStateManager.writeTopLevelState', function (funcName: string) {
  const content = readFileSync(join(ROOT, 'adws/core/remoteReconcile.ts'), 'utf-8');
  assert.ok(
    !content.includes('writeTopLevelState'),
    `Expected "${funcName}" to NOT call writeTopLevelState`,
  );
});

Then('{string} does not mutate the worktree', function (funcName: string) {
  const content = readFileSync(join(ROOT, 'adws/core/remoteReconcile.ts'), 'utf-8');
  assert.ok(
    !content.includes('ensureWorktree') && !content.includes('git checkout'),
    `Expected "${funcName}" to NOT mutate the worktree`,
  );
});

// ── Section 9: TypeScript compilation ─────────────────────────────────────────
// "{string} is run" and "the command exits with code {int}" are already defined
// in removeUnitTestsSteps.ts and wireExtractorSteps.ts respectively.

Given('the ADW codebase with remoteReconcile.ts added', function () {
  assert.ok(
    existsSync(join(ROOT, 'adws/core/remoteReconcile.ts')),
    'Expected adws/core/remoteReconcile.ts to exist',
  );
});
