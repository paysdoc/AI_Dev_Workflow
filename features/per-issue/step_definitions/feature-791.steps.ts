/**
 * BDD step definitions for feature-791.feature
 *
 * GitContext credentials arrive through a TokenProvider port resolved on every
 * command — nothing cached at construction, nothing read from the environment,
 * and the provider (not the core) decides which credential a command gets.
 *
 * Reuses gitContextSharedWorld.ts (`makeSpyExec`, `makeFullOptions`,
 * `makeNoOpFsDeps`, `FRAMEWORK_ROOT`, `TARGET_REPOS_ROOT`) per the plan's step
 * 15. Issue-791 bookkeeping (the provider fake and its call log, the
 * operation-invocation map, the ambient-env sentinel, the env snapshot) lives
 * in a module-private world (`W791`), as feature-790.steps.ts does with `w790`.
 *
 * ONE BINDING POINT: `buildContext` is the only place that knows the literal
 * `{owner, repo, tokenProvider}` construction shape. If review reshapes the
 * port, exactly this helper changes.
 *
 * Contexts are built LAZILY (first use), per the feature file's step-definition
 * note — every scenario configures its credential source in a Given that
 * FOLLOWS the context Given, so a source that can produce no credential
 * surfaces its failure at the first operation, not inside a Given.
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext, createGitHubTokenProvider } from '../../../adws/gitContext/index.ts';
import type { TokenProvider, CredentialRequest, GitContextOptions, ExecFn } from '../../../adws/gitContext/index.ts';
import { buildLaunchGitContext } from '../../../adws/core/launchGitContext.ts';
import type { TargetRepoInfo } from '../../../adws/types/issueTypes.ts';
import { makeSpyExec, makeFullOptions, makeNoOpFsDeps, FRAMEWORK_ROOT, TARGET_REPOS_ROOT, type SpyCall } from './gitContextSharedWorld.ts';

// ---------------------------------------------------------------------------
// #791 local world state
// ---------------------------------------------------------------------------

interface PendingContext {
  owner: string;
  repo: string;
}

type ProviderScript =
  | { kind: 'constant'; value: string }
  | { kind: 'fresh' }
  | { kind: 'twiceThenFail'; value: string }
  | { kind: 'purposeSplit'; ordinary: string; elevated: string }
  | { kind: 'fail' };

interface GitHubSourceConfig {
  appConfigured: boolean;
  appNotInstalled: boolean;
  pat: string | undefined;
  alternateIdentityPat: string | undefined;
  ghCliToken: string;
}

type CredentialSource =
  | { kind: 'scripted'; script: ProviderScript }
  | { kind: 'github'; config: GitHubSourceConfig };

interface OperationRun {
  operation: string;
  calls: SpyCall[];
  error: unknown;
}

interface World791 {
  primary: PendingContext | null;
  secondary: PendingContext | null;
  source: CredentialSource | null;
  cachedProvider: TokenProvider | null;
  providerCalls: CredentialRequest[];
  primaryCtx: GitContext | null;
  secondaryCtx: GitContext | null;
  spyExec: ExecFn | null;
  spyCalls: SpyCall[];
  operationRuns: OperationRun[];
  lastError: unknown;
  ambientPrior: { ghToken: string | undefined; githubPat: string | undefined } | null;
  ambientSentinelValue: string | null;
  envSnapshot: NodeJS.ProcessEnv | null;
  launchCtx: GitContext | null;
  launchEnvs: NodeJS.ProcessEnv[];
}

const W791: World791 = {
  primary: null,
  secondary: null,
  source: null,
  cachedProvider: null,
  providerCalls: [],
  primaryCtx: null,
  secondaryCtx: null,
  spyExec: null,
  spyCalls: [],
  operationRuns: [],
  lastError: null,
  ambientPrior: null,
  ambientSentinelValue: null,
  envSnapshot: null,
  launchCtx: null,
  launchEnvs: [],
};

After(function () {
  if (W791.ambientPrior) {
    if (W791.ambientPrior.ghToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = W791.ambientPrior.ghToken;
    if (W791.ambientPrior.githubPat === undefined) delete process.env.GITHUB_PAT; else process.env.GITHUB_PAT = W791.ambientPrior.githubPat;
  }
  W791.primary = null;
  W791.secondary = null;
  W791.source = null;
  W791.cachedProvider = null;
  W791.providerCalls = [];
  W791.primaryCtx = null;
  W791.secondaryCtx = null;
  W791.spyExec = null;
  W791.spyCalls = [];
  W791.operationRuns = [];
  W791.lastError = null;
  W791.ambientPrior = null;
  W791.ambientSentinelValue = null;
  W791.envSnapshot = null;
  W791.launchCtx = null;
  W791.launchEnvs = [];
});

const FIXED_IDENTITY = {
  authorName: 'ADW Bot',
  authorEmail: 'adw-bot@users.noreply.github.com',
  committerName: 'ADW Bot',
  committerEmail: 'adw-bot@users.noreply.github.com',
};

// ---------------------------------------------------------------------------
// Scripted credential-provider fake
// ---------------------------------------------------------------------------

function makeScriptedProvider(script: ProviderScript): TokenProvider {
  let n = 0;
  return {
    credentialEnv(request: CredentialRequest): NodeJS.ProcessEnv {
      n += 1;
      if (script.kind === 'constant') return { GH_TOKEN: script.value };
      if (script.kind === 'fresh') return { GH_TOKEN: `credential-${n}` };
      if (script.kind === 'twiceThenFail') {
        if (n <= 2) return { GH_TOKEN: script.value };
        throw new Error('credential provider: exhausted after two answers');
      }
      if (script.kind === 'purposeSplit') {
        return { GH_TOKEN: request.purpose === 'alternateIdentity' ? script.elevated : script.ordinary };
      }
      throw new Error('credential provider: failed to resolve a credential');
    },
  };
}

/** The GitHub credential source's mint is deterministic and bound to owner/repo — see the "mints a credential naming the repository" Given. */
function buildProviderFromSource(source: CredentialSource): TokenProvider {
  if (source.kind === 'scripted') return makeScriptedProvider(source.script);
  const { config } = source;
  return createGitHubTokenProvider({
    pat: config.pat,
    alternateIdentityPat: config.alternateIdentityPat,
    isAppConfigured: () => config.appConfigured,
    mintInstallationToken: (owner, repo) => {
      if (config.appNotInstalled) throw new Error(`GitHub App is not installed on ${owner}/${repo}`);
      return `installation-token::${owner}/${repo}`;
    },
    ghAuthToken: () => config.ghCliToken,
  });
}

function getSharedProvider(): TokenProvider {
  if (!W791.cachedProvider) {
    assert.ok(W791.source !== null, 'Expected a credential source to be configured before first use');
    const source = W791.source;
    const raw = buildProviderFromSource(source);
    W791.cachedProvider = {
      credentialEnv(request: CredentialRequest): NodeJS.ProcessEnv {
        W791.providerCalls.push(request);
        return raw.credentialEnv(request);
      },
    };
  }
  return W791.cachedProvider;
}

// ---------------------------------------------------------------------------
// The one binding point
// ---------------------------------------------------------------------------

function buildContext(owner: string, repo: string, provider: TokenProvider, exec: ExecFn): GitContext {
  const base = makeFullOptions(owner, repo, 'unused-transitional-token', 'ADW Fixture Bot', 'fixture-bot@adw.dev');
  const options: GitContextOptions = { ...base, token: undefined, tokenProvider: provider };
  return new GitContext(options, { exec, fsDeps: makeNoOpFsDeps() });
}

function getOrBuildContext(which: 'primary' | 'secondary'): GitContext {
  if (which === 'primary' && W791.primaryCtx) return W791.primaryCtx;
  if (which === 'secondary' && W791.secondaryCtx) return W791.secondaryCtx;
  const spec = which === 'primary' ? W791.primary : W791.secondary;
  assert.ok(spec, `Expected a ${which} context to be configured`);
  assert.ok(W791.spyExec, 'Expected the spawn seam to be configured before the first operation');
  const provider = getSharedProvider();
  const ctx = buildContext(spec.owner, spec.repo, provider, W791.spyExec);
  if (which === 'primary') W791.primaryCtx = ctx; else W791.secondaryCtx = ctx;
  return ctx;
}

// ---------------------------------------------------------------------------
// Operation dispatch — deliberately echoes feature-790's map
// ---------------------------------------------------------------------------

function runOperation(ctx: GitContext, operation: string): unknown {
  switch (operation) {
    case 'fetch-issue-comments': return ctx.fetchIssueComments(28);
    case 'remote-url': return ctx.remoteUrl();
    case 'create-pr': return ctx.createPR('t', 'body', 'feature-x');
    case 'commit-changes': return ctx.commitChanges('msg', ctx.worktreePathFor('feature-issue-791-x'));
    case 'approve-pr': ctx.approvePR(7); return undefined;
    case 'graphql': return ctx.runGraphQL('query { viewer { login } }');
    case 'graphql-input': return ctx.runGraphQLInput({ query: 'mutation { doThing }' });
    case 'board-status-move': return ctx.moveIssueToStatus(28, 'In Progress');
    default: throw new Error(`Unknown operation: "${operation}"`);
  }
}

function runOperationTracked(operation: string, which: 'primary' | 'secondary', captureFailure: boolean): void {
  const before = W791.spyCalls.length;
  try {
    const ctx = getOrBuildContext(which);
    runOperation(ctx, operation);
    W791.lastError = null;
    W791.operationRuns.push({ operation, calls: W791.spyCalls.slice(before), error: null });
  } catch (err) {
    W791.lastError = err;
    W791.operationRuns.push({ operation, calls: W791.spyCalls.slice(before), error: err });
    if (!captureFailure) throw err;
  }
}

function lastRun(): OperationRun {
  assert.ok(W791.operationRuns.length > 0, 'Expected at least one operation to have run');
  return W791.operationRuns[W791.operationRuns.length - 1];
}

function runsForOperation(operation: string): OperationRun[] {
  return W791.operationRuns.filter((r) => r.operation === operation);
}

// ---------------------------------------------------------------------------
// Givens — context construction
// ---------------------------------------------------------------------------

Given('a git context for the repository {string} whose credentials come from a credential provider', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  W791.primary = { owner, repo };
});

Given('a second git context for the repository {string} whose credentials come from the same credential provider', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  W791.secondary = { owner, repo };
});

Given('a git context for the repository {string} whose credentials come from the GitHub credential source', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  W791.primary = { owner, repo };
});

// ---------------------------------------------------------------------------
// Givens — the scripted credential-provider fake
// ---------------------------------------------------------------------------

Given('the credential provider answers every request with {string}', function (value: string) {
  W791.source = { kind: 'scripted', script: { kind: 'constant', value } };
});

Given('the credential provider answers with a fresh credential on every request', function () {
  W791.source = { kind: 'scripted', script: { kind: 'fresh' } };
});

Given('the credential provider answers ordinary requests with {string} and elevated requests with {string}', function (ordinary: string, elevated: string) {
  W791.source = { kind: 'scripted', script: { kind: 'purposeSplit', ordinary, elevated } };
});

Given('the credential provider answers twice with {string} and fails afterwards', function (value: string) {
  W791.source = { kind: 'scripted', script: { kind: 'twiceThenFail', value } };
});

Given('the credential provider fails to resolve a credential', function () {
  W791.source = { kind: 'scripted', script: { kind: 'fail' } };
});

// ---------------------------------------------------------------------------
// Givens — the GitHub credential source (real createGitHubTokenProvider)
// ---------------------------------------------------------------------------

Given(
  'the GitHub credential source is configured with the App installed, the personal access token {string} and the gh CLI token {string}',
  function (pat: string, ghCli: string) {
    W791.source = { kind: 'github', config: { appConfigured: true, appNotInstalled: false, pat, alternateIdentityPat: pat, ghCliToken: ghCli } };
  },
);

Given(
  'the GitHub credential source is configured with app {string}, personal access token {string} and gh CLI token {string}',
  function (appLabel: string, pat: string, ghCli: string) {
    W791.source = {
      kind: 'github',
      config: { appConfigured: appLabel === 'configured', appNotInstalled: false, pat, alternateIdentityPat: pat, ghCliToken: ghCli },
    };
  },
);

Given(
  'the GitHub credential source is configured with a whitespace-only personal access token and the gh CLI token {string}',
  function (ghCli: string) {
    W791.source = {
      kind: 'github',
      config: { appConfigured: false, appNotInstalled: false, pat: '   ', alternateIdentityPat: '   ', ghCliToken: ghCli },
    };
  },
);

Given('the GitHub credential source is configured with the App installed but not installed on the repository', function () {
  W791.source = {
    kind: 'github',
    config: { appConfigured: true, appNotInstalled: true, pat: undefined, alternateIdentityPat: undefined, ghCliToken: '' },
  };
});

Given('the GitHub credential source mints a credential naming the repository it is asked for', function () {
  // Documentary — the GitHub source's mint is always deterministically bound
  // to owner/repo (installation-token::{owner}/{repo}) once the App is
  // configured; see buildProviderFromSource.
});

// ---------------------------------------------------------------------------
// Givens — spawn seam, ambient environment
// ---------------------------------------------------------------------------

Given('the spawn seam records every command with the credential it carried', function () {
  const { exec, calls } = makeSpyExec(new Map());
  W791.spyExec = exec;
  W791.spyCalls = calls;
  W791.envSnapshot = { ...process.env };
});

Given('the ambient environment carries a stray GH_TOKEN and GITHUB_PAT of {string}', function (value: string) {
  W791.ambientPrior = { ghToken: process.env.GH_TOKEN, githubPat: process.env.GITHUB_PAT };
  process.env.GH_TOKEN = value;
  process.env.GITHUB_PAT = value;
  W791.ambientSentinelValue = value;
});

// ---------------------------------------------------------------------------
// When — operations
// ---------------------------------------------------------------------------

When('the {string} operation runs', function (operation: string) {
  runOperationTracked(operation, 'primary', false);
});

When('the {string} operation runs and any failure is captured', function (operation: string) {
  runOperationTracked(operation, 'primary', true);
});

When('the {string} operation runs on each context', function (operation: string) {
  const primaryCtx = getOrBuildContext('primary');
  const beforePrimary = W791.spyCalls.length;
  runOperation(primaryCtx, operation);
  W791.operationRuns.push({ operation: `${operation}:primary`, calls: W791.spyCalls.slice(beforePrimary), error: null });

  const secondaryCtx = getOrBuildContext('secondary');
  const beforeSecondary = W791.spyCalls.length;
  runOperation(secondaryCtx, operation);
  W791.operationRuns.push({ operation: `${operation}:secondary`, calls: W791.spyCalls.slice(beforeSecondary), error: null });
});

When('the command {string} is executed through the public executor carrying the credential {string}', function (command: string, credential: string) {
  const ctx = getOrBuildContext('primary');
  ctx.exec(command, { cwd: { kind: 'frameworkRoot' }, env: { GH_TOKEN: credential } });
});

// ---------------------------------------------------------------------------
// When — the launch boundary (§12)
// ---------------------------------------------------------------------------

When('a git context is built through the launch boundary for the repository {string}', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  const provider = getSharedProvider();
  const targetRepo: TargetRepoInfo = { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
  W791.launchCtx = buildLaunchGitContext(targetRepo, {
    tokenProvider: provider,
    resolveGitIdentity: () => FIXED_IDENTITY,
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_ROOT,
  });
});

When('the context is asked to assemble a command environment twice', function () {
  assert.ok(W791.launchCtx !== null, 'Expected a launch context to have been built');
  const ctx = W791.launchCtx;
  W791.launchEnvs = [ctx.commandEnv(), ctx.commandEnv()];
});

// ---------------------------------------------------------------------------
// Then — assertions
// ---------------------------------------------------------------------------

Then('the recorded commands carried the credentials {string} and {string} in order', function (first: string, second: string) {
  assert.ok(W791.spyCalls.length >= 2, `Expected at least 2 recorded commands but got ${W791.spyCalls.length}`);
  assert.strictEqual(W791.spyCalls[0].env.GH_TOKEN, first);
  assert.strictEqual(W791.spyCalls[1].env.GH_TOKEN, second);
});

Then('the credential provider was asked exactly {int} times', function (expected: number) {
  assert.strictEqual(W791.providerCalls.length, expected);
});

Then('the recorded commands each carried a different credential', function () {
  const calls = lastRun().calls;
  assert.ok(calls.length >= 2, `Expected at least 2 recorded commands but got ${calls.length}`);
  const tokens = calls.map((c) => c.env.GH_TOKEN);
  assert.strictEqual(new Set(tokens).size, tokens.length, `Expected all distinct credentials but got: ${tokens.join(', ')}`);
});

Then('the {string} operation spawned with the credential {string}', function (operation: string, credential: string) {
  const runs = runsForOperation(operation);
  assert.ok(runs.length > 0, `Expected at least one run of operation "${operation}"`);
  const last = runs[runs.length - 1];
  assert.ok(last.calls.length > 0, `Expected operation "${operation}" to have spawned at least one command`);
  assert.strictEqual(last.calls[0].env.GH_TOKEN, credential);
});

Then('no further command reached the spawn seam', function () {
  assert.strictEqual(lastRun().calls.length, 0, `Expected no new recorded commands but got ${lastRun().calls.length}`);
});

Then('no command reached the spawn seam', function () {
  assert.strictEqual(lastRun().calls.length, 0, `Expected no recorded commands but got ${lastRun().calls.length}`);
});

Then('no recorded command carried the stray ambient credential', function () {
  assert.ok(W791.ambientSentinelValue !== null, 'Expected an ambient sentinel to have been configured');
  const sentinel = W791.ambientSentinelValue;
  for (const call of W791.spyCalls) {
    assert.notStrictEqual(call.env.GH_TOKEN, sentinel, `A recorded command carried the ambient sentinel: ${JSON.stringify(call)}`);
  }
});

Then('the operation failed with an error naming the repository {string}', function (fullName: string) {
  assert.ok(W791.lastError instanceof Error, 'Expected an error to have been captured');
  assert.ok(
    (W791.lastError as Error).message.includes(fullName),
    `Expected error to name "${fullName}" but got: ${(W791.lastError as Error).message}`,
  );
});

Then('the recorded command carried the credential {string}', function (credential: string) {
  assert.ok(W791.spyCalls.length > 0, 'Expected at least one recorded command');
  assert.strictEqual(W791.spyCalls[W791.spyCalls.length - 1].env.GH_TOKEN, credential);
});

Then('the two operations spawned with the credentials {string} and {string}', function (first: string, second: string) {
  const primaryRuns = W791.operationRuns.filter((r) => r.operation.endsWith(':primary'));
  const secondaryRuns = W791.operationRuns.filter((r) => r.operation.endsWith(':secondary'));
  assert.ok(primaryRuns.length > 0 && secondaryRuns.length > 0, 'Expected both contexts to have run an operation');
  const primaryCredential = primaryRuns[primaryRuns.length - 1].calls[0]?.env.GH_TOKEN;
  const secondaryCredential = secondaryRuns[secondaryRuns.length - 1].calls[0]?.env.GH_TOKEN;
  assert.strictEqual(primaryCredential, first);
  assert.strictEqual(secondaryCredential, second);
});

Then('the two assembled command environments carried different credentials', function () {
  assert.strictEqual(W791.launchEnvs.length, 2, 'Expected two assembled command environments');
  assert.notStrictEqual(W791.launchEnvs[0].GH_TOKEN, W791.launchEnvs[1].GH_TOKEN);
});

Then('the run modified no process environment variable', function () {
  assert.ok(W791.envSnapshot !== null, 'Expected an environment snapshot to have been captured');
  const snap = W791.envSnapshot;
  const snapKeys = new Set(Object.keys(snap));
  const curKeys = new Set(Object.keys(process.env));
  const diffs: string[] = [];
  for (const k of curKeys) { if (!snapKeys.has(k)) diffs.push(`ADDED: ${k}`); }
  for (const k of snapKeys) { if (!curKeys.has(k)) diffs.push(`REMOVED: ${k}`); }
  for (const k of snapKeys) { if (curKeys.has(k) && process.env[k] !== snap[k]) diffs.push(`CHANGED: ${k}`); }
  assert.strictEqual(diffs.length, 0, `Expected no process.env mutation but got: ${diffs.join(', ')}`);
});
