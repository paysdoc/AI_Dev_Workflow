/**
 * BDD step definitions for feature-796.feature
 *
 * Orchestrators and phases reach the forge only through the providers the launch
 * boundary minted.
 *
 * §1  the merge orchestrator's forge traffic goes through the boundary
 * §2  the branch lookup must still see pull requests that are not open
 * §3  the upgrade orchestrator stops minting its own provider
 * §4  the auto-merge phase's two gates run on the repo context it was handed
 * §5  workflow init sources its providers from the boundary, always
 * §6  a repository that is not on GitHub needs no orchestrator change
 * §7  the wrong-repo invariant survives the migration
 * §8  the migration captures no credential at wiring time
 * §9  the structural backstops → feature-691.steps.ts (guard), feature-504.steps.ts (type-check)
 *
 * Driven through the boundary's existing injection seams (LaunchGitContextDeps,
 * `mintProviders`), exactly as feature-794.steps.ts drives it, plus the two exported
 * production deps-builders (`buildDefaultDeps`, `buildDefaultUpgradeDeps`) and the
 * exported `resolveWorkflowProviders` decision function this slice introduces.
 *
 * The fixture repository "adw-fixture/void-796" is never a real repository — every
 * `targetReposDir`/`frameworkRepoRoot` the boundary receives is a throwaway mkdtemp
 * directory, so a step that reaches an un-migrated git operation fails locally and
 * fast rather than making a real network call.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'node:url';

import { buildLaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import type { LaunchBoundary, LaunchGitContextDeps } from '../../../adws/core/launchGitContext.ts';
import type { MintProvidersOptions } from '../../../adws/providers/repoContext.ts';
import type {
  BoundProviders,
  RepoIdentifier,
  IssueTracker,
  CodeHost,
  BoardManager,
  IssueComment,
  PullRequestSummary,
} from '../../../adws/providers/types.ts';
import { Platform } from '../../../adws/providers/types.ts';
import { GitHubCodeHost } from '../../../adws/providers/github/githubCodeHost.ts';
import { GitHubIssueTracker } from '../../../adws/providers/github/githubIssueTracker.ts';

import { executeMerge, buildDefaultDeps } from '../../../adws/adwMerge.tsx';
import type { MergeDeps, MergeRunResult } from '../../../adws/adwMerge.tsx';
import { executeUpgrade, buildDefaultUpgradeDeps } from '../../../adws/adwUpgrade.tsx';
import type { UpgradeDeps, UpgradeRunResult } from '../../../adws/adwUpgrade.tsx';
import { executeAutoMergePhase } from '../../../adws/phases/autoMergePhase.ts';
import { resolveWorkflowProviders } from '../../../adws/phases/workflowInit.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { computeFrameworkHash } from '../../../adws/core/hashComputer.ts';
import { buildClaimBranchName } from '../../../adws/core/upgradeClaim.ts';
import { UPGRADE_FAILURE_SIGNATURE } from '../../../adws/core/upgradeFailureCap.ts';
import type { TargetRepoInfo } from '../../../adws/types/issueTypes.ts';
import type { GitContext, GitIdentity } from '../../../adws/gitContext/index.ts';

// ── The fixture repo's real filesystem home (never on disk as a git repo) ─────
const FRAMEWORK_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// ── World state ──────────────────────────────────────────────────────────────

interface CallRecord {
  operation: string;
  args: unknown[];
}

interface Fixture {
  prByBranch: Map<string, PullRequestSummary>;
  issueLabels: Map<number, string[]>;
  prApproval: Map<number, boolean>;
  issueComments: Map<number, IssueComment[]>;
  defaultBranch: string;
  nextPrNumber: number;
}

interface World796 {
  frameworkRoot: string;
  targetReposDir: string;
  tempDirs: string[];
  usedAdwIds: Set<string>;

  boundary: LaunchBoundary | null;
  watchedBoundary: LaunchBoundary | null;
  watchedGitContextLog: string[] | null;

  mintCallCount: number;
  mintedRepoId: RepoIdentifier | null;

  activeFixture: Fixture | null;
  activeCallLog: CallRecord[];

  remoteCallCount: number;
  remoteAnswer: { owner: string; repo: string } | null;
  tokenCallCount: number;

  mergeDeps: MergeDeps | null;
  mergeBranchName: string | undefined;
  mergeRetryCount: number;
  mergeResult: MergeRunResult | null;

  upgradeDeps: UpgradeDeps | null;
  upgradeResult: UpgradeRunResult | null;

  autoMergeConfig: WorkflowConfig | null;
  autoMergeRepoId: RepoIdentifier | null;

  resolveResult: { repoId: RepoIdentifier; providers: BoundProviders } | null;
  resolveError: Error | null;
}

const w: World796 = {
  frameworkRoot: '',
  targetReposDir: '',
  tempDirs: [],
  usedAdwIds: new Set(),
  boundary: null,
  watchedBoundary: null,
  watchedGitContextLog: null,
  mintCallCount: 0,
  mintedRepoId: null,
  activeFixture: null,
  activeCallLog: [],
  remoteCallCount: 0,
  remoteAnswer: null,
  tokenCallCount: 0,
  mergeDeps: null,
  mergeBranchName: undefined,
  mergeRetryCount: 0,
  mergeResult: null,
  upgradeDeps: null,
  upgradeResult: null,
  autoMergeConfig: null,
  autoMergeRepoId: null,
  resolveResult: null,
  resolveError: null,
};

function resetWorld(): void {
  w.frameworkRoot = '';
  w.targetReposDir = '';
  w.tempDirs = [];
  w.usedAdwIds = new Set();
  w.boundary = null;
  w.watchedBoundary = null;
  w.watchedGitContextLog = null;
  w.mintCallCount = 0;
  w.mintedRepoId = null;
  w.activeFixture = null;
  w.activeCallLog = [];
  w.remoteCallCount = 0;
  w.remoteAnswer = null;
  w.tokenCallCount = 0;
  w.mergeDeps = null;
  w.mergeBranchName = undefined;
  w.mergeRetryCount = 0;
  w.mergeResult = null;
  w.upgradeDeps = null;
  w.upgradeResult = null;
  w.autoMergeConfig = null;
  w.autoMergeRepoId = null;
  w.resolveResult = null;
  w.resolveError = null;
}

const AUTO_MERGE_ADW_ID = 'mk1wgc-void-automerge';

Before({ tags: '@adw-796' }, function () {
  resetWorld();
});

After({ tags: '@adw-796' }, function () {
  for (const dir of w.tempDirs) {
    if (dir && fs.existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  for (const adwId of w.usedAdwIds) {
    const agentsDir = path.join(AGENTS_STATE_DIR, adwId);
    if (fs.existsSync(agentsDir)) rmSync(agentsDir, { recursive: true, force: true });
    const logsDir = path.join(LOGS_DIR, adwId);
    if (fs.existsSync(logsDir)) rmSync(logsDir, { recursive: true, force: true });
  }
  resetWorld();
});

// ── Shared helpers ───────────────────────────────────────────────────────────

const FIXED_IDENTITY: GitIdentity = {
  authorName: 'ADW Test Bot',
  authorEmail: 'bot@test.dev',
  committerName: 'ADW Test Bot',
  committerEmail: 'bot@test.dev',
};

function makeTargetRepo(owner: string, repo: string): TargetRepoInfo {
  return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

function splitRepo(repoStr: string): { owner: string; repo: string } {
  const [owner, repo] = repoStr.split('/');
  return { owner, repo };
}

function makeFixture(): Fixture {
  return {
    prByBranch: new Map(),
    issueLabels: new Map(),
    prApproval: new Map(),
    issueComments: new Map(),
    defaultBranch: 'main',
    nextPrNumber: 100,
  };
}

/** The exact forge-semantic member set from AC1's sweep (gitContext.ts:492-742). */
const FORGE_SEMANTIC_METHODS = new Set([
  'defaultBranch', 'fetchIssue', 'commentOnIssue', 'issueState', 'closeIssue', 'issueTitle',
  'fetchIssueComments', 'issueHasLabel', 'addIssueLabel', 'createIssue', 'updateIssueBody',
  'findOpenUpgradeIssue', 'deleteIssueComment', 'listOpenIssues', 'issueComments', 'fetchMergedPRs',
  'authenticatedUser', 'findPRByBranch', 'fetchPRDetails', 'fetchPRReviews', 'fetchPRReviewComments',
  'commentOnPR', 'mergePR', 'approvePR', 'prApprovalState', 'fetchPRList', 'fetchAllPRs',
  'fetchPRChangedFiles', 'createPR', 'createLabel', 'applyLabel', 'setSecret', 'runGraphQL',
  'runGraphQLInput', 'moveIssueToStatus',
]);

/** Wraps a GitContext in a Proxy that logs access to any forge-semantic member; everything else forwards silently. */
function watchGitContext(real: GitContext, log: string[]): GitContext {
  return new Proxy(real as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && FORGE_SEMANTIC_METHODS.has(prop)) {
        log.push(prop);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as GitContext;
}

/** A gitContext-shaped stub for scenarios with no real GitContext to watch (auto-merge phase config). */
function makeStubGitContext(): GitContext {
  const stub: Record<string, unknown> = {};
  for (const name of FORGE_SEMANTIC_METHODS) {
    stub[name] = () => {
      throw new Error(`unexpected forge-semantic call on watched stub git context: ${name}`);
    };
  }
  return stub as unknown as GitContext;
}

function record(callLog: CallRecord[], operation: string, ...args: unknown[]): void {
  callLog.push({ operation, args });
}

function makeRecordingIssueTracker(fixture: Fixture, callLog: CallRecord[]): IssueTracker {
  return {
    async fetchIssue(issueNumber) {
      record(callLog, 'fetchIssue', issueNumber);
      return {
        id: String(issueNumber), number: issueNumber, title: '', body: '', state: 'open',
        author: '', labels: fixture.issueLabels.get(issueNumber) ?? [], comments: [],
      };
    },
    commentOnIssue(issueNumber, body) {
      record(callLog, 'commentOnIssue', issueNumber, body);
    },
    deleteComment(commentId) {
      record(callLog, 'deleteComment', commentId);
    },
    async closeIssue(issueNumber, comment) {
      record(callLog, 'closeIssue', issueNumber, comment);
      return true;
    },
    getIssueState(issueNumber) {
      record(callLog, 'getIssueState', issueNumber);
      return 'open';
    },
    fetchComments(issueNumber) {
      record(callLog, 'fetchComments', issueNumber);
      return fixture.issueComments.get(issueNumber) ?? [];
    },
    async moveToStatus(issueNumber, status) {
      record(callLog, 'moveToStatus', issueNumber, status);
      return true;
    },
    fetchLabels(issueNumber) {
      record(callLog, 'fetchLabels', issueNumber);
      return fixture.issueLabels.get(issueNumber) ?? [];
    },
    addLabel(issueNumber, labelName) {
      record(callLog, 'addLabel', issueNumber, labelName);
      const labels = fixture.issueLabels.get(issueNumber) ?? [];
      if (!labels.includes(labelName)) fixture.issueLabels.set(issueNumber, [...labels, labelName]);
    },
    applyLabel(issueNumber, labelName) {
      record(callLog, 'applyLabel', issueNumber, labelName);
      const labels = fixture.issueLabels.get(issueNumber) ?? [];
      if (!labels.includes(labelName)) fixture.issueLabels.set(issueNumber, [...labels, labelName]);
    },
    ensureLabel(name, color, description) {
      record(callLog, 'ensureLabel', name, color, description);
    },
    createIssue(title, body) {
      record(callLog, 'createIssue', title, body);
      return 9999;
    },
    updateIssueBody(issueNumber, body) {
      record(callLog, 'updateIssueBody', issueNumber, body);
    },
    searchOpenIssues(search, limit) {
      record(callLog, 'searchOpenIssues', search, limit);
      return [];
    },
    findOpenUpgradeIssue() {
      record(callLog, 'findOpenUpgradeIssue');
      return null;
    },
    listIssues(query) {
      record(callLog, 'listIssues', query);
      return [];
    },
  };
}

function makeRecordingCodeHost(fixture: Fixture, callLog: CallRecord[], repoId: RepoIdentifier): CodeHost {
  return {
    getDefaultBranch() {
      record(callLog, 'getDefaultBranch');
      return fixture.defaultBranch;
    },
    createPullRequest(options) {
      record(callLog, 'createPullRequest', options);
      const number = fixture.nextPrNumber++;
      return { url: `https://github.com/${repoId.owner}/${repoId.repo}/pull/${number}`, number };
    },
    fetchPullRequest(prNumber) {
      record(callLog, 'fetchPullRequest', prNumber);
      return { number: prNumber, title: '', body: '', sourceBranch: '', targetBranch: '', url: '' };
    },
    commentOnPullRequest(prNumber, body) {
      record(callLog, 'commentOnPullRequest', prNumber, body);
    },
    fetchReviewComments(prNumber) {
      record(callLog, 'fetchReviewComments', prNumber);
      return [];
    },
    listOpenPullRequests() {
      record(callLog, 'listOpenPullRequests');
      return [];
    },
    getRepoIdentifier() {
      record(callLog, 'getRepoIdentifier');
      return repoId;
    },
    findPullRequestByBranch(branchName) {
      record(callLog, 'findPullRequestByBranch', branchName);
      return fixture.prByBranch.get(branchName) ?? null;
    },
    isPullRequestApproved(prNumber) {
      record(callLog, 'isPullRequestApproved', prNumber);
      return fixture.prApproval.get(prNumber) ?? false;
    },
    approvePullRequest(prNumber) {
      record(callLog, 'approvePullRequest', prNumber);
      return { success: true };
    },
    mergePullRequest(prNumber) {
      record(callLog, 'mergePullRequest', prNumber);
      return { success: true };
    },
    setSecret(name, value) {
      record(callLog, 'setSecret', name, value);
    },
    listMergedPullRequests(limit) {
      record(callLog, 'listMergedPullRequests', limit);
      return [];
    },
  };
}

function makeRecordingBoardManager(callLog: CallRecord[]): BoardManager {
  return {
    async findBoard() {
      record(callLog, 'findBoard');
      return null;
    },
    async createBoard(name) {
      record(callLog, 'createBoard', name);
      return 'board-1';
    },
    async ensureColumns(boardId) {
      record(callLog, 'ensureColumns', boardId);
      return true;
    },
  };
}

function makeRecordingProviders(fixture: Fixture, callLog: CallRecord[], repoId: RepoIdentifier): BoundProviders {
  return {
    issueTracker: makeRecordingIssueTracker(fixture, callLog),
    codeHost: makeRecordingCodeHost(fixture, callLog, repoId),
    boardManager: makeRecordingBoardManager(callLog),
  };
}

/** Builds a launch boundary whose minted providers are this file's recording stand-ins. */
function buildRecordingBoundary(owner: string, repo: string): void {
  w.frameworkRoot = mkdtempSync(path.join(tmpdir(), 'adw-796-framework-'));
  w.targetReposDir = mkdtempSync(path.join(tmpdir(), 'adw-796-target-repos-'));
  w.tempDirs.push(w.frameworkRoot, w.targetReposDir);
  w.activeFixture = makeFixture();
  w.activeCallLog = [];
  const deps: LaunchGitContextDeps = {
    getRepoInfo: () => {
      w.remoteCallCount += 1;
      if (!w.remoteAnswer) throw new Error('local git remote not configured for this scenario');
      return w.remoteAnswer;
    },
    resolveToken: () => {
      w.tokenCallCount += 1;
      return 'test-sentinel-token';
    },
    resolveGitIdentity: () => FIXED_IDENTITY,
    frameworkRepoRoot: w.frameworkRoot,
    targetReposDir: w.targetReposDir,
    mintProviders: (options: MintProvidersOptions): BoundProviders => {
      w.mintCallCount += 1;
      w.mintedRepoId = options.repoId;
      return makeRecordingProviders(w.activeFixture!, w.activeCallLog, options.repoId);
    },
  };
  w.boundary = buildLaunchBoundary(makeTargetRepo(owner, repo), deps);
}

let cachedClaimBranch: string | null = null;

/** The real upgrade claim branch for THIS repo's actual framework state — deterministic per run. */
function claimBranchName(): string {
  if (!cachedClaimBranch) {
    cachedClaimBranch = buildClaimBranchName(computeFrameworkHash(FRAMEWORK_REPO_ROOT));
  }
  return cachedClaimBranch;
}

function stubRegenDeps(worktreePath: string): Pick<
  UpgradeDeps,
  'ensureWorktree' | 'reconcileWorktreeToRemote' | 'runInitCommand' | 'copyInitCommandToWorktree'
  | 'verifyAdwRegen' | 'copyStarterSettings' | 'writeAdwVersion' | 'commitChanges' | 'pushBranch' | 'isPushRejection'
> {
  return {
    ensureWorktree: () => worktreePath,
    reconcileWorktreeToRemote: () => {},
    runInitCommand: async () => ({ success: true }),
    copyInitCommandToWorktree: () => {},
    verifyAdwRegen: () => ({ ok: true, missing: [] }),
    copyStarterSettings: () => ({ action: 'skipped', destPath: '' }),
    writeAdwVersion: () => {},
    commitChanges: () => true,
    pushBranch: () => {},
    isPushRejection: () => false,
  };
}

function assertCommentRecorded(issueNumber: number): CallRecord {
  const call = w.activeCallLog.find(c => c.operation === 'commentOnIssue' && c.args[0] === issueNumber);
  assert.ok(call, `Expected a commentOnIssue call for issue ${issueNumber} in the recorded call log`);
  return call!;
}

function assertNoCommentRecorded(): void {
  const call = w.activeCallLog.find(c => c.operation === 'commentOnIssue');
  assert.strictEqual(call, undefined, 'Expected no commentOnIssue call to have been recorded');
}

function assertLabelApplied(issueNumber: number, label: string): void {
  const call = w.activeCallLog.find(
    c => (c.operation === 'applyLabel' || c.operation === 'addLabel') && c.args[0] === issueNumber && c.args[1] === label,
  );
  assert.ok(call, `Expected label "${label}" to have been applied to issue ${issueNumber}`);
}

function assertNoLabelApplied(issueNumber: number): void {
  const call = w.activeCallLog.find(
    c => (c.operation === 'applyLabel' || c.operation === 'addLabel') && c.args[0] === issueNumber,
  );
  assert.strictEqual(call, undefined, `Expected no label to have been applied to issue ${issueNumber}`);
}

function assertLabelsAsked(issueNumber: number): void {
  const call = w.activeCallLog.find(c => c.operation === 'fetchLabels' && c.args[0] === issueNumber);
  assert.ok(call, `Expected a fetchLabels call for issue ${issueNumber}`);
}

function assertApprovalAsked(prNumber: number): void {
  const call = w.activeCallLog.find(c => c.operation === 'isPullRequestApproved' && c.args[0] === prNumber);
  assert.ok(call, `Expected an isPullRequestApproved call for pull request ${prNumber}`);
}

// ── §1/§3/§6/§7 setup — the recording boundary ─────────────────────────────────

Given('a launch boundary for the repository {string} whose providers record every call', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  buildRecordingBoundary(owner, repo);
});

Given(
  'a launch boundary for the repository {string} whose providers are a recording tracker that is not GitHub',
  function (repoStr: string) {
    const { owner, repo } = splitRepo(repoStr);
    buildRecordingBoundary(owner, repo);
  },
);

Given('the local git remote answers {string}', function (repoStr: string) {
  w.remoteAnswer = splitRepo(repoStr);
});

// ── §1/§3/§4 — watching the git context for forge-semantic calls ──────────────

Given('the boundary\'s git context is watched for forge-semantic calls', function () {
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  w.watchedGitContextLog = [];
  w.watchedBoundary = {
    gitContext: watchGitContext(w.boundary.gitContext, w.watchedGitContextLog),
    repoId: w.boundary.repoId,
    providers: w.boundary.providers,
  };
});

Given('the configuration\'s git context is watched for forge-semantic calls', function () {
  assert.ok(w.autoMergeConfig, 'Expected an auto-merge phase configuration to have been built');
  w.watchedGitContextLog = [];
  w.autoMergeConfig.gitContext = watchGitContext(makeStubGitContext(), w.watchedGitContextLog);
});

Then('the watched git context was asked for no forge-semantic operation', function () {
  assert.ok(w.watchedGitContextLog, 'Expected a watched git context to have been configured');
  assert.strictEqual(
    w.watchedGitContextLog.length, 0,
    `Expected no forge-semantic access on the watched git context, got: ${w.watchedGitContextLog.join(', ')}`,
  );
});

// ── §1/§8 — building the merge orchestrator's production dependencies ─────────

Given('the merge orchestrator\'s production dependencies are built from that boundary', function () {
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const effective = w.watchedBoundary ?? w.boundary;
  w.mergeDeps = buildDefaultDeps(effective);
});

// ── §3 — building the upgrade orchestrator's production dependencies ──────────

Given('the upgrade orchestrator\'s production dependencies are built from that boundary', function () {
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const effective = w.watchedBoundary ?? w.boundary;
  w.upgradeDeps = buildDefaultUpgradeDeps(effective.providers, effective.gitContext);
});

// ── §1/§2 — branch/PR fixtures (literal branch name) ───────────────────────────

Given('the branch {string} has a pull request numbered {int} in state {string}', function (branchName: string, prNumber: number, state: string) {
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.mergeBranchName = branchName;
  w.activeFixture.prByBranch.set(branchName, { number: prNumber, state, sourceBranch: branchName, targetBranch: 'main', labels: [] });
});

/**
 * "the branch {string} has no pull request" is already registered by
 * feature-527.steps.ts (G20, mock-server PR fixture setup — a no-op there when
 * `this.mockContext` is unset, which is always true for this file's scenarios).
 * Re-registering the identical phrase here would be an AmbiguousStepDefinition,
 * so feature-527's handler calls this exported hook instead of feature-796
 * registering a second, colliding Given.
 */
export function noteBranchHasNoPullRequest(branchName: string): void {
  if (!w.activeFixture) return;
  w.mergeBranchName = branchName;
  w.activeFixture.prByBranch.delete(branchName);
}

Given('the merge orchestrator has already failed to resolve a pull request {int} times', function (count: number) {
  w.mergeRetryCount = count;
});

// ── §2/§3 — claim-branch PR fixtures (computed branch name) ────────────────────

Given('the claim branch for issue {int} has no pull request', function (_issueNumber: number) {
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.prByBranch.delete(claimBranchName());
});

Given(
  'the claim branch for issue {int} has a pull request numbered {int} in state {string} labelled {string}',
  function (_issueNumber: number, prNumber: number, state: string, label: string) {
    assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
    const branch = claimBranchName();
    w.activeFixture.prByBranch.set(branch, { number: prNumber, state, sourceBranch: branch, targetBranch: 'main', labels: [label] });
  },
);

// ── §1/§3/§4 — label/approval/comment fixtures ─────────────────────────────────

Given('issue {int} carries the label {string}', function (issueNumber: number, label: string) {
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueLabels.set(issueNumber, [label]);
});

Given('issue {int} carries no labels', function (issueNumber: number) {
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueLabels.set(issueNumber, []);
});

Given('pull request {int} has no approving review', function (prNumber: number) {
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.prApproval.set(prNumber, false);
});

Given('pull request {int} has an approving review', function (prNumber: number) {
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.prApproval.set(prNumber, true);
});

Given('issue {int} carries {int} recorded upgrade failure comments', function (issueNumber: number, count: number) {
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  const comments: IssueComment[] = Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    body: `${UPGRADE_FAILURE_SIGNATURE}\n\nsimulated failure ${i}`,
    author: 'adw-bot[bot]',
    createdAt: new Date(0).toISOString(),
  }));
  w.activeFixture.issueComments.set(issueNumber, comments);
});

// ── §3 — regeneration succeeds without touching real git/LLM ──────────────────

Given('the upgrade regeneration produces a committed change', function () {
  assert.ok(w.upgradeDeps, 'Expected upgrade orchestrator dependencies to have been built first');
  const fakeWorktree = mkdtempSync(path.join(tmpdir(), 'adw-796-worktree-'));
  w.tempDirs.push(fakeWorktree);
  w.upgradeDeps = { ...w.upgradeDeps, ...stubRegenDeps(fakeWorktree) };
});

// ── §4/§6/§7 — auto-merge phase configuration ──────────────────────────────────

Given('an auto-merge phase configuration for issue {int} whose pull request is {int}', function (issueNumber: number, prNumber: number) {
  const repoId: RepoIdentifier = { owner: 'adw-fixture', repo: 'void-796', platform: Platform.GitHub };
  w.autoMergeRepoId = repoId;
  const logsDir = mkdtempSync(path.join(tmpdir(), 'adw-796-logs-'));
  w.tempDirs.push(logsDir);
  const branchName = 'feature-issue-42-void';
  w.autoMergeConfig = {
    issueNumber,
    adwId: AUTO_MERGE_ADW_ID,
    worktreePath: '/tmp/adw-796-fixture-worktree',
    defaultBranch: 'main',
    logsDir,
    ctx: {
      issueNumber,
      adwId: AUTO_MERGE_ADW_ID,
      prUrl: `https://github.com/${repoId.owner}/${repoId.repo}/pull/${prNumber}`,
      branchName,
    },
    branchName,
    repoContext: undefined,
    gitContext: undefined,
  } as unknown as WorkflowConfig;
});

function buildAutoMergeProviders(): void {
  assert.ok(w.autoMergeConfig, 'Expected an auto-merge phase configuration to have been built first');
  assert.ok(w.autoMergeRepoId, 'Expected an auto-merge phase configuration to have been built first');
  w.activeFixture = makeFixture();
  w.activeCallLog = [];
  const providers = makeRecordingProviders(w.activeFixture, w.activeCallLog, w.autoMergeRepoId);
  w.autoMergeConfig.repoContext = { ...providers, cwd: w.autoMergeConfig.worktreePath, repoId: w.autoMergeRepoId };
}

Given('the configuration\'s providers record every call', function () {
  buildAutoMergeProviders();
});

Given('the configuration is served by a recording tracker that is not GitHub', function () {
  buildAutoMergeProviders();
});

// ── §8 — credential counting ────────────────────────────────────────────────────

Given('the boundary resolves credentials through a counting credential source', function () {
  // resolveToken (wired in buildRecordingBoundary) always counts; reset here for a clean read.
  w.tokenCallCount = 0;
});

Then('the counting credential source was never asked', function () {
  assert.strictEqual(w.tokenCallCount, 0, `Expected the credential source never to be asked, got ${w.tokenCallCount} call(s)`);
});

// ── §5 — workflow init provider sourcing ────────────────────────────────────────

When('workflow init resolves its providers from that boundary with no caller-supplied identity', function () {
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  w.resolveResult = null;
  w.resolveError = null;
  try {
    w.resolveResult = resolveWorkflowProviders(w.boundary);
  } catch (err) {
    w.resolveError = err instanceof Error ? err : new Error(String(err));
  }
});

When('workflow init resolves its providers from that boundary with the caller-supplied identity {string}', function (repoStr: string) {
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const { owner, repo } = splitRepo(repoStr);
  w.resolveResult = null;
  w.resolveError = null;
  try {
    w.resolveResult = resolveWorkflowProviders(w.boundary, { owner, repo, platform: Platform.GitHub });
  } catch (err) {
    w.resolveError = err instanceof Error ? err : new Error(String(err));
  }
});

Then('workflow init received the very issue tracker and code host the boundary minted', function () {
  assert.ok(w.resolveResult, 'Expected resolveWorkflowProviders to succeed');
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  assert.strictEqual(w.resolveResult.providers.issueTracker, w.boundary.providers.issueTracker);
  assert.strictEqual(w.resolveResult.providers.codeHost, w.boundary.providers.codeHost);
});

Then('workflow init read no repository identity of its own', function () {
  assert.strictEqual(w.remoteCallCount, 0, `Expected zero reads of the local git remote, got ${w.remoteCallCount}`);
});

Then('resolving workflow init\'s providers failed naming both repositories', function () {
  assert.ok(w.resolveError, 'Expected resolveWorkflowProviders to throw on a contradicting identity');
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const msg = w.resolveError.message;
  assert.ok(
    msg.includes(w.boundary.repoId.owner) && msg.includes(w.boundary.repoId.repo),
    `Expected the error to name the boundary's repository, got: ${msg}`,
  );
  assert.ok(
    msg.includes('other-fixture') && msg.includes('void-796'),
    `Expected the error to name the caller-supplied repository, got: ${msg}`,
  );
});

Then('no issue tracker was constructed outside the launch boundary', function () {
  // resolveWorkflowProviders throws before ever reading boundary.providers on a mismatch —
  // the boundary's own lazy mint never fires either, so the count must stay at zero.
  assert.strictEqual(w.mintCallCount, 0, `Expected no provider construction at all, got ${w.mintCallCount} mint(s)`);
});

// ── When — running the orchestrators / phase ────────────────────────────────────

When('the merge orchestrator runs for issue {int} under adw id {string}', async function (issueNumber: number, adwId: string) {
  assert.ok(w.mergeDeps, 'Expected the merge orchestrator\'s production dependencies to have been built first');
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  w.usedAdwIds.add(adwId);
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber,
    workflowStage: 'awaiting_merge',
    branchName: w.mergeBranchName,
    mergeRetryCount: w.mergeRetryCount,
  });
  const repoInfo = { owner: w.boundary.repoId.owner, repo: w.boundary.repoId.repo };
  w.mergeResult = await executeMerge(issueNumber, adwId, repoInfo, '/tmp/adw-796-base-repo', w.mergeDeps);
});

When('the upgrade orchestrator runs for issue {int} under adw id {string}', async function (issueNumber: number, adwId: string) {
  assert.ok(w.upgradeDeps, 'Expected the upgrade orchestrator\'s production dependencies to have been built first');
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  w.usedAdwIds.add(adwId);
  const repoInfo = { owner: w.boundary.repoId.owner, repo: w.boundary.repoId.repo };
  w.upgradeResult = await executeUpgrade(issueNumber, adwId, repoInfo, '/tmp/adw-796-base-repo', FRAMEWORK_REPO_ROOT, w.upgradeDeps);
});

When('the auto-merge phase runs', async function () {
  assert.ok(w.autoMergeConfig, 'Expected an auto-merge phase configuration to have been built');
  await executeAutoMergePhase(w.autoMergeConfig);
});

// ── §1/§2 — merge/upgrade outcome assertions ────────────────────────────────────

Then('the merge orchestrator reports the outcome {string} for reason {string}', function (outcome: string, reason: string) {
  assert.ok(w.mergeResult, 'Expected the merge orchestrator to have run');
  assert.strictEqual(w.mergeResult.outcome, outcome);
  assert.strictEqual(w.mergeResult.reason, reason);
});

Then('the merge orchestrator did not defer for human review', function () {
  assert.ok(w.mergeResult, 'Expected the merge orchestrator to have run');
  assert.notStrictEqual(w.mergeResult.reason, 'hitl_blocked_unapproved');
});

Then('the upgrade orchestrator reports the outcome {string}', function (outcome: string) {
  assert.ok(w.upgradeResult, 'Expected the upgrade orchestrator to have run');
  assert.strictEqual(w.upgradeResult.outcome, outcome);
});

Then('the upgrade orchestrator did not stop on an existing pull request', function () {
  assert.ok(w.upgradeResult, 'Expected the upgrade orchestrator to have run');
  assert.notStrictEqual(w.upgradeResult.reason, 'pr_already_exists');
});

// ── Comment assertions (shared across boundary/configuration/non-GitHub phrasing) ─

Then('the boundary\'s issue tracker recorded a comment on issue {int}', function (issueNumber: number) {
  assertCommentRecorded(issueNumber);
});

Then('the configuration\'s providers recorded a comment on issue {int}', function (issueNumber: number) {
  assertCommentRecorded(issueNumber);
});

Then('the non-GitHub tracker recorded a comment on issue {int}', function (issueNumber: number) {
  assertCommentRecorded(issueNumber);
});

Then('the recorded comment on issue {int} contains {string}', function (issueNumber: number, text: string) {
  const call = assertCommentRecorded(issueNumber);
  const body = call.args[1] as string;
  assert.ok(body.includes(text), `Expected the recorded comment to contain "${text}", got: ${body}`);
});

Then('the boundary\'s issue tracker recorded no comment', function () {
  assertNoCommentRecorded();
});

Then('the configuration\'s providers recorded no comment', function () {
  assertNoCommentRecorded();
});

// ── Label assertions ─────────────────────────────────────────────────────────────

Then('the boundary\'s providers recorded the label {string} applied to issue {int}', function (label: string, issueNumber: number) {
  assertLabelApplied(issueNumber, label);
});

Then('the configuration\'s providers recorded the label {string} applied to issue {int}', function (label: string, issueNumber: number) {
  assertLabelApplied(issueNumber, label);
});

Then('the non-GitHub tracker recorded the label {string} applied to issue {int}', function (label: string, issueNumber: number) {
  assertLabelApplied(issueNumber, label);
});

Then('the boundary\'s providers recorded no label applied to issue {int}', function (issueNumber: number) {
  assertNoLabelApplied(issueNumber);
});

Then('the configuration\'s providers recorded no label applied to issue {int}', function (issueNumber: number) {
  assertNoLabelApplied(issueNumber);
});

// ── Label/approval read assertions ────────────────────────────────────────────────

Then('the boundary\'s providers were asked for the labels on issue {int}', function (issueNumber: number) {
  assertLabelsAsked(issueNumber);
});

Then('the configuration\'s providers were asked for the labels on issue {int}', function (issueNumber: number) {
  assertLabelsAsked(issueNumber);
});

Then('the boundary\'s providers were asked for the approval on pull request {int}', function (prNumber: number) {
  assertApprovalAsked(prNumber);
});

Then('the configuration\'s providers were asked for the approval on pull request {int}', function (prNumber: number) {
  assertApprovalAsked(prNumber);
});

// ── §3 — upgrade PR/comment/board assertions ──────────────────────────────────────

Then('the boundary\'s code host created exactly one pull request', function () {
  const calls = w.activeCallLog.filter(c => c.operation === 'createPullRequest');
  assert.strictEqual(calls.length, 1, `Expected exactly one createPullRequest call, got ${calls.length}`);
});

Then('no code host was constructed outside the launch boundary', function () {
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  assert.ok(
    !(w.boundary.providers.codeHost instanceof GitHubCodeHost),
    'Expected the code host in use not to be a GitHubCodeHost instance constructed outside the boundary',
  );
});

Then('the boundary\'s providers were asked for the comments on issue {int}', function (issueNumber: number) {
  const call = w.activeCallLog.find(c => c.operation === 'fetchComments' && c.args[0] === issueNumber);
  assert.ok(call, `Expected a fetchComments call for issue ${issueNumber}`);
});

Then('the boundary\'s providers recorded issue {int} moved to {string}', function (issueNumber: number, status: string) {
  const call = w.activeCallLog.find(c => c.operation === 'moveToStatus' && c.args[0] === issueNumber && c.args[1] === status);
  assert.ok(call, `Expected issue ${issueNumber} to have been moved to "${status}"`);
});

// ── §6 — non-GitHub tracker / no GitHub provider constructed ──────────────────────

Then('no GitHub provider was constructed during the phase', function () {
  assert.ok(w.autoMergeConfig?.repoContext, 'Expected the auto-merge configuration to carry a repo context');
  const rc = w.autoMergeConfig.repoContext;
  assert.ok(!(rc.issueTracker instanceof GitHubIssueTracker), 'Expected the issue tracker not to be a GitHubIssueTracker instance');
  assert.ok(!(rc.codeHost instanceof GitHubCodeHost), 'Expected the code host not to be a GitHubCodeHost instance');
});

Then('no GitHub provider was constructed during the run', function () {
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  assert.ok(
    !(w.boundary.providers.issueTracker instanceof GitHubIssueTracker),
    'Expected the issue tracker not to be a GitHubIssueTracker instance',
  );
  assert.ok(
    !(w.boundary.providers.codeHost instanceof GitHubCodeHost),
    'Expected the code host not to be a GitHubCodeHost instance',
  );
});

// ── §7 — wrong-repo invariant ──────────────────────────────────────────────────────

Then('every recorded provider call addressed the repository {string}', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  assert.ok(w.mintedRepoId, 'Expected a provider set to have been minted');
  assert.strictEqual(w.mintedRepoId.owner, owner, 'Expected the minted provider set to be bound to the expected owner');
  assert.strictEqual(w.mintedRepoId.repo, repo, 'Expected the minted provider set to be bound to the expected repo');
  assert.ok(w.activeCallLog.length > 0, 'Expected at least one recorded provider call');
});

Then('the local git remote was never read', function () {
  assert.strictEqual(w.remoteCallCount, 0, `Expected zero reads of the local git remote, got ${w.remoteCallCount}`);
});

Then('every recorded provider call about a pull request named pull request {int}', function (prNumber: number) {
  const prScopedOps = new Set(['isPullRequestApproved', 'commentOnPullRequest', 'mergePullRequest', 'approvePullRequest', 'fetchPullRequest']);
  const calls = w.activeCallLog.filter(c => prScopedOps.has(c.operation));
  assert.ok(calls.length > 0, 'Expected at least one pull-request-scoped provider call to have been recorded');
  for (const call of calls) {
    assert.strictEqual(
      call.args[0], prNumber,
      `Expected call "${call.operation}" to address pull request ${prNumber}, got ${String(call.args[0])}`,
    );
  }
});

// §9 reuses 'the git/gh guard is run across the repository' / 'the git/gh guard reports
// no violations' (feature-691.steps.ts) and 'the ADW TypeScript type-check passes'
// (feature-504.steps.ts) — no new step definitions.
