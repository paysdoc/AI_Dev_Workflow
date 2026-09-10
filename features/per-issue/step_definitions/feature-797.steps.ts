/**
 * Step definitions for feature-797.feature
 *
 * §1  the core package stands alone (a real `cp -R` copy-and-import, and a
 *     runtime member-shape probe over `gitContextSharedWorld.ts`'s `W`)
 * §2  the cron's open-issue listing is served by the issue tracker
 * §3  the sweeps ask questions the open-only ports cannot answer
 * §4  the stage readers must still see pull requests that are not open
 * §5  comment handling keeps its exact words and its exact order
 * §6  a repository that has never been cloned
 * §7  same commands, same repos, same place they run from (the recording
 *     `exec` seam, via `gitContextSharedWorld.ts`)
 * §8  the structural backstops → feature-691.steps.ts (guard),
 *     feature-504.steps.ts (type-check), plus one new stale-entry check here
 *
 * §2-§6 share ONE "world": `bw` (boundary world). Its Given —
 * "the repository {string} is launched with recording providers" — builds a
 * REAL `LaunchBoundary` via the production `buildLaunchBoundary`, injecting
 * `forgeProviders` so `.providers` resolves to this file's own recording
 * `IssueTracker`/`CodeHost` stand-ins (a fixture-backed fake, never a hand-typed
 * deps bag) and wrapping `.gitContext` in a forge-semantic-access watcher
 * (this file's own copy of feature-796's Proxy pattern, one step further:
 * membership, not just calls, for §1's second scenario). Deliberately does
 * NOT reuse feature-796.steps.ts's near-identical "a launch boundary … whose
 * providers record every call" — that Given's stand-ins log calls but answer
 * none of the listings, merged-PR lookups, or default-branch reads §2-§6
 * depend on.
 *
 * The boundary's `GitContext` targets a REAL git repository (bare origin +
 * clone, seeded once per scenario) at `targetReposDir/adw-fixture/void-797`,
 * because `buildLaunchBoundary` never accepts an injected `exec` — only a
 * real spawn reaches its `GitContext`. §3's sweep-persist row and §4's
 * ls-remote row need real git plumbing; the other §2-§6 rows never touch
 * `.gitContext` beyond the (always-empty) forge-semantic watch log.
 *
 * §7 is a DIFFERENT world entirely — no boundary, no providers, just a raw
 * `GitContext` built with a recording `exec` stub via `gitContextSharedWorld.ts`
 * (`makeSpyExec`/`makeFullOptions`), reused verbatim from the shared module
 * feature-659.steps.ts/feature-691.steps.ts already share (that file's
 * untagged `After` hook resets `W`, so this file adds none of its own).
 *
 * Every scenario targets the deliberately non-existent "adw-fixture/void-797".
 *
 * Registered phrases reused (not redefined here):
 *  - Given 'the ADW codebase is checked out'            → ensureCronOnEveryEventSteps.ts
 *  - When  'the git/gh guard is run across the repository' → feature-691.steps.ts
 *  - Then  'the git/gh guard reports no violations'      → feature-691.steps.ts
 *  - Then  'the ADW TypeScript type-check passes'        → feature-504.steps.ts
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, copyFileSync,
  type Dirent,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GitContext } from '../../../adws/gitContext/index.ts';
import { ensureRepoWorkspace } from '../../../adws/gitContext/index.ts';
import { createGhRepoApi } from '../../../adws/providers/github/ghRepoApi.ts';
import { createLiteralTokenProvider } from '../../../adws/providers/github/githubTokenProvider.ts';
import {
  type BoundProviders,
  type IssueTracker,
  type CodeHost,
  type IssueComment,
  type IssueListEntry,
  type IssueListQuery,
  type MergedPullRequestRecord,
  type PullRequestSummary,
  type RepoIdentifier,
} from '../../../adws/providers/types.ts';
import { buildLaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import type { LaunchBoundary, LaunchGitContextDeps } from '../../../adws/core/launchGitContext.ts';
import type { ForgeProvidersOptions } from '../../../adws/providers/forgeProviders.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import type { WorkflowStage } from '../../../adws/types/workflowTypes.ts';
import { ADW_SIGNATURE_PATTERN } from '../../../adws/core/workflowCommentParsing.ts';

import { listCronOpenIssues, type RawIssue } from '../../../adws/triggers/cronIssueListing.ts';
import { evaluateIssue, type CronIssue } from '../../../adws/triggers/cronIssueFilter.ts';
import { runPromotionSweep, type PromotionSweepReport } from '../../../adws/triggers/promotionSweep.ts';
import type { ScenariosPaths } from '../../../adws/triggers/promotionSweepDefaults.ts';
import { defaultGetMergedAt } from '../../../adws/triggers/perIssueScenarioSweep.ts';
import { prepareSweepBase, persistRemovalViaPr } from '../../../adws/triggers/perIssueSweepPersist.ts';
import { buildDefaultReconcileDeps, deriveStageFromRemote } from '../../../adws/core/remoteReconcile.ts';
import { postIssueStageComment } from '../../../adws/phases/phaseCommentHelpers.ts';
import { formatWorkflowComment, type WorkflowContext } from '../../../adws/forge/workflowCommentsIssue.ts';
import { buildDefaultTakeoverDeps } from '../../../adws/triggers/takeoverHandler.ts';

import { scanFiles, collectTsFiles } from '../../../adws/checkGitGhGuard.ts';
import { hasGuardedConstruction, findStaleSanctionedEntries } from '../../../adws/guard/constructionRule.ts';
import * as ts from 'typescript';

import { W, makeSpyExec, makeFullOptions, makeNoOpFsDeps } from './gitContextSharedWorld.ts';

// ── Shared constants ─────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GITCONTEXT_SRC = path.join(REPO_ROOT, 'adws', 'gitContext');

const FIXED_IDENTITY = {
  authorName: 'ADW Test Bot', authorEmail: 'bot@test-797.dev',
  committerName: 'ADW Test Bot', committerEmail: 'bot@test-797.dev',
};

const SENTINEL_TOKEN = 'sentinel-797-token-xyz';

/** The exact forge-semantic member set AC1 removes from GitContext (gitContext.ts's former ~lines 333-788). */
const FORGE_SEMANTIC_METHODS = new Set([
  'defaultBranch', 'fetchIssue', 'commentOnIssue', 'issueState', 'closeIssue', 'issueTitle',
  'fetchIssueComments', 'issueHasLabel', 'issueLabels', 'addIssueLabel', 'createIssue', 'updateIssueBody',
  'findOpenUpgradeIssue', 'deleteIssueComment', 'listOpenIssues', 'issueComments', 'fetchMergedPRs',
  'authenticatedUser', 'findPRByBranch', 'fetchPRDetails', 'fetchPRReviews', 'fetchPRReviewComments',
  'commentOnPR', 'mergePR', 'approvePR', 'prApprovalState', 'fetchPRList', 'fetchAllPRs',
  'fetchPRChangedFiles', 'createPR', 'createLabel', 'applyLabel', 'setSecret', 'runGraphQL',
  'runGraphQLInput', 'moveIssueToStatus',
]);

/** A representative sample of the surviving public API — git, worktree, workspace, executor. */
const SURVIVING_METHODS = [
  'exec', 'commandEnv', 'getCurrentBranch', 'createWorktreeForNewBranch', 'pushBranch',
  'lsFiles', 'lsRemote', 'remoteUrl',
];

function splitRepo(repoStr: string): { owner: string; repo: string } {
  const [owner, repo] = repoStr.split('/');
  return { owner, repo };
}

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/** Wraps a GitContext in a Proxy that logs access to any forge-semantic member; everything else forwards silently. */
function watchGitContext(real: GitContext, log: string[]): GitContext {
  return new Proxy(real as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && FORGE_SEMANTIC_METHODS.has(prop)) log.push(prop);
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as GitContext;
}

// ── §1.1 — package isolation world ───────────────────────────────────────────

interface Wcopy {
  tempDir: string | null;
  importError: Error | null;
  imported: boolean;
}
const wc: Wcopy = { tempDir: null, importError: null, imported: false };

function copyDirEntry(entry: Dirent, src: string, dest: string, excludeDirNames: ReadonlySet<string>): void {
  const srcPath = path.join(src, entry.name);
  const destPath = path.join(dest, entry.name);
  if (entry.isFile()) {
    copyFileSync(srcPath, destPath);
    return;
  }
  if (!entry.isDirectory() || excludeDirNames.has(entry.name)) return;
  copyDirExcluding(srcPath, destPath, excludeDirNames);
}

function copyDirExcluding(src: string, dest: string, excludeDirNames: ReadonlySet<string>): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    copyDirEntry(entry, src, dest, excludeDirNames);
  }
}

// ── §2-§6 — the recording-providers boundary world ───────────────────────────

interface CallRecord { op: string; args: unknown[] }

interface IssueFixtureEntry {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  labels: { name: string }[];
  comments: IssueComment[];
  createdAt: string;
  updatedAt: string;
}

interface Fixture797 {
  issues: Map<number, IssueFixtureEntry>;
  mergedPRs: MergedPullRequestRecord[];
  prByBranch: Map<string, PullRequestSummary>;
  defaultBranch: string;
  nextIssueNumber: number;
  nextPrNumber: number;
}

function makeFixture(): Fixture797 {
  return {
    issues: new Map(), mergedPRs: [], prByBranch: new Map(),
    defaultBranch: 'main', nextIssueNumber: 5000, nextPrNumber: 5000,
  };
}

function matchesState(entry: IssueFixtureEntry, state: IssueListQuery['state']): boolean {
  const effective = state ?? 'open';
  if (effective === 'all') return true;
  return entry.state === effective.toUpperCase();
}

function projectIssue(entry: IssueFixtureEntry): IssueListEntry {
  return {
    number: entry.number, title: entry.title, body: entry.body, state: entry.state,
    labels: entry.labels, comments: entry.comments.map((c) => ({ body: c.body })),
    createdAt: entry.createdAt, updatedAt: entry.updatedAt,
  };
}

function makeRecordingIssueTracker(fixture: Fixture797, callLog: CallRecord[]): IssueTracker {
  return {
    async fetchIssue(issueNumber) {
      callLog.push({ op: 'fetchIssue', args: [issueNumber] });
      const e = fixture.issues.get(issueNumber);
      return {
        id: String(issueNumber), number: issueNumber, title: e?.title ?? '', body: e?.body ?? '',
        state: e?.state ?? 'OPEN', author: '', labels: (e?.labels ?? []).map((l) => l.name), comments: [],
      };
    },
    commentOnIssue(issueNumber, body) {
      callLog.push({ op: 'commentOnIssue', args: [issueNumber, body] });
    },
    deleteComment(commentId) {
      callLog.push({ op: 'deleteComment', args: [commentId] });
    },
    async closeIssue(issueNumber) {
      callLog.push({ op: 'closeIssue', args: [issueNumber] });
      return true;
    },
    getIssueState(issueNumber) {
      callLog.push({ op: 'getIssueState', args: [issueNumber] });
      return fixture.issues.get(issueNumber)?.state ?? 'OPEN';
    },
    fetchComments(issueNumber) {
      callLog.push({ op: 'fetchComments', args: [issueNumber] });
      return fixture.issues.get(issueNumber)?.comments ?? [];
    },
    async moveToStatus(issueNumber, status) {
      callLog.push({ op: 'moveToStatus', args: [issueNumber, status] });
      return true;
    },
    fetchLabels(issueNumber) {
      callLog.push({ op: 'fetchLabels', args: [issueNumber] });
      return (fixture.issues.get(issueNumber)?.labels ?? []).map((l) => l.name);
    },
    addLabel(issueNumber, labelName) {
      callLog.push({ op: 'addLabel', args: [issueNumber, labelName] });
    },
    applyLabel(issueNumber, labelName) {
      callLog.push({ op: 'applyLabel', args: [issueNumber, labelName] });
    },
    ensureLabel(name, color, description) {
      callLog.push({ op: 'ensureLabel', args: [name, color, description] });
    },
    createIssue(title, body) {
      callLog.push({ op: 'createIssue', args: [title, body] });
      const number = fixture.nextIssueNumber++;
      fixture.issues.set(number, {
        number, title, body, state: 'OPEN', labels: [], comments: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      return number;
    },
    updateIssueBody(issueNumber, body) {
      callLog.push({ op: 'updateIssueBody', args: [issueNumber, body] });
    },
    searchOpenIssues(search, limit) {
      callLog.push({ op: 'searchOpenIssues', args: [search, limit] });
      return [];
    },
    findOpenUpgradeIssue() {
      callLog.push({ op: 'findOpenUpgradeIssue', args: [] });
      return null;
    },
    listIssues(query) {
      callLog.push({ op: 'listIssues', args: [query] });
      return [...fixture.issues.values()].filter((e) => matchesState(e, query.state)).map(projectIssue);
    },
    getIssueTitle(issueNumber) {
      callLog.push({ op: 'getIssueTitle', args: [issueNumber] });
      return fixture.issues.get(issueNumber)?.title ?? '(unknown)';
    },
  };
}

function makeRecordingCodeHost(fixture: Fixture797, callLog: CallRecord[], repoId: RepoIdentifier): CodeHost {
  return {
    getDefaultBranch() {
      callLog.push({ op: 'getDefaultBranch', args: [] });
      return fixture.defaultBranch;
    },
    createPullRequest(options) {
      callLog.push({ op: 'createPullRequest', args: [options] });
      const number = fixture.nextPrNumber++;
      fixture.prByBranch.set(options.sourceBranch, {
        number, state: 'OPEN', sourceBranch: options.sourceBranch, targetBranch: options.targetBranch, labels: [],
      });
      return { url: `https://github.com/${repoId.owner}/${repoId.repo}/pull/${number}`, number };
    },
    fetchPullRequest(prNumber) {
      callLog.push({ op: 'fetchPullRequest', args: [prNumber] });
      return { number: prNumber, title: '', body: '', sourceBranch: '', targetBranch: '', url: '', state: 'OPEN' };
    },
    commentOnPullRequest(prNumber, body) {
      callLog.push({ op: 'commentOnPullRequest', args: [prNumber, body] });
    },
    fetchReviewComments(prNumber) {
      callLog.push({ op: 'fetchReviewComments', args: [prNumber] });
      return [];
    },
    listOpenPullRequests() {
      callLog.push({ op: 'listOpenPullRequests', args: [] });
      return [];
    },
    getRepoIdentifier() {
      callLog.push({ op: 'getRepoIdentifier', args: [] });
      return repoId;
    },
    findPullRequestByBranch(branchName) {
      callLog.push({ op: 'findPullRequestByBranch', args: [branchName] });
      return fixture.prByBranch.get(branchName) ?? null;
    },
    isPullRequestApproved(prNumber) {
      callLog.push({ op: 'isPullRequestApproved', args: [prNumber] });
      return false;
    },
    approvePullRequest(prNumber) {
      callLog.push({ op: 'approvePullRequest', args: [prNumber] });
      return { success: true };
    },
    mergePullRequest(prNumber) {
      callLog.push({ op: 'mergePullRequest', args: [prNumber] });
      return { success: true };
    },
    setSecret(name, value) {
      callLog.push({ op: 'setSecret', args: [name, value] });
    },
    listMergedPullRequests(limit) {
      callLog.push({ op: 'listMergedPullRequests', args: [limit] });
      return fixture.mergedPRs;
    },
    listPullRequests() {
      callLog.push({ op: 'listPullRequests', args: [] });
      return [];
    },
    getAuthenticatedUser() {
      callLog.push({ op: 'getAuthenticatedUser', args: [] });
      return null;
    },
    canApprovePullRequests() {
      callLog.push({ op: 'canApprovePullRequests', args: [] });
      return false;
    },
  };
}

interface Wboundary {
  targetReposDir: string | null;
  bareRemote: string | null;
  frameworkRoot: string | null;
  ensureTargetReposDir: string | null;
  boundaryWorkdir: string | null;
  removableFeaturePath: string | null;
  boundary: LaunchBoundary | null;
  fixture: Fixture797 | null;
  callLog: CallRecord[];
  gitContextLog: string[];
  mintCallCount: number;
  usedAdwIds: Set<string>;
  tempDirs: string[];

  // Per-scenario result slots
  cronListingResult: RawIssue[] | null;
  promotionReport: PromotionSweepReport | null;
  fakeFeaturePath: string | null;
  fakeFeatureContent: string | null;
  expectedMergedAt: string | null;
  resolvedMergedAt: Date | null;
  derivedStage: WorkflowStage | null;
  lastStage: string | null;
  lastWorkflowContext: WorkflowContext | null;
  resolvedAdwId: string | null;
  resolvedDefaultBranchFromEnsure: string | null;
  ensureError: Error | null;
}

const bw: Wboundary = {
  targetReposDir: null, bareRemote: null, frameworkRoot: null, ensureTargetReposDir: null,
  boundaryWorkdir: null, removableFeaturePath: null, boundary: null, fixture: null,
  callLog: [], gitContextLog: [], mintCallCount: 0, usedAdwIds: new Set(), tempDirs: [],
  cronListingResult: null, promotionReport: null, fakeFeaturePath: null, fakeFeatureContent: null,
  expectedMergedAt: null, resolvedMergedAt: null, derivedStage: null, lastStage: null,
  lastWorkflowContext: null, resolvedAdwId: null, resolvedDefaultBranchFromEnsure: null, ensureError: null,
};

function resetBw(): void {
  bw.targetReposDir = null; bw.bareRemote = null; bw.frameworkRoot = null; bw.ensureTargetReposDir = null;
  bw.boundaryWorkdir = null; bw.removableFeaturePath = null; bw.boundary = null; bw.fixture = null;
  bw.callLog = []; bw.gitContextLog = []; bw.mintCallCount = 0; bw.usedAdwIds = new Set(); bw.tempDirs = [];
  bw.cronListingResult = null; bw.promotionReport = null; bw.fakeFeaturePath = null; bw.fakeFeatureContent = null;
  bw.expectedMergedAt = null; bw.resolvedMergedAt = null; bw.derivedStage = null; bw.lastStage = null;
  bw.lastWorkflowContext = null; bw.resolvedAdwId = null; bw.resolvedDefaultBranchFromEnsure = null; bw.ensureError = null;
}

/** Seeds a real bare origin + clone at targetReposDir/owner/repo, on a branch literally named "main". */
function seedRealBoundaryRepo(targetReposDir: string, owner: string, repo: string): { bareRemote: string; workdir: string } {
  const bareRemote = mkdtempSync(path.join(tmpdir(), 'adw-797-bare-'));
  git('git init --bare', bareRemote);
  git('git symbolic-ref HEAD refs/heads/main', bareRemote);

  const workdir = path.join(targetReposDir, owner, repo);
  mkdirSync(workdir, { recursive: true });
  git(`git clone "${bareRemote}" .`, workdir);
  git('git config user.email "adw-797@test.local"', workdir);
  git('git config user.name "ADW Test 797"', workdir);

  mkdirSync(path.join(workdir, 'features', 'per-issue'), { recursive: true });
  const removableRel = 'features/per-issue/feature-999-removable.feature';
  writeFileSync(
    path.join(workdir, removableRel),
    'Feature: removable fixture\n\n  Scenario: placeholder\n    Given a thing\n',
  );
  writeFileSync(path.join(workdir, 'README.md'), '# fixture repo\n');
  git('git add -A', workdir);
  git('git commit -m "seed fixture repo"', workdir);
  git('git push -u origin main', workdir);

  bw.removableFeaturePath = removableRel;
  return { bareRemote, workdir };
}

/** `forgeProviders` seam for the recording boundary — counts the call and hands back this file's recording tracker/host over `bw.fixture`. */
function mintRecordingProviders(options: ForgeProvidersOptions): BoundProviders {
  bw.mintCallCount += 1;
  assert.ok(bw.fixture, 'Expected a fixture to have been created before minting providers');
  return {
    issueTracker: makeRecordingIssueTracker(bw.fixture, bw.callLog),
    codeHost: makeRecordingCodeHost(bw.fixture, bw.callLog, options.identity),
  };
}

function buildRecordingBoundary(owner: string, repo: string): void {
  bw.targetReposDir = mkdtempSync(path.join(tmpdir(), 'adw-797-target-root-'));
  bw.frameworkRoot = mkdtempSync(path.join(tmpdir(), 'adw-797-framework-'));
  bw.ensureTargetReposDir = mkdtempSync(path.join(tmpdir(), 'adw-797-ensure-root-'));
  bw.tempDirs.push(bw.targetReposDir, bw.frameworkRoot, bw.ensureTargetReposDir);

  const { bareRemote, workdir } = seedRealBoundaryRepo(bw.targetReposDir, owner, repo);
  bw.bareRemote = bareRemote;
  bw.boundaryWorkdir = workdir;
  bw.tempDirs.push(bareRemote);

  bw.fixture = makeFixture();
  bw.callLog = [];
  bw.gitContextLog = [];
  bw.mintCallCount = 0;

  const deps: LaunchGitContextDeps = {
    getRepoInfo: () => { throw new Error('buildRecordingBoundary: getRepoInfo should never be called for a target repo'); },
    tokenProvider: createLiteralTokenProvider(SENTINEL_TOKEN),
    resolveGitIdentity: () => FIXED_IDENTITY,
    frameworkRepoRoot: bw.frameworkRoot,
    targetReposDir: bw.targetReposDir,
    forgeProviders: mintRecordingProviders,
  };

  const raw = buildLaunchBoundary({ owner, repo, cloneUrl: `https://example.invalid/${owner}/${repo}.git` }, deps);
  bw.boundary = {
    gitContext: watchGitContext(raw.gitContext, bw.gitContextLog),
    repoId: raw.repoId,
    get providers(): BoundProviders { return raw.providers; },
  };
}

function requireBoundary(): LaunchBoundary {
  assert.ok(bw.boundary, 'Expected a launch boundary to have been built first');
  return bw.boundary;
}

// ── §7 — the recording-exec world (gitContextSharedWorld.ts's W) ────────────

interface W7 { result: string | null }
const w7: W7 = { result: null };

const CRON_ISSUE_FIELDS = ['number', 'title', 'body', 'comments', 'createdAt', 'updatedAt', 'labels'] as const;

// ── Before / After ────────────────────────────────────────────────────────────

Before({ tags: '@adw-797' }, function () {
  resetBw();
  wc.tempDir = null; wc.importError = null; wc.imported = false;
  w7.result = null;
});

After({ tags: '@adw-797' }, function () {
  if (wc.tempDir && existsSync(wc.tempDir)) rmSync(wc.tempDir, { recursive: true, force: true });
  for (const dir of bw.tempDirs) {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  for (const adwId of bw.usedAdwIds) {
    const agentsDir = path.join(AGENTS_STATE_DIR, adwId);
    if (existsSync(agentsDir)) rmSync(agentsDir, { recursive: true, force: true });
    const logsDir = path.join(LOGS_DIR, adwId);
    if (existsSync(logsDir)) rmSync(logsDir, { recursive: true, force: true });
  }
  resetBw();
  wc.tempDir = null; wc.importError = null; wc.imported = false;
  w7.result = null;
});

// ── §1.1 — package isolation ──────────────────────────────────────────────────

Given('the git context package is copied on its own into an empty directory', function () {
  const parent = mkdtempSync(path.join(tmpdir(), 'adw-797-isolated-'));
  wc.tempDir = parent;
  copyDirExcluding(GITCONTEXT_SRC, path.join(parent, 'gitContext'), new Set(['__tests__']));
});

When('the copied git context package is imported as its own entry point', async function () {
  assert.ok(wc.tempDir, 'Expected the package to have been copied first');
  const entryUrl = pathToFileURL(path.join(wc.tempDir, 'gitContext', 'index.ts')).href;
  try {
    await import(entryUrl);
    wc.imported = true;
    wc.importError = null;
  } catch (err) {
    wc.imported = false;
    wc.importError = err as Error;
  }
});

Then('the import of the copied package succeeds', function () {
  assert.strictEqual(
    wc.importError, null,
    `Expected the copied package to import cleanly, got: ${wc.importError?.stack ?? wc.importError}`,
  );
  assert.strictEqual(wc.imported, true);
});

Then('the copied package resolved no module outside its own directory', function () {
  assert.strictEqual(wc.importError, null, 'Expected no import error (a reach outside the copy would fail to resolve)');
  assert.ok(wc.tempDir, 'Expected a temp directory to have been set up');
  const topLevel = readdirSync(wc.tempDir);
  assert.deepStrictEqual(
    topLevel, ['gitContext'],
    `Expected only the copied gitContext package on disk, found: ${topLevel.join(', ')}`,
  );
});

// ── §1.2 — the member-shape probe ─────────────────────────────────────────────

Given('a git context constructed over a recording command executor', function () {
  const { exec, calls } = makeSpyExec(new Map());
  W.ctx = new GitContext(
    makeFullOptions('adw-fixture', 'void-797', SENTINEL_TOKEN, FIXED_IDENTITY.authorName, FIXED_IDENTITY.authorEmail),
    { exec, fsDeps: makeNoOpFsDeps() },
  );
  W.spyCalls = calls;
});

Then('the git context exposes no forge-semantic operation', function () {
  assert.ok(W.ctx, 'Expected a git context to have been constructed');
  const present = [...FORGE_SEMANTIC_METHODS].filter((name) => (W.ctx as unknown as Record<string, unknown>)[name] !== undefined);
  assert.deepStrictEqual(present, [], `Expected no forge-semantic members, found: ${present.join(', ')}`);
});

Then('the git context still exposes its git, worktree, workspace and executor operations', function () {
  assert.ok(W.ctx, 'Expected a git context to have been constructed');
  const missing = SURVIVING_METHODS.filter((name) => typeof (W.ctx as unknown as Record<string, unknown>)[name] !== 'function');
  assert.deepStrictEqual(missing, [], `Expected these to remain functions: ${missing.join(', ')}`);
});

// ── §2-§6 — the recording-providers boundary ──────────────────────────────────

Given('the repository {string} is launched with recording providers', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  buildRecordingBoundary(owner, repo);
});

Then('the git context was asked for no forge-semantic operation', function () {
  assert.strictEqual(
    bw.gitContextLog.length, 0,
    `Expected no forge-semantic access on the boundary's git context, got: ${bw.gitContextLog.join(', ')}`,
  );
});

// ── §2 — cron open-issue listing ──────────────────────────────────────────────

Given('the recording issue tracker holds an open issue {int}', function (issueNumber: number) {
  assert.ok(bw.fixture, 'Expected a boundary to have been built first');
  bw.fixture.issues.set(issueNumber, {
    number: issueNumber, title: '', body: '', state: 'OPEN', labels: [], comments: [],
    createdAt: new Date(Date.now() - 60_000).toISOString(), updatedAt: new Date(Date.now() - 60_000).toISOString(),
  });
});

Given(
  'the recording issue tracker holds an open issue {int} carrying the label {string}, a body, an adw-id comment and a creation timestamp',
  function (issueNumber: number, label: string) {
    assert.ok(bw.fixture, 'Expected a boundary to have been built first');
    const oldIso = new Date(Date.now() - 60_000).toISOString();
    bw.fixture.issues.set(issueNumber, {
      number: issueNumber,
      title: 'fixture issue',
      body: 'some fixture body text',
      state: 'OPEN',
      labels: [{ name: label }],
      comments: [{ id: 'c1', body: '**ADW ID:** `qnr31u-void-cron-797`', author: 'adw-bot', createdAt: oldIso }],
      createdAt: oldIso,
      updatedAt: oldIso,
    });
  },
);

When('the cron\'s open-issue listing runs from that boundary', function () {
  const boundary = requireBoundary();
  bw.cronListingResult = listCronOpenIssues(boundary.providers.issueTracker);
});

Then('the recording issue tracker recorded an open-issue listing for {string}', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  const boundary = requireBoundary();
  assert.strictEqual(boundary.repoId.owner, owner);
  assert.strictEqual(boundary.repoId.repo, repo);
  assert.ok(bw.callLog.some((c) => c.op === 'listIssues'), 'Expected a listIssues call to have been recorded');
});

Then('the cron evaluates issue {int} as eligible', function (issueNumber: number) {
  assert.ok(bw.cronListingResult, 'Expected the cron listing to have run first');
  const issue = bw.cronListingResult.find((i) => i.number === issueNumber);
  assert.ok(issue, `Expected issue ${issueNumber} in the cron listing`);
  const result = evaluateIssue(issue as unknown as CronIssue, Date.now(), { spawns: new Set() }, 0);
  assert.strictEqual(result.eligible, true, `Expected issue ${issueNumber} to be eligible, got: ${JSON.stringify(result)}`);
});

Then('the listed issue {int} carries its body, its comments, its labels and its timestamps', function (issueNumber: number) {
  assert.ok(bw.cronListingResult, 'Expected the cron listing to have run first');
  const issue = bw.cronListingResult.find((i) => i.number === issueNumber);
  assert.ok(issue, `Expected issue ${issueNumber} in the cron listing`);
  assert.ok(issue.body && issue.body.length > 0, 'Expected a non-empty body');
  assert.ok(issue.comments.length > 0, 'Expected at least one comment');
  assert.ok(issue.labels.length > 0, 'Expected at least one label');
  assert.ok(issue.createdAt, 'Expected a createdAt timestamp');
  assert.ok(issue.updatedAt, 'Expected an updatedAt timestamp');
});

// ── §3 — the sweeps ────────────────────────────────────────────────────────────

Given('a per-issue scenario file for issue {int} tagged as promotion-suggested', function (issueNumber: number) {
  bw.fakeFeaturePath = `features/per-issue/feature-${issueNumber}.feature`;
  bw.fakeFeatureContent = [
    '@promotion-suggested-2026-01-01',
    `Feature: fixture for issue ${issueNumber}`,
    '',
    '  Scenario: fixture scenario',
    '    Given a fixture step',
    '',
  ].join('\n');
});

Given('the recording issue tracker holds a closed promotion-tracking issue for issue {int}', function (issueNumber: number) {
  assert.ok(bw.fixture, 'Expected a boundary to have been built first');
  const trackerNumber = 9000 + issueNumber;
  bw.fixture.issues.set(trackerNumber, {
    number: trackerNumber,
    title: `Promote feature-${issueNumber}`,
    body: `Promotes: feature-${issueNumber}\n\nClosed without merging.`,
    state: 'CLOSED',
    labels: [],
    comments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

When('the promotion sweep tick runs from that boundary', async function () {
  const boundary = requireBoundary();
  const scenariosConfig: ScenariosPaths = {
    perIssueDir: 'features/per-issue', regressionDir: 'features/regression/', vocabPath: 'features/regression/vocabulary.md',
  };
  bw.promotionReport = await runPromotionSweep({
    boundary,
    now: () => new Date('2026-06-01T00:00:00Z'),
    listPerIssueFeatures: () => (bw.fakeFeaturePath ? [bw.fakeFeaturePath] : []),
    readFeatureContent: (filePath: string) => (filePath === bw.fakeFeaturePath ? bw.fakeFeatureContent : null),
    listStepDefSiblings: () => [],
    loadVocabulary: () => '',
    loadStats: () => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 }),
    scenariosConfig,
    tagAndCommit: () => { /* git-persistence mechanics are out of scope for this scenario */ },
    log: () => { /* keep test output quiet */ },
  });
});

Then('the promotion sweep decided {string} for issue {int}', function (action: string, issueNumber: number) {
  assert.ok(bw.promotionReport, 'Expected the promotion sweep to have run');
  const featurePath = `features/per-issue/feature-${issueNumber}.feature`;
  const bucket = (bw.promotionReport as unknown as Record<string, string[]>)[
    action === 'decline' ? 'declined' : action
  ];
  assert.ok(bucket?.includes(featurePath), `Expected ${featurePath} in report.${action === 'decline' ? 'declined' : action}, got: ${JSON.stringify(bw.promotionReport)}`);
});

Then('the recording issue tracker recorded no issue creation', function () {
  assert.strictEqual(
    bw.callLog.some((c) => c.op === 'createIssue'), false,
    'Expected no createIssue call to have been recorded',
  );
});

Given('the recording code host holds a merged pull request {int} whose body closes issue {int}', function (_prNumber: number, issueNumber: number) {
  assert.ok(bw.fixture, 'Expected a boundary to have been built first');
  bw.expectedMergedAt = '2026-01-10T12:00:00.000Z';
  bw.fixture.mergedPRs.push({ body: `Closes #${issueNumber}`, mergedAt: bw.expectedMergedAt });
});

When('the per-issue scenario sweep resolves the merge date for issue {int}', async function (issueNumber: number) {
  const boundary = requireBoundary();
  bw.resolvedMergedAt = await defaultGetMergedAt(boundary.providers.codeHost, issueNumber);
});

Then('the resolved merge date is the merge date of pull request {int}', function (_prNumber: number) {
  assert.ok(bw.expectedMergedAt, 'Expected a fixture merged-at date to have been configured');
  assert.ok(bw.resolvedMergedAt, 'Expected a resolved merge date');
  assert.strictEqual(bw.resolvedMergedAt.toISOString(), new Date(bw.expectedMergedAt).toISOString());
});

Given('the recording code host reports the default branch {string}', function (branch: string) {
  assert.ok(bw.fixture, 'Expected a boundary to have been built first');
  bw.fixture.defaultBranch = branch;
});

When('the per-issue sweep persists a removal batch from that boundary', async function () {
  const boundary = requireBoundary();
  const base = prepareSweepBase(boundary);
  assert.ok(base, 'Expected prepareSweepBase to succeed against the seeded fixture repo');
  assert.ok(bw.removableFeaturePath, 'Expected a removable fixture file to have been seeded');
  await persistRemovalViaPr([bw.removableFeaturePath], base);
});

Then('the recording code host recorded exactly one pull request creation', function () {
  const creations = bw.callLog.filter((c) => c.op === 'createPullRequest');
  assert.strictEqual(creations.length, 1, `Expected exactly one createPullRequest call, got ${creations.length}`);
});

Then('the recording code host was asked for the default branch', function () {
  assert.ok(bw.callLog.some((c) => c.op === 'getDefaultBranch'), 'Expected a getDefaultBranch call to have been recorded');
});

// ── §4 — remote reconcile ──────────────────────────────────────────────────────

Given('a state file for adw id {string} recording branch {string}', function (adwId: string, branchName: string) {
  AgentStateManager.writeTopLevelState(adwId, { branchName });
  bw.usedAdwIds.add(adwId);
});

Given('the recording code host holds a pull request {int} on branch {string} in state {string}', function (
  prNumber: number, branchName: string, state: string,
) {
  assert.ok(bw.fixture, 'Expected a boundary to have been built first');
  assert.ok(bw.boundaryWorkdir, 'Expected a seeded fixture repo');
  bw.fixture.prByBranch.set(branchName, {
    number: prNumber, state, sourceBranch: branchName, targetBranch: bw.fixture.defaultBranch, labels: [],
  });
  // Real ls-remote target: push a same-tip branch to the real bare origin.
  git(`git push origin main:refs/heads/${branchName}`, bw.boundaryWorkdir);
});

When('the remote reconcile derives the stage for adw id {string} from that boundary', function (adwId: string) {
  const boundary = requireBoundary();
  const deps = buildDefaultReconcileDeps(boundary);
  bw.derivedStage = deriveStageFromRemote(adwId, deps);
});

Then('the derived stage is {string}', function (stage: string) {
  assert.strictEqual(bw.derivedStage, stage);
});

Then('the recording code host was asked for the pull request on branch {string} at least {int} times', function (
  branchName: string, minTimes: number,
) {
  const count = bw.callLog.filter((c) => c.op === 'findPullRequestByBranch' && c.args[0] === branchName).length;
  assert.ok(count >= minTimes, `Expected at least ${minTimes} findPullRequestByBranch("${branchName}") calls, got ${count}`);
});

// ── §5 — comment handling ──────────────────────────────────────────────────────

When('the workflow stage comment for stage {string} is posted for issue {int} from that boundary', function (
  stage: string, issueNumber: number,
) {
  const boundary = requireBoundary();
  const wfCtx: WorkflowContext = { issueNumber, adwId: 'qnr31u-void-comment' };
  bw.lastStage = stage;
  bw.lastWorkflowContext = wfCtx;
  postIssueStageComment(boundary.providers, issueNumber, stage as WorkflowStage, wfCtx);
});

function lastCommentOn(issueNumber: number): CallRecord {
  const calls = bw.callLog.filter((c) => c.op === 'commentOnIssue' && c.args[0] === issueNumber);
  assert.ok(calls.length > 0, `Expected a commentOnIssue call for issue ${issueNumber}`);
  return calls[calls.length - 1];
}

Then('the recording issue tracker recorded a comment on issue {int}', function (issueNumber: number) {
  lastCommentOn(issueNumber);
});

Then('the recorded comment on issue {int} carries the ADW signature', function (issueNumber: number) {
  const call = lastCommentOn(issueNumber);
  const body = call.args[1] as string;
  assert.ok(ADW_SIGNATURE_PATTERN.test(body), `Expected the ADW signature marker in: ${body}`);
});

Then('the recorded comment on issue {int} is the body the stage {string} formats today', function (
  issueNumber: number, stage: string,
) {
  const call = lastCommentOn(issueNumber);
  const body = call.args[1] as string;
  assert.ok(bw.lastWorkflowContext, 'Expected a workflow context to have been captured');
  assert.strictEqual(bw.lastStage, stage);
  const expected = formatWorkflowComment(stage as WorkflowStage, bw.lastWorkflowContext);
  assert.strictEqual(body, expected);
});

Given('issue {int} carries an adw-id comment for {string} followed by one for {string}', function (
  issueNumber: number, oldId: string, newId: string,
) {
  assert.ok(bw.fixture, 'Expected a boundary to have been built first');
  const now = new Date().toISOString();
  bw.fixture.issues.set(issueNumber, {
    number: issueNumber, title: '', body: '', state: 'OPEN', labels: [],
    comments: [
      { id: 'c1', body: `**ADW ID:** \`${oldId}\``, author: 'adw-bot', createdAt: now },
      { id: 'c2', body: `**ADW ID:** \`${newId}\``, author: 'adw-bot', createdAt: now },
    ],
    createdAt: now, updatedAt: now,
  });
});

When('the takeover handler resolves the adw id for issue {int} from that boundary', function (issueNumber: number) {
  const boundary = requireBoundary();
  const deps = buildDefaultTakeoverDeps(boundary);
  bw.resolvedAdwId = deps.resolveAdwId(issueNumber, boundary.repoId);
});

Then('the resolved adw id is {string}', function (adwId: string) {
  assert.strictEqual(bw.resolvedAdwId, adwId);
});

// ── §6 — a repository that has never been cloned ─────────────────────────────

Given('the workspace directory for {string} is already cloned', function (repoStr: string) {
  assert.ok(bw.ensureTargetReposDir, 'Expected a boundary to have been built first');
  const { owner, repo } = splitRepo(repoStr);
  mkdirSync(path.join(bw.ensureTargetReposDir, owner, repo, '.git'), { recursive: true });
});

Given('the workspace directory for {string} does not exist', function (repoStr: string) {
  if (!bw.ensureTargetReposDir) return; // §7's world: FRAMEWORK_ROOT/TARGET_REPOS_ROOT are already fixed non-existent fakes.
  const { owner, repo } = splitRepo(repoStr);
  const p = path.join(bw.ensureTargetReposDir, owner, repo);
  assert.ok(!existsSync(p), `Expected ${p} not to exist`);
});

/** `ensureRepoWorkspace`'s `getDefaultBranch` dep: resolves through the boundary's code host and records the result on `bw` for the Then step to inspect. */
function resolveAndRecordDefaultBranch(boundary: LaunchBoundary): string {
  const branch = boundary.providers.codeHost.getDefaultBranch();
  bw.resolvedDefaultBranchFromEnsure = branch;
  return branch;
}

When('the target repository workspace is ensured from that boundary', function () {
  const boundary = requireBoundary();
  assert.ok(bw.ensureTargetReposDir, 'Expected a boundary to have been built first');
  bw.ensureError = null;
  bw.resolvedDefaultBranchFromEnsure = null;
  try {
    ensureRepoWorkspace('adw-fixture', 'void-797', 'https://example.invalid/adw-fixture/void-797.git', {
      targetReposDir: bw.ensureTargetReposDir,
      getDefaultBranch: () => resolveAndRecordDefaultBranch(boundary),
      exec: () => { /* no real git needed — clone/fetch mechanics are out of scope for this scenario */ },
      fsDeps: { existsSync, mkdirSync },
      log: () => {},
    });
  } catch (err) {
    bw.ensureError = err as Error;
  }
});

Then('the ensure resolved the default branch {string}', function (branch: string) {
  assert.strictEqual(bw.resolvedDefaultBranchFromEnsure, branch);
});

Then('ensuring the workspace raised no error about a missing provider configuration', function () {
  assert.strictEqual(bw.ensureError, null, `Expected no error, got: ${bw.ensureError}`);
});

Then('the recording code host was not asked for the default branch', function () {
  assert.strictEqual(
    bw.callLog.some((c) => c.op === 'getDefaultBranch'), false,
    'Expected no getDefaultBranch call to have been recorded',
  );
});

Then('no provider configuration was read from the workspace directory that does not exist', function () {
  assert.strictEqual(bw.mintCallCount, 0, 'Expected the boundary\'s provider mint to never have been triggered');
});

// ── §7 — same commands, same repos, same place they run from ─────────────────

Given('the forge operations for {string} run through a git context whose executor records every command', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  const { exec, calls } = makeSpyExec(new Map());
  W.ctx = new GitContext(
    makeFullOptions(owner, repo, SENTINEL_TOKEN, FIXED_IDENTITY.authorName, FIXED_IDENTITY.authorEmail),
    { exec, fsDeps: makeNoOpFsDeps() },
  );
  W.spyCalls = calls;
});

When('the open-issue listing runs for that repository', function () {
  assert.ok(W.ctx, 'Expected a recording git context to have been set up');
  w7.result = createGhRepoApi(W.ctx).listOpenIssues({ fields: [...CRON_ISSUE_FIELDS], limit: 100 });
});

Then('exactly one command was recorded', function () {
  assert.strictEqual(W.spyCalls.length, 1, `Expected exactly one recorded command, got ${W.spyCalls.length}`);
});

Then('the recorded command addresses the repository {string}', function (repoStr: string) {
  assert.ok(W.spyCalls[0], 'Expected a recorded command');
  assert.ok(W.spyCalls[0].command.includes(`--repo ${repoStr}`), `Expected --repo ${repoStr} in: ${W.spyCalls[0].command}`);
});

Then('the recorded command requests the issue fields the cron\'s eligibility filter reads', function () {
  assert.ok(W.spyCalls[0], 'Expected a recorded command');
  assert.ok(
    W.spyCalls[0].command.includes(`--json ${CRON_ISSUE_FIELDS.join(',')}`),
    `Expected the cron's 7-field projection in: ${W.spyCalls[0].command}`,
  );
});

Then('the recorded command ran from the framework root', function () {
  assert.ok(W.spyCalls[0], 'Expected a recorded command');
  assert.strictEqual(W.spyCalls[0].cwd, '/srv/adw/framework');
});

Then('the recorded command carried its credential in the child environment', function () {
  assert.ok(W.spyCalls[0], 'Expected a recorded command');
  assert.strictEqual(W.spyCalls[0].env.GH_TOKEN, SENTINEL_TOKEN);
});

Then('no credential was written into the ambient process environment', function () {
  assert.notStrictEqual(process.env.GH_TOKEN, SENTINEL_TOKEN);
});

// ── §8 — structural backstops ──────────────────────────────────────────────────

Then('the guard reports no stale transitional entry in the sanctioned-construction allowlist', function () {
  const repoRoot = process.cwd();
  const allFiles = collectTsFiles(repoRoot, repoRoot);
  // Exercise the same shellout/identity/construction scan `scanFiles` runs, so a
  // parse failure surfaces here rather than being silently skipped.
  scanFiles(allFiles, repoRoot);
  const seen = new Set<string>();
  for (const relPath of allFiles) {
    const source = readFileSync(path.join(repoRoot, relPath), 'utf-8');
    const sourceFile = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, false);
    if (hasGuardedConstruction(sourceFile)) seen.add(relPath);
  }
  const stale = findStaleSanctionedEntries(seen);
  assert.deepStrictEqual(stale, [], `Expected no stale transitional entries, got: ${stale.join(', ')}`);
});
