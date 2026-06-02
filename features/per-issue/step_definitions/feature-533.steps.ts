/**
 * BDD step definitions for feature-533.feature — entry file.
 * Shared state, Before/After hooks, exported helpers, and the pr_review When step.
 * Given/Then registrations live in sibling files auto-discovered by the cucumber glob:
 *  - feature-533-given.steps.ts  (Given steps, §§1–6)
 *  - feature-533-then.steps.ts   (Then steps, §§1–6)
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

import { Before, After, When } from '@cucumber/cucumber';
import { existsSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Per-scenario state
// ---------------------------------------------------------------------------

/** Invocation log file path, written by the claude-cli-stub. */
export const invocationLogs = new Map<string, string>();

/** Temp dirs created during the scenario (worktrees, log dirs). */
export const tempDirs: string[] = [];

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
// Helpers (exported for use by sibling step files)
// ---------------------------------------------------------------------------

/** Creates an invocation log path for an adwId and wires it into harnessEnv. */
export function ensureInvocationLog(world: RegressionWorld, adwId: string): string {
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
export function readInvocations(adwId: string): string[] {
  const logPath = invocationLogs.get(adwId);
  if (!logPath || !existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
}

/** Builds a review-agent JSON payload text with the given review issues. */
export function buildReviewPayload(
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
export function seedReviewPayload(world: RegressionWorld, adwId: string, payloadText: string): void {
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
