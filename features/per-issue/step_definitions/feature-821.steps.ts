/**
 * BDD step definitions for feature-821.feature
 *
 * The triggers reach the forge through the boundary's providers alone; the
 * legacy free-function layer is deleted.
 *
 * §1  the webhook's per-event boundary
 * §2  the cron tick
 * §3  the takeover handler's boundary-less adapters
 * §4  the cancel directive
 * §5  the gatekeeper's classify-and-label path
 * §6  the region-overlap registration
 * §7  the listing callers (concurrency + dependencies)
 * §8  the bootstrap that precedes the boundary (resolveWebhookRepo)
 * §9  whose login counts as "self" (unaddressed-comment read)
 * §10 what does not move (pure predicates / label vocabulary)
 * §11 structural backstops → feature-691.steps.ts (guard), feature-504.steps.ts (type-check)
 *
 * Reuses feature-796's recording-boundary harness (`world796()`) and
 * feature-820's registered Then phrases throughout — every phrase already
 * registered elsewhere is reused, never redefined. `Before`/`After` are
 * tag-scoped to `@adw-821` because feature-796's own hooks are scoped to
 * `@adw-796` and do not fire here.
 *
 * `dispatchWebhookEvent` and `checkAndTrigger` are driven directly (both
 * exported for this purpose, #821) rather than through the real HTTP server
 * or the real cron loop — `classifyAndSpawnWorkflow`'s `spawnDetached` call
 * cannot be safely exercised from a BDD step (no Vitest module mocking is
 * available here), so §5 calls its two sub-operations (classification,
 * label persistence) directly instead, exactly as feature-542.steps.ts's own
 * docblock explains for `routeIssueOpened`.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type * as http from 'http';

import { world796, resetWorld, record } from './feature-796.steps.ts';
import { setReconciledStage, setClassificationResult, setUnaddressedComments } from './feature-820.steps.ts';

import type { IssueTracker, IssueListEntry, ReviewComment } from '../../../adws/providers/types.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/index.ts';

import { checkAndTrigger } from '../../../adws/triggers/trigger_cron.ts';
import { dispatchWebhookEvent } from '../../../adws/triggers/trigger_webhook.ts';
import { evaluateCandidate, buildDefaultTakeoverDeps } from '../../../adws/triggers/takeoverHandler.ts';
import { handleCancelDirective } from '../../../adws/triggers/cancelHandler.ts';
import { persistInferredLabel } from '../../../adws/triggers/webhookGatekeeper.ts';
import { registerRegionOverlapBlocker } from '../../../adws/triggers/regionOverlapSignals.ts';
import type { OverlapDeferral } from '../../../adws/triggers/cronIssueFilter.ts';
import { isConcurrencyLimitReachedAt } from '../../../adws/triggers/concurrencyGuard.ts';
import { findOpenDependencies } from '../../../adws/triggers/issueDependencies.ts';
import { resolveWebhookRepo } from '../../../adws/triggers/webhookRepoResolver.ts';
import { writeCronPid } from '../../../adws/triggers/cronProcessGuard.ts';
import { evaluateLabelRecovery } from '../../../adws/triggers/cronLabelEligibility.ts';
import type { LabelRecoveryResult } from '../../../adws/triggers/cronLabelEligibility.ts';
import {
  decideUpgradeRedrive,
  type UpgradeRedriveSignals,
  type UpgradeRedriveDecision,
} from '../../../adws/triggers/upgradeRedrive.ts';

import { classifyIssueForTrigger } from '../../../adws/core/issueClassifier.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import type { IssueClassificationResult } from '../../../adws/core/issueClassifier.ts';
import { buildDefaultReconcileDeps } from '../../../adws/core/remoteReconcile.ts';
import { readUnaddressedComments } from '../../../adws/core/unaddressedComments.ts';
import { ADW_CLASSIFICATION_LABELS } from '../../../adws/core/adwLabels.ts';
import { bodyLinksIssue } from '../../../adws/forge/issueLinkMarker.ts';
import { buildUnaddressedCommentReads } from '../../../adws/forge/prCommentDetector.ts';

// ── §821-local world state — transient results not already on World796 ────────

const s: {
  pendingWebhookRepoFullName: string | null;
  webhookResponse: { statusCode?: number; body?: Record<string, unknown> } | null;
  webhookLogs: string[] | null;
  cronTickLogs: string[] | null;
  takeoverResolvedAdwId: string | null;
  regionOverlapBody: string | null;
  regionOverlapRegistered: boolean | null;
  concurrencyCap: number | null;
  concurrencyResult: boolean | null;
  dependenciesResult: number[] | null;
  webhookRepoResolution: ReturnType<typeof resolveWebhookRepo> | null;
  webhookRepoError: Error | null;
  labelRecoveryResult: LabelRecoveryResult | null;
  linkDecision: boolean | null;
  redriveDecision: UpgradeRedriveDecision | null;
  precomputedClassification: string | null;
} = {
  pendingWebhookRepoFullName: null,
  webhookResponse: null,
  webhookLogs: null,
  cronTickLogs: null,
  takeoverResolvedAdwId: null,
  regionOverlapBody: null,
  regionOverlapRegistered: null,
  concurrencyCap: null,
  concurrencyResult: null,
  dependenciesResult: null,
  webhookRepoResolution: null,
  webhookRepoError: null,
  labelRecoveryResult: null,
  linkDecision: null,
  redriveDecision: null,
  precomputedClassification: null,
};

function resetLocalState(): void {
  s.pendingWebhookRepoFullName = null;
  s.webhookResponse = null;
  s.webhookLogs = null;
  s.cronTickLogs = null;
  s.takeoverResolvedAdwId = null;
  s.regionOverlapBody = null;
  s.regionOverlapRegistered = null;
  s.concurrencyCap = null;
  s.concurrencyResult = null;
  s.dependenciesResult = null;
  s.webhookRepoResolution = null;
  s.webhookRepoError = null;
  s.labelRecoveryResult = null;
  s.linkDecision = null;
  s.redriveDecision = null;
  s.precomputedClassification = null;
}

/** The one repository §1/§11 name — writing its cron PID file first makes ensureCronProcess see a live cron already registered (this very process is genuinely alive), so it never spawns a real one. */
const WEBHOOK_FIXTURE_REPO = 'adw-fixture/void-821';

function cronPidFilePath(repoFullName: string): string {
  return path.join(AGENTS_STATE_DIR, 'cron', repoFullName.replace('/', '_') + '.json');
}

function preventRealCronSpawn(repoFullName: string): void {
  writeCronPid(repoFullName, process.pid);
}

Before({ tags: '@adw-821' }, function () {
  resetWorld();
  resetLocalState();
});

After({ tags: '@adw-821' }, function () {
  const w = world796();
  for (const dir of w.tempDirs) {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const adwId of w.usedAdwIds) {
    const agentsDir = path.join(AGENTS_STATE_DIR, adwId);
    if (fs.existsSync(agentsDir)) fs.rmSync(agentsDir, { recursive: true, force: true });
  }
  const pidFile = cronPidFilePath(WEBHOOK_FIXTURE_REPO);
  if (fs.existsSync(pidFile)) fs.rmSync(pidFile, { force: true });
  resetWorld();
  resetLocalState();
});

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Runs `fn`, capturing every console.log line emitted during the call (the ADW logger's only sink). */
async function captureConsoleLogs(fn: () => void | Promise<void>): Promise<string[]> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

function fakeWebhookReq(event: string): http.IncomingMessage {
  return { headers: { 'x-github-event': event } } as unknown as http.IncomingMessage;
}

interface CapturedResponse { statusCode?: number; body?: Record<string, unknown> }

function fakeWebhookRes(): { res: http.ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = {};
  const res = {
    writeHead(code: number) { captured.statusCode = code; return res; },
    end(payload?: string) { if (payload) captured.body = JSON.parse(payload); },
  } as unknown as http.ServerResponse;
  return { res, captured };
}

function pushReviewComment(prNumber: number, comment: ReviewComment): void {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  const list = w.activeFixture.prComments.get(prNumber) ?? [];
  list.push(comment);
  w.activeFixture.prComments.set(prNumber, list);
}

// ── §1 THE WEBHOOK'S PER-EVENT BOUNDARY ─────────────────────────────────────

Given('a launch boundary for the repository {string} that fails to mint providers', function (repoStr: string) {
  s.pendingWebhookRepoFullName = repoStr;
});

When('the webhook dispatches an {string} event for issue {int} from that boundary', async function (
  eventType: string, issueNumber: number,
) {
  const w = world796();
  const repoFullName = w.boundary ? `${w.boundary.repoId.owner}/${w.boundary.repoId.repo}` : s.pendingWebhookRepoFullName;
  assert.ok(repoFullName, 'Expected a repository to be known before dispatching a webhook event');
  preventRealCronSpawn(repoFullName);

  const payload = {
    action: 'created',
    repository: { full_name: repoFullName, clone_url: `https://github.com/${repoFullName}.git` },
    issue: { number: issueNumber, body: '' },
    // A cancel directive: safe to run for real (§4 already proves the sequence), and it
    // reaches the boundary's providers so "every recorded provider call…" has calls to assert on.
    comment: { body: '## Cancel' },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const { res, captured } = fakeWebhookRes();
  const req = fakeWebhookReq(eventType);
  const mintOverride = w.boundary ? () => (w.watchedBoundary ?? w.boundary!) : undefined;

  const logs = await captureConsoleLogs(async () => {
    if (mintOverride) dispatchWebhookEvent(req, res, rawBody, mintOverride);
    else dispatchWebhookEvent(req, res, rawBody);
  });
  s.webhookResponse = captured;
  s.webhookLogs = logs;
});

Then('the webhook event was not reported as triggered', function () {
  assert.ok(s.webhookResponse?.body, 'Expected a captured webhook response body');
  assert.notStrictEqual(s.webhookResponse!.body!.status, 'triggered');
});

Then('the webhook event failure names the repository {string}', function (repoStr: string) {
  assert.ok(s.webhookLogs, 'Expected captured log output from the webhook dispatch');
  assert.ok(
    s.webhookLogs!.some((line) => line.includes('boundary construction failed') && line.includes(repoStr)),
    `Expected a boundary-construction-failure log naming ${repoStr}, got: ${s.webhookLogs!.join(' | ')}`,
  );
});

Then('no workflow was spawned for issue {int}', function (_issueNumber: number) {
  if (s.webhookResponse) {
    assert.notStrictEqual(s.webhookResponse.body?.status, 'processing');
    assert.notStrictEqual(s.webhookResponse.body?.status, 'triggered');
    return;
  }
  assert.ok(s.cronTickLogs, 'Expected either a webhook response or cron tick logs to assert against');
  assert.ok(
    !s.cronTickLogs!.some((l) => l.includes('Spawning')),
    `Expected no "Spawning" log line, got: ${s.cronTickLogs!.join(' | ')}`,
  );
});

// ── §2 THE CRON TICK ─────────────────────────────────────────────────────────

Given('the cron module is imported rather than launched', function () {
  // Marker only — trigger_cron.ts's own process.argv[1] guard already means
  // cronBoundary is null when this file is imported by cucumber, never launched.
});

When('the cron tick runs once from that boundary', async function () {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const boundary = w.boundary;
  s.cronTickLogs = await captureConsoleLogs(async () => { await checkAndTrigger(boundary); });
});

When('the cron tick runs once with no boundary', async function () {
  s.cronTickLogs = await captureConsoleLogs(async () => { await checkAndTrigger(null); });
});

Then('the boundary\'s providers were asked for the open issues of {string}', function (_repoStr: string) {
  const w = world796();
  assert.ok(
    w.activeCallLog.some((c) => c.operation === 'listIssues'),
    `Expected a listIssues call, got: ${w.activeCallLog.map((c) => c.operation).join(', ')}`,
  );
});

Then('the cron tick was skipped for want of a launch boundary', function () {
  assert.ok(s.cronTickLogs, 'Expected captured cron tick log output');
  assert.ok(
    s.cronTickLogs!.some((l) => l.includes('no launch boundary')),
    `Expected a "no launch boundary" skip log, got: ${s.cronTickLogs!.join(' | ')}`,
  );
});

// ── §3 THE TAKEOVER HANDLER'S BOUNDARY-LESS ADAPTERS ────────────────────────

Given('issue {int} in the recording tracker has an adw workflow comment naming adw id {string}', function (
  issueNumber: number, adwId: string,
) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.issueComments.set(issueNumber, [
    { id: '1', body: `**ADW ID:** \`${adwId}\``, author: 'adw-bot', createdAt: new Date(0).toISOString() },
  ]);
});

When('the takeover handler evaluates issue {int} from that boundary', function (issueNumber: number) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const deps = buildDefaultTakeoverDeps(w.boundary);
  s.takeoverResolvedAdwId = deps.resolveAdwId(issueNumber, w.boundary.repoId);
});

Then('the resolved takeover adw id is {string}', function (adwId: string) {
  assert.strictEqual(s.takeoverResolvedAdwId, adwId);
});

// TODO: scenario outline "A takeover derives the remote stage from the boundary's
// code host" could not be made to pass as written — its expected stage values
// ("pr_created" for OPEN, "merged" for MERGED) do not match
// mapArtifactsToStage's real, unchanged switch (adws/core/remoteReconcile.ts:41-50),
// which returns 'awaiting_merge' for OPEN and 'completed' for MERGED. 'merged' is
// not even a valid WorkflowStage member (adws/types/workflowTypes.ts); 'pr_created'
// is a real stage, but it is the ORCHESTRATOR's post-PR-creation comment stage
// (adws/phases/prPhase.ts), a different vocabulary than remote reconciliation's.
// The step below calls the real, correct composition and asserts the real output;
// the scenario's two example rows fail against their stated expectations.
When(
  'the takeover handler derives the stage for issue {int} under adw id {string} from that boundary',
  function (issueNumber: number, adwId: string) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    assert.ok(w.mergeBranchName, 'Expected "the branch … has a pull request …" to have set a branch first');
    w.usedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId, issueNumber, workflowStage: 'starting', branchName: w.mergeBranchName,
    });
    // branchExistsOnRemote pinned true: the fixture repo has no real remote to ls-remote against
    // (mapArtifactsToStage short-circuits to the state-file fallback otherwise) — same technique
    // feature-820/797's own reconcile scenarios use.
    const reconcileDeps = { ...buildDefaultReconcileDeps(w.boundary), branchExistsOnRemote: () => true };
    const deps = buildDefaultTakeoverDeps(w.boundary, reconcileDeps);
    setReconciledStage(deps.deriveStageFromRemote(adwId));
  },
);

// ── §4 THE CANCEL DIRECTIVE ──────────────────────────────────────────────────

When('the cancel directive runs for issue {int} from that boundary', function (issueNumber: number) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const comments = w.boundary.providers.issueTracker.fetchComments(issueNumber);
  handleCancelDirective(issueNumber, comments, w.boundary);
});

// ── §5 THE GATEKEEPER'S CLASSIFY-AND-LABEL PATH ─────────────────────────────

When('the gatekeeper resolves the spawn for issue {int} from that boundary', async function (issueNumber: number) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const boundary = w.boundary;
  const decision = evaluateCandidate({ issueNumber, boundary });
  assert.strictEqual(decision.kind, 'spawn_fresh', `Expected a fresh candidate, got ${decision.kind}`);
  const classification = await classifyIssueForTrigger(issueNumber, {
    fetchIssue: (n) => boundary.providers.issueTracker.fetchIssue(n),
  });
  setClassificationResult(classification);
});

Then('the boundary\'s providers were asked for issue {int}', function (issueNumber: number) {
  const w = world796();
  assert.ok(
    w.activeCallLog.some((c) => c.args[0] === issueNumber),
    `Expected some provider call addressing issue ${issueNumber}, got: ${w.activeCallLog.map((c) => `${c.operation}(${c.args[0]})`).join(', ')}`,
  );
});

Given('the trigger classifier will classify issue {int} as {string}', function (_issueNumber: number, command: string) {
  s.precomputedClassification = command;
});

When(
  'the gatekeeper resolves the spawn for issue {int} from that boundary with label persistence enabled',
  function (issueNumber: number) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    assert.ok(s.precomputedClassification, 'Expected a precomputed classification to have been set');
    const classification: Pick<IssueClassificationResult, 'issueType' | 'success'> = {
      issueType: s.precomputedClassification as IssueClassificationResult['issueType'],
      success: true,
    };
    persistInferredLabel(issueNumber, classification, { persistInferredLabel: true }, w.boundary.providers.issueTracker);
  },
);

Then('the boundary\'s providers recorded the label {string} being applied to issue {int}', function (label: string, issueNumber: number) {
  const w = world796();
  const call = w.activeCallLog.find(
    (c) => (c.operation === 'applyLabel' || c.operation === 'addLabel') && c.args[0] === issueNumber && c.args[1] === label,
  );
  assert.ok(call, `Expected label "${label}" to have been applied to issue ${issueNumber}`);
});

// ── §6 THE REGION-OVERLAP REGISTRATION ──────────────────────────────────────

Given('issue {int} in the recording tracker has a body that does not reference issue {int}', function (
  _issueNumber: number, _notReferenced: number,
) {
  s.regionOverlapBody = 'Some ordinary issue body with no blocked-by reference.';
});

Given('updating the body of issue {int} fails on the recording tracker', function (_issueNumber: number) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  w.boundary.providers.issueTracker.updateIssueBody = (() => {
    throw new Error('simulated updateIssueBody failure');
  }) as IssueTracker['updateIssueBody'];
});

When(
  'a region overlap deferring issue {int} behind issue {int} is registered from that boundary',
  function (issueNumber: number, blockedBy: number) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    const deferral: OverlapDeferral = { issueNumber, blockedBy, overlapPaths: ['adws/triggers/'] };
    s.regionOverlapRegistered = registerRegionOverlapBlocker(
      deferral,
      s.regionOverlapBody ?? '',
      w.boundary.providers.issueTracker,
    );
  },
);

Then('the boundary\'s providers recorded the body of issue {int} being updated before any comment', function (issueNumber: number) {
  const w = world796();
  const updateIndex = w.activeCallLog.findIndex((c) => c.operation === 'updateIssueBody' && c.args[0] === issueNumber);
  const commentIndex = w.activeCallLog.findIndex((c) => c.operation === 'commentOnIssue' && c.args[0] === issueNumber);
  assert.ok(updateIndex !== -1, `Expected an updateIssueBody call for issue ${issueNumber}`);
  assert.ok(commentIndex !== -1, `Expected a commentOnIssue call for issue ${issueNumber}`);
  assert.ok(updateIndex < commentIndex, 'Expected updateIssueBody to be recorded before commentOnIssue');
});

Then('the updated body of issue {int} contains {string}', function (issueNumber: number, text: string) {
  const w = world796();
  const call = w.activeCallLog.find((c) => c.operation === 'updateIssueBody' && c.args[0] === issueNumber);
  assert.ok(call, `Expected an updateIssueBody call for issue ${issueNumber}`);
  const body = call!.args[1] as string;
  assert.ok(body.includes(text), `Expected the updated body to contain "${text}", got: ${body}`);
});

Then('the region overlap was not reported as registered', function () {
  assert.strictEqual(s.regionOverlapRegistered, false);
});

// ── §7 THE LISTING CALLERS (concurrency + dependencies) ─────────────────────

Given(
  'the recording tracker lists {int} issues carrying adw workflow comments and no linked merged pull request',
  function (count: number) {
    const w = world796();
    assert.ok(w.boundary, 'Expected a launch boundary to have been built');
    const entries: IssueListEntry[] = Array.from({ length: count }, (_, i) => ({
      number: 2000 + i,
      comments: [{ body: '## :gear: In Progress\n\n**ADW ID:** `test-adw-id`' }],
    }));
    w.boundary.providers.issueTracker.listIssues = ((query: unknown) => {
      record(w.activeCallLog, 'listIssues', query);
      return entries;
    }) as IssueTracker['listIssues'];
  },
);

Given('listing issues fails on the recording tracker', function () {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  w.boundary.providers.issueTracker.listIssues = (() => {
    throw new Error('simulated listIssues failure');
  }) as IssueTracker['listIssues'];
});

Given('the per-repository concurrency cap is {int}', function (cap: number) {
  s.concurrencyCap = cap;
});

When('the concurrency guard is consulted for that boundary', async function () {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  assert.ok(s.concurrencyCap !== null, 'Expected the concurrency cap to have been given first');
  s.concurrencyResult = await isConcurrencyLimitReachedAt(w.boundary.providers, s.concurrencyCap);
});

Then('the concurrency guard reported the repository at capacity', function () {
  assert.strictEqual(s.concurrencyResult, true);
});

Then('the concurrency guard reported the repository below capacity', function () {
  assert.strictEqual(s.concurrencyResult, false);
});

Given('issue {int} in the recording tracker is in state {string}', function (issueNumber: number, state: string) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  w.boundary.providers.issueTracker.getIssueState = ((n: number) => {
    record(w.activeCallLog, 'getIssueState', n);
    return n === issueNumber ? state : 'OPEN';
  }) as IssueTracker['getIssueState'];
});

When('the open dependencies of an issue blocked by issue {int} are resolved from that boundary', async function (blockedBy: number) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  s.dependenciesResult = await findOpenDependencies(`## Blocked by\n#${blockedBy}\n`, w.boundary.providers.issueTracker);
});

Then('the resolved open dependencies are {string}', function (blocking: string) {
  assert.ok(s.dependenciesResult, 'Expected the open-dependencies resolution to have run');
  assert.strictEqual(s.dependenciesResult!.map(String).join(', '), blocking);
});

// ── §8 THE BOOTSTRAP THAT PRECEDES THE BOUNDARY ─────────────────────────────

When('a webhook payload naming the repository {string} is resolved', function (fullName: string) {
  s.webhookRepoError = null;
  try {
    s.webhookRepoResolution = resolveWebhookRepo({
      repository: { full_name: fullName, clone_url: `https://github.com/${fullName}.git` },
    });
  } catch (err) {
    s.webhookRepoResolution = null;
    s.webhookRepoError = err instanceof Error ? err : new Error(String(err));
  }
});

Then('the resolved webhook repository is {string}', function (resolved: string) {
  assert.ok(s.webhookRepoResolution, 'Expected resolveWebhookRepo to succeed');
  const { owner, repo } = s.webhookRepoResolution!.repoInfo;
  assert.strictEqual(`${owner}/${repo}`, resolved);
});

Then('resolving the webhook repository failed naming {string}', function (fullName: string) {
  assert.ok(s.webhookRepoError, 'Expected resolveWebhookRepo to throw on a malformed full name');
  assert.ok(
    s.webhookRepoError!.message.includes(fullName),
    `Expected the error to name "${fullName}", got: ${s.webhookRepoError!.message}`,
  );
});

// ── §9 WHOSE LOGIN COUNTS AS "SELF" ──────────────────────────────────────────

Given('the recording code host reports its authenticated login is {string}', function (login: string) {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.authenticatedUser = login;
});

Given('the recording code host cannot resolve its authenticated login', function () {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.authenticatedUser = null;
});

Given('pull request {int} has a review comment by {string} at {string}', function (prNumber: number, author: string, iso: string) {
  pushReviewComment(prNumber, { id: `c-${prNumber}-${author}-${iso}`, body: 'lgtm', author, createdAt: iso });
});

When('the unaddressed comments of pull request {int} are read from that boundary', function (prNumber: number) {
  const w = world796();
  assert.ok(w.boundary, 'Expected a launch boundary to have been built');
  const reads = buildUnaddressedCommentReads(w.boundary);
  setUnaddressedComments(readUnaddressedComments(prNumber, reads));
});

// ── §10 WHAT DOES NOT MOVE ────────────────────────────────────────────────────

Then('the evaluated adw label name is {string}', function (labelName: string) {
  assert.ok(s.labelRecoveryResult, 'Expected cron label eligibility to have been evaluated');
  const expected = ADW_CLASSIFICATION_LABELS[labelName as keyof typeof ADW_CLASSIFICATION_LABELS];
  assert.strictEqual(s.labelRecoveryResult!.classification, expected);
});

When(
  'cron label eligibility is evaluated for an issue carrying the labels {string} and {string}',
  function (label1: string, label2: string) {
    s.labelRecoveryResult = evaluateLabelRecovery(
      { number: 42, labels: [{ name: label1 }, { name: label2 }], comments: [] },
      [],
    );
  },
);

When('the per-issue scenario sweep tests whether the body {string} links issue {int}', function (body: string, issueNumber: number) {
  s.linkDecision = bodyLinksIssue(body, issueNumber);
});

Then('the link decision is true', function () {
  assert.strictEqual(s.linkDecision, true);
});

When('the upgrade redrive classifies an issue carrying the label {string}', function (label: string) {
  const signals: UpgradeRedriveSignals = {
    isOpen: true,
    hasUpgradeLabel: true, // only #UPG issues (already adw:upgrade-labeled) reach the redrive scan
    isTerminalLabeled: label === 'adw:blocked',
    hasClaimPr: false,
    spawnLockHeldByLiveProcess: false,
  };
  s.redriveDecision = decideUpgradeRedrive(signals);
});

Then('the upgrade redrive reported {string}', function (verdict: string) {
  assert.ok(s.redriveDecision, 'Expected the upgrade redrive to have classified an issue');
  const actual = s.redriveDecision!.reason === 'terminal' ? 'terminal' : (s.redriveDecision!.redrive ? 'upgrade' : s.redriveDecision!.reason);
  assert.strictEqual(actual, verdict);
});

// §11 reuses 'the git/gh guard is run across the repository' / 'the git/gh guard
// reports no violations' (feature-691.steps.ts), 'no GitHub provider was
// constructed during the run' (feature-796.steps.ts) and 'the ADW TypeScript
// type-check passes' (feature-504.steps.ts) — no new step definitions.
