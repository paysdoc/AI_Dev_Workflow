/**
 * BDD step definitions for feature-664.feature
 *
 * GitContext boundary constructor — webhook (per-event)
 *
 * §1  per-event construction from payload → target workspace (outline)
 * §2  per-event independence — second context does not mutate first
 * §3  per-event auth — command carries context token, not process-global
 * §4  interleaved isolation — two repos' events never cross-contaminate
 * §5  payload-determined threading — resolution ignores process cwd
 * §6  TypeScript type-check passes → feature-504.steps.ts (T22)
 * G18 "the ADW codebase is checked out" → ensureCronOnEveryEventSteps.ts
 */

import * as os from 'os';
import { Given, When, Then, After, defineStep } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext } from '../../../adws/gitContext/index.ts';
import { buildLaunchGitContext } from '../../../adws/core/launchGitContext.ts';
import type { LaunchGitContextDeps } from '../../../adws/core/launchGitContext.ts';
import { resolveWebhookRepo } from '../../../adws/triggers/webhookRepoResolver.ts';
import type { ExecFn } from '../../../adws/gitContext/types.ts';
import { createGhRepoApi } from '../../../adws/providers/github/ghRepoApi.ts';
import { createLiteralTokenProvider } from '../../../adws/providers/github/githubTokenProvider.ts';

// ── Types ────────────────────────────────────────────────────────────────────

interface RecordedCall {
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

// ── World state ──────────────────────────────────────────────────────────────

const w = {
  frameworkRoot: '',
  targetReposDir: '',
  repoTokens: new Map<string, string>(),
  payloads: new Map<string, Record<string, unknown>>(),
  currentPayload: null as Record<string, unknown> | null,
  contexts: new Map<string, GitContext>(),
  currentCtx: null as GitContext | null,
  ctxParams: new Map<string, { owner: string; repo: string; token: string }>(),
  currentCtxParams: null as { owner: string; repo: string; token: string } | null,
  recordedCalls: new Map<string, RecordedCall>(),
  currentRecordedCall: null as RecordedCall | null,
  worktreePath1: null as string | null,
  worktreePath2: null as string | null,
  originalCwd: process.cwd(),
  originalGhToken: process.env.GH_TOKEN,
};

const TEST_IDENTITY = {
  authorName: 'ADW Test Bot',
  authorEmail: 'bot@test.dev',
  committerName: 'ADW Test Bot',
  committerEmail: 'bot@test.dev',
};

After(function () {
  // Restore cwd
  if (process.cwd() !== w.originalCwd) process.chdir(w.originalCwd);
  // Restore process.env.GH_TOKEN
  if (w.originalGhToken === undefined) {
    delete process.env.GH_TOKEN;
  } else {
    process.env.GH_TOKEN = w.originalGhToken;
  }
  // Clear world
  w.repoTokens.clear();
  w.payloads.clear();
  w.currentPayload = null;
  w.contexts.clear();
  w.currentCtx = null;
  w.ctxParams.clear();
  w.currentCtxParams = null;
  w.recordedCalls.clear();
  w.currentRecordedCall = null;
  w.worktreePath1 = null;
  w.worktreePath2 = null;
  w.originalGhToken = process.env.GH_TOKEN;
});

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeTestDeps(owner: string, repo: string): LaunchGitContextDeps {
  const repoKey = `${owner}/${repo}`;
  return {
    getRepoInfo: () => ({ owner, repo }),
    resolveToken: () => w.repoTokens.get(repoKey) ?? 'test-sentinel-token',
    resolveGitIdentity: () => TEST_IDENTITY,
    frameworkRepoRoot: w.frameworkRoot,
    targetReposDir: w.targetReposDir,
  } as unknown as LaunchGitContextDeps;
}

function buildContextForPayload(payload: Record<string, unknown>): {
  ctx: GitContext;
  params: { owner: string; repo: string; token: string };
} {
  const resolution = resolveWebhookRepo(payload);
  assert.ok(resolution !== null, 'Expected resolveWebhookRepo to return a non-null resolution');
  const { owner, repo } = resolution.repoInfo;
  const repoKey = `${owner}/${repo}`;
  const token = w.repoTokens.get(repoKey) ?? 'test-sentinel-token';
  const ctx = buildLaunchGitContext(resolution.targetRepo, makeTestDeps(owner, repo));
  return { ctx, params: { owner, repo, token } };
}

function buildContextWithExec(
  params: { owner: string; repo: string; token: string },
  exec: ExecFn,
): GitContext {
  return new GitContext(
    {
      owner: params.owner,
      repo: params.repo,
      selfHost: false,
      tokenProvider: createLiteralTokenProvider(params.token),
      gitIdentity: TEST_IDENTITY,
      frameworkRepoRoot: w.frameworkRoot,
      targetReposDir: w.targetReposDir,
    },
    { exec },
  );
}

function makeRecordingExec(): { exec: ExecFn; getCall: () => RecordedCall | null } {
  let recorded: RecordedCall | null = null;
  const exec: ExecFn = (command, options) => {
    recorded = { command, cwd: options.cwd, env: { ...options.env } as Record<string, string | undefined> };
    return 'main'; // canned success output
  };
  return { exec, getCall: () => recorded };
}

// ── §1/§2/§3/§4/§5 — Webhook server setup ────────────────────────────────────

Given(
  'a webhook server is handling events with framework root {string} and target-repos root {string}',
  function (frameworkRoot: string, targetReposDir: string) {
    w.frameworkRoot = frameworkRoot;
    w.targetReposDir = targetReposDir;
  },
);

// ── §1/§2/§3/§4 — Payload construction ──────────────────────────────────────

Given('a webhook event payload for repository {string}', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  const payload: Record<string, unknown> = {
    repository: {
      full_name: fullName,
      name: repo,
      owner: { login: owner },
      clone_url: `https://github.com/${fullName}.git`,
    },
  };
  w.payloads.set(fullName, payload);
  w.currentPayload = payload;
});

Given(
  'a webhook event payload for repository {string} carrying auth token {string}',
  function (fullName: string, token: string) {
    const [owner, repo] = fullName.split('/');
    const payload: Record<string, unknown> = {
      repository: {
        full_name: fullName,
        name: repo,
        owner: { login: owner },
        clone_url: `https://github.com/${fullName}.git`,
      },
    };
    w.payloads.set(fullName, payload);
    w.repoTokens.set(fullName, token);
    w.currentPayload = payload;
  },
);

// ── §1/§3 — Per-event context construction (single-context scenarios) ─────────

Given('a per-event GitContext is constructed from the webhook event payload', function () {
  assert.ok(w.currentPayload !== null, 'Expected a current webhook event payload');
  const { ctx, params } = buildContextForPayload(w.currentPayload);
  w.currentCtx = ctx;
  w.currentCtxParams = params;
});

// ── §2/§4 — Per-event context construction (multi-context scenarios) ──────────
// defineStep covers both Given and When keywords with the same text.

defineStep(
  'a per-event GitContext is constructed from the webhook event payload for repository {string}',
  function (fullName: string) {
    const payload = w.payloads.get(fullName);
    assert.ok(payload !== undefined, `Expected a payload for repository "${fullName}"`);
    const { ctx, params } = buildContextForPayload(payload);
    w.contexts.set(fullName, ctx);
    w.ctxParams.set(fullName, params);
    w.currentCtx = ctx;
    w.currentCtxParams = params;
  },
);

// ── §3 — Recording runner (single-context) ────────────────────────────────────

Given(
  "the per-event context's git and gh commands are captured by a recording runner",
  function () {
    assert.ok(w.currentCtxParams !== null, 'Expected per-event context params to be set');
    const { exec, getCall } = makeRecordingExec();
    const ctx = buildContextWithExec(w.currentCtxParams, exec);
    w.currentCtx = ctx;
    // Store a reference to getCall so we can retrieve the recording later
    (w as unknown as { _getCall?: () => RecordedCall | null })._getCall = getCall;
  },
);

// ── §4 — Recording runners (multi-context) ────────────────────────────────────

Given(
  "each per-event context's git and gh commands are captured by a recording runner",
  function () {
    // Re-construct each keyed context with its own recording exec
    const recorders = new Map<string, () => RecordedCall | null>();
    for (const [fullName, params] of w.ctxParams.entries()) {
      const { exec, getCall } = makeRecordingExec();
      const ctx = buildContextWithExec(params, exec);
      w.contexts.set(fullName, ctx);
      recorders.set(fullName, getCall);
    }
    (w as unknown as { _recorders?: Map<string, () => RecordedCall | null> })._recorders = recorders;
  },
);

// ── §3 — Running the representative op ────────────────────────────────────────

When(
  'the {string} read operation runs through the per-event context',
  async function (opName: string) {
    assert.ok(w.currentCtx !== null, 'Expected a per-event GitContext to be set');
    if (opName === 'default-branch') {
      await createGhRepoApi(w.currentCtx).defaultBranch();
    } else if (opName === 'current-branch') {
      await w.currentCtx.getCurrentBranch();
    } else {
      assert.fail(`Unknown read operation: "${opName}"`);
    }
    const getCall = (w as unknown as { _getCall?: () => RecordedCall | null })._getCall;
    if (getCall) w.currentRecordedCall = getCall();
  },
);

// ── §3b — Mid-flight global overwrite ────────────────────────────────────────

When(
  'a later in-flight event overwrites the process-global auth token with {string}',
  function (token: string) {
    process.env.GH_TOKEN = token;
  },
);

// ── §4 — Interleaved operations ───────────────────────────────────────────────

When(
  'events for repository {string} and repository {string} are handled with interleaved operations',
  async function (fullNameA: string, fullNameB: string) {
    const ctxA = w.contexts.get(fullNameA);
    const ctxB = w.contexts.get(fullNameB);
    assert.ok(ctxA !== undefined, `Expected a GitContext for repository "${fullNameA}"`);
    assert.ok(ctxB !== undefined, `Expected a GitContext for repository "${fullNameB}"`);

    const recorders = (w as unknown as { _recorders?: Map<string, () => RecordedCall | null> })._recorders;

    // Interleaved: run op on A, then B. A git op (not a repo-API op) so the
    // per-context cwd assertions below stay meaningful post-#775 — repo-API
    // ops now share one framework-rooted cwd across all contexts.
    await ctxA.getCurrentBranch();
    await ctxB.getCurrentBranch();

    if (recorders) {
      const callA = recorders.get(fullNameA)?.();
      const callB = recorders.get(fullNameB)?.();
      if (callA) w.recordedCalls.set(fullNameA, callA);
      if (callB) w.recordedCalls.set(fullNameB, callB);
    }
  },
);

// ── §5 — Payload-determined worktree resolution ───────────────────────────────

When(
  'the per-event worktree for branch {string} is resolved from two different working directories',
  function (branch: string) {
    assert.ok(w.currentCtx !== null, 'Expected a per-event GitContext to be set');
    w.worktreePath1 = w.currentCtx.worktreePathFor(branch);
    process.chdir(os.tmpdir());
    w.worktreePath2 = w.currentCtx.worktreePathFor(branch);
  },
);

// ── §1/§2 — Identity assertions ───────────────────────────────────────────────

Then(
  'the per-event context targets owner {string} repo {string}',
  function (expectedOwner: string, expectedRepo: string) {
    assert.ok(w.currentCtx !== null, 'Expected a per-event GitContext to be set');
    assert.strictEqual(w.currentCtx.owner, expectedOwner);
    assert.strictEqual(w.currentCtx.repo, expectedRepo);
  },
);

Then(
  'the per-event context base path is {string}',
  function (expectedPath: string) {
    assert.ok(w.currentCtx !== null, 'Expected a per-event GitContext to be set');
    assert.strictEqual(w.currentCtx.basePath, expectedPath);
  },
);

Then(
  'the per-event context for repository {string} targets owner {string} repo {string}',
  function (fullName: string, expectedOwner: string, expectedRepo: string) {
    const ctx = w.contexts.get(fullName);
    assert.ok(ctx !== undefined, `Expected a GitContext for repository "${fullName}"`);
    assert.strictEqual(ctx.owner, expectedOwner);
    assert.strictEqual(ctx.repo, expectedRepo);
  },
);

Then(
  'the per-event context for repository {string} base path is {string}',
  function (fullName: string, expectedPath: string) {
    const ctx = w.contexts.get(fullName);
    assert.ok(ctx !== undefined, `Expected a GitContext for repository "${fullName}"`);
    assert.strictEqual(ctx.basePath, expectedPath);
  },
);

// ── §3 — Per-command auth/cwd assertions (single-context) ────────────────────

Then(
  'the captured per-event command ran with auth token {string} in its child environment',
  function (expectedToken: string) {
    assert.ok(
      w.currentRecordedCall !== null,
      'Expected a recorded command call (run the operation first)',
    );
    assert.strictEqual(
      w.currentRecordedCall.env.GH_TOKEN,
      expectedToken,
      `Expected env.GH_TOKEN to be "${expectedToken}" but got "${w.currentRecordedCall.env.GH_TOKEN}"`,
    );
  },
);

Then(
  'the captured per-event command ran with cwd equal to the per-event context base path',
  function () {
    assert.ok(w.currentCtx !== null, 'Expected a per-event GitContext to be set');
    assert.ok(
      w.currentRecordedCall !== null,
      'Expected a recorded command call (run the operation first)',
    );
    assert.strictEqual(w.currentRecordedCall.cwd, w.currentCtx.basePath);
  },
);

Then(
  "the captured per-event command's child environment does not carry auth token {string}",
  function (forbiddenToken: string) {
    assert.ok(
      w.currentRecordedCall !== null,
      'Expected a recorded command call (run the operation first)',
    );
    const envValues = Object.values(w.currentRecordedCall.env);
    assert.ok(
      !envValues.includes(forbiddenToken),
      `Expected env NOT to contain "${forbiddenToken}" but it did`,
    );
  },
);

// ── §4 — Per-command auth/cwd assertions (multi-context) ─────────────────────

Then(
  'the per-event command for repository {string} ran with auth token {string} in its child environment',
  function (fullName: string, expectedToken: string) {
    const call = w.recordedCalls.get(fullName);
    assert.ok(call !== undefined, `Expected a recorded call for repository "${fullName}"`);
    assert.strictEqual(
      call.env.GH_TOKEN,
      expectedToken,
      `Expected env.GH_TOKEN to be "${expectedToken}" for ${fullName} but got "${call.env.GH_TOKEN}"`,
    );
  },
);

Then(
  'the per-event command for repository {string} ran with cwd equal to its per-event context base path',
  function (fullName: string) {
    const ctx = w.contexts.get(fullName);
    const call = w.recordedCalls.get(fullName);
    assert.ok(ctx !== undefined, `Expected a GitContext for repository "${fullName}"`);
    assert.ok(call !== undefined, `Expected a recorded call for repository "${fullName}"`);
    assert.strictEqual(call.cwd, ctx.basePath);
  },
);

Then(
  'the per-event command for repository {string} child environment does not carry auth token {string}',
  function (fullName: string, forbiddenToken: string) {
    const call = w.recordedCalls.get(fullName);
    assert.ok(call !== undefined, `Expected a recorded call for repository "${fullName}"`);
    const envValues = Object.values(call.env);
    assert.ok(
      !envValues.includes(forbiddenToken),
      `Expected env for ${fullName} NOT to contain "${forbiddenToken}" but it did`,
    );
  },
);

// ── §5 — Both worktree resolution assertions ──────────────────────────────────

Then('both per-event resolutions return {string}', function (expectedPath: string) {
  assert.strictEqual(w.worktreePath1, expectedPath, 'First resolution did not match');
  assert.strictEqual(w.worktreePath2, expectedPath, 'Second resolution (after chdir) did not match');
});
