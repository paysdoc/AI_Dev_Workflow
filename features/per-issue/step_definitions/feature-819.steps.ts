/**
 * BDD step definitions for feature-819.feature
 *
 * GitHub forge adapter reaches only the executor, the ports, and the domain
 * model — the legacy free functions stop being an import, their parsing and
 * error policies move into the adapter, and the port factories take the
 * context the caller already holds.
 *
 * §1-§5 drive a real `GitContext` over a recording `exec` (pattern-matched,
 * never call-order-matched) and a `createLiteralTokenProvider(ordinary,
 * elevated)` — never a fake adapter. §6-§7 reuse the guard fixture-tree
 * family and the whole-repo guard/type-check steps verbatim (feature-816.
 * steps.ts, feature-769.steps.ts, feature-504.steps.ts) — no redefinitions.
 * Because this file's scenarios carry @adw-819, not @adw-816, feature-816.
 * steps.ts's own Before/After (tag-scoped to @adw-816) never run for them;
 * this file forces fixture-tree isolation from its own hooks, as feature-817/
 * 818.steps.ts do.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import { resetGuardFixtureTree } from './feature-816.steps.ts';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { Logger } from '../../../adws/gitContext/index.ts';
import { createLiteralTokenProvider } from '../../../adws/providers/github/githubTokenProvider.ts';
import { createGitHubIssueTracker } from '../../../adws/providers/github/githubIssueTracker.ts';
import { createGitHubCodeHost } from '../../../adws/providers/github/githubCodeHost.ts';
import { createGitHubBoardManager } from '../../../adws/providers/github/githubBoardManager.ts';
import { mintBoundProviders } from '../../../adws/providers/repoContext.ts';
import {
  Platform,
  BoardStatus,
  type RepoIdentifier,
  type IssueTracker,
  type CodeHost,
  type BoardManager,
  type BoundProviders,
} from '../../../adws/providers/types.ts';

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';
const ADW_DECORATION_RE = /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/;

// ---------------------------------------------------------------------------
// The recording gh seam: a real GitContext over a pattern-scripted exec
// ---------------------------------------------------------------------------

interface ScriptedRule {
  pattern: string;
  kind: 'answer' | 'refuse' | 'refuseOnce';
  payload: string;
  consumed: boolean;
}

interface SpyCall {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
}

interface CapturedLog {
  message: string;
  level?: string;
}

let repoId: RepoIdentifier | null = null;
let ctx: GitContext | null = null;
let rules: ScriptedRule[] = [];
let calls: SpyCall[] = [];
let driveResult: unknown;
let driveError: Error | null = null;
let capturedStdoutLines: string[] = [];
let capturingLoggerLogs: CapturedLog[] = [];
let lastMatchedCapturedLog: CapturedLog | null = null;
let issueTracker: IssueTracker | null = null;
let codeHost: CodeHost | null = null;
let boardManager: BoardManager | null = null;
let mintedProviders: BoundProviders | null = null;

/** Mimics a real gh-CLI child-process failure, which carries its message on `.stderr` (see `stderrOf` in githubCodeHost.ts). */
function ghFailure(message: string): Error {
  return Object.assign(new Error(message), { stderr: message });
}

function scriptedExec(command: string, options: { cwd: string; env: NodeJS.ProcessEnv; input?: string }): string {
  calls.push({ command, cwd: options.cwd, env: { ...options.env }, input: options.input });
  for (const rule of rules) {
    if (!command.includes(rule.pattern)) continue;
    if (rule.kind === 'refuseOnce') {
      if (rule.consumed) continue;
      rule.consumed = true;
      throw ghFailure(rule.payload);
    }
    if (rule.kind === 'refuse') throw ghFailure(rule.payload);
    return rule.payload;
  }
  return 'main\n';
}

function requireCtx(): GitContext {
  assert.ok(ctx, 'Expected "a recording gh seam for the repository ..." to have run first');
  return ctx;
}

function requireRepoId(): RepoIdentifier {
  assert.ok(repoId, 'Expected "a recording gh seam for the repository ..." to have run first');
  return repoId;
}

function getIssueTracker(): IssueTracker {
  if (!issueTracker) issueTracker = createGitHubIssueTracker(requireCtx(), requireRepoId());
  return issueTracker;
}

function getCodeHost(): CodeHost {
  if (!codeHost) codeHost = createGitHubCodeHost(requireCtx(), requireRepoId());
  return codeHost;
}

function getBoardManager(): BoardManager {
  if (!boardManager) boardManager = createGitHubBoardManager(requireCtx(), requireRepoId());
  return boardManager;
}

// ---------------------------------------------------------------------------
// Before / After — scoped to @adw-819
// ---------------------------------------------------------------------------

Before({ tags: '@adw-819' }, function () {
  resetGuardFixtureTree();
  repoId = null;
  ctx = null;
  rules = [];
  calls = [];
  driveResult = undefined;
  driveError = null;
  capturedStdoutLines = [];
  capturingLoggerLogs = [];
  lastMatchedCapturedLog = null;
  issueTracker = null;
  codeHost = null;
  boardManager = null;
  mintedProviders = null;
});

After({ tags: '@adw-819' }, function () {
  resetGuardFixtureTree();
});

// ---------------------------------------------------------------------------
// Given — the recording gh seam and its scripted responses
// ---------------------------------------------------------------------------

Given(
  'a recording gh seam for the repository {string} serving the ordinary credential {string} and the elevated credential {string}',
  function (repoStr: string, ordinary: string, elevated: string) {
    const [owner, repo] = repoStr.split('/');
    repoId = { owner, repo, platform: Platform.GitHub };
    rules = [];
    calls = [];
    ctx = new GitContext(
      {
        owner,
        repo,
        selfHost: false,
        tokenProvider: createLiteralTokenProvider(ordinary, elevated),
        gitIdentity: {
          authorName: 'ADW Test', authorEmail: 'adw-test@example.invalid',
          committerName: 'ADW Test', committerEmail: 'adw-test@example.invalid',
        },
        frameworkRepoRoot: FRAMEWORK_ROOT,
        targetReposDir: TARGET_REPOS_DIR,
      },
      { exec: scriptedExec },
    );
  },
);

Given('the recording gh seam answers commands matching {string} with:', function (pattern: string, body: string) {
  rules.push({ pattern, kind: 'answer', payload: body, consumed: false });
});

Given('the recording gh seam answers commands matching {string} with {string}', function (pattern: string, answer: string) {
  rules.push({ pattern, kind: 'answer', payload: answer, consumed: false });
});

Given('the recording gh seam refuses commands matching {string} with the message {string}', function (pattern: string, message: string) {
  rules.push({ pattern, kind: 'refuse', payload: message, consumed: false });
});

Given('the recording gh seam refuses the first command matching {string} with the message {string}', function (pattern: string, message: string) {
  rules.push({ pattern, kind: 'refuseOnce', payload: message, consumed: false });
});

Given(
  'the pull request {int} reports the review decision {string} with the reviews {string}',
  function (prNumber: number, decisionRaw: string, reviewsRaw: string) {
    const decision = decisionRaw === '(none)' ? null : decisionRaw === '(empty)' ? '' : decisionRaw;
    const reviews = reviewsRaw === ''
      ? []
      : reviewsRaw.split(',').map((entry) => {
        const [login, stateDay] = entry.split(':');
        const [state, day] = stateDay.split('@');
        return { author: { login }, state, submittedAt: `2026-01-0${day}T00:00:00Z` };
      });
    const { owner, repo } = requireRepoId();
    rules.push({
      pattern: `gh pr view ${prNumber} --repo ${owner}/${repo} --json reviewDecision,reviews`,
      kind: 'answer',
      payload: JSON.stringify({ reviewDecision: decision, reviews }),
      consumed: false,
    });
  },
);

const PROJECT_RESPONSE = JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1' }] } } } });
const ITEM_RESPONSE = JSON.stringify({
  data: { repository: { issue: { projectItems: { nodes: [
    { id: 'ITEM_1', project: { id: 'PVT_1' }, fieldValueByName: { name: 'Todo' } },
  ] } } } },
});
const MOVE_RESPONSE = JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } } });

function fieldResponseFor(status: string): string {
  return JSON.stringify({ data: { node: { field: { id: 'FIELD_1', options: [{ id: 'OPT_1', name: status }] } } } });
}

Given('the recording gh seam is configured for a successful board move of issue {int} to {string}', function (issueNumber: number, targetStatus: string) {
  const { owner, repo } = requireRepoId();
  rules.push({ pattern: 'projectsV2(first:1)', kind: 'answer', payload: PROJECT_RESPONSE, consumed: false });
  rules.push({ pattern: 'projectItems(first:50)', kind: 'answer', payload: ITEM_RESPONSE, consumed: false });
  rules.push({ pattern: 'field(name:', kind: 'answer', payload: fieldResponseFor(targetStatus), consumed: false });
  rules.push({ pattern: 'updateProjectV2ItemFieldValue', kind: 'answer', payload: MOVE_RESPONSE, consumed: false });
  // Supports the Review-transition notification lookup (onStatusMoved), which only fires for
  // a move to Review: a hitl-labelled issue and an empty open-PR list let the lookup complete
  // both its reads without throwing, so the driven operation reaches the gh pr list command too.
  rules.push({
    pattern: `gh issue view ${issueNumber} --repo ${owner}/${repo} --json`,
    kind: 'answer',
    payload: JSON.stringify({ number: issueNumber, title: 'x', body: '', state: 'OPEN', labels: [{ name: 'hitl' }] }),
    consumed: false,
  });
  rules.push({ pattern: `gh pr list --repo ${owner}/${repo}`, kind: 'answer', payload: '[]', consumed: false });
});

// ---------------------------------------------------------------------------
// Given — the mint, and logger injection
// ---------------------------------------------------------------------------

Given('the GitHub providers are minted over the recording gh seam', function () {
  const providers = mintBoundProviders({
    repoId: requireRepoId(),
    gitContext: requireCtx(),
    codeHostPlatform: Platform.GitHub,
    issueTrackerPlatform: Platform.GitHub,
  });
  mintedProviders = providers;
  issueTracker = providers.issueTracker;
  codeHost = providers.codeHost;
  boardManager = providers.boardManager ?? null;
});

Given('the GitHub board manager is built with a capturing logger', function () {
  capturingLoggerLogs = [];
  const logger: Logger = (message, level) => { capturingLoggerLogs.push({ message, level }); };
  boardManager = createGitHubBoardManager(requireCtx(), requireRepoId(), { logger });
});

Given('the GitHub code host is built with a capturing logger', function () {
  capturingLoggerLogs = [];
  const logger: Logger = (message, level) => { capturingLoggerLogs.push({ message, level }); };
  codeHost = createGitHubCodeHost(requireCtx(), requireRepoId(), { logger });
});

Given('the GitHub board manager is built with no logger', function () {
  boardManager = createGitHubBoardManager(requireCtx(), requireRepoId());
});

// ---------------------------------------------------------------------------
// Operation dispatch tables
// ---------------------------------------------------------------------------

function issueTrackerOperation(tracker: IssueTracker, op: string): unknown {
  switch (op) {
    case 'fetch-issue': return tracker.fetchIssue(42);
    case 'comment-on-issue': return tracker.commentOnIssue(42, 'a comment');
    case 'close-issue-with-comment': return tracker.closeIssue(42, 'a comment');
    case 'add-label': return tracker.addLabel(42, 'hitl');
    case 'apply-label': return tracker.applyLabel(42, 'adw:blocked');
    case 'fetch-comments': return tracker.fetchComments(42);
    case 'fetch-labels': return tracker.fetchLabels(42);
    case 'search-open-issues': return tracker.searchOpenIssues('search text', 5);
    case 'find-open-upgrade-issue': return tracker.findOpenUpgradeIssue();
    case 'list-issues': return tracker.listIssues({ fields: ['number'] });
    case 'create-issue': return tracker.createIssue('title', 'body');
    default: throw new Error(`Unknown issue tracker operation: ${op}`);
  }
}

function codeHostOperation(host: CodeHost, op: string): unknown {
  switch (op) {
    case 'default-branch': return host.getDefaultBranch();
    case 'comment-on-pull-request': return host.commentOnPullRequest(7, 'a comment');
    case 'list-open-requests': return host.listOpenPullRequests();
    case 'merge-pull-request': return host.mergePullRequest(7);
    case 'set-secret': return host.setSecret('MY_SECRET', 'a-value');
    case 'list-merged-requests': return host.listMergedPullRequests(200);
    case 'fetch-pull-request': return host.fetchPullRequest(7);
    case 'fetch-review-comments': return host.fetchReviewComments(7);
    case 'is-pull-request-approved': return host.isPullRequestApproved(7);
    case 'find-pull-request-by-branch': return host.findPullRequestByBranch('feature-x');
    case 'create-pull-request': return host.createPullRequest({ title: 'T', body: 'b', sourceBranch: 'feature-x', targetBranch: 'main' });
    case 'approve-pull-request': return host.approvePullRequest(7);
    default: throw new Error(`Unknown code host operation: ${op}`);
  }
}

function boardManagerOperation(bm: BoardManager, op: string): unknown {
  switch (op) {
    case 'find-board': return bm.findBoard();
    case 'create-board': return bm.createBoard('ADW Board');
    case 'ensure-columns': return bm.ensureColumns('PVT_1');
    default: throw new Error(`Unknown board manager operation: ${op}`);
  }
}

// ---------------------------------------------------------------------------
// When — driving an operation, capturing stdout around it
// ---------------------------------------------------------------------------

async function captureStdoutDuring(fn: () => unknown): Promise<void> {
  const original = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    lines.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    driveResult = await fn();
    driveError = null;
  } catch (err) {
    driveResult = undefined;
    driveError = err instanceof Error ? err : new Error(String(err));
  } finally {
    process.stdout.write = original;
    capturedStdoutLines = lines.join('').split('\n');
  }
}

When('the issue tracker operation {string} is driven over the recording gh seam', async function (op: string) {
  await captureStdoutDuring(() => issueTrackerOperation(getIssueTracker(), op));
});

When('the code host operation {string} is driven over the recording gh seam', async function (op: string) {
  await captureStdoutDuring(() => codeHostOperation(getCodeHost(), op));
});

When('the board manager operation {string} is driven over the recording gh seam', async function (op: string) {
  await captureStdoutDuring(() => boardManagerOperation(getBoardManager(), op));
});

When('the minted issue tracker, code host and board manager are each driven once', async function () {
  assert.ok(mintedProviders, 'Expected "the GitHub providers are minted ..." to have run first');
  mintedProviders.issueTracker.getIssueState(42);
  mintedProviders.codeHost.listOpenPullRequests();
  await mintedProviders.boardManager?.findBoard();
});

When('the minted issue tracker applies the label {string} to issue {int}', async function (label: string, issueNumber: number) {
  assert.ok(mintedProviders, 'Expected "the GitHub providers are minted ..." to have run first');
  await captureStdoutDuring(() => mintedProviders!.issueTracker.applyLabel(issueNumber, label));
});

When('the minted issue tracker moves issue {int} to the board status {string}', async function (issueNumber: number, status: string) {
  assert.ok(mintedProviders, 'Expected "the GitHub providers are minted ..." to have run first');
  await captureStdoutDuring(() => mintedProviders!.issueTracker.moveToStatus(issueNumber, status as BoardStatus));
});

// ---------------------------------------------------------------------------
// Then — command / result / error / credential assertions
// ---------------------------------------------------------------------------

Then('every command the driven operation issued reached the recording gh seam', function () {
  assert.ok(calls.length > 0, 'Expected at least one command to have reached the recording seam');
});

Then('every command the minted providers issued reached the recording gh seam', function () {
  assert.ok(calls.length > 0, 'Expected at least one command to have reached the recording seam');
});

Then('the driven operation issued a command matching {string}', function (pattern: string) {
  assert.ok(
    calls.some((c) => c.command.includes(pattern)),
    `Expected a command matching "${pattern}". Issued: ${calls.map((c) => c.command).join(' | ')}`,
  );
});

Then('the driven operation issued no command matching {string}', function (pattern: string) {
  assert.ok(
    !calls.some((c) => c.command.includes(pattern)),
    `Expected no command matching "${pattern}". Issued: ${calls.map((c) => c.command).join(' | ')}`,
  );
});

Then('the driven operation\'s command ran from the recording context\'s framework root', function () {
  assert.ok(calls.length > 0, 'Expected at least one recorded command');
  assert.ok(
    calls.every((c) => c.cwd === FRAMEWORK_ROOT),
    `Expected every command to run from ${FRAMEWORK_ROOT}. Got: ${calls.map((c) => c.cwd).join(', ')}`,
  );
});

function getPath(obj: unknown, pathStr: string): unknown {
  return pathStr.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

Then('the driven operation returned {string}', function (expected: string) {
  assert.strictEqual(String(driveResult), expected, `Full value: ${JSON.stringify(driveResult)}`);
});

Then('the driven operation returned the field {string} as {string}', function (path: string, expected: string) {
  const value = getPath(driveResult, path);
  assert.strictEqual(String(value), expected, `Expected field "${path}" to be "${expected}", got "${String(value)}" (full value: ${JSON.stringify(driveResult)})`);
});

Then('the driven operation returned {int} items', function (count: number) {
  assert.ok(Array.isArray(driveResult), `Expected an array, got: ${JSON.stringify(driveResult)}`);
  assert.strictEqual((driveResult as unknown[]).length, count);
});

Then('the driven operation failed with an error naming {string}', function (needle: string) {
  assert.ok(driveError, `Expected the driven operation to fail. Result: ${JSON.stringify(driveResult)}`);
  assert.ok(driveError.message.includes(needle), `Expected error naming "${needle}", got: ${driveError.message}`);
});

Then('the driven operation completed without throwing', function () {
  assert.strictEqual(driveError, null, `Expected no error, got: ${driveError?.message}`);
});

Then('the driven operation issued a command matching {string} before a command matching {string}', function (before: string, after: string) {
  const beforeIdx = calls.findIndex((c) => c.command.includes(before));
  const afterIdx = calls.findIndex((c) => c.command.includes(after));
  assert.ok(beforeIdx >= 0, `Expected a command matching "${before}". Issued: ${calls.map((c) => c.command).join(' | ')}`);
  assert.ok(afterIdx >= 0, `Expected a command matching "${after}". Issued: ${calls.map((c) => c.command).join(' | ')}`);
  assert.ok(beforeIdx < afterIdx, `Expected "${before}" (index ${beforeIdx}) before "${after}" (index ${afterIdx})`);
});

Then('the driven operation issued {int} commands', function (count: number) {
  assert.strictEqual(calls.length, count, `Issued: ${calls.map((c) => c.command).join(' | ')}`);
});

Then('the command matching {string} carried the credential {string}', function (pattern: string, credential: string) {
  const call = calls.find((c) => c.command.includes(pattern));
  assert.ok(call, `Expected a command matching "${pattern}". Issued: ${calls.map((c) => c.command).join(' | ')}`);
  assert.strictEqual(call!.env.GH_TOKEN, credential);
});

Then('every command the driven operation issued carried the credential {string}', function (credential: string) {
  assert.ok(calls.length > 0, 'Expected at least one recorded command');
  assert.ok(
    calls.every((c) => c.env.GH_TOKEN === credential),
    `Expected every command to carry "${credential}". Got: ${calls.map((c) => c.env.GH_TOKEN).join(', ')}`,
  );
});

Then('the minted providers issued no command outside the repository {string}', function (repoStr: string) {
  const [owner, repo] = repoStr.split('/');
  assert.ok(calls.length > 0, 'Expected at least one recorded command');
  assert.ok(
    calls.every((c) => c.command.includes(owner) && c.command.includes(repo)),
    `Expected every command to address ${repoStr}. Got: ${calls.map((c) => c.command).join(' | ')}`,
  );
});

// ---------------------------------------------------------------------------
// Then — logger / stdout assertions
// ---------------------------------------------------------------------------

Then('the capturing logger recorded a message naming {string}', function (needle: string) {
  const found = capturingLoggerLogs.find((l) => l.message.includes(needle));
  assert.ok(found, `Expected a captured log message naming "${needle}". Got: ${JSON.stringify(capturingLoggerLogs)}`);
  lastMatchedCapturedLog = found;
});

Then('the capturing logger recorded that message at level {string}', function (level: string) {
  assert.ok(lastMatchedCapturedLog, 'Expected a prior "the capturing logger recorded a message naming ..." step to have matched a log line');
  assert.strictEqual(lastMatchedCapturedLog.level, level);
});

Then('no ADW-decorated log line was written to standard output', function () {
  const decorated = capturedStdoutLines.filter((l) => ADW_DECORATION_RE.test(l));
  assert.deepStrictEqual(decorated, [], `Expected no ADW-decorated stdout lines. Got: ${JSON.stringify(capturedStdoutLines)}`);
});

Then('an undecorated log line naming {string} was written to standard output', function (needle: string) {
  const found = capturedStdoutLines.some((l) => l.includes(needle) && !ADW_DECORATION_RE.test(l));
  assert.ok(found, `Expected an undecorated stdout line naming "${needle}". Got: ${JSON.stringify(capturedStdoutLines)}`);
});
