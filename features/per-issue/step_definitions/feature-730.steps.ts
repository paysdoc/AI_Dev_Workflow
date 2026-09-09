/**
 * BDD step definitions for feature-730.feature
 *
 * Part 1 (§1-§3): executeUpgrade step-6 commit/push failures return a handled
 *                 { outcome: 'failed', reason } instead of throwing, and post a
 *                 counted failure comment (except the silent claim_lost park).
 * Part 2 (§4-§6): the pure redrive-eligibility predicate and the cron redrive
 *                 sweep that re-spawns a stranded #UPG.
 * §T reuses the registered T22 type-check step (feature-504.steps.ts).
 *
 * Self-contained module state — does NOT reach into feature-685's module-private
 * cap ctx (per the feature file's maintainer note).
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'         → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes'    → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  executeUpgrade,
  type UpgradeDeps,
  type UpgradeRunResult,
} from '../../../adws/adwUpgrade.tsx';
import { countUpgradeFailureComments, UPGRADE_FAILURE_SIGNATURE } from '../../../adws/core/upgradeFailureCap.ts';
import {
  decideUpgradeRedrive,
  runUpgradeRedriveScan,
  buildDefaultUpgradeRedriveDeps,
  type UpgradeRedriveSignals,
  type UpgradeRedriveDeps,
  type UpgradeRedriveIssue,
} from '../../../adws/triggers/upgradeRedrive.ts';
import { getSpawnLockFilePath } from '../../../adws/triggers/spawnGate.ts';
import { ADW_UPGRADE_LABEL, ADW_BLOCKED_LABEL } from '../../../adws/core/adwLabels.ts';
import { Platform } from '../../../adws/providers/types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_INFO = { owner: 'acme', repo: 'target', platform: Platform.GitHub };
const FRAMEWORK_ROOT = '/framework';
const BASE_REPO = '/base/repo';
const MOCK_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const BOT_AUTHOR = 'adw-bot[bot]';

const REDRIVE_REPO_INFO = { owner: 'adw-730-fixture', repo: 'upgrade-redrive', platform: Platform.GitHub };
const LIVE_PID = 424242;
const DEAD_PID = 99999;

// ---------------------------------------------------------------------------
// Part 1 module-level scenario state
// ---------------------------------------------------------------------------

let capturedComments: Array<{ issueNumber: number; body: string }> = [];
let executionResult: UpgradeRunResult | undefined;
let executionThrew: boolean;

function makeUpgradeDeps730(overrides: Partial<UpgradeDeps> = {}): UpgradeDeps {
  return {
    computeFrameworkHash: () => MOCK_HASH,
    ensureWorktree: () => '/worktrees/adw-upgrade-a1b2c3d4',
    reconcileWorktreeToRemote: () => undefined,
    getDefaultBranch: () => 'main',
    findPRByBranch: () => null,
    runInitCommand: async () => ({ success: true }),
    copyInitCommandToWorktree: () => undefined,
    verifyAdwRegen: () => ({ ok: true, missing: [] }),
    copyStarterSettings: () => ({ action: 'skipped', destPath: '/worktrees/adw-upgrade-a1b2c3d4/.claude/settings.json' }),
    writeAdwVersion: () => undefined,
    commitChanges: () => true,
    pushBranch: () => undefined,
    isPushRejection: () => false,
    createPullRequest: () => ({ url: 'https://github.com/acme/target/pull/99', number: 99 }),
    commentOnIssue: (issueNumber: number, body: string) => {
      capturedComments.push({ issueNumber, body });
    },
    ensureLogsDirectory: () => '/logs/adwupgrade',
    log: () => undefined,
    readAdwYmlConfig: () => ({ hitl: false, unitTests: true, guardrails: false }),
    mergePR: () => ({ success: true }),
    fetchIssueLabels: () => [],
    fetchIssueComments: () => [],
    ensureLabel: () => undefined,
    applyLabel: () => undefined,
    moveToStatus: async () => true,
    postSlack: async () => undefined,
    maxFailures: 3,
    ...overrides,
  };
}

let upgradeDeps: UpgradeDeps = makeUpgradeDeps730();

// ---------------------------------------------------------------------------
// Part 2 module-level scenario state
// ---------------------------------------------------------------------------

let redriveSignals: UpgradeRedriveSignals | undefined;
let redriveDecision: { redrive: boolean; reason: string } | undefined;
let redriveIssueFixtures: UpgradeRedriveIssue[] = [];
let redriveSpawnCalls: Array<{ upgNumber: number; targetRepoArgs: readonly string[] }> = [];
let redriveDeps: UpgradeRedriveDeps = buildRedriveDeps730();
const writtenLockPaths = new Set<string>();

function buildRedriveDeps730(): UpgradeRedriveDeps {
  return {
    ...buildDefaultUpgradeRedriveDeps(REDRIVE_REPO_INFO, { findPullRequestByBranch: () => null }),
    // No §5/§6 scenario constructs a claim-PR-present composing case (that signal
    // is pinned directly on the pure predicate in §4) — always "no PR" here.
    findClaimPr: () => null,
    isProcessLive: (pid: number) => pid === LIVE_PID,
    spawn: (upgNumber: number, targetRepoArgs: readonly string[]) => {
      redriveSpawnCalls.push({ upgNumber, targetRepoArgs });
    },
    log: () => undefined,
  };
}

function fixtureIssueBody(issueNumber: number): string {
  return [
    'Auto-generated upgrade tracking issue.',
    `Claim branch: \`adw-upgrade-fixture-${issueNumber}\``,
    `Framework hash: \`fixturehash${issueNumber}\``,
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-730
// ---------------------------------------------------------------------------

Before({ tags: '@adw-730' }, function () {
  capturedComments = [];
  executionResult = undefined;
  executionThrew = false;
  upgradeDeps = makeUpgradeDeps730();

  redriveSignals = undefined;
  redriveDecision = undefined;
  redriveIssueFixtures = [];
  redriveSpawnCalls = [];
  redriveDeps = buildRedriveDeps730();
});

After({ tags: '@adw-730' }, function () {
  for (const lockPath of writtenLockPaths) {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // best-effort cleanup
    }
  }
  writtenLockPaths.clear();
});

// ---------------------------------------------------------------------------
// Part 1: Given — step-6 failure modes
// ---------------------------------------------------------------------------

Given('an upgrade whose step-6 regen commit fails with a non-rejection error', function () {
  upgradeDeps = makeUpgradeDeps730({
    commitChanges: () => {
      throw new Error('commit boom: disk full');
    },
  });
});

Given('an upgrade whose step-6 branch push fails with a non-rejection error', function () {
  upgradeDeps = makeUpgradeDeps730({
    pushBranch: () => {
      throw new Error('push boom: fatal: unable to access remote');
    },
    isPushRejection: () => false,
  });
});

Given('an upgrade whose step-6 branch push is rejected as non-fast-forward', function () {
  const rejection = Object.assign(new Error('failed to push some refs'), {
    stderr: Buffer.from(' ! [rejected] adw-upgrade-x -> adw-upgrade-x (non-fast-forward)'),
  });
  upgradeDeps = makeUpgradeDeps730({
    pushBranch: () => {
      throw rejection;
    },
    isPushRejection: () => true,
  });
});

// ---------------------------------------------------------------------------
// Part 1: When
// ---------------------------------------------------------------------------

When('the framework upgrade orchestration is executed for tracking issue {int}', async function (issueNumber: number) {
  executionThrew = false;
  executionResult = undefined;
  try {
    executionResult = await executeUpgrade(issueNumber, 'test-adw-730', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, upgradeDeps);
  } catch {
    executionThrew = true;
  }
});

// ---------------------------------------------------------------------------
// Part 1: Then
// ---------------------------------------------------------------------------

Then('the framework upgrade orchestration returns without throwing', function () {
  assert.strictEqual(executionThrew, false, 'Expected executeUpgrade to resolve without throwing');
  assert.ok(executionResult !== undefined, 'Expected a result object to be returned');
});

Then('the framework upgrade orchestration outcome is {string}', function (expected: string) {
  assert.ok(executionResult !== undefined, 'executionResult must be set by the When step');
  assert.strictEqual(
    executionResult.outcome,
    expected,
    `Expected outcome "${expected}" but got "${executionResult.outcome}"`,
  );
});

Then('the framework upgrade orchestration reason is {string}', function (expected: string) {
  assert.ok(executionResult !== undefined, 'executionResult must be set by the When step');
  assert.strictEqual(
    executionResult.reason,
    expected,
    `Expected reason "${expected}" but got "${executionResult.reason}"`,
  );
});

Then('a bot-authored upgrade-failure comment that the failure cap counts is recorded on issue {int}', function (issueNumber: number) {
  const match = capturedComments.find((c) => c.issueNumber === issueNumber);
  assert.ok(match, `Expected a comment recorded on issue ${issueNumber} but capturedComments was: ${JSON.stringify(capturedComments)}`);
  assert.ok(
    match!.body.startsWith(UPGRADE_FAILURE_SIGNATURE),
    `Expected comment body to start with the failure signature but got: ${match!.body.slice(0, 80)}`,
  );
  const count = countUpgradeFailureComments([{ body: match!.body, author: BOT_AUTHOR }]);
  assert.strictEqual(count, 1, 'Expected the recorded comment to be counted by the failure cap');
});

Then('no upgrade-failure comment is recorded on issue {int}', function (issueNumber: number) {
  const match = capturedComments.find((c) => c.issueNumber === issueNumber);
  assert.ok(!match, `Expected NO comment on issue ${issueNumber} but found one: ${JSON.stringify(match)}`);
});

// ---------------------------------------------------------------------------
// Part 2: §4 — pure redrive-eligibility predicate
// ---------------------------------------------------------------------------

Given(
  'a candidate upgrade issue that is {word}, {word} the adw:upgrade label, {word} the adw:blocked label, and {word} a PR on its claim branch',
  function (state: string, upgradeLabel: string, terminalLabel: string, claimPr: string) {
    redriveSignals = {
      isOpen: state === 'open',
      hasUpgradeLabel: upgradeLabel === 'carries',
      isTerminalLabeled: terminalLabel === 'carries',
      hasClaimPr: claimPr === 'has',
      spawnLockHeldByLiveProcess: false,
    };
  },
);

When('the upgrade redrive eligibility is evaluated', function () {
  assert.ok(redriveSignals !== undefined, 'redriveSignals must be set by the Given step');
  redriveDecision = decideUpgradeRedrive(redriveSignals);
});

Then('the candidate upgrade is redrivable: {word}', function (expected: string) {
  assert.ok(redriveDecision !== undefined, 'redriveDecision must be set by the When step');
  assert.strictEqual(
    redriveDecision.redrive,
    expected === 'true',
    `Expected redrivable:${expected} but got redrive:${redriveDecision.redrive} (reason: ${redriveDecision.reason})`,
  );
});

// ---------------------------------------------------------------------------
// Part 2: §5-§6 — the redrive sweep
// ---------------------------------------------------------------------------

Given('a stranded upgrade tracking issue {int} with no PR on its claim branch', function (issueNumber: number) {
  redriveIssueFixtures.push({
    number: issueNumber,
    body: fixtureIssueBody(issueNumber),
    labels: [{ name: ADW_UPGRADE_LABEL }],
  });
});

Given('an already-escalated upgrade tracking issue {int} carrying the adw:blocked label', function (issueNumber: number) {
  redriveIssueFixtures.push({
    number: issueNumber,
    body: fixtureIssueBody(issueNumber),
    labels: [{ name: ADW_UPGRADE_LABEL }, { name: ADW_BLOCKED_LABEL }],
  });
});

Given(
  /^the per-issue spawn lock for issue (\d+) is (absent|held by a dead process|held by a live process)$/,
  function (issueNumberStr: string, lockState: string) {
    const issueNumber = Number(issueNumberStr);
    const lockPath = getSpawnLockFilePath(REDRIVE_REPO_INFO, issueNumber);

    if (lockState === 'absent') {
      fs.rmSync(lockPath, { force: true });
      return;
    }

    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const record = {
      pid: lockState === 'held by a live process' ? LIVE_PID : DEAD_PID,
      pidStartedAt: 'fixture-start-time',
      repoKey: `${REDRIVE_REPO_INFO.owner}/${REDRIVE_REPO_INFO.repo}`,
      issueNumber,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(lockPath, JSON.stringify(record, null, 2));
    writtenLockPaths.add(lockPath);
  },
);

When('the cron upgrade-redrive sweep runs', function () {
  runUpgradeRedriveScan(redriveIssueFixtures, REDRIVE_REPO_INFO, ['--target-repo', 'adw-730-fixture/upgrade-redrive'], redriveDeps);
});

Then('the redrive sweep re-spawns the upgrade orchestrator for issue {int}', function (issueNumber: number) {
  const called = redriveSpawnCalls.some((c) => c.upgNumber === issueNumber);
  assert.ok(
    called,
    `Expected the redrive sweep to re-spawn issue ${issueNumber} but spawnCalls were: ${JSON.stringify(redriveSpawnCalls)}`,
  );
});

Then('the redrive sweep does not re-spawn the upgrade orchestrator for issue {int}', function (issueNumber: number) {
  const called = redriveSpawnCalls.some((c) => c.upgNumber === issueNumber);
  assert.ok(
    !called,
    `Expected the redrive sweep NOT to re-spawn issue ${issueNumber} but it did: ${JSON.stringify(redriveSpawnCalls)}`,
  );
});
