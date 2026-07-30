/**
 * BDD step definitions for feature-685.feature
 *
 * Part A: validity-only regen gate (verifyAdwRegen takes only worktreePath, no hash)
 * Part B: MAX_FAILURES cap + escalation (executeUpgrade with injected UpgradeDeps)
 * Part D: scoped regen commit (commitChanges with excludePaths)
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'         → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes'    → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { verifyAdwRegen, REQUIRED_ADW_FILES } from '../../../adws/phases/worktreeSetup.ts';
import {
  isUpgradeFailureComment,
  countUpgradeFailureComments,
  type IssueCommentRecord,
} from '../../../adws/core/upgradeFailureCap.ts';
import {
  executeUpgrade,
  buildUpgradeFailureComment,
  buildUpgradeHitlComment,
  buildUpgradeMergeFailedComment,
  type UpgradeDeps,
} from '../../../adws/adwUpgrade.tsx';
import { commitOps } from '../../../adws/gitContext/commitOps.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Module-level scenario state (reset in Before/After hooks)
// ---------------------------------------------------------------------------

// Part A state
let scenarioTempDir: string | undefined;
let verifyResult: { ok: boolean; missing: readonly string[] } | undefined;

// Part B state
interface CommentRecord { body: string; author: string; }
let threadComments: CommentRecord[] = [];
let classifierResult: boolean | undefined;
let failureCountResult: number | undefined;
let upgradeResult: { outcome: string; reason: string } | undefined;
let capturedApplyLabel: Array<[number, string]> = [];
let capturedMoveToStatus: Array<[number, string]> = [];
let capturedPostSlack: string[] = [];
let capturedComments: Array<[number, string]> = [];
let capturedRunInitCommand: number = 0;
let capturedCreatePR: number = 0;
let injectedFailureCap: number = 3;

// Part D state
let regenWorktreeDir: string | undefined;
let regenCommitFiles: string[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@adw.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "ADW Test"', { cwd: dir, stdio: 'pipe' });
}

function seedAdwFilesAndVocab(dir: string): void {
  const adwDir = path.join(dir, '.adw');
  fs.mkdirSync(adwDir, { recursive: true });
  for (const file of REQUIRED_ADW_FILES) {
    fs.writeFileSync(path.join(adwDir, file), `# ${file}\n\nFixture content.\n`);
  }
  const vocabDir = path.join(dir, 'features', 'regression');
  fs.mkdirSync(vocabDir, { recursive: true });
  fs.writeFileSync(path.join(vocabDir, 'vocabulary.md'), '# Vocabulary\n\nFixture content.\n');
}

const REPO_INFO = { owner: 'acme', repo: 'target' };
const FRAMEWORK_ROOT = '/framework';
const BASE_REPO = '/base/repo';
const BOT_AUTHOR = 'adw-bot[bot]';
const HUMAN_AUTHOR = 'some-human';
const MOCK_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

function makeDepsForScenario(overrides: Partial<UpgradeDeps> = {}): UpgradeDeps {
  capturedApplyLabel = [];
  capturedMoveToStatus = [];
  capturedPostSlack = [];
  capturedComments = [];
  capturedRunInitCommand = 0;
  capturedCreatePR = 0;

  return {
    computeFrameworkHash: () => MOCK_HASH,
    ensureWorktree: () => '/worktrees/adw-upgrade-a1b2c3d4',
    reconcileWorktreeToRemote: () => undefined,
    getDefaultBranch: () => 'main',
    findPRByBranch: () => null,
    runInitCommand: async () => { capturedRunInitCommand++; return { success: true }; },
    copyInitCommandToWorktree: () => undefined,
    verifyAdwRegen: () => ({ ok: true, missing: [] }),
    copyStarterSettings: () => ({ action: 'skipped', destPath: '/worktrees/adw-upgrade-a1b2c3d4/.claude/settings.json' }),
    writeAdwVersion: () => undefined,
    commitChanges: () => true,
    pushBranch: () => undefined,
    isPushRejection: () => false,
    createPullRequest: () => { capturedCreatePR++; return { url: 'https://github.com/acme/target/pull/99', number: 99 }; },
    commentOnIssue: (_issueNumber: number, body: string, _repoInfo: typeof REPO_INFO) => {
      capturedComments.push([_issueNumber, body]);
    },
    ensureLogsDirectory: () => '/logs',
    log: () => undefined,
    readAdwYmlConfig: () => ({ hitl: false, unitTests: true, guardrails: false }),
    mergePR: () => ({ success: true }),
    fetchIssueLabels: () => [],
    fetchIssueComments: () => threadComments,
    ensureLabel: () => undefined,
    applyLabel: (issueNumber: number, label: string) => { capturedApplyLabel.push([issueNumber, label]); },
    moveToStatus: (issueNumber: number, status: string) => { capturedMoveToStatus.push([issueNumber, status]); return true; },
    postSlack: async (text: string) => { capturedPostSlack.push(text); },
    maxFailures: injectedFailureCap,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-685
// ---------------------------------------------------------------------------

Before({ tags: '@adw-685' }, function (this: RegressionWorld) {
  // Part A
  scenarioTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-685-'));
  verifyResult = undefined;

  // Part B
  threadComments = [];
  classifierResult = undefined;
  failureCountResult = undefined;
  upgradeResult = undefined;
  capturedApplyLabel = [];
  capturedMoveToStatus = [];
  capturedPostSlack = [];
  capturedComments = [];
  capturedRunInitCommand = 0;
  capturedCreatePR = 0;
  injectedFailureCap = 3;

  // Part D
  regenWorktreeDir = undefined;
  regenCommitFiles = [];
});

After({ tags: '@adw-685' }, function (this: RegressionWorld) {
  if (scenarioTempDir) {
    fs.rmSync(scenarioTempDir, { recursive: true, force: true });
    scenarioTempDir = undefined;
  }
  if (regenWorktreeDir) {
    fs.rmSync(regenWorktreeDir, { recursive: true, force: true });
    regenWorktreeDir = undefined;
  }
  verifyResult = undefined;
});

// ---------------------------------------------------------------------------
// Part A: Given — baseline worktrees
// ---------------------------------------------------------------------------

Given(
  'a regen target worktree carrying a complete, non-empty .adw\\/ directory and the regression vocabulary file',
  function () {
    if (!scenarioTempDir) return;
    initGitRepo(scenarioTempDir);
    seedAdwFilesAndVocab(scenarioTempDir);
    execSync('git add -A', { cwd: scenarioTempDir, stdio: 'pipe' });
    execSync('git commit -m "init: seed fixture files"', { cwd: scenarioTempDir, stdio: 'pipe' });
  },
);

Given(
  'the regen target worktree additionally carries a legacy regen receipt stamped with framework hash {string}',
  function (hash: string) {
    if (!scenarioTempDir) return;
    const receiptPath = path.join(scenarioTempDir, '.adw', '.regen-receipt');
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `frameworkHash: ${hash}\n`);
    // NOT committed — stays as working tree noise (proves receipt is fully ignored)
  },
);

Given(
  'the regen target worktree is missing the .adw\\/ config file {string}',
  function (file: string) {
    if (!scenarioTempDir) return;
    const filePath = path.join(scenarioTempDir, '.adw', file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  },
);

Given(
  'the regen target worktree has an empty .adw\\/ config file {string}',
  function (file: string) {
    if (!scenarioTempDir) return;
    const filePath = path.join(scenarioTempDir, '.adw', file);
    fs.writeFileSync(filePath, '');
  },
);

Given(
  'the regen target worktree is missing the regression vocabulary file',
  function () {
    if (!scenarioTempDir) return;
    const vocabPath = path.join(scenarioTempDir, 'features', 'regression', 'vocabulary.md');
    if (fs.existsSync(vocabPath)) fs.unlinkSync(vocabPath);
  },
);

// ---------------------------------------------------------------------------
// Part A: When
// ---------------------------------------------------------------------------

When(
  'the .adw\\/ regeneration validity is checked',
  function () {
    if (!scenarioTempDir) return;
    verifyResult = verifyAdwRegen(scenarioTempDir);
  },
);

// ---------------------------------------------------------------------------
// Part A: Then
// ---------------------------------------------------------------------------

Then(
  'the regeneration validity check passes',
  function () {
    assert.ok(verifyResult !== undefined, 'verifyResult must be set by the When step');
    assert.strictEqual(
      verifyResult.ok,
      true,
      `Expected validity check to pass but got ok:false, missing:${JSON.stringify(verifyResult.missing)}`,
    );
  },
);

Then(
  'the regeneration validity check fails',
  function () {
    assert.ok(verifyResult !== undefined, 'verifyResult must be set by the When step');
    assert.strictEqual(
      verifyResult.ok,
      false,
      `Expected validity check to fail but got ok:true`,
    );
  },
);

Then(
  'the regeneration validity check reports {string} as a missing artefact',
  function (artifact: string) {
    assert.ok(verifyResult !== undefined, 'verifyResult must be set by the When step');
    const missing = verifyResult.missing as readonly string[];
    const found = missing.some((m) => m.includes(artifact));
    assert.ok(
      found,
      `Expected missing artefacts to include "${artifact}" but got: ${JSON.stringify(missing)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Part B: Given — classifier inputs
// ---------------------------------------------------------------------------

When(
  'the upgrade failure-comment classifier evaluates a {string} comment authored by {string}',
  function (kind: string, authorRole: string) {
    const body = (() => {
      switch (kind) {
        case 'upgrade-failure': return buildUpgradeFailureComment('LLM timed out', 'test-adw-id', 541);
        case 'hitl-deferred': return buildUpgradeHitlComment(99, 'test-adw-id');
        case 'merge-failed': return buildUpgradeMergeFailedComment(99, 'branch protection', 'test-adw-id');
        default: return 'Some unrelated comment text';
      }
    })();
    const author = authorRole === 'bot' ? BOT_AUTHOR : HUMAN_AUTHOR;
    classifierResult = isUpgradeFailureComment(body, author);
  },
);

Then(
  'the classifier recognises it as an upgrade failure comment: {string}',
  function (expectedStr: string) {
    const expected = expectedStr === 'true';
    assert.strictEqual(
      classifierResult,
      expected,
      `Expected classifier result to be ${expected} but got ${String(classifierResult)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Part B: Given — thread building
// ---------------------------------------------------------------------------

Given(
  'an upgrade tracking issue {int} whose comment thread holds {int} bot-authored upgrade-failure comments',
  function (_issueNumber: number, count: number) {
    const failureBody = buildUpgradeFailureComment('LLM timed out', 'test-adw-id', _issueNumber);
    for (let i = 0; i < count; i++) {
      threadComments.push({ body: failureBody, author: BOT_AUTHOR });
    }
  },
);

Given(
  'the thread also holds one bot-authored HITL-deferred comment, one bot-authored merge-failed comment, and {int} human comments',
  function (humanCount: number) {
    threadComments.push({ body: buildUpgradeHitlComment(1, 'id'), author: BOT_AUTHOR });
    threadComments.push({ body: buildUpgradeMergeFailedComment(1, 'error', 'id'), author: BOT_AUTHOR });
    for (let i = 0; i < humanCount; i++) {
      threadComments.push({ body: 'Human comment text', author: HUMAN_AUTHOR });
    }
  },
);

When(
  'the upgrade failure comments on the thread are counted',
  function () {
    failureCountResult = countUpgradeFailureComments(threadComments as readonly IssueCommentRecord[]);
  },
);

Then(
  'the upgrade failure-comment count is {int}',
  function (expected: number) {
    assert.strictEqual(
      failureCountResult,
      expected,
      `Expected failure comment count ${expected} but got ${String(failureCountResult)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Part B: Given — orchestration setup
// ---------------------------------------------------------------------------

Given(
  'the upgrade failure cap is set to {int}',
  function (cap: number) {
    injectedFailureCap = cap;
  },
);

// ---------------------------------------------------------------------------
// Part B: When — orchestration run
// ---------------------------------------------------------------------------

// We need module-level flags for the Given steps
let alreadyEscalatedIssue: number | null = null;
let claimPrAlreadyExists = false;

Before({ tags: '@adw-685' }, function () {
  alreadyEscalatedIssue = null;
  claimPrAlreadyExists = false;
});

Given(
  'the upgrade tracking issue {int} already carries the terminal "adw:blocked" label',
  function (issueNumber: number) {
    alreadyEscalatedIssue = issueNumber;
    threadComments = [];
  },
);

Given(
  'the upgrade claim branch already has an open pull request',
  function () {
    claimPrAlreadyExists = true;
  },
);

When(
  'the upgrade orchestration runs for tracking issue {int}',
  async function (issueNumber: number) {
    const extraOverrides: Record<string, unknown> = {};

    if (alreadyEscalatedIssue !== null) {
      extraOverrides['fetchIssueLabels'] = () => ['adw:blocked'];
    }

    if (claimPrAlreadyExists) {
      extraOverrides['findPRByBranch'] = () => ({ number: 77, state: 'OPEN', labels: [] });
    }

    const deps = makeDepsForScenario(extraOverrides as Partial<UpgradeDeps>);
    upgradeResult = await executeUpgrade(issueNumber, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps) as { outcome: string; reason: string };
  },
);

// ---------------------------------------------------------------------------
// Part B: Then — orchestration assertions
// ---------------------------------------------------------------------------

Then(
  'the upgrade orchestration outcome is {string}',
  function (expected: string) {
    assert.ok(upgradeResult !== undefined, 'upgradeResult must be set by the When step');
    assert.strictEqual(
      upgradeResult.outcome,
      expected,
      `Expected outcome "${expected}" but got "${upgradeResult.outcome}"`,
    );
  },
);

Then(
  'the terminal "adw:blocked" label is applied to issue {int}',
  function (issueNumber: number) {
    const applied = capturedApplyLabel.some(([n, l]) => n === issueNumber && l === 'adw:blocked');
    assert.ok(
      applied,
      `Expected adw:blocked label to be applied to issue ${issueNumber} but capturedApplyLabel was: ${JSON.stringify(capturedApplyLabel)}`,
    );
  },
);

Then(
  'no terminal "adw:blocked" label is applied to issue {int}',
  function (issueNumber: number) {
    const applied = capturedApplyLabel.some(([n, l]) => n === issueNumber && l === 'adw:blocked');
    assert.ok(
      !applied,
      `Expected adw:blocked label NOT to be applied to issue ${issueNumber} but it was`,
    );
  },
);

Then(
  'the board moves issue {int} to "Blocked"',
  function (issueNumber: number) {
    const moved = capturedMoveToStatus.some(([n, s]) => n === issueNumber && s === 'Blocked');
    assert.ok(
      moved,
      `Expected board to move issue ${issueNumber} to "Blocked" but capturedMoveToStatus was: ${JSON.stringify(capturedMoveToStatus)}`,
    );
  },
);

Then(
  'the board is not moved for issue {int}',
  function (issueNumber: number) {
    const moved = capturedMoveToStatus.some(([n]) => n === issueNumber);
    assert.ok(
      !moved,
      `Expected board NOT to be moved for issue ${issueNumber} but it was: ${JSON.stringify(capturedMoveToStatus)}`,
    );
  },
);

Then(
  'exactly one Slack alert is posted',
  function () {
    assert.strictEqual(
      capturedPostSlack.length,
      1,
      `Expected exactly 1 Slack alert but got ${capturedPostSlack.length}`,
    );
  },
);

Then(
  'no Slack alert is posted',
  function () {
    assert.strictEqual(
      capturedPostSlack.length,
      0,
      `Expected no Slack alerts but got ${capturedPostSlack.length}`,
    );
  },
);

Then(
  'a distinct escalation comment is posted to issue {int}',
  function (issueNumber: number) {
    const posted = capturedComments.some(([n]) => n === issueNumber);
    assert.ok(
      posted,
      `Expected a comment to be posted to issue ${issueNumber} but none was`,
    );
  },
);

Then(
  'the escalation comment is not itself classified as an upgrade failure comment',
  function () {
    // Check that none of the posted comments are classified as upgrade-failure
    for (const [, body] of capturedComments) {
      const isFailure = isUpgradeFailureComment(body, BOT_AUTHOR);
      assert.ok(
        !isFailure,
        `Expected escalation comment NOT to be classified as upgrade-failure but it was. Body: ${body.slice(0, 100)}`,
      );
    }
  },
);

Then(
  'no escalation comment is posted to issue {int}',
  function (issueNumber: number) {
    const posted = capturedComments.some(([n]) => n === issueNumber);
    assert.ok(
      !posted,
      `Expected NO comment to be posted to issue ${issueNumber} but one was`,
    );
  },
);

Then(
  'the .adw\\/ directory is regenerated',
  function () {
    assert.ok(
      capturedRunInitCommand > 0,
      `Expected runInitCommand to be called (regen) but it was not called`,
    );
  },
);

Then(
  'the .adw\\/ directory is not regenerated',
  function () {
    assert.strictEqual(
      capturedRunInitCommand,
      0,
      `Expected runInitCommand NOT to be called but it was called ${capturedRunInitCommand} times`,
    );
  },
);

Then(
  'a pull request is opened for issue {int}',
  function (_issueNumber: number) {
    assert.ok(
      capturedCreatePR > 0,
      `Expected createPullRequest to be called but it was not`,
    );
  },
);

Then(
  'no pull request is opened for issue {int}',
  function (_issueNumber: number) {
    assert.strictEqual(
      capturedCreatePR,
      0,
      `Expected createPullRequest NOT to be called but it was called ${capturedCreatePR} times`,
    );
  },
);

// ---------------------------------------------------------------------------
// Part D: Given — regen worktrees
// ---------------------------------------------------------------------------

Given(
  'a regen worktree with pending changes to {string}, {string}, and {string}',
  function (file1: string, file2: string, file3: string) {
    regenWorktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-685-regen-'));
    initGitRepo(regenWorktreeDir);

    // Create and commit baseline versions of all three files
    for (const file of [file1, file2, file3]) {
      const fullPath = path.join(regenWorktreeDir, file);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, `original content for ${file}\n`);
    }
    execSync('git add -A', { cwd: regenWorktreeDir, stdio: 'pipe' });
    execSync('git commit -m "baseline"', { cwd: regenWorktreeDir, stdio: 'pipe' });

    // Modify all three files (pending changes)
    for (const file of [file1, file2, file3]) {
      const fullPath = path.join(regenWorktreeDir, file);
      fs.writeFileSync(fullPath, `modified content for ${file}\n`);
    }
  },
);

Given(
  'a regen worktree with a pending change to {string} and an untracked {string}',
  function (trackedFile: string, untrackedFile: string) {
    regenWorktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-685-regen-'));
    initGitRepo(regenWorktreeDir);

    // Create and commit only the tracked file
    const trackedPath = path.join(regenWorktreeDir, trackedFile);
    fs.mkdirSync(path.dirname(trackedPath), { recursive: true });
    fs.writeFileSync(trackedPath, `original content for ${trackedFile}\n`);
    execSync('git add -A', { cwd: regenWorktreeDir, stdio: 'pipe' });
    execSync('git commit -m "baseline"', { cwd: regenWorktreeDir, stdio: 'pipe' });

    // Modify the tracked file
    fs.writeFileSync(trackedPath, `modified content for ${trackedFile}\n`);

    // Create the untracked file (never committed, never staged)
    const untrackedPath = path.join(regenWorktreeDir, untrackedFile);
    fs.mkdirSync(path.dirname(untrackedPath), { recursive: true });
    fs.writeFileSync(untrackedPath, `untracked content for ${untrackedFile}\n`);
  },
);

// ---------------------------------------------------------------------------
// Part D: When
// ---------------------------------------------------------------------------

When(
  'the regen changes are committed excluding {string}',
  function (excludePath: string) {
    if (!regenWorktreeDir) throw new Error('regenWorktreeDir not set');
    const run = (cmd: string, cwd: string): string => {
      return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    };
    commitOps.commitChanges(run, 'chore: regen commit', regenWorktreeDir, { excludePaths: [excludePath] });
    // Capture what was committed
    regenCommitFiles = execSync('git show --name-only --format= HEAD', {
      cwd: regenWorktreeDir,
      encoding: 'utf-8',
    }).split('\n').map(f => f.trim()).filter(Boolean);
  },
);

When(
  'the regen changes are committed without an exclude list',
  function () {
    if (!regenWorktreeDir) throw new Error('regenWorktreeDir not set');
    const run = (cmd: string, cwd: string): string => {
      return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    };
    commitOps.commitChanges(run, 'chore: regen commit', regenWorktreeDir);
    // Capture what was committed
    regenCommitFiles = execSync('git show --name-only --format= HEAD', {
      cwd: regenWorktreeDir,
      encoding: 'utf-8',
    }).split('\n').map(f => f.trim()).filter(Boolean);
  },
);

// ---------------------------------------------------------------------------
// Part D: Then
// ---------------------------------------------------------------------------

Then(
  'the resulting commit includes {string}',
  function (file: string) {
    assert.ok(
      regenCommitFiles.includes(file),
      `Expected commit to include "${file}" but committed files were: ${JSON.stringify(regenCommitFiles)}`,
    );
  },
);

Then(
  'the resulting commit excludes {string}',
  function (file: string) {
    assert.ok(
      !regenCommitFiles.includes(file),
      `Expected commit to exclude "${file}" but it was in the commit: ${JSON.stringify(regenCommitFiles)}`,
    );
  },
);

Then(
  '{string} remains uncommitted in the worktree',
  function (file: string) {
    if (!regenWorktreeDir) throw new Error('regenWorktreeDir not set');
    const status = execSync('git status --porcelain --untracked-files=all', { cwd: regenWorktreeDir, encoding: 'utf-8' });
    const inStatus = status.split('\n').some(line => line.includes(file));
    assert.ok(
      inStatus,
      `Expected "${file}" to remain uncommitted in the worktree but git status was:\n${status}`,
    );
  },
);
