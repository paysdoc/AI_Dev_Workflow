/**
 * BDD step definitions for feature-790.feature
 *
 * The GitContext spawn chokepoint promoted to a public, forge-neutral executor:
 * `exec(command, {cwd, env, input?})`. Every scenario drives the real GitContext
 * in-process with an injected spy `ExecFn` — nothing spawns a real process.
 *
 * Reuses gitContextSharedWorld.ts (`W`, `makeSpyExec`, `makeFullOptions`,
 * `makeNoOpFsDeps`, `FRAMEWORK_ROOT`, `TARGET_REPOS_ROOT`) per the committed
 * plan's step 12. Issue-790-specific bookkeeping (method-invocation tracking,
 * the pass-through observer, the env snapshot, the raised-error sentinel) lives
 * in a small module-private world (`w790`) rather than widening `SharedWorld`.
 *
 * §1     command passthrough + trimmed return
 * §2     caller-chosen cwd class, crossed against command convention
 * §3     framework-root class is the injected root, not the ambient cwd
 * §4     workspace class + explicit worktree narrowing
 * §5     existing context operations keep their working directories
 * §6     per-command credential env, PATH still inherited
 * §7     PAT selection stays functional for internal operations
 * §8     the PAT-selection flag has no purchase on the public entry
 * §9     optional stdin — supplied, omitted, internal write
 * §10    every internal operation reaches the seam through the public executor
 * §11    the missing-working-directory rewrap stays inside the executor
 * §12    every other failure reaches the caller unwrapped
 * §13    no process-environment mutation
 * §T     TypeScript type-check passes → feature-504.steps.ts (T22)
 * G18    "the ADW codebase is checked out" → ensureCronOnEveryEventSteps.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { ExecFn, ExecOptions, ExecWorkingDirectory, FsDeps, GitContextOptions } from '../../../adws/gitContext/index.ts';
import { W, makeSpyExec, makeFullOptions, makeNoOpFsDeps, FRAMEWORK_ROOT, TARGET_REPOS_ROOT, type SpyCall } from './gitContextSharedWorld.ts';
import { createGhRepoApi } from '../../../adws/providers/github/ghRepoApi.ts';
import { createLiteralTokenProvider } from '../../../adws/providers/github/githubTokenProvider.ts';

interface MethodInvocation {
  method: string;
  calls: SpyCall[];
}

interface World790 {
  owner: string;
  repo: string;
  token: string;
  pat: string | undefined;
  ctx: GitContext | null;
  methodInvocations: MethodInvocation[];
  observerCount: number;
  envSnapshot: NodeJS.ProcessEnv | null;
  sentinelError: unknown;
  chdirDir: string | null;
  lastResult: unknown;
  lastError: unknown;
}

const w790: World790 = {
  owner: '',
  repo: '',
  token: 'token-primary',
  pat: undefined,
  ctx: null,
  methodInvocations: [],
  observerCount: 0,
  envSnapshot: null,
  sentinelError: null,
  chdirDir: null,
  lastResult: null,
  lastError: null,
};

After(function () {
  if (w790.ctx !== null) {
    delete (w790.ctx as unknown as Record<string, unknown>)['exec'];
  }
  if (w790.chdirDir !== null) {
    if (process.cwd() !== W.originalCwd) process.chdir(W.originalCwd);
    fs.rmSync(w790.chdirDir, { recursive: true, force: true });
  }
  w790.owner = '';
  w790.repo = '';
  w790.token = 'token-primary';
  w790.pat = undefined;
  w790.ctx = null;
  w790.methodInvocations = [];
  w790.observerCount = 0;
  w790.envSnapshot = null;
  w790.sentinelError = null;
  w790.chdirDir = null;
  w790.lastResult = null;
  w790.lastError = null;
  W.ctx = null;
  W.spyCalls = [];
  W.responseMap = new Map();
});

// ── Fixture construction ─────────────────────────────────────────────────────

function buildOptions(): GitContextOptions {
  return {
    ...makeFullOptions(w790.owner, w790.repo, w790.token, 'ADW Fixture Bot', 'fixture-bot@adw.dev'),
    tokenProvider: createLiteralTokenProvider(w790.token, w790.pat),
  };
}

function installContext(exec: ExecFn, fsDeps: FsDeps): void {
  const ctx = new GitContext(buildOptions(), { exec, fsDeps });
  W.ctx = ctx;
  w790.ctx = ctx;
  w790.envSnapshot = { ...process.env };
}

function buildFailure(label: string): { error: unknown; fsDeps: FsDeps } {
  if (label === 'a missing-directory failure while the working directory is absent') {
    const error = Object.assign(new Error('spawnSync /bin/sh ENOENT'), {
      code: 'ENOENT',
      syscall: 'spawnSync /bin/sh',
      path: '/bin/sh',
    });
    return { error, fsDeps: makeNoOpFsDeps() };
  }
  if (label === 'a missing-file failure raised while the working directory is present') {
    const error = Object.assign(new Error('spawnSync /bin/sh ENOENT'), {
      code: 'ENOENT',
      syscall: 'spawnSync /bin/sh',
      path: '/bin/sh',
    });
    return { error, fsDeps: { ...makeNoOpFsDeps(), existsSync: () => true } };
  }
  if (label === 'a plain failure carrying no error code') {
    return { error: new Error('gh: unauthenticated'), fsDeps: makeNoOpFsDeps() };
  }
  throw new Error(`Unknown spawn seam failure label: "${label}"`);
}

Given('a git context for target repository {string}', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  w790.owner = owner;
  w790.repo = repo;
  w790.token = 'token-primary';
  w790.pat = undefined;
});

Given('the context is configured with the primary token {string} and the personal access token {string}', function (token: string, pat: string) {
  w790.token = token;
  w790.pat = pat;
});

Given("the context's spawn seam records every command", function () {
  const { exec, calls } = makeSpyExec(new Map());
  W.spyCalls = calls;
  installContext(exec, makeNoOpFsDeps());
});

Given("the context's spawn seam records every command and answers {string}", function (payload: string) {
  const unescaped = payload.replace(/\\n/g, '\n');
  const { exec, calls } = makeSpyExec(new Map(), unescaped);
  W.spyCalls = calls;
  installContext(exec, makeNoOpFsDeps());
});

Given("the context's spawn seam raises {string}", function (failureLabel: string) {
  const { error, fsDeps } = buildFailure(failureLabel);
  w790.sentinelError = error;
  const exec: ExecFn = () => { throw error; };
  W.spyCalls = [];
  installContext(exec, fsDeps);
});

Given("the context's public executor is wrapped with a pass-through observer", function () {
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  const ctx = w790.ctx;
  const original = ctx.exec.bind(ctx);
  w790.observerCount = 0;
  (ctx as unknown as Record<string, unknown>)['exec'] = (command: string, options: ExecOptions) => {
    w790.observerCount += 1;
    return original(command, options);
  };
});

Given('the process working directory is moved outside both the framework root and the workspace', function () {
  w790.chdirDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-790-chdir-'));
  process.chdir(w790.chdirDir);
});

// ── Directory-class vocabulary ───────────────────────────────────────────────

function directoryClassFor(label: string): ExecWorkingDirectory {
  if (label === 'framework root') return { kind: 'frameworkRoot' };
  if (label === 'target workspace') return { kind: 'workspace' };
  throw new Error(`Unknown directory label: "${label}"`);
}

function expectedPathFor(label: string): string {
  if (label === 'framework root') return FRAMEWORK_ROOT;
  if (label === 'target workspace') return path.join(TARGET_REPOS_ROOT, w790.owner, w790.repo);
  throw new Error(`Unknown directory label: "${label}"`);
}

// ── The one binding point ────────────────────────────────────────────────────
// The only place in this file that names the literal ExecOptions shape. If
// HITL review reshapes the public signature, this helper is what changes.

function runThroughExecutor(
  ctx: GitContext,
  command: string,
  cwd: ExecWorkingDirectory,
  env: NodeJS.ProcessEnv = {},
  input?: string,
  extra?: Record<string, unknown>,
): string {
  const options = { cwd, env, input, ...extra } as ExecOptions;
  return ctx.exec(command, options);
}

// ── Context-method dispatch ───────────────────────────────────────────────────

function runContextMethod(ctx: GitContext, method: string, worktreePath?: string): unknown {
  const gh = createGhRepoApi(ctx);
  switch (method) {
    case 'fetch-issue-comments': return gh.fetchIssueComments(28);
    case 'issue-comment': return gh.commentOnIssue(28, 'issue comment body');
    case 'approve-pr': gh.approvePR(7); return undefined;
    case 'authenticated-user': return gh.authenticatedUser();
    case 'board-status-move': return gh.moveIssueToStatus(28, 'In Progress');
    case 'remote-url': return ctx.remoteUrl();
    case 'local-branches': return ctx.localBranches();
    case 'head-short': return ctx.headShort();
    case 'current-branch': return ctx.getCurrentBranch(worktreePath);
    default: throw new Error(`Unknown context method: "${method}"`);
  }
}

// ── When — direct executor invocation ────────────────────────────────────────

When('the command {string} is executed through the public executor in the {string} directory', function (command: string, directory: string) {
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w790.lastResult = runThroughExecutor(w790.ctx, command, directoryClassFor(directory));
    w790.lastError = null;
  } catch (err) {
    w790.lastError = err;
    w790.lastResult = null;
  }
});

When('the command {string} is executed through the public executor in the worktree directory for branch {string}', function (command: string, branch: string) {
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  const worktreePath = w790.ctx.worktreePathFor(branch);
  try {
    w790.lastResult = runThroughExecutor(w790.ctx, command, { kind: 'workspace', path: worktreePath });
    w790.lastError = null;
  } catch (err) {
    w790.lastError = err;
    w790.lastResult = null;
  }
});

When('the command {string} is executed through the public executor in the {string} directory carrying the credential token {string}', function (command: string, directory: string, token: string) {
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w790.lastResult = runThroughExecutor(w790.ctx, command, directoryClassFor(directory), { GH_TOKEN: token });
    w790.lastError = null;
  } catch (err) {
    w790.lastError = err;
    w790.lastResult = null;
  }
});

When('the command {string} is executed through the public executor in the {string} directory carrying the standard-input payload {string}', function (command: string, directory: string, payload: string) {
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w790.lastResult = runThroughExecutor(w790.ctx, command, directoryClassFor(directory), {}, payload);
    w790.lastError = null;
  } catch (err) {
    w790.lastError = err;
    w790.lastResult = null;
  }
});

When('the command {string} is executed through the public executor in the {string} directory with a PAT-selection flag set and the credential token {string}', function (command: string, directory: string, token: string) {
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w790.lastResult = runThroughExecutor(w790.ctx, command, directoryClassFor(directory), { GH_TOKEN: token }, undefined, { usePat: true });
    w790.lastError = null;
  } catch (err) {
    w790.lastError = err;
    w790.lastResult = null;
  }
});

// ── When — context-method invocation ─────────────────────────────────────────

When('the {string} context method is invoked', function (method: string) {
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  const before = W.spyCalls.length;
  try {
    w790.lastResult = runContextMethod(w790.ctx, method);
    w790.lastError = null;
  } catch (err) {
    w790.lastError = err;
    w790.lastResult = null;
  }
  w790.methodInvocations.push({ method, calls: W.spyCalls.slice(before) });
});

When('the {string} context method is invoked for the worktree of branch {string}', function (method: string, branch: string) {
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  const worktreePath = w790.ctx.worktreePathFor(branch);
  const before = W.spyCalls.length;
  try {
    w790.lastResult = runContextMethod(w790.ctx, method, worktreePath);
    w790.lastError = null;
  } catch (err) {
    w790.lastError = err;
    w790.lastResult = null;
  }
  w790.methodInvocations.push({ method, calls: W.spyCalls.slice(before) });
});

// ── Assertions ────────────────────────────────────────────────────────────────

function lastCall(): SpyCall {
  assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded executor command');
  return W.spyCalls[W.spyCalls.length - 1];
}

function lastCallForMethod(method: string): SpyCall {
  const entries = w790.methodInvocations.filter((m) => m.method === method);
  assert.ok(entries.length > 0, `Expected at least one invocation of context method "${method}"`);
  const lastEntry = entries[entries.length - 1];
  assert.ok(lastEntry.calls.length > 0, `Expected at least one recorded command for context method "${method}"`);
  return lastEntry.calls[lastEntry.calls.length - 1];
}

Then('the executor returns the trimmed output {string}', function (expected: string) {
  assert.strictEqual(w790.lastResult, expected);
});

Then('the recorded executor command is exactly {string}', function (expected: string) {
  assert.strictEqual(lastCall().command, expected);
});

Then('the recorded executor command ran in the {string} directory', function (directory: string) {
  assert.strictEqual(lastCall().cwd, expectedPathFor(directory));
});

Then('the recorded executor command ran in the worktree directory for branch {string}', function (branch: string) {
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  assert.strictEqual(lastCall().cwd, w790.ctx.worktreePathFor(branch));
});

Then('the recorded executor command carried the credential token {string} in its child environment', function (token: string) {
  assert.strictEqual(lastCall().env['GH_TOKEN'], token);
});

Then("the recorded executor command inherited the process environment's PATH", function () {
  assert.strictEqual(lastCall().env['PATH'], process.env['PATH']);
});

Then('the recorded executor commands carried the credential tokens {string} and {string} in order', function (first: string, second: string) {
  assert.ok(W.spyCalls.length >= 2, `Expected at least 2 recorded commands but got ${W.spyCalls.length}`);
  assert.strictEqual(W.spyCalls[0].env['GH_TOKEN'], first);
  assert.strictEqual(W.spyCalls[1].env['GH_TOKEN'], second);
});

Then('the recorded executor command carried the standard-input payload {string}', function (payload: string) {
  assert.strictEqual(lastCall().input, payload);
});

Then('the recorded executor command carried no standard input', function () {
  assert.strictEqual(lastCall().input, undefined);
});

Then('the recorded command for the {string} context method ran in the {string} directory', function (method: string, directory: string) {
  assert.strictEqual(lastCallForMethod(method).cwd, expectedPathFor(directory));
});

Then('the recorded command for the {string} context method carried the credential token {string} in its child environment', function (method: string, token: string) {
  assert.strictEqual(lastCallForMethod(method).env['GH_TOKEN'], token);
});

Then('the recorded command for the {string} context method carried the standard-input payload {string}', function (method: string, payload: string) {
  assert.strictEqual(lastCallForMethod(method).input, payload);
});

Then('every recorded spawn command passed through the public executor', function () {
  assert.strictEqual(
    W.spyCalls.length,
    w790.observerCount,
    `Expected ${W.spyCalls.length} seam calls to equal ${w790.observerCount} observed calls`,
  );
});

Then('the executor failure is recognisable by the missing-working-directory error code', function () {
  assert.ok(w790.lastError !== null, 'Expected an error to be thrown');
  assert.strictEqual((w790.lastError as NodeJS.ErrnoException).code, 'ENOENT');
});

Then('the executor failure names the working directory that could not be entered', function () {
  assert.ok(w790.lastError !== null, 'Expected an error to be thrown');
  assert.ok(w790.ctx !== null, 'Expected a GitContext to be set up');
  const message = (w790.lastError as Error).message;
  assert.ok(
    message.includes(w790.ctx.basePath),
    `Expected message to include "${w790.ctx.basePath}" but got: ${message}`,
  );
});

Then('the executor failure names the repository {string}', function (fullName: string) {
  assert.ok(w790.lastError !== null, 'Expected an error to be thrown');
  const message = (w790.lastError as Error).message;
  assert.ok(message.includes(fullName), `Expected message to include "${fullName}" but got: ${message}`);
});

Then("the executor failure is the spawn seam's own failure, unwrapped", function () {
  assert.ok(w790.lastError !== null, 'Expected an error to be thrown');
  assert.strictEqual(w790.lastError, w790.sentinelError);
});

Then('no process environment variable was modified by the run', function () {
  assert.ok(w790.envSnapshot !== null, 'Expected an environment snapshot to have been captured');
  const snap = w790.envSnapshot;
  const snapKeys = new Set(Object.keys(snap));
  const curKeys = new Set(Object.keys(process.env));
  const diffs: string[] = [];
  for (const k of curKeys) { if (!snapKeys.has(k)) diffs.push(`ADDED: ${k}`); }
  for (const k of snapKeys) { if (!curKeys.has(k)) diffs.push(`REMOVED: ${k}`); }
  for (const k of snapKeys) { if (curKeys.has(k) && process.env[k] !== snap[k]) diffs.push(`CHANGED: ${k}`); }
  assert.strictEqual(diffs.length, 0, `Expected no process.env mutation but got: ${diffs.join(', ')}`);
});
