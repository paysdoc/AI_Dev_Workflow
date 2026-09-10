/**
 * BDD step definitions for feature-844.feature
 *
 * Routes the workflow issue record, the HITL board notifier and the
 * health-check probes through the forge ports; makes local repo identity and
 * the SSH clone rewrite ADW-owned and host-neutral; and re-proves the vcs
 * contracts the deleted `adws/vcs/__tests__` files used to carry.
 *
 * §1  the issue record through the tracker port
 * §2  the HITL board notifier through the ports
 * §3  the health check through the ports
 * §4  local repo identity without the GitHub adapter
 * §5  the SSH clone rewrite without the GitHub adapter
 * §6  the contracts the deleted tests carried (commitOps/branchOps)
 * §7  the backstops (guard, docs-index, type-check)
 *
 * Reuses feature-796.steps.ts's recording-boundary harness (`world796()`)
 * throughout — every phrase feature-796/820/816/817/810 already registers is
 * reused, never redefined. `Before`/`After` are tag-scoped to `@adw-844`
 * because feature-796's own hooks are scoped to `@adw-796` (its .feature file
 * has since been swept) and do not fire here; this file resets the same
 * shared world and the guard fixture tree from its own hooks, as
 * feature-817/820.steps.ts do.
 *
 * §7's guard/type-check phrases have no surviving registration anywhere
 * (feature-769.steps.ts / feature-691.steps.ts / feature-504.steps.ts, which
 * six other per-issue files still attribute them to, have all been swept) —
 * this file is the one that supplies them, verified clean against
 * `--tags @adw-844 --dry-run` first.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { execFileSync, spawnSync } from 'child_process';

import { world796, splitRepo } from './feature-796.steps.ts';
import { resetGuardFixtureTree } from './feature-816.steps.ts';

import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import type { Issue } from '../../../adws/providers/types.ts';
import { fetchIssueRecord } from '../../../adws/core/issueRecord.ts';
import { formatIssueContextAsArgs } from '../../../adws/agents/planAgent.ts';
import { readAdwLabelNames, issueTypeToAdwLabel } from '../../../adws/core/adwLabels.ts';
import { buildNotifierDeps, notifyReviewTransition, notifyBlockedTransition } from '../../../adws/forge/hitlBoardNotifier.ts';
import { checkGitHubCLI, checkIssueNumber, type CheckResult } from '../../../adws/healthCheckChecks.ts';
import { readLocalRepoIdentity } from '../../../adws/core/localRepoIdentity.ts';
import { convertToSshUrl } from '../../../adws/core/sshCloneUrl.ts';
import { ensureRepoWorkspace } from '../../../adws/gitContext/index.ts';
import { commitOps } from '../../../adws/gitContext/commitOps.ts';
import { branchOps } from '../../../adws/gitContext/branchOps.ts';

const REPO_ROOT = process.cwd();
const ORIGINAL_SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// ---------------------------------------------------------------------------
// This file's own local world state
// ---------------------------------------------------------------------------

interface GitRunnerCall { command: string; cwd: string }

interface S844 {
  lastIssue: Issue | null;
  lastIssueError: Error | null;
  renderedSection: string | null;
  notifyThrew: boolean;
  slackMessages: string[];
  authCheckResult: CheckResult | null;
  issueCheckResult: CheckResult | null;
  localIdentityResult: { owner: string; repo: string; platform: string } | null;
  localIdentityError: Error | null;
  checkoutRemote: string | null;
  checkoutHasNoRemote: boolean;
  preparedCloneUrl: string | null;
  targetRepoOwner: string;
  targetRepoRepo: string;
  targetRepoCloneUrl: string;
  targetReposDir: string;
  recordedCloneCommands: string[];
  gitRunner: ((cmd: string, cwd: string) => string) | null;
  gitRunnerCalls: GitRunnerCall[];
  pushError: Error | null;
  regressionEnumerateOutput: string;
  guardExitCode: number;
  guardOutput: string;
}

function freshState(): S844 {
  return {
    lastIssue: null,
    lastIssueError: null,
    renderedSection: null,
    notifyThrew: false,
    slackMessages: [],
    authCheckResult: null,
    issueCheckResult: null,
    localIdentityResult: null,
    localIdentityError: null,
    checkoutRemote: null,
    checkoutHasNoRemote: false,
    preparedCloneUrl: null,
    targetRepoOwner: '',
    targetRepoRepo: '',
    targetRepoCloneUrl: '',
    targetReposDir: '',
    recordedCloneCommands: [],
    gitRunner: null,
    gitRunnerCalls: [],
    pushError: null,
    regressionEnumerateOutput: '',
    guardExitCode: 0,
    guardOutput: '',
  };
}

let s: S844 = freshState();

// ---------------------------------------------------------------------------
// A counting, capturing fetch stub — Slack delivery for §2, "no forge
// request" proof for §4. Never a real network call.
// ---------------------------------------------------------------------------

let fetchCallCount = 0;
let originalFetch: typeof fetch | undefined;

function installFetchStub(): void {
  fetchCallCount = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    fetchCallCount += 1;
    if (init?.body) {
      try {
        const parsed = JSON.parse(String(init.body)) as { text?: string };
        if (typeof parsed.text === 'string') s.slackMessages.push(parsed.text);
      } catch { /* not a Slack-shaped body */ }
    }
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;
}

function restoreFetchStub(): void {
  if (originalFetch) globalThis.fetch = originalFetch;
}

function lastSlackMessage(): string {
  assert.ok(s.slackMessages.length > 0, 'Expected a Slack message to have been captured');
  return s.slackMessages[s.slackMessages.length - 1];
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-844
// ---------------------------------------------------------------------------

Before({ tags: '@adw-844' }, function () {
  s = freshState();
  installFetchStub();
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/adw-844-test';
  resetGuardFixtureTree();
});

After({ tags: '@adw-844' }, function () {
  restoreFetchStub();
  if (ORIGINAL_SLACK_WEBHOOK_URL === undefined) delete process.env.SLACK_WEBHOOK_URL;
  else process.env.SLACK_WEBHOOK_URL = ORIGINAL_SLACK_WEBHOOK_URL;

  const w = world796();
  for (const dir of w.tempDirs) {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  w.tempDirs = [];
  resetGuardFixtureTree();
  s = freshState();
});

function requireBoundary(): LaunchBoundary {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built first');
  return w.boundary;
}

// ---------------------------------------------------------------------------
// §1 — the issue record through the tracker port
// ---------------------------------------------------------------------------

Given('issue {int} in the recording tracker has the url {string}', function (issueNumber: number, url: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueUrls.set(issueNumber, url);
});

Given('issue {int} in the recording tracker was created at {string}', function (issueNumber: number, createdAt: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueCreatedAts.set(issueNumber, createdAt);
});

Given('issue {int} in the recording tracker was opened by {string}', function (issueNumber: number, author: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueAuthors.set(issueNumber, author);
});

Given('the recording tracker refuses to read issue {int}', function (issueNumber: number) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.refuseIssueFetch.add(issueNumber);
});

When('the issue record for issue {int} is read from that boundary', async function (issueNumber: number) {
  const boundary = requireBoundary();
  s.lastIssue = null;
  s.lastIssueError = null;
  try {
    s.lastIssue = await fetchIssueRecord(boundary.providers.issueTracker, issueNumber);
  } catch (err) {
    s.lastIssueError = err instanceof Error ? err : new Error(String(err));
  }
});

When('the plan agent\'s issue section is rendered for issue {int} from that boundary', async function (issueNumber: number) {
  const boundary = requireBoundary();
  s.lastIssue = await fetchIssueRecord(boundary.providers.issueTracker, issueNumber);
  s.renderedSection = formatIssueContextAsArgs(s.lastIssue);
});

Then('the issue record\'s url is {string}', function (url: string) {
  assert.ok(s.lastIssue, 'Expected the issue record read to have succeeded');
  assert.strictEqual(s.lastIssue.url, url);
});

Then('the issue record\'s creation timestamp is {string}', function (createdAt: string) {
  assert.ok(s.lastIssue, 'Expected the issue record read to have succeeded');
  assert.strictEqual(s.lastIssue.createdAt, createdAt);
});

Then('the rendered issue section names the author {string}', function (author: string) {
  assert.ok(s.renderedSection, 'Expected the plan agent issue section to have been rendered');
  assert.ok(
    s.renderedSection.includes(`**Author:** ${author}`),
    `Expected the rendered section to name the author "${author}", got:\n${s.renderedSection}`,
  );
});

Then('the rendered issue section contains no {string}', function (text: string) {
  assert.ok(s.renderedSection, 'Expected the plan agent issue section to have been rendered');
  assert.ok(
    !s.renderedSection.includes(text),
    `Expected the rendered section not to contain "${text}", got:\n${s.renderedSection}`,
  );
});

Then('the rendered issue section names the labels {string}', function (labels: string) {
  assert.ok(s.renderedSection, 'Expected the plan agent issue section to have been rendered');
  assert.ok(
    s.renderedSection.includes(`**Labels:** ${labels}`),
    `Expected the rendered section to name labels "${labels}", got:\n${s.renderedSection}`,
  );
});

Then('the adw classification read from that issue record is {string}', function (labelName: string) {
  assert.ok(s.lastIssue, 'Expected an issue record to have been read');
  const reading = readAdwLabelNames(s.lastIssue.labels);
  assert.ok(reading.classification, `Expected a non-null classification, got: ${reading.classification}`);
  // readAdwLabelNames.classification is the slash command (e.g. '/feature'); the
  // scenario names the classification by its adw:* label, so translate back through
  // the same catalogue rather than asserting a coincidental string match.
  assert.strictEqual(issueTypeToAdwLabel(reading.classification), labelName);
});

Then('reading the issue record failed with a message beginning {string}', function (prefix: string) {
  assert.ok(s.lastIssueError, 'Expected the issue record read to have failed');
  assert.ok(
    s.lastIssueError.message.startsWith(prefix),
    `Expected message to begin with "${prefix}", got: ${s.lastIssueError.message}`,
  );
});

Then('the boundary\'s providers were asked to fetch issue {int}', function (issueNumber: number) {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'fetchIssue' && c.args[0] === issueNumber);
  assert.ok(call, `Expected a fetchIssue call for issue ${issueNumber}`);
});

// ---------------------------------------------------------------------------
// §2 — the HITL board notifier through the ports
// ---------------------------------------------------------------------------

Given('issue {int} in the recording tracker is titled {string} and carries the label {string}', function (issueNumber: number, title: string, label: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueTitles.set(issueNumber, title);
  w.activeFixture.issueLabels.set(issueNumber, [label]);
});

Given('issue {int} in the recording tracker is titled {string} and carries no labels', function (issueNumber: number, title: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueTitles.set(issueNumber, title);
  w.activeFixture.issueLabels.set(issueNumber, []);
});

Given('issue {int} in the recording tracker is titled {string} and is in state {string}', function (issueNumber: number, title: string, state: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueTitles.set(issueNumber, title);
  w.activeFixture.issueStates.set(issueNumber, state);
});

function addRecordingPR(prNumber: number, issueNumber: number, state: string, mergedAt: string | null, updatedAt: string): void {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  const { owner, repo } = w.boundary ? w.boundary.repoId : { owner: 'adw-fixture', repo: 'void-844' };
  w.activeFixture.allPRs.push({
    number: prNumber,
    body: `Closes #${issueNumber}`,
    state,
    mergedAt,
    updatedAt,
    url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
  });
}

Given('the recording code host has pull request {int} open, linking issue {int}, updated at {string}', function (prNumber: number, issueNumber: number, updatedAt: string) {
  addRecordingPR(prNumber, issueNumber, 'OPEN', null, updatedAt);
});

Given('the recording code host has pull request {int} merged, linking issue {int}, updated at {string}', function (prNumber: number, issueNumber: number, updatedAt: string) {
  addRecordingPR(prNumber, issueNumber, 'MERGED', updatedAt, updatedAt);
});

Given('the recording code host lists pull request {int} before pull request {int}', function (first: number, second: number) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  const arr = w.activeFixture.allPRs;
  const firstIdx = arr.findIndex((p) => p.number === first);
  const secondIdx = arr.findIndex((p) => p.number === second);
  assert.ok(firstIdx !== -1 && secondIdx !== -1, 'Expected both pull requests to already be recorded');
  if (firstIdx > secondIdx) {
    const tmp = arr[firstIdx];
    arr[firstIdx] = arr[secondIdx];
    arr[secondIdx] = tmp;
  }
});

Given('pull request {int} in the recording code host has the url {string}', function (prNumber: number, url: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  const pr = w.activeFixture.allPRs.find((p) => p.number === prNumber);
  assert.ok(pr, `Expected pull request ${prNumber} to already be recorded`);
  pr.url = url;
});

Given('the recording code host refuses to list pull requests', function () {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.refuseListPullRequests = true;
});

When('the review-transition notification is raised for issue {int} from that boundary', async function (issueNumber: number) {
  const boundary = requireBoundary();
  const deps = buildNotifierDeps(() => boundary.providers, boundary.repoId);
  s.notifyThrew = false;
  try {
    await notifyReviewTransition({ issueNumber, repoInfo: boundary.repoId }, deps);
  } catch {
    s.notifyThrew = true;
  }
});

When('the blocked-transition notification is raised for issue {int} from that boundary for a discarded workflow', async function (issueNumber: number) {
  const boundary = requireBoundary();
  const deps = buildNotifierDeps(() => boundary.providers, boundary.repoId);
  s.notifyThrew = false;
  try {
    await notifyBlockedTransition({ issueNumber, repoInfo: boundary.repoId, source: 'discarded' }, deps);
  } catch {
    s.notifyThrew = true;
  }
});

Then('the review-transition notification announces pull request {int}', function (prNumber: number) {
  const msg = lastSlackMessage();
  assert.ok(msg.includes(`/pull/${prNumber}`), `Expected the announced message to reference pull request ${prNumber}, got: ${msg}`);
});

Then('no review-transition notification was announced', function () {
  assert.strictEqual(s.slackMessages.length, 0, `Expected no Slack message, got: ${s.slackMessages.join(' | ')}`);
});

Then('the announced notification link is {string}', function (url: string) {
  const msg = lastSlackMessage();
  assert.ok(msg.includes(url), `Expected the announced message to contain "${url}", got: ${msg}`);
});

Then('the boundary\'s providers were asked for no pull-request listing', function () {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'listPullRequests');
  assert.strictEqual(call, undefined, 'Expected no listPullRequests call to have been recorded');
});

Then('raising the review-transition notification did not fail', function () {
  assert.strictEqual(s.notifyThrew, false, 'Expected notifyReviewTransition not to throw');
});

Then('the blocked-transition notification announces issue {int} as discarded', function (issueNumber: number) {
  const msg = lastSlackMessage();
  assert.ok(
    msg.includes(`#${issueNumber}`) && msg.toLowerCase().includes('discarded'),
    `Expected a discarded message naming issue #${issueNumber}, got: ${msg}`,
  );
});

// ---------------------------------------------------------------------------
// §3 — the health check through the ports
// ---------------------------------------------------------------------------

Given('the recording code host reports the authenticated user {string}', function (user: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.authenticatedUser = user;
});

Given('the recording code host cannot determine its authenticated user', function () {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.authenticatedUser = null;
});

Given('the recording code host refuses to name its authenticated user by name', function () {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.refuseAuthenticatedUser = true;
});

When('the forge authentication health check runs from that boundary', function () {
  const boundary = requireBoundary();
  s.authCheckResult = checkGitHubCLI(boundary.providers.codeHost);
});

Then('the forge authentication health check reports authenticated', function () {
  assert.ok(s.authCheckResult, 'Expected the forge authentication health check to have run');
  assert.strictEqual(s.authCheckResult.details.authenticated, true);
});

Then('the forge authentication health check reports not authenticated', function () {
  assert.ok(s.authCheckResult, 'Expected the forge authentication health check to have run');
  assert.strictEqual(s.authCheckResult.details.authenticated, false);
});

Then('the forge authentication health check reported a result rather than raising', function () {
  assert.ok(s.authCheckResult, 'Expected the health check to have reported a result rather than throwing');
});

When('the issue-accessibility health check runs for issue {int} from that boundary', async function (issueNumber: number) {
  const boundary = requireBoundary();
  s.issueCheckResult = await checkIssueNumber(issueNumber, boundary.providers.issueTracker);
});

Then('the issue-accessibility health check succeeds', function () {
  assert.ok(s.issueCheckResult, 'Expected the issue-accessibility health check to have run');
  assert.strictEqual(s.issueCheckResult.success, true, `Expected success, got error: ${s.issueCheckResult.error}`);
});

Then('the issue-accessibility health check reports the title {string}', function (title: string) {
  assert.ok(s.issueCheckResult, 'Expected the issue-accessibility health check to have run');
  assert.strictEqual(s.issueCheckResult.details.title, title);
});

Then('the issue-accessibility health check reports the state {string}', function (state: string) {
  assert.ok(s.issueCheckResult, 'Expected the issue-accessibility health check to have run');
  assert.strictEqual(s.issueCheckResult.details.state, state);
});

Then('the issue-accessibility health check fails with the error {string}', function (message: string) {
  assert.ok(s.issueCheckResult, 'Expected the issue-accessibility health check to have run');
  assert.strictEqual(s.issueCheckResult.success, false);
  assert.strictEqual(s.issueCheckResult.error, message);
});

// ---------------------------------------------------------------------------
// §4 — local repo identity without the GitHub adapter
//
// The two guard-fixture scenarios at the tail of §4 (zero-arg vs explicit-root
// readLocalRepoIdentity) reuse feature-816.steps.ts's Given/When/Then verbatim
// — no step definitions of this file's own back them.
//
// KNOWN-RED, CONTRACT DEFECT: scenario "An identity read given an explicit root
// is not flagged as cwd-derived" (feature-844.feature:541) cannot pass as
// written, and the behaviour it names is nevertheless CORRECT.
//
// What the rule under test does: running checkGitGhGuard.ts over that exact
// fixture emits ONE line, and it is not this rule's —
//   adws/core/probeOps.ts:5  [unsanctioned-construction]  gitContextForRepo(…)
// No [cwd-derived-identity] line appears, i.e. readLocalRepoIdentity(root) with
// an explicit root IS permitted, which is precisely the scenario's title. Drop
// the gitContextForRepo call from the fixture and the same tree is a clean
// ✔ PASS.
//
// Why the extra line is unavoidable: 'unsanctioned-construction' (#795) flags a
// bare gitContextForRepo(...) callee at any path outside constructionRule.ts's
// two SANCTIONED_CONSTRUCTION_SITES (adws/core/launchGitContext.ts,
// adws/providers/forgeProviders.ts), independent of its argument — a fixture
// calling gitContextForRepo(id) on an unrelated threaded `id` fires identically.
// That independence is deliberate and pinned twice: checkGitGhGuard.test.ts
// ("the identical source is ZERO violations under cwd-derived-identity …,
// proving the two rules are independent") and feature-823's §6 construction
// rows. The cwd-derived-identity unit tests avoid the collision by siting their
// fixtures at the sanctioned adws/core/launchGitContext.ts; this scenario sites
// its fixture at a non-sanctioned path and then asserts a whole-guard pass.
//
// So the only ways to green it are to sanction adws/core/probeOps.ts or to drop
// gitContextForRepo from CONTEXT_CONSTRUCTORS — both gut the #795 ratchet that
// PRD story 24 and feature-823 FINDING 6 exist to hold (a boundary-free
// construction path reintroduced under a familiar name, e.g. imported from
// @paysdoc/devplatform in #840, would then be flagged by nothing). Not done.
//
// Remedy is a .feature amendment, which this workflow may not make: the Then
// should assert the rule the scenario names, not a whole-guard pass — register
// `the guard failure over the guard fixture tree cites no {string} rule`
// (the parameterised twin of feature-816.steps.ts:129's extraction-readiness
// form) and pair it with `… fails naming "adws/core/probeOps.ts"`.
// ---------------------------------------------------------------------------

Given('a checkout whose origin remote is {string}', function (remote: string) {
  s.checkoutRemote = remote;
  s.checkoutHasNoRemote = false;
});

Given('a checkout with no origin remote', function () {
  s.checkoutRemote = null;
  s.checkoutHasNoRemote = true;
});

When('the local repo identity is read from that checkout', function () {
  s.localIdentityResult = null;
  s.localIdentityError = null;
  try {
    const identity = readLocalRepoIdentity(undefined, {
      readRemoteUrl: () => {
        if (s.checkoutHasNoRemote) throw new Error("fatal: No such remote 'origin'");
        return s.checkoutRemote as string;
      },
    });
    s.localIdentityResult = { owner: identity.owner, repo: identity.repo, platform: String(identity.platform) };
  } catch (err) {
    s.localIdentityError = err instanceof Error ? err : new Error(String(err));
  }
});

Then('the local repo identity is owner {string} and repo {string}', function (owner: string, repo: string) {
  assert.ok(s.localIdentityResult, 'Expected the local repo identity read to have succeeded');
  assert.strictEqual(s.localIdentityResult.owner, owner);
  assert.strictEqual(s.localIdentityResult.repo, repo);
});

Then('the local repo identity declares the platform {string}', function (platform: string) {
  assert.ok(s.localIdentityResult, 'Expected the local repo identity read to have succeeded');
  assert.strictEqual(s.localIdentityResult.platform, platform);
});

Then('reading the local repo identity failed with a message beginning {string}', function (prefix: string) {
  assert.ok(s.localIdentityError, 'Expected the local repo identity read to have failed');
  assert.ok(
    s.localIdentityError.message.startsWith(prefix),
    `Expected message to begin with "${prefix}", got: ${s.localIdentityError.message}`,
  );
});

Then('reading the local repo identity issued no forge request', function () {
  assert.strictEqual(fetchCallCount, 0, `Expected no fetch calls, got ${fetchCallCount}`);
});

// ---------------------------------------------------------------------------
// §5 — the SSH clone rewrite without the GitHub adapter
// ---------------------------------------------------------------------------

When('the clone url {string} is prepared for cloning', function (input: string) {
  s.preparedCloneUrl = convertToSshUrl(input);
});

Then('the prepared clone url is {string}', function (output: string) {
  assert.strictEqual(s.preparedCloneUrl, output);
});

Given('a target repository {string} published at {string} that has never been cloned', function (repoStr: string, cloneUrl: string) {
  const { owner, repo } = splitRepo(repoStr);
  s.targetRepoOwner = owner;
  s.targetRepoRepo = repo;
  s.targetRepoCloneUrl = cloneUrl;
  s.targetReposDir = mkdtempSync(path.join(tmpdir(), 'adw-844-target-repos-'));
  world796().tempDirs.push(s.targetReposDir);
  s.recordedCloneCommands = [];
});

When('the target repository workspace is ensured', function () {
  const sshUrl = convertToSshUrl(s.targetRepoCloneUrl);
  ensureRepoWorkspace(s.targetRepoOwner, s.targetRepoRepo, sshUrl, {
    targetReposDir: s.targetReposDir,
    getDefaultBranch: () => 'main',
    exec: (cmd) => { s.recordedCloneCommands.push(cmd); },
    fsDeps: { existsSync: () => false, mkdirSync: () => {} },
  });
});

Then('the recorded clone was issued for {string}', function (expectedUrl: string) {
  const cmd = s.recordedCloneCommands.find((c) => c.startsWith('git clone'));
  assert.ok(cmd, `Expected a git clone command, got: ${s.recordedCloneCommands.join(', ')}`);
  assert.ok(cmd.includes(expectedUrl), `Expected the clone command to reference "${expectedUrl}", got: ${cmd}`);
});

// ---------------------------------------------------------------------------
// §6 — the contracts the deleted adws/vcs/__tests__ files carried
// ---------------------------------------------------------------------------

function makeRecordingGitRunner(opts: { failFetch?: boolean; pushRejectStderr?: string } = {}): { run: (cmd: string, cwd: string) => string; calls: GitRunnerCall[] } {
  const calls: GitRunnerCall[] = [];
  const run = (command: string, cwd: string): string => {
    calls.push({ command, cwd });
    if (opts.failFetch && command.startsWith('git fetch')) {
      throw new Error('fatal: no such remote ref');
    }
    if (opts.pushRejectStderr && command.startsWith('git push')) {
      throw Object.assign(new Error('push rejected'), { stderr: opts.pushRejectStderr });
    }
    return '';
  };
  return { run, calls };
}

Given('a recording git runner', function () {
  const { run, calls } = makeRecordingGitRunner();
  s.gitRunner = run;
  s.gitRunnerCalls = calls;
});

Given('a recording git runner whose fetch fails', function () {
  const { run, calls } = makeRecordingGitRunner({ failFetch: true });
  s.gitRunner = run;
  s.gitRunnerCalls = calls;
});

Given('a recording git runner whose push is rejected with {string}', function (stderr: string) {
  const { run, calls } = makeRecordingGitRunner({ pushRejectStderr: stderr });
  s.gitRunner = run;
  s.gitRunnerCalls = calls;
});

When('the branch {string} is pushed from the worktree {string}', function (branch: string, worktree: string) {
  assert.ok(s.gitRunner, 'Expected a recording git runner to have been set up first');
  s.pushError = null;
  try {
    commitOps.pushBranch(s.gitRunner, branch, worktree);
  } catch (err) {
    s.pushError = err instanceof Error ? err : new Error(String(err));
  }
});

When('the branch {string} is reset to its remote in the worktree {string}', function (branch: string, worktree: string) {
  assert.ok(s.gitRunner, 'Expected a recording git runner to have been set up first');
  branchOps.fetchAndResetToRemote(s.gitRunner, branch, worktree);
});

Then('the recorded git commands are a fetch of {string} followed by a force-with-lease push', function (branch: string) {
  assert.strictEqual(s.gitRunnerCalls[0]?.command, `git fetch origin "${branch}"`);
  assert.strictEqual(s.gitRunnerCalls[1]?.command, `git push --force-with-lease --force-if-includes -u origin "${branch}"`);
});

Then('the recorded git commands are a fetch of {string} followed by a hard reset', function (branch: string) {
  assert.strictEqual(s.gitRunnerCalls[0]?.command, `git fetch origin "${branch}"`);
  assert.strictEqual(s.gitRunnerCalls[1]?.command, `git reset --hard "origin/${branch}"`);
});

Then('every recorded git command ran in {string}', function (cwd: string) {
  assert.ok(s.gitRunnerCalls.length > 0, 'Expected at least one recorded git command');
  for (const call of s.gitRunnerCalls) {
    assert.strictEqual(call.cwd, cwd, `Expected command "${call.command}" to run in "${cwd}", got "${call.cwd}"`);
  }
});

Then('a force-with-lease push was recorded', function () {
  const call = s.gitRunnerCalls.find((c) => c.command.includes('force-with-lease'));
  assert.ok(call, 'Expected a force-with-lease push to have been recorded');
});

Then('pushing the branch did not fail', function () {
  assert.strictEqual(s.pushError, null, `Expected pushBranch not to throw, got: ${s.pushError?.message}`);
});

Then('pushing the branch failed as a lease rejection', function () {
  assert.ok(s.pushError, 'Expected pushBranch to have thrown');
  assert.ok(/force-with-lease/.test(s.pushError.message), `Expected a lease-rejection message, got: ${s.pushError.message}`);
});

Then('pushing the branch failed without lease wording', function () {
  assert.ok(s.pushError, 'Expected pushBranch to have thrown');
  assert.ok(!/force-with-lease/.test(s.pushError.message), `Expected no lease wording, got: ${s.pushError.message}`);
});

When('the regression suite is enumerated by tag', function () {
  const result = spawnSync('bunx', ['cucumber-js', '--tags', '@regression', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, NODE_OPTIONS: '--import tsx' },
  });
  s.regressionEnumerateOutput = (result.stdout || '') + (result.stderr || '');
});

Then('the regression suite enumerates {int} scenarios', function (count: number) {
  const match = s.regressionEnumerateOutput.match(/(\d+) scenarios?/);
  assert.ok(match, `Expected a "N scenarios" summary line, got:\n${s.regressionEnumerateOutput}`);
  assert.strictEqual(Number(match[1]), count);
});

// ---------------------------------------------------------------------------
// §7 — the backstops (guard, docs-index, type-check)
// ---------------------------------------------------------------------------

// 'the docs-index gate is run over the ADW checkout' / 'the docs-index gate exits 0'
// are reused from feature-810.steps.ts — not redefined here.

When('the git\\/gh guard is run across the repository', function () {
  try {
    const stdout = execFileSync('bunx', ['tsx', 'adws/checkGitGhGuard.ts'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    s.guardExitCode = 0;
    s.guardOutput = stdout;
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    s.guardExitCode = e.status ?? 1;
    s.guardOutput = (e.stdout ?? '') + (e.stderr ?? '');
  }
});

Then('the git\\/gh guard reports no violations', function () {
  assert.strictEqual(s.guardExitCode, 0, `Expected the guard to exit 0. Output:\n${s.guardOutput}`);
});

Then('the ADW TypeScript type-check passes', function () {
  try {
    execFileSync('bunx', ['tsc', '--noEmit'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: { ...process.env, NODE_OPTIONS: '' },
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    assert.fail(`Expected the ADW TypeScript type-check to pass. Output:\n${(e.stdout ?? '') + (e.stderr ?? '')}`);
  }
});
