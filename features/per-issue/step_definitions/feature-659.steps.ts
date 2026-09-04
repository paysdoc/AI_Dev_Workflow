/**
 * BDD step definitions for feature-659.feature
 *
 * GitContext — per-command auth/env injection with isolation
 *
 * §1   representative op carries token + git identity + base-path cwd
 * §2   command cwd is base path regardless of process.cwd()
 * §3   parent process.env is never mutated by an operation
 * §4   two contexts in one process never observe each other's token/cwd
 * §5   interleaved ops across two contexts each carry their own auth
 * §6   TypeScript type-check passes → feature-504.steps.ts (T22)
 * G18  "the ADW codebase is checked out" → ensureCronOnEveryEventSteps.ts
 */

import * as os from 'os';
import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext } from '../../../adws/gitContext/index.ts';
import { createGhRepoApi } from '../../../adws/providers/github/ghRepoApi.ts';
import {
  W,
  makeSpyExec,
  makeFullOptions,
  makeNoOpFsDeps,
  parseAuthor,
  FRAMEWORK_ROOT,
  type PendingCtxArgs,
} from './gitContextSharedWorld.ts';

function runOp(ctx: GitContext, opName: string): void {
  const gh = createGhRepoApi(ctx);
  switch (opName) {
    case 'default-branch':
      gh.defaultBranch();
      return;
    case 'current-branch':
      ctx.getCurrentBranch();
      return;
    case 'issue-view':
      gh.fetchIssue(1);
      return;
    case 'issue-comment':
      gh.commentOnIssue(1, 'test body');
      return;
    case 'issue-create':
      gh.createIssue('Test Issue', 'test body');
      return;
    case 'label-apply':
      gh.applyLabel(1, 'test-label');
      return;
    case 'pr-view':
      gh.fetchPRDetails(1);
      return;
    case 'pr-comment':
      gh.commentOnPR(1, 'test body');
      return;
    case 'pr-create':
      gh.createPR('Test PR', 'test body', 'feature-test-branch');
      return;
    case 'pr-merge':
      gh.mergePR(1);
      return;
    case 'pr-review':
      gh.approvePR(1);
      return;
    case 'board-move':
      gh.moveIssueToStatus(1, 'In Progress');
      return;
    default:
      throw new Error(`Unknown op name: "${opName}"`);
  }
}

After(function () {
  if (process.cwd() !== W.originalCwd) {
    process.chdir(W.originalCwd);
  }
  if (W.savedGhToken === undefined) {
    delete process.env['GH_TOKEN'];
  } else {
    process.env['GH_TOKEN'] = W.savedGhToken;
  }
  W.savedGhToken = undefined;
  W.pendingArgs = null;
  W.ctx = null;
  W.spyCalls = [];
  W.responseMap = new Map();
  W.contextsByKey = new Map();
  W.pendingByKey = new Map();
  W.parentEnvSnapshot = null;
  W.lastError = null;
});

// ── Construction — single-context steps ─────────────────────────────────────

// Stages args; the runner-setup step builds the context with exec injected.
Given(
  'a GitContext for owner {string} repo {string} with auth token {string} and git author {string}',
  function (owner: string, repo: string, token: string, authorStr: string) {
    const { name, email } = parseAuthor(authorStr);
    W.pendingArgs = { owner, repo, token, authorName: name, authorEmail: email };
  },
);

// ── Construction — two-context steps ────────────────────────────────────────

// Stages args keyed by "owner/repo"; runner-setup builds each context.
Given(
  'a GitContext for owner {string} repo {string} with auth token {string}',
  function (owner: string, repo: string, token: string) {
    const key = `${owner}/${repo}`;
    W.pendingByKey.set(key, { owner, repo, token, authorName: 'Test Bot', authorEmail: 'bot@test.dev' });
  },
);

// ── Runner setup — single context ────────────────────────────────────────────

Given("the context's git and gh commands are captured by a recording runner", function () {
  // Support both the 4-arg (with author) and 3-arg (without author) Given steps
  let args: PendingCtxArgs | null = W.pendingArgs;
  if (args === null && W.pendingByKey.size === 1) {
    // 3-arg Given staged into pendingByKey — pull it out for single-context use
    const [, entry] = [...W.pendingByKey.entries()][0];
    args = entry;
    W.pendingByKey = new Map();
  }
  assert.ok(args !== null, 'Expected construction args to be staged');
  const { exec, calls } = makeSpyExec(W.responseMap);
  const { owner, repo, token, authorName, authorEmail } = args;
  W.ctx = new GitContext(makeFullOptions(owner, repo, token, authorName, authorEmail), { exec, fsDeps: makeNoOpFsDeps() });
  W.spyCalls = calls;
  W.pendingArgs = null;
});

// ── Runner setup — two-context ────────────────────────────────────────────────

Given("each context's git and gh commands are captured by a recording runner", function () {
  assert.ok(W.pendingByKey.size > 0, 'Expected pending contexts to be staged');
  for (const [key, args] of W.pendingByKey) {
    const { exec, calls } = makeSpyExec(new Map());
    const { owner, repo, token, authorName, authorEmail } = args;
    const ctx = new GitContext(makeFullOptions(owner, repo, token, authorName, authorEmail), { exec, fsDeps: makeNoOpFsDeps() });
    W.contextsByKey.set(key, { ctx, calls });
  }
  W.pendingByKey = new Map();
});

// ── Parent-env fixture steps ─────────────────────────────────────────────────

Given('the parent process environment has auth token {string}', function (token: string) {
  W.savedGhToken = process.env['GH_TOKEN'];
  process.env['GH_TOKEN'] = token;
});

Given('the parent process environment has no auth token set', function () {
  W.savedGhToken = process.env['GH_TOKEN'];
  delete process.env['GH_TOKEN'];
});

Given('a baseline snapshot of the parent process environment is captured', function () {
  W.parentEnvSnapshot = { ...process.env };
});

// ── Cwd perturbation ─────────────────────────────────────────────────────────

Given('the process working directory is changed away from the context base path', function () {
  process.chdir(os.tmpdir());
});

// ── Operation steps — single context ─────────────────────────────────────────

When('the {string} read operation runs through the context', function (opName: string) {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
  runOp(W.ctx, opName);
});

When('the {string} gh operation runs through the context', function (opName: string) {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
  runOp(W.ctx, opName);
});

// ── Operation steps — two contexts ───────────────────────────────────────────

When(
  'the {string} read operation runs through the {string} context',
  function (opName: string, key: string) {
    const entry = W.contextsByKey.get(key);
    assert.ok(entry !== undefined, `Expected a context for key "${key}"`);
    runOp(entry.ctx, opName);
  },
);

When(
  'the {string} gh operation runs through the {string} context',
  function (opName: string, key: string) {
    const entry = W.contextsByKey.get(key);
    assert.ok(entry !== undefined, `Expected a context for key "${key}"`);
    runOp(entry.ctx, opName);
  },
);

When(
  'an operation on the {string} context and an operation on the {string} context are interleaved in one process',
  function (keyA: string, keyB: string) {
    const entryA = W.contextsByKey.get(keyA);
    const entryB = W.contextsByKey.get(keyB);
    assert.ok(entryA !== undefined, `Expected a context for key "${keyA}"`);
    assert.ok(entryB !== undefined, `Expected a context for key "${keyB}"`);
    // Interleave: A runs, then B runs — per-command env means no shared global
    createGhRepoApi(entryA.ctx).defaultBranch();
    createGhRepoApi(entryB.ctx).defaultBranch();
  },
);

// ── Single-context assertions ─────────────────────────────────────────────────

Then(
  'the captured command ran with auth token {string} in its child environment',
  function (token: string) {
    assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded command');
    const recorded = W.spyCalls[W.spyCalls.length - 1];
    assert.strictEqual(
      recorded.env['GH_TOKEN'],
      token,
      `Expected child env GH_TOKEN to be "${token}" but got "${recorded.env['GH_TOKEN']}"`,
    );
  },
);

Then(
  'the captured command ran with git author {string} in its child environment',
  function (authorStr: string) {
    assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded command');
    const { name, email } = parseAuthor(authorStr);
    const recorded = W.spyCalls[W.spyCalls.length - 1];
    assert.strictEqual(recorded.env['GIT_AUTHOR_NAME'], name);
    assert.strictEqual(recorded.env['GIT_AUTHOR_EMAIL'], email);
    assert.strictEqual(recorded.env['GIT_COMMITTER_NAME'], name);
    assert.strictEqual(recorded.env['GIT_COMMITTER_EMAIL'], email);
  },
);

Then('the captured command ran with cwd equal to the context base path', function () {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up');
  assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded command');
  const recorded = W.spyCalls[W.spyCalls.length - 1];
  assert.strictEqual(
    recorded.cwd,
    W.ctx.basePath,
    `Expected cwd "${recorded.cwd}" to equal base path "${W.ctx.basePath}"`,
  );
});

// Repo-API gh commands run from the framework repository root, not the context
// base path (issue #775) — the sibling of the base-path phrase above, reused by
// the migrated feature-663/691/692/695/697/700 sites whose driving op is a gh
// operation rather than a git operation.
Then('the captured command ran with cwd equal to the framework repository root', function () {
  assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded command');
  const recorded = W.spyCalls[W.spyCalls.length - 1];
  assert.strictEqual(
    recorded.cwd,
    FRAMEWORK_ROOT,
    `Expected cwd "${recorded.cwd}" to equal the framework repository root "${FRAMEWORK_ROOT}"`,
  );
});

// ── Parent-env assertions ─────────────────────────────────────────────────────

Then('the parent process environment still has auth token {string}', function (token: string) {
  assert.strictEqual(
    process.env['GH_TOKEN'],
    token,
    `Expected process.env.GH_TOKEN to remain "${token}" but got "${process.env['GH_TOKEN']}"`,
  );
});

Then('the parent process environment still has no auth token set', function () {
  assert.strictEqual(
    process.env['GH_TOKEN'],
    undefined,
    `Expected process.env.GH_TOKEN to be absent but got "${process.env['GH_TOKEN']}"`,
  );
});

Then('the parent process environment matches the baseline snapshot', function () {
  assert.ok(W.parentEnvSnapshot !== null, 'Expected a baseline snapshot to have been captured');
  const snap = W.parentEnvSnapshot;
  const snapKeys = new Set(Object.keys(snap));
  const curKeys = new Set(Object.keys(process.env));
  const diffs: string[] = [];
  for (const k of curKeys) { if (!snapKeys.has(k)) diffs.push(`ADDED: ${k}=${process.env[k]}`); }
  for (const k of snapKeys) { if (!curKeys.has(k)) diffs.push(`REMOVED: ${k}=${snap[k]}`); }
  for (const k of snapKeys) { if (curKeys.has(k) && process.env[k] !== snap[k]) diffs.push(`CHANGED: ${k}: was=${snap[k]?.slice(0,40)} now=${process.env[k]?.slice(0,40)}`); }
  if (diffs.length > 0) {
    throw new Error(`Parent process.env was mutated during the operation:\n${diffs.join('\n')}`);
  }
});

// ── Two-context isolation assertions ─────────────────────────────────────────

Then(
  'the {string} command ran with auth token {string} in its child environment',
  function (key: string, token: string) {
    const entry = W.contextsByKey.get(key);
    assert.ok(entry !== undefined, `Expected context for key "${key}"`);
    assert.ok(entry.calls.length > 0, `Expected at least one recorded call for "${key}"`);
    const recorded = entry.calls[entry.calls.length - 1];
    assert.strictEqual(
      recorded.env['GH_TOKEN'],
      token,
      `Expected child env GH_TOKEN for "${key}" to be "${token}" but got "${recorded.env['GH_TOKEN']}"`,
    );
  },
);

Then(
  'the {string} command ran with cwd equal to the {string} context base path',
  function (commandKey: string, contextKey: string) {
    const entry = W.contextsByKey.get(contextKey);
    assert.ok(entry !== undefined, `Expected context for key "${contextKey}"`);
    assert.ok(entry.calls.length > 0, `Expected at least one recorded call for "${commandKey}"`);
    const recorded = entry.calls[entry.calls.length - 1];
    assert.strictEqual(
      recorded.cwd,
      entry.ctx.basePath,
      `Expected cwd "${recorded.cwd}" to equal base path "${entry.ctx.basePath}"`,
    );
  },
);

// Sibling of the base-path phrase above, for two-context gh-op sites migrated by issue #775.
Then(
  'the {string} command ran with cwd equal to the framework repository root',
  function (commandKey: string) {
    // The command key identifies which recorded call to assert on; the two-context
    // fixtures key calls by "owner/repo", but every gh command in this suite is
    // asserted via its OWN context key, so we look it up the same way the token
    // phrase above does.
    const entry = W.contextsByKey.get(commandKey);
    assert.ok(entry !== undefined, `Expected context for key "${commandKey}"`);
    assert.ok(entry.calls.length > 0, `Expected at least one recorded call for "${commandKey}"`);
    const recorded = entry.calls[entry.calls.length - 1];
    assert.strictEqual(
      recorded.cwd,
      FRAMEWORK_ROOT,
      `Expected cwd "${recorded.cwd}" to equal the framework repository root "${FRAMEWORK_ROOT}"`,
    );
  },
);

Then(
  "the {string} command's child environment does not carry auth token {string}",
  function (key: string, otherToken: string) {
    const entry = W.contextsByKey.get(key);
    assert.ok(entry !== undefined, `Expected context for key "${key}"`);
    assert.ok(entry.calls.length > 0, `Expected at least one recorded call for "${key}"`);
    const recorded = entry.calls[entry.calls.length - 1];
    const envValues = Object.values(recorded.env);
    assert.ok(
      !envValues.includes(otherToken),
      `Expected "${key}" child env NOT to carry token "${otherToken}" but it was found`,
    );
  },
);
