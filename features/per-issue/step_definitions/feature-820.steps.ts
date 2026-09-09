/**
 * BDD step definitions for feature-820.feature
 *
 * Orchestrators, phases, core utilities and the proof publisher reach the
 * forge through the boundary's providers alone (#820).
 *
 * §1  the comment-clearing orchestrator (adwClearComments)
 * §2  the proof publisher and proof publish phase
 * §3  the remaining wrong-repo fallbacks (orchestrator lock, depaudit setup)
 * §4  the branch lookups in core/ and the pr-review ordering
 * §5  the label-override chokepoint (issueClassifier)
 * §6  the approval capability gate (reviewPhase)
 * §7  the label-write policy (unverified verdict)
 * §8  the unaddressed-comment read
 * §9  a forge that is not GitHub refuses by name
 * §10 what does not move (pure predicates) + the wontfix escape hatch
 * §11 structural backstops → feature-691.steps.ts (guard), feature-504.steps.ts (type-check)
 *
 * Reuses feature-796's recording-boundary harness (`world796()`) throughout —
 * every phrase feature-796/794/691/504/797 already registers is reused, never
 * redefined. `Before`/`After` are tag-scoped to `@adw-820` because
 * feature-796's own hooks are scoped to `@adw-796` and do not fire here; this
 * file resets the same shared world and cleans up its own agent-state dirs.
 *
 * §6/§10(first) route through `test/mocks/claude-cli-stub.ts` exactly as
 * feature-762.steps.ts does (save/restore `CLAUDE_CODE_PATH`,
 * `clearClaudeCodePathCache()`), so the review/scenario agent calls the
 * phases make are real subprocess spawns of a fast, canned stub rather than
 * the real Claude CLI.
 *
 * §2's "object storage is configured" row needs `CLOUDFLARE_ACCOUNT_ID`,
 * `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` to be non-empty in
 * `process.env` BEFORE this process starts — `adws/core/environment.ts`
 * captures them into frozen module-level constants at first import, so a
 * step cannot toggle them at runtime. Run this file's suite with those three
 * set to any non-empty placeholder value; the injected recording `uploader`
 * fully replaces the real R2 client either way, so no real credentials or
 * network calls are needed — only truthiness is checked.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'node:url';

import { world796, splitRepo, resetWorld, claimBranchName, setClaimBranchOverride } from './feature-796.steps.ts';
import type { CallRecord } from './feature-796.steps.ts';

import type { GitHubLabel } from '../../../adws/providers/github/domain/issue.ts';
import type { ReviewComment, RepoContext } from '../../../adws/providers/types.ts';
import { Platform } from '../../../adws/providers/types.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import type { WorkflowContext } from '../../../adws/github/workflowCommentsIssue.ts';

import { clearIssueComments } from '../../../adws/adwClearComments.tsx';
import { publishPrProof } from '../../../adws/proof/prProofPublisher.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';
import { executeProofPublishPhase } from '../../../adws/phases/proofPublishPhase.ts';
import { acquireOrchestratorLock, releaseOrchestratorLock } from '../../../adws/phases/orchestratorLock.ts';
import { getSpawnLockFilePath } from '../../../adws/triggers/spawnGate.ts';
import { executeDepauditSetup } from '../../../adws/phases/depauditSetup.ts';
import { resolveWorkflowRepoId } from '../../../adws/phases/workflowRepoIdentity.ts';
import { buildDefaultUpgradeClaimDeps, buildClaimBranchName } from '../../../adws/core/upgradeClaim.ts';
import { resolvePrReviewInvocation } from '../../../adws/core/prReviewInvocation.ts';
import type { PrReviewInvocation } from '../../../adws/core/prReviewInvocation.ts';
import { deriveStageFromRemote, buildDefaultReconcileDeps } from '../../../adws/core/remoteReconcile.ts';
import { classifyIssueForTrigger } from '../../../adws/core/issueClassifier.ts';
import type { IssueClassificationResult } from '../../../adws/core/issueClassifier.ts';
import { executeReviewPhase } from '../../../adws/phases/reviewPhase.ts';
import { readUnaddressedComments } from '../../../adws/core/unaddressedComments.ts';
import { executeScenarioPhase } from '../../../adws/phases/scenarioPhase.ts';
import { AgentStateManager, ADW_UNVERIFIED_LABEL, hasWontFixLabelName, detectRecoveryState } from '../../../adws/core/index.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';
import { JiraIssueTracker } from '../../../adws/providers/jira/jiraIssueTracker.ts';
import type { JiraApiClient } from '../../../adws/providers/jira/jiraApiClient.ts';
import { GitLabCodeHost } from '../../../adws/providers/gitlab/gitlabCodeHost.ts';
import type { GitLabApiClient } from '../../../adws/providers/gitlab/gitlabApiClient.ts';

const FRAMEWORK_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLAUDE_CLI_STUB_PATH = path.resolve(FRAMEWORK_REPO_ROOT, 'test/mocks/claude-cli-stub.ts');

/**
 * The frozen framework hash this file's §3/§10 upgrade-claim rows name literally in Gherkin
 * ("adw-upgrade-abc123" — the same stub hash `upgradeClaim.test.ts` uses). The real hash is
 * recomputed from the checkout on every commit, so freezing it is the only way a literal
 * branch parameter can address the same branch the fixture seeds. Scoped to @adw-820 by the
 * hooks below; feature-796's own rows keep the real computed hash.
 */
const FROZEN_CLAIM_BRANCH = buildClaimBranchName('abc123');
const FIXED_ADW_ID = 'wgg98x-void';

// ── §820-local world state — transient results not already on World796 ────────

interface UploaderCall {
  owner: string;
  repo: string;
}

const s: {
  workflowConfig: WorkflowConfig | null;
  clearCommentsResult: ReturnType<typeof clearIssueComments> | null;
  scenarioProof: ScenarioProofResult | null;
  uploaderCalls: UploaderCall[] | null;
  lockFilePath: string | null;
  lockExistedAfterAcquire: boolean;
  lockExistsAfterRelease: boolean;
  depauditResult: Awaited<ReturnType<typeof executeDepauditSetup>> | null;
  upgradeClaimIssueNumber: number | null;
  prReviewInvocation: PrReviewInvocation | null;
  reconciledStage: string | null;
  classificationResult: IssueClassificationResult | null;
  classifyWithCalled: boolean;
  reviewPhaseResult: Awaited<ReturnType<typeof executeReviewPhase>> | null;
  unaddressedComments: ReviewComment[] | null;
  retirementResult: boolean | null;
  refusalError: Error | null;
  scenarioPhaseResult: Awaited<ReturnType<typeof executeScenarioPhase>> | null;
  originalClaudeCodePath: string | undefined;
  claudeStubActive: boolean;
} = {
  workflowConfig: null,
  clearCommentsResult: null,
  scenarioProof: null,
  uploaderCalls: null,
  lockFilePath: null,
  lockExistedAfterAcquire: false,
  lockExistsAfterRelease: false,
  depauditResult: null,
  upgradeClaimIssueNumber: null,
  prReviewInvocation: null,
  reconciledStage: null,
  classificationResult: null,
  classifyWithCalled: false,
  reviewPhaseResult: null,
  unaddressedComments: null,
  retirementResult: null,
  refusalError: null,
  scenarioPhaseResult: null,
  originalClaudeCodePath: undefined,
  claudeStubActive: false,
};

function resetLocalState(): void {
  s.workflowConfig = null;
  s.clearCommentsResult = null;
  s.scenarioProof = null;
  s.uploaderCalls = null;
  s.lockFilePath = null;
  s.lockExistedAfterAcquire = false;
  s.lockExistsAfterRelease = false;
  s.depauditResult = null;
  s.upgradeClaimIssueNumber = null;
  s.prReviewInvocation = null;
  s.reconciledStage = null;
  s.classificationResult = null;
  s.classifyWithCalled = false;
  s.reviewPhaseResult = null;
  s.unaddressedComments = null;
  s.retirementResult = null;
  s.refusalError = null;
  s.scenarioPhaseResult = null;
}

function requireConfig(): WorkflowConfig {
  assert.ok(s.workflowConfig, 'Expected a workflow configuration to have been built first');
  return s.workflowConfig!;
}

function activateClaudeCliStub(): void {
  s.originalClaudeCodePath = process.env['CLAUDE_CODE_PATH'];
  process.env['CLAUDE_CODE_PATH'] = CLAUDE_CLI_STUB_PATH;
  clearClaudeCodePathCache();
  s.claudeStubActive = true;
}

/**
 * Writes the claude-cli-stub's cwd-relative manifest marker file (the
 * fallback `resolveManifestPath()` uses when MOCK_MANIFEST_PATH cannot
 * reach the spawned child through `getSafeSubprocessEnv()`'s fixed
 * allowlist — see test/mocks/claude-cli-stub.ts's module docblock) so the
 * stub streams a review-agent payload carrying valid ReviewResult JSON
 * instead of the default prose fixture, which `extractJson` cannot parse.
 */
function writeReviewPassManifest(worktreePath: string): void {
  const payloadPath = path.join(worktreePath, '.adw-stub-review-payload.json');
  fs.writeFileSync(
    payloadPath,
    JSON.stringify([
      { type: 'text', text: JSON.stringify({ success: true, reviewSummary: 'LGTM', reviewIssues: [], screenshots: [] }) },
    ]),
  );
  const manifestPath = path.join(worktreePath, '.adw-stub-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ jsonlPath: payloadPath, edits: [] }));
}

function restoreClaudeCliStub(): void {
  if (!s.claudeStubActive) return;
  if (s.originalClaudeCodePath === undefined) delete process.env['CLAUDE_CODE_PATH'];
  else process.env['CLAUDE_CODE_PATH'] = s.originalClaudeCodePath;
  clearClaudeCodePathCache();
  s.claudeStubActive = false;
}

Before({ tags: '@adw-820' }, function () {
  resetWorld();
  resetLocalState();
  setClaimBranchOverride(FROZEN_CLAIM_BRANCH);
});

After({ tags: '@adw-820' }, function () {
  setClaimBranchOverride(null);
  restoreClaudeCliStub();
  const w = world796();
  for (const dir of w.tempDirs) {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  const adwIds = new Set([...w.usedAdwIds, FIXED_ADW_ID]);
  for (const adwId of adwIds) {
    const agentsDir = path.join(AGENTS_STATE_DIR, adwId);
    if (fs.existsSync(agentsDir)) fs.rmSync(agentsDir, { recursive: true, force: true });
    const logsDir = path.join(LOGS_DIR, adwId);
    if (fs.existsSync(logsDir)) fs.rmSync(logsDir, { recursive: true, force: true });
  }
  resetWorld();
  resetLocalState();
});

// ── Shared WorkflowConfig fixture builder ──────────────────────────────────────
// Minimal-but-real WorkflowConfig, bound to the boundary's own recording
// providers (never a GitHubIssueTracker/GitHubCodeHost instance) so every
// phase reads the SAME identity `resolveWorkflowRepoId` would resolve.
// Also registered as `w.autoMergeConfig` so feature-796's reused
// 'no GitHub provider was constructed during the phase' assertion (which
// reads that field) is meaningful for §11's backstop row.

function buildWorkflowConfig(issueNumber: number, overrides: { prUrl?: string; labels?: GitHubLabel[] } = {}): WorkflowConfig {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built first');
  const boundary = w.boundary;
  const adwId = `bdd820-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  w.usedAdwIds.add(adwId);

  const worktreePath = mkdtempSync(path.join(tmpdir(), 'adw-820-worktree-'));
  const logsDir = mkdtempSync(path.join(tmpdir(), 'adw-820-logs-'));
  w.tempDirs.push(worktreePath, logsDir);

  const orchestratorStatePath = AgentStateManager.initializeState(adwId, 'orchestrator');

  const repoContext: RepoContext = {
    issueTracker: boundary.providers.issueTracker,
    codeHost: boundary.providers.codeHost,
    boardManager: boundary.providers.boardManager,
    cwd: worktreePath,
    repoId: boundary.repoId,
  };

  const issue = {
    number: issueNumber,
    title: 'Test issue',
    body: 'Test issue body',
    state: 'open',
    author: { login: 'tester', isBot: false },
    assignees: [],
    labels: overrides.labels ?? [],
    comments: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    url: `https://github.com/${boundary.repoId.owner}/${boundary.repoId.repo}/issues/${issueNumber}`,
  };

  const ctx: WorkflowContext = {
    issueNumber,
    adwId,
    issueType: '/feature',
    ...(overrides.prUrl ? { prUrl: overrides.prUrl } : {}),
  };

  const config = {
    issueNumber,
    adwId,
    issue,
    issueType: '/feature',
    worktreePath,
    defaultBranch: 'main',
    logsDir,
    orchestratorStatePath,
    orchestratorName: 'orchestrator',
    recoveryState: detectRecoveryState([]),
    ctx,
    branchName: 'feature-issue-42-void',
    applicationUrl: 'http://localhost:0',
    targetRepo: undefined,
    repoContext,
    projectConfig: {},
    adwYmlConfig: { hitl: false, unitTests: true, guardrails: false },
    topLevelStatePath: '',
    gitContext: undefined,
  } as unknown as WorkflowConfig;

  w.autoMergeConfig = config;
  return config;
}

// ── §1 THE COMMENT-CLEARING ORCHESTRATOR ───────────────────────────────────────

function seedIssueComments(issueNumber: number, ids: string[]): void {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueComments.set(
    issueNumber,
    ids.map((id, i) => ({ id, body: `comment ${i}`, author: 'human', createdAt: new Date(0).toISOString() })),
  );
}

Given('issue {int} in the recording tracker has comments with ids {string}', function (issueNumber: number, id: string) {
  seedIssueComments(issueNumber, [id]);
});

Given(
  'issue {int} in the recording tracker has comments with ids {string}, {string} and {string}',
  function (issueNumber: number, id1: string, id2: string, id3: string) {
    seedIssueComments(issueNumber, [id1, id2, id3]);
  },
);

Given('issue {int} in the recording tracker is titled {string}', function (issueNumber: number, title: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueTitles.set(issueNumber, title);
});

When('the comment-clearing orchestrator clears issue {int} from that boundary', function (issueNumber: number) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const effective = w.watchedBoundary ?? w.boundary;
  s.clearCommentsResult = clearIssueComments(issueNumber, effective.providers.issueTracker);
});

Then(
  'the boundary\'s providers recorded comment deletions for the ids {string}, {string} and {string}',
  function (id1: string, id2: string, id3: string) {
    const w = world796();
    for (const id of [id1, id2, id3]) {
      const call = w.activeCallLog.find((c) => c.operation === 'deleteComment' && c.args[0] === id);
      assert.ok(call, `Expected a deleteComment call for id "${id}"`);
    }
  },
);

Then('the comment-clearing orchestrator reported {int} deleted and {int} failed', function (deleted: number, failed: number) {
  assert.ok(s.clearCommentsResult, 'Expected the comment-clearing orchestrator to have run');
  assert.strictEqual(s.clearCommentsResult!.deleted, deleted);
  assert.strictEqual(s.clearCommentsResult!.failed, failed);
});

Then('the boundary\'s providers were asked for the title of issue {int}', function (issueNumber: number) {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'getIssueTitle' && c.args[0] === issueNumber);
  assert.ok(call, `Expected a getIssueTitle call for issue ${issueNumber}`);
});

Then('the comment-clearing orchestrator reported the issue title {string}', function (title: string) {
  assert.ok(s.clearCommentsResult, 'Expected the comment-clearing orchestrator to have run');
  assert.strictEqual(s.clearCommentsResult!.issueTitle, title);
});

// ── §2 THE PROOF PUBLISHER ──────────────────────────────────────────────────────

function buildScenarioProof(passed: number, failed: number, artifactsDir: string): ScenarioProofResult {
  return {
    tagResults: [
      {
        tag: '@review-proof',
        resolvedTag: '@review-proof',
        severity: 'blocker',
        optional: false,
        passed: failed === 0,
        output: '',
        exitCode: 0,
        skipped: false,
        counts: { total: passed + failed, passed, failed },
      },
    ],
    hasBlockerFailures: failed > 0,
    resultsFilePath: '',
    artifactsDir,
  };
}

Given('a scenario proof result reporting {int} passed and {int} failed with no artifacts', function (passed: number, failed: number) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-820-artifacts-'));
  world796().tempDirs.push(dir);
  s.scenarioProof = buildScenarioProof(passed, failed, dir);
});

Given(
  'a scenario proof result reporting {int} passed and {int} failed with one screenshot artifact',
  function (passed: number, failed: number) {
    const dir = mkdtempSync(path.join(tmpdir(), 'adw-820-artifacts-'));
    world796().tempDirs.push(dir);
    const scenarioDir = path.join(dir, 'MyScenario');
    fs.mkdirSync(scenarioDir, { recursive: true });
    fs.writeFileSync(path.join(scenarioDir, 'screenshot.png'), Buffer.from([0]));
    s.scenarioProof = buildScenarioProof(passed, failed, dir);
  },
);

Given('object storage is configured with a recording uploader', function () {
  s.uploaderCalls = [];
});

When(
  'the proof publisher publishes for pull request {int} under adw id {string} from that boundary',
  async function (prNumber: number, adwId: string) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    const boundary = w.boundary;
    w.usedAdwIds.add(adwId);
    await publishPrProof({
      artifactsDir: s.scenarioProof?.artifactsDir,
      scenarioProof: s.scenarioProof ?? undefined,
      prNumber,
      repoInfo: boundary.repoId,
      adwId,
      ...(s.uploaderCalls
        ? {
            uploader: async (opts: { owner: string; repo: string; key: string }) => {
              s.uploaderCalls!.push({ owner: opts.owner, repo: opts.repo });
              return { url: `https://fake-r2.example/${opts.key}`, bucket: `${opts.owner}-${opts.repo}`, key: opts.key };
            },
          }
        : {}),
      commenter: (n: number, body: string) => boundary.providers.codeHost.commentOnPullRequest(n, body),
    });
  },
);

Then('the boundary\'s code host recorded a comment on pull request {int}', function (prNumber: number) {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'commentOnPullRequest' && c.args[0] === prNumber);
  assert.ok(call, `Expected a commentOnPullRequest call for pull request ${prNumber}`);
});

Then('the recorded comment on pull request {int} contains {string}', function (prNumber: number, text: string) {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'commentOnPullRequest' && c.args[0] === prNumber);
  assert.ok(call, `Expected a commentOnPullRequest call for pull request ${prNumber}`);
  const body = call!.args[1] as string;
  assert.ok(body.includes(text), `Expected the recorded comment to contain "${text}", got: ${body}`);
});

Then('the recording uploader was asked to upload for the repository {string}', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  assert.ok(s.uploaderCalls && s.uploaderCalls.length > 0, 'Expected the recording uploader to have been called at least once');
  for (const call of s.uploaderCalls!) {
    assert.strictEqual(call.owner, owner);
    assert.strictEqual(call.repo, repo);
  }
});

Given('a workflow configuration bound to that boundary whose pull request url names pull request {int}', function (prNumber: number) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  s.workflowConfig = buildWorkflowConfig(42, {
    prUrl: `https://github.com/${w.boundary.repoId.owner}/${w.boundary.repoId.repo}/pull/${prNumber}`,
  });
});

When('the proof publish phase runs for that configuration', async function () {
  const config = requireConfig();
  if (s.scenarioProof) config.ctx.scenarioProof = s.scenarioProof;
  await executeProofPublishPhase(config);
});

// ── §3 THE REMAINING WRONG-REPO FALLBACKS ──────────────────────────────────────

Given('a workflow configuration bound to that boundary for issue {int} with no target repository', function (issueNumber: number) {
  s.workflowConfig = buildWorkflowConfig(issueNumber);
});

When('the orchestrator lock is acquired and released for that configuration', function () {
  const config = requireConfig();
  const repoId = resolveWorkflowRepoId(config);
  s.lockFilePath = getSpawnLockFilePath(repoId, config.issueNumber);
  const acquired = acquireOrchestratorLock(config);
  assert.ok(acquired, 'Expected the orchestrator lock to be acquired');
  s.lockExistedAfterAcquire = fs.existsSync(s.lockFilePath);
  releaseOrchestratorLock(config);
  s.lockExistsAfterRelease = fs.existsSync(s.lockFilePath);
});

Then('the spawn lock artefact was written under the repository {string}', function (repoStr: string) {
  assert.ok(s.lockExistedAfterAcquire, 'Expected the spawn lock artefact to exist right after acquisition');
  const { owner, repo } = splitRepo(repoStr);
  assert.ok(
    s.lockFilePath && s.lockFilePath.includes(`${owner}_${repo}_issue-`),
    `Expected the lock path to be namespaced by ${owner}/${repo}, got: ${s.lockFilePath}`,
  );
});

Then('the spawn lock artefact was removed on release', function () {
  assert.strictEqual(s.lockExistsAfterRelease, false, 'Expected the spawn lock artefact to be removed after release');
});

Given('no secrets are available to propagate', function () {
  // Marker only — the When step's injected getEnv always answers undefined.
});

When('the dependency-audit setup runs for that configuration', async function () {
  const config = requireConfig();
  s.depauditResult = await executeDepauditSetup(config, {
    execWithRetry: () => '',
    getEnv: () => undefined,
  });
});

Then('the reported skipped-secret warnings name the repository {string}', function (repoStr: string) {
  assert.ok(s.depauditResult, 'Expected the dependency-audit setup to have run');
  const { owner, repo } = splitRepo(repoStr);
  const expected = `${owner}/${repo}`;
  assert.ok(
    s.depauditResult!.warnings.some((w) => w.includes(expected)),
    `Expected a warning naming ${expected}, got: ${s.depauditResult!.warnings.join(' | ')}`,
  );
});

// ── §4 THE BRANCH LOOKUPS IN core/ AND THE PR-REVIEW ORDERING ──────────────────

Given('pull request {int} in the recording code host implements issue {int}', function (prNumber: number, issueNumber: number) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.prLinkedIssue.set(prNumber, issueNumber);
});

When(
  'the upgrade claim deps resolve the issue number for the branch {string} from that boundary',
  function (branchName: string) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    const tmp = mkdtempSync(path.join(tmpdir(), 'adw-820-claim-'));
    w.tempDirs.push(tmp);
    const deps = buildDefaultUpgradeClaimDeps(tmp, w.boundary.gitContext, w.boundary.providers.codeHost);
    const pr = deps.findPRByBranch(branchName);
    s.upgradeClaimIssueNumber = pr ? deps.resolveIssueNumberFromPR(pr.number) : null;
  },
);

Then('the resolved upgrade claim issue number is {int}', function (issueNumber: number) {
  assert.strictEqual(s.upgradeClaimIssueNumber, issueNumber);
});

Then('the boundary\'s code host was asked for the pull request on branch {string}', function (branchName: string) {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'findPullRequestByBranch' && c.args[0] === branchName);
  assert.ok(call, `Expected a findPullRequestByBranch call for branch "${branchName}"`);
});

// 'a state file for adw id {string} recording branch {string}' is already
// registered by feature-797.steps.ts — reused, not redefined here (its
// adwId is tracked for cleanup via the fixed FIXED_ADW_ID entry the After
// hook always sweeps, since that registration writes into feature-797's own
// world, not world796()).

When(
  'the pr-review orchestrator resolves its invocation for adw id {string} from that boundary',
  function (adwId: string) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    const boundary = w.boundary;
    s.prReviewInvocation = resolvePrReviewInvocation([String(0), adwId], {
      readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
      findPullRequestByBranch: (b) => boundary.providers.codeHost.findPullRequestByBranch(b),
      resolveSpawn: () => null,
    });
  },
);

Then('the resolved pr-review pull request number is {int}', function (prNumber: number) {
  assert.ok(s.prReviewInvocation, 'Expected the pr-review invocation to have been resolved');
  assert.strictEqual(s.prReviewInvocation!.kind, 'run');
  assert.strictEqual((s.prReviewInvocation as { kind: 'run'; prNumber: number }).prNumber, prNumber);
});

When(
  'the remote reconcile derives the stage for adw id {string} with the boundary\'s wiring',
  function (adwId: string) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    w.usedAdwIds.add(adwId);
    const deps = { ...buildDefaultReconcileDeps(w.boundary), branchExistsOnRemote: () => true };
    s.reconciledStage = deriveStageFromRemote(adwId, deps);
  },
);

Then('the reconciled stage is {string}', function (stage: string) {
  assert.strictEqual(s.reconciledStage, stage);
});

// ── §5 THE LABEL-OVERRIDE CHOKEPOINT ────────────────────────────────────────────

Given('issue {int} in the recording tracker carries the label {string}', function (issueNumber: number, label: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueLabels.set(issueNumber, [label]);
});

Given(
  'issue {int} in the recording tracker carries the labels {string} and {string}',
  function (issueNumber: number, label1: string, label2: string) {
    const w = world796();
    assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
    w.activeFixture.issueLabels.set(issueNumber, [label1, label2]);
  },
);

When('the trigger classifier classifies issue {int} from that boundary', async function (issueNumber: number) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const boundary = w.boundary;
  s.classifyWithCalled = false;
  s.classificationResult = await classifyIssueForTrigger(issueNumber, {
    fetchIssue: (n) => boundary.providers.issueTracker.fetchIssue(n),
    classifyWith: async () => {
      s.classifyWithCalled = true;
      return { issueType: '/feature', success: true };
    },
  });
});

Then('the classification is {string}', function (command: string) {
  assert.ok(s.classificationResult, 'Expected the trigger classifier to have run');
  assert.strictEqual(s.classificationResult!.issueType, command);
});

Then('the trigger classifier did not invoke the language model', function () {
  assert.strictEqual(s.classifyWithCalled, false);
});

Then('the trigger classifier invoked the language model', function () {
  assert.strictEqual(s.classifyWithCalled, true);
});

// ── §6 THE APPROVAL CAPABILITY GATE ─────────────────────────────────────────────

Given('the recording code host reports that it can approve pull requests', function () {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.canApprove = true;
});

Given('the recording code host reports that it cannot approve pull requests', function () {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.canApprove = false;
});

When('the review phase completes with no blocker issues for that configuration', async function () {
  const config = requireConfig();
  writeReviewPassManifest(config.worktreePath);
  activateClaudeCliStub();
  try {
    s.reviewPhaseResult = await executeReviewPhase(config, '');
  } finally {
    restoreClaudeCliStub();
  }
});

Then('the boundary\'s code host recorded an approval of pull request {int}', function (prNumber: number) {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'approvePullRequest' && c.args[0] === prNumber);
  assert.ok(call, `Expected an approvePullRequest call for pull request ${prNumber}`);
});

Then('the boundary\'s code host recorded no approval', function () {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'approvePullRequest');
  assert.strictEqual(call, undefined, 'Expected no approvePullRequest call to have been recorded');
});

Then('the review phase reported the review as passed', function () {
  assert.ok(s.reviewPhaseResult, 'Expected the review phase to have run');
  assert.strictEqual(s.reviewPhaseResult!.reviewPassed, true);
});

// ── §7 THE LABEL-WRITE POLICY ────────────────────────────────────────────────────
// unitTestPhase's warn-branch label write is re-composed here rather than driven
// through executeUnitTestPhase itself, which runs the real /test agent with
// retries and is not hermetically drivable — the same reasoning feature-770's
// step definitions document for the sibling verdict-to-comment mapping.

Given('the recording tracker has no {string} label defined', function (label: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.undefinedLabels.add(label);
});

When('the unit-test phase records an unverified verdict for that configuration', function () {
  const config = requireConfig();
  try {
    if (config.repoContext) {
      config.repoContext.issueTracker.applyLabel(config.issueNumber, ADW_UNVERIFIED_LABEL);
    }
  } catch {
    // Marking unverified is advisory metadata — non-fatal, mirrors unitTestPhase.ts.
  }
});

Then('the boundary\'s providers recorded the label {string} being created', function (label: string) {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'createLabel' && c.args[0] === label);
  assert.ok(call, `Expected a createLabel call for "${label}"`);
});

// ── §8 THE UNADDRESSED-COMMENT READ ─────────────────────────────────────────────

Given('pull request {int} in the recording code host is on branch {string}', function (prNumber: number, branchName: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  const existing = w.activeFixture.prByBranch.get(branchName);
  w.activeFixture.prByBranch.set(
    branchName,
    existing ?? { number: prNumber, state: 'OPEN', sourceBranch: branchName, targetBranch: 'main', labels: [] },
  );
});

Given('the branch {string} has its last ADW commit at {string}', function (branchName: string, iso: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.lastAdwCommit.set(branchName, new Date(iso));
});

Given('the branch {string} has no ADW commit', function (branchName: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.lastAdwCommit.set(branchName, null);
});

function pushReviewComment(prNumber: number, comment: ReviewComment): void {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  const list = w.activeFixture.prComments.get(prNumber) ?? [];
  list.push(comment);
  w.activeFixture.prComments.set(prNumber, list);
}

Given('pull request {int} has a human review comment {string} at {string}', function (prNumber: number, body: string, iso: string) {
  pushReviewComment(prNumber, { id: `c-${prNumber}-${body.length}-${iso}`, body, author: 'a-human', createdAt: iso });
});

Given(
  'pull request {int} has a review comment {string} from a {string} author at {string}',
  function (prNumber: number, body: string, kind: string, iso: string) {
    const id = `c-${prNumber}-${kind}-${iso}`;
    if (kind === 'bot') {
      pushReviewComment(prNumber, { id, body, author: 'dependabot[bot]', createdAt: iso, isBot: true });
    } else if (kind === 'self-reviewed') {
      const w = world796();
      assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
      w.activeFixture.authenticatedUser = 'adw-actor';
      pushReviewComment(prNumber, { id, body, author: 'adw-actor', createdAt: iso });
    } else if (kind === 'ADW-signed') {
      pushReviewComment(prNumber, { id, body: `${body}\n\n<!-- adw-bot -->`, author: 'a-human', createdAt: iso });
    } else {
      throw new Error(`Unknown review comment author kind: "${kind}"`);
    }
  },
);

When(
  'the pr-review workflow reads the unaddressed comments for pull request {int} from that boundary',
  function (prNumber: number) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
    const codeHost = w.boundary.providers.codeHost;
    const fixture = w.activeFixture;
    s.unaddressedComments = readUnaddressedComments(prNumber, {
      fetchPullRequest: (n) => codeHost.fetchPullRequest(n),
      fetchReviewComments: (n) => codeHost.fetchReviewComments(n),
      getAuthenticatedUser: () => codeHost.getAuthenticatedUser(),
      lastAdwCommitTimestamp: (branch) => fixture.lastAdwCommit.get(branch) ?? null,
    });
  },
);

Then('the unaddressed comments are exactly {string}', function (body: string) {
  assert.ok(s.unaddressedComments, 'Expected the unaddressed-comment read to have run');
  assert.strictEqual(s.unaddressedComments!.length, 1, `Expected exactly one unaddressed comment, got ${s.unaddressedComments!.length}`);
  assert.strictEqual(s.unaddressedComments![0].body, body);
});

Then('the unaddressed comments are empty', function () {
  assert.ok(s.unaddressedComments, 'Expected the unaddressed-comment read to have run');
  assert.strictEqual(s.unaddressedComments!.length, 0);
});

// ── §9 A FORGE THAT IS NOT GITHUB REFUSES BY NAME ──────────────────────────────

const REFUSAL_REPO_ID = { owner: 'acme', repo: 'widget', platform: Platform.GitLab };

function buildRefusalProvider(providerName: string): JiraIssueTracker | GitLabCodeHost {
  if (providerName === 'JiraIssueTracker') return new JiraIssueTracker({} as JiraApiClient, 'ADW');
  if (providerName === 'GitLabCodeHost') return new GitLabCodeHost(REFUSAL_REPO_ID, {} as GitLabApiClient);
  throw new Error(`Unknown refusal-stub provider: "${providerName}"`);
}

When('the {string} method is called on the {string} provider', function (method: string, providerName: string) {
  const target = buildRefusalProvider(providerName);
  s.refusalError = null;
  try {
    switch (method) {
      case 'getIssueTitle':
        (target as JiraIssueTracker).getIssueTitle();
        break;
      case 'canApprovePullRequests':
        (target as GitLabCodeHost).canApprovePullRequests();
        break;
      case 'getAuthenticatedUser':
        (target as GitLabCodeHost).getAuthenticatedUser();
        break;
      default:
        throw new Error(`Unknown refusal-stub method: "${method}"`);
    }
  } catch (err) {
    s.refusalError = err instanceof Error ? err : new Error(String(err));
  }
});

Then('it fails with a message naming {string}', function (qualifiedName: string) {
  assert.ok(s.refusalError, 'Expected the method call to throw');
  assert.ok(
    s.refusalError!.message.includes(`${qualifiedName} is not implemented`),
    `Expected a message naming "${qualifiedName}", got: ${s.refusalError!.message}`,
  );
});

// ── §10 WHAT DOES NOT MOVE + THE WONTFIX ESCAPE HATCH ──────────────────────────

Given('the configuration\'s issue carries the label {string}', function (label: string) {
  const config = requireConfig();
  (config.issue.labels as unknown as GitHubLabel[]).push({ id: label, name: label, color: 'ededed' });
});

When('the scenario phase runs for that configuration', async function () {
  const config = requireConfig();
  activateClaudeCliStub();
  try {
    s.scenarioPhaseResult = await executeScenarioPhase(config);
  } finally {
    restoreClaudeCliStub();
  }
});

Then('the scenario phase reported that it skipped scenario authoring', function () {
  assert.ok(s.scenarioPhaseResult, 'Expected the scenario phase to have run');
  assert.strictEqual(
    s.scenarioPhaseResult!.phaseCostRecords.length,
    0,
    'Expected no phase cost records when scenario authoring is skipped',
  );
});

Then('the boundary\'s providers recorded no forge call', function () {
  const w = world796();
  assert.strictEqual(
    w.activeCallLog.length,
    0,
    `Expected no recorded provider calls, got: ${w.activeCallLog.map((c: CallRecord) => c.operation).join(', ')}`,
  );
});

When(
  'the upgrade claim deps read the retirement state of the claim pull request for issue {int} from that boundary',
  function (_issueNumber: number) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    const tmp = mkdtempSync(path.join(tmpdir(), 'adw-820-claim-'));
    w.tempDirs.push(tmp);
    const deps = buildDefaultUpgradeClaimDeps(tmp, w.boundary.gitContext, w.boundary.providers.codeHost);
    const pr = deps.findPRByBranch(claimBranchName());
    s.retirementResult = pr ? hasWontFixLabelName(pr.labels) : false;
  },
);

Then('the claim pull request is reported retired', function () {
  assert.strictEqual(s.retirementResult, true);
});

Then('the boundary\'s code host was asked for the pull request on branch {string} exactly once', function (branchName: string) {
  const w = world796();
  const calls = w.activeCallLog.filter((c) => c.operation === 'findPullRequestByBranch' && c.args[0] === branchName);
  assert.strictEqual(calls.length, 1, `Expected exactly one findPullRequestByBranch("${branchName}") call, got ${calls.length}`);
});

// §11 reuses 'the git\/gh guard is run across the repository' / 'the git\/gh
// guard reports no violations' (feature-691.steps.ts), 'no GitHub provider was
// constructed during the phase' (feature-796.steps.ts, driven off
// w.autoMergeConfig — see buildWorkflowConfig above) and 'the ADW TypeScript
// type-check passes' (feature-504.steps.ts) — no new step definitions.
