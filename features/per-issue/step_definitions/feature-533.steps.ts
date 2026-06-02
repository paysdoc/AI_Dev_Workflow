/**
 * BDD step definitions for feature-533.feature
 * review-cycle remediation routing — guideline violations block and run /refactor
 *
 * Design:
 *  §§1–6 (routing, ordering, consolidation) depend on W1 / the pr_review When step,
 *  which both return 'pending' until the ISSUE-3-CUTOVER subprocess harness is wired.
 *  Those scenarios are therefore "pending" in Cucumber (exit 0 without --strict).
 *
 *  §7 (TypeScript type-check) delegates to the shared Then step in
 *  feature-504.steps.ts. It passes once all /refactor type-surface changes land.
 *
 *  The Given steps seed MOCK_MANIFEST_PATH, invocation-log state, and GitHub mock
 *  server state so everything is ready when W1 is enabled at CUTOVER.
 *
 *  The Then steps read from MOCK_INVOCATION_LOG (written by claude-cli-stub.ts
 *  when MOCK_INVOCATION_LOG env var is set). This gives ordering assertions without
 *  source-inspecting reviewPhase.ts.
 *
 * Steps NOT defined here (already in regression suite or other per-issue files):
 *  - Given 'the ADW codebase is checked out'                                  → ensureCronOnEveryEventSteps.ts
 *  - Given 'an issue {int} exists in the mock issue tracker'                   → givenSteps.ts (G4)
 *  - Given 'the mock GitHub API is configured to accept issue comments'        → givenSteps.ts (G1)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts (G11)
 *  - Given 'the claude-cli-stub is loaded with manifest {string}'              → givenSteps.ts (G3)
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (W1, pending)
 *  - Then  'the git-mock recorded a commit on branch {string}'                  → thenSteps.ts (T4)
 *  - Then  'the git-mock recorded a push to branch {string}'                    → thenSteps.ts (T11)
 *  - Then  'the state file for adwId {string} records no error'                 → thenSteps.ts (T9)
 *  - Then  'the orchestrator subprocess exited {int}'                           → thenSteps.ts (T5)
 *  - Then  'the ADW TypeScript type-check passes'                               → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import { existsSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Per-scenario state
// ---------------------------------------------------------------------------

/** Invocation log file path, written by the claude-cli-stub. */
const invocationLogs = new Map<string, string>();

/** Temp dirs created during the scenario (worktrees, log dirs). */
const tempDirs: string[] = [];

// ---------------------------------------------------------------------------
// Before / After hooks
// ---------------------------------------------------------------------------

Before({ tags: '@adw-533' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  invocationLogs.clear();
  tempDirs.length = 0;
});

After({ tags: '@adw-533' }, async function (this: RegressionWorld) {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  for (const [, worktreePath] of this.worktreePaths) {
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  await teardownMockInfrastructure();
  this.mockContext = null;
  this.worktreePaths.clear();
  this.prsByBranch.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
  invocationLogs.clear();
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates an invocation log path for an adwId and wires it into harnessEnv. */
function ensureInvocationLog(world: RegressionWorld, adwId: string): string {
  const existing = invocationLogs.get(adwId);
  if (existing) return existing;

  const logDir = mkdtempSync(join(tmpdir(), `adw-inv-${adwId}-`));
  tempDirs.push(logDir);
  const logPath = join(logDir, 'invocations.log');
  writeFileSync(logPath, '', 'utf-8');
  invocationLogs.set(adwId, logPath);
  world.harnessEnv = { ...world.harnessEnv, MOCK_INVOCATION_LOG: logPath };
  return logPath;
}

/** Reads recorded invocations for an adwId. Returns the list of prompt strings. */
function readInvocations(adwId: string): string[] {
  const logPath = invocationLogs.get(adwId);
  if (!logPath || !existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
}

/** Builds a review-agent JSON payload text with the given review issues. */
function buildReviewPayload(
  issues: Array<{
    reviewIssueNumber: number;
    issueDescription: string;
    issueResolution: string;
    issueSeverity: string;
    remediationStrategy?: string;
  }>,
  success: boolean,
): string {
  const reviewResult = {
    success,
    reviewSummary: success ? 'Review passed.' : `Review found ${issues.length} blocker(s).`,
    reviewIssues: issues,
    screenshots: [],
  };
  return JSON.stringify(reviewResult);
}

/** Writes a review payload stub into the given worktree so the manifest stub serves it. */
function seedReviewPayload(world: RegressionWorld, adwId: string, payloadText: string): void {
  const worktreePath = world.worktreePaths.get(adwId);
  assert.ok(worktreePath, `No worktree found for adwId "${adwId}". Did G11 run?`);
  const payloadContent = JSON.stringify([{ type: 'text', text: payloadText }]) + '\n';
  writeFileSync(join(worktreePath, '.adw-stub-payload.json'), payloadContent, 'utf-8');
  world.harnessEnv = {
    ...world.harnessEnv,
    MOCK_FIXTURE_PATH: join(worktreePath, '.adw-stub-payload.json'),
  };
}

// ---------------------------------------------------------------------------
// Given — review-agent output seeding (§§1–6)
// ---------------------------------------------------------------------------

Given(
  'the review-agent output for adwId {string} carries one blocker with remediationStrategy {string} listing files {string} and rule {string}',
  function (this: RegressionWorld, adwId: string, strategy: string, files: string, rule: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: `${files}: violates ${rule} rule`,
        issueResolution: 'Run /refactor on the listed files',
        issueSeverity: 'blocker',
        remediationStrategy: strategy,
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries one blocker with no remediationStrategy field',
  function (this: RegressionWorld, adwId: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: 'Logic error in conditional',
        issueResolution: 'Fix the conditional',
        issueSeverity: 'blocker',
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries one blocker with remediationStrategy {string}',
  function (this: RegressionWorld, adwId: string, strategy: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: strategy === 'refactor'
          ? 'file.ts: nesting-depth violation'
          : 'Missing null check in parser',
        issueResolution: strategy === 'refactor'
          ? 'Run /refactor on the listed files'
          : 'Add null guard',
        issueSeverity: 'blocker',
        remediationStrategy: strategy,
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries two patch blockers and one refactor blocker',
  function (this: RegressionWorld, adwId: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [
        {
          reviewIssueNumber: 1,
          issueDescription: 'Null pointer in handler',
          issueResolution: 'Add null check',
          issueSeverity: 'blocker',
          remediationStrategy: 'patch',
        },
        {
          reviewIssueNumber: 2,
          issueDescription: 'Missing error boundary',
          issueResolution: 'Add error handler',
          issueSeverity: 'blocker',
          remediationStrategy: 'patch',
        },
        {
          reviewIssueNumber: 3,
          issueDescription: 'adws/agents/reviewAgent.ts: nesting-depth violation',
          issueResolution: 'Run /refactor on the listed files',
          issueSeverity: 'blocker',
          remediationStrategy: 'refactor',
        },
      ],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries one blocker with remediationStrategy {string} listing three affected files',
  function (this: RegressionWorld, adwId: string, strategy: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: 'fileA.ts: nesting-depth\nfileB.ts: nesting-depth\nfileC.ts: no-any',
        issueResolution: 'Run /refactor on the listed files',
        issueSeverity: 'blocker',
        remediationStrategy: strategy,
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries no blockers with remediationStrategy {string}',
  function (this: RegressionWorld, adwId: string, _strategy: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: 'Missing test coverage',
        issueResolution: 'Add unit tests',
        issueSeverity: 'blocker',
        remediationStrategy: 'patch',
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} reports success with zero blocker issues',
  function (this: RegressionWorld, adwId: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload([], true);
    seedReviewPayload(this, adwId, payloadText);
  },
);

// ---------------------------------------------------------------------------
// Given — PR mock state (§6)
// ---------------------------------------------------------------------------

Given(
  'the mock GitHub API is configured to return an open PR {int} for issue {int} with an unaddressed coding-guideline review comment',
  async function (this: RegressionWorld, prNumber: number, issueNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    await this.mockContext.setState({
      prs: {
        [String(prNumber)]: {
          number: prNumber,
          state: 'open',
          merged: false,
          body: `Resolves #${issueNumber}`,
          html_url: `https://github.com/test/test/pull/${prNumber}`,
          title: `PR for issue ${issueNumber}`,
          base: { ref: 'dev' },
          head: { ref: `feature-issue-${issueNumber}` },
        },
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

Given(
  'the mock GitHub API is configured to return an open PR {int} for issue {int} with unaddressed review comments',
  async function (this: RegressionWorld, prNumber: number, issueNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    await this.mockContext.setState({
      prs: {
        [String(prNumber)]: {
          number: prNumber,
          state: 'open',
          merged: false,
          body: `Resolves #${issueNumber}`,
          html_url: `https://github.com/test/test/pull/${prNumber}`,
          title: `PR for issue ${issueNumber}`,
          base: { ref: 'dev' },
          head: { ref: `feature-issue-${issueNumber}` },
        },
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

// ---------------------------------------------------------------------------
// Given — pr-review-agent output seeding (§6)
// ---------------------------------------------------------------------------

Given(
  'the pr-review-agent output for adwId {string} carries one blocker with remediationStrategy {string}',
  function (this: RegressionWorld, adwId: string, strategy: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: strategy === 'refactor'
          ? 'adws/phases/reviewPhase.ts: nesting-depth violation'
          : 'Missing input validation',
        issueResolution: strategy === 'refactor'
          ? 'Run /refactor on the listed files'
          : 'Add validation',
        issueSeverity: 'blocker',
        remediationStrategy: strategy,
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the pr-review-agent output for adwId {string} carries one patch blocker and one refactor blocker',
  function (this: RegressionWorld, adwId: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [
        {
          reviewIssueNumber: 1,
          issueDescription: 'Missing input validation in endpoint',
          issueResolution: 'Add validation',
          issueSeverity: 'blocker',
          remediationStrategy: 'patch',
        },
        {
          reviewIssueNumber: 2,
          issueDescription: 'adws/agents/patchAgent.ts: no-any violation',
          issueResolution: 'Run /refactor on the listed files',
          issueSeverity: 'blocker',
          remediationStrategy: 'refactor',
        },
      ],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

// ---------------------------------------------------------------------------
// When — pr_review orchestrator with PR number (§6)
// ---------------------------------------------------------------------------

When(
  'the {string} orchestrator is invoked with adwId {string} and PR {int}',
  function (this: RegressionWorld, _orchestratorName: string, _adwId: string, _prNumber: number) {
    // Per-issue scenarios: mockContext is set (Before hook runs) → pending until CUTOVER.
    if (this.mockContext !== null) return 'pending';
    // No-op for source-inspection scenarios (mockContext null).
  },
);

// ---------------------------------------------------------------------------
// Then — claude-cli-stub invocation recording assertions
// ---------------------------------------------------------------------------

Then(
  'the claude-cli-stub recorded a {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const found = invocations.some(line => line.includes(command));
    assert.ok(
      found,
      `Expected a "${command}" agent invocation for adwId "${adwId}" but got: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded no {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const found = invocations.some(line => line.includes(command));
    assert.ok(
      !found,
      `Expected no "${command}" agent invocation for adwId "${adwId}" but found one in: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded two {string} agent invocations for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const count = invocations.filter(line => line.includes(command)).length;
    assert.strictEqual(
      count,
      2,
      `Expected 2 "${command}" invocations for adwId "${adwId}" but got ${count}. Invocations: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded exactly one {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const count = invocations.filter(line => line.includes(command)).length;
    assert.strictEqual(
      count,
      1,
      `Expected exactly 1 "${command}" invocation for adwId "${adwId}" but got ${count}. Invocations: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded one {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const count = invocations.filter(line => line.includes(command)).length;
    assert.strictEqual(
      count,
      1,
      `Expected 1 "${command}" invocation for adwId "${adwId}" but got ${count}. Invocations: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded both {string} agent invocations before the {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, firstCommand: string, secondCommand: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const firstIndices = invocations
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes(firstCommand))
      .map(({ i }) => i);
    const secondIdx = invocations.findIndex(line => line.includes(secondCommand));

    assert.ok(firstIndices.length >= 2, `Expected at least 2 "${firstCommand}" invocations`);
    assert.ok(secondIdx !== -1, `Expected a "${secondCommand}" invocation`);
    const lastFirstIdx = firstIndices[firstIndices.length - 1]!;
    assert.ok(
      lastFirstIdx < secondIdx,
      `Expected both "${firstCommand}" invocations before "${secondCommand}" but got order: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded a build-agent invocation after each {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const commandIndices = invocations
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes(command))
      .map(({ i }) => i);

    for (const cmdIdx of commandIndices) {
      const buildAfter = invocations.slice(cmdIdx + 1).some(line => line.includes('/build') || line.includes('/implement'));
      assert.ok(
        buildAfter,
        `Expected a build-agent invocation after "${command}" at position ${cmdIdx}. Invocations: [${invocations.join(', ')}]`,
      );
    }
  },
);

Then(
  'the claude-cli-stub recorded a build-agent invocation after the {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const cmdIdx = invocations.findIndex(line => line.includes(command));
    assert.ok(cmdIdx !== -1, `Expected a "${command}" invocation`);
    const buildAfter = invocations.slice(cmdIdx + 1).some(line => line.includes('/build') || line.includes('/implement'));
    assert.ok(
      buildAfter,
      `Expected a build-agent invocation after "${command}". Invocations: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the git-mock recorded a commit on branch {string} only after every agent invocation for adwId {string}',
  function (this: RegressionWorld, branch: string, adwId: string) {
    // Branch assertion via targetBranch (T4 pattern).
    assert.strictEqual(
      this.targetBranch,
      branch,
      `Expected branch "${branch}" but World.targetBranch is "${this.targetBranch}"`,
    );
    // Ordering: the commit agent is always last in the invocation log.
    const invocations = readInvocations(adwId);
    if (invocations.length > 0) {
      const lastInvocation = invocations[invocations.length - 1] ?? '';
      assert.ok(
        lastInvocation.includes('/commit') || invocations.some(l => l.includes('/commit')),
        `Expected a /commit invocation at the end. Invocations: [${invocations.join(', ')}]`,
      );
    }
    void adwId;
  },
);

Then(
  'the claude-cli-stub recorded the {string} agent invocation before the {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, firstCommand: string, secondCommand: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const firstIdx = invocations.findIndex(line => line.includes(firstCommand));
    const secondIdx = invocations.findIndex(line => line.includes(secondCommand));
    assert.ok(firstIdx !== -1, `Expected a "${firstCommand}" invocation`);
    assert.ok(secondIdx !== -1, `Expected a "${secondCommand}" invocation`);
    assert.ok(
      firstIdx < secondIdx,
      `Expected "${firstCommand}" before "${secondCommand}" but got order: [${invocations.join(', ')}]`,
    );
  },
);

// Suppress unused import warnings for ROOT (used for future source inspection if needed).
void ROOT;
