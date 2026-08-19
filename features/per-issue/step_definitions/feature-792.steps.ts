/**
 * BDD step definitions for feature-792.feature
 *
 * GitHub knowledge consolidates into the forge adapter package: the gh
 * command-string builders, GitHub App authentication and token resolution
 * move out of the git core; App configuration is injected instead of read
 * from the environment; the CI guard's exempt set names exactly two
 * packages.
 *
 * Reuses gitContextSharedWorld.ts (`makeSpyExec`, `makeNoOpFsDeps`,
 * `FRAMEWORK_ROOT`, `TARGET_REPOS_ROOT`) per this file's own testing notes.
 * A module-private world (`W792`) holds this issue's bookkeeping: the
 * pending context args, the credential-provider spec, the GitHub API
 * (runCurl) recording seam, the App-config/ambient-environment state, and
 * per-operation call tracking — mirroring the shape of feature-790's `w790`
 * and feature-791's `W791`.
 *
 * Does NOT redefine (reused, registered elsewhere):
 *  - 'the ADW codebase is checked out'                       → ensureCronOnEveryEventSteps.ts (G18)
 *  - 'the ADW TypeScript type-check passes'                  → feature-504.steps.ts (T22)
 *  - 'the process working directory is moved outside...'     → feature-790.steps.ts (§3; its global After restores cwd)
 *  - 'the git/gh guard runs across the whole ADW repository' → feature-769.steps.ts (§19)
 *  - 'the guard run reports no violations'                   → feature-769.steps.ts (§19)
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { GitContextOptions, ExecFn, TokenProvider } from '../../../adws/gitContext/index.ts';
import { makeSpyExec, makeNoOpFsDeps, FRAMEWORK_ROOT, TARGET_REPOS_ROOT, type SpyCall } from './gitContextSharedWorld.ts';
import { createGhCommandRunner } from '../../../adws/providers/github/ghCommandRunner.ts';
import {
  isGitHubAppConfigured,
  getInstallationToken,
  clearAppAuthCaches,
} from '../../../adws/providers/github/appAuth.ts';
import type { GitHubAppConfig, RunCurl } from '../../../adws/providers/github/appAuth.ts';
import { createGitHubTokenProvider } from '../../../adws/providers/github/githubTokenProvider.ts';
import { resolveContextToken } from '../../../adws/providers/github/tokenResolver.ts';
import {
  fetchIssueCmd, commentOnIssueCmd, addIssueLabelCmd,
} from '../../../adws/providers/github/commands/issueCommands.ts';
import { mergePRCmd, approvePRCmd } from '../../../adws/providers/github/commands/prCommands.ts';
import { createLabelCmd } from '../../../adws/providers/github/commands/labelCommands.ts';
import { setSecretCmd } from '../../../adws/providers/github/commands/secretCommands.ts';
import { projectQueryCmd } from '../../../adws/providers/github/commands/boardCommands.ts';
import { scanFiles, collectTsFiles } from '../../../adws/checkGitGhGuard.ts';

const OWNER = 'acme';
const REPO = 'webapp';

const FIXED_IDENTITY = {
  authorName: 'ADW Fixture Bot',
  authorEmail: 'fixture-bot@adw.dev',
  committerName: 'ADW Fixture Bot',
  committerEmail: 'fixture-bot@adw.dev',
};

const JWT_SHAPE_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;

// ---------------------------------------------------------------------------
// #792 world state
// ---------------------------------------------------------------------------

interface PendingContext {
  owner: string;
  repo: string;
}

type ProviderSpec =
  | { kind: 'scripted'; credential: string }
  | { kind: 'adapter' };

interface OperationRun {
  operation: string;
  calls: SpyCall[];
  error: unknown;
  result: unknown;
}

interface GithubApiCall {
  args: readonly string[];
  config: string;
}

interface World792 {
  pending: PendingContext | null;
  providerSpec: ProviderSpec;
  ctx: GitContext | null;
  spyExec: ExecFn | null;
  spyCalls: SpyCall[];
  responseMap: Map<string, string | Error>;
  operationRuns: OperationRun[];
  envSnapshot: NodeJS.ProcessEnv | null;

  // Credential configuration for the adapter's real TokenProvider
  pat: string | undefined;
  alternateIdentityPat: string | undefined;
  ghCliToken: string;

  // App configuration + ambient environment
  appConfig: GitHubAppConfig | null;
  ambientPriorAppId: string | undefined;
  ambientPriorAppSlug: string | undefined;
  ambientPriorKeyPath: string | undefined;
  ambientSaved: boolean;
  scratchDir: string | null;

  // GitHub API (runCurl) recording seam
  githubApiCalls: GithubApiCall[];
  runCurl: RunCurl;
  lastSeamAnswer: string | null;

  // Mint / resolution results
  mintedToken: string | null;
  mintResults: Array<string | null>;
  mintCallDeltas: number[];
  resolvedCredential: string | null;
  lastError: unknown;

  // Adapter's own gh call site (§11a)
  lastAdapterResult: string | null;
  lastAdapterCalls: SpyCall[];

  // Guard fixture (§15-18)
  fixtureRoot: string | null;
  fixtureRelPath: string | null;
  guardExitCode: number | null;
  guardStdout: string;

  // §14 refusal
  refusalError: Error | null;
  refusalAttempts: number;
}

const W792: World792 = {
  pending: null,
  providerSpec: { kind: 'adapter' },
  ctx: null,
  spyExec: null,
  spyCalls: [],
  responseMap: new Map(),
  operationRuns: [],
  envSnapshot: null,
  pat: 'default-adapter-pat',
  alternateIdentityPat: undefined,
  ghCliToken: '',
  appConfig: null,
  ambientPriorAppId: undefined,
  ambientPriorAppSlug: undefined,
  ambientPriorKeyPath: undefined,
  ambientSaved: false,
  scratchDir: null,
  githubApiCalls: [],
  runCurl: () => { throw new Error('W792.runCurl: no canned response configured'); },
  lastSeamAnswer: null,
  mintedToken: null,
  mintResults: [],
  mintCallDeltas: [],
  resolvedCredential: null,
  lastError: null,
  lastAdapterResult: null,
  lastAdapterCalls: [],
  fixtureRoot: null,
  fixtureRelPath: null,
  guardExitCode: null,
  guardStdout: '',
  refusalError: null,
  refusalAttempts: 0,
};

Before({ tags: '@adw-792' }, function () {
  clearAppAuthCaches();
  W792.pending = null;
  W792.providerSpec = { kind: 'adapter' };
  W792.ctx = null;
  W792.spyExec = null;
  W792.spyCalls = [];
  W792.responseMap = new Map();
  W792.operationRuns = [];
  W792.envSnapshot = null;
  W792.pat = 'default-adapter-pat';
  W792.alternateIdentityPat = undefined;
  W792.ghCliToken = '';
  W792.appConfig = null;
  W792.ambientPriorAppId = undefined;
  W792.ambientPriorAppSlug = undefined;
  W792.ambientPriorKeyPath = undefined;
  W792.ambientSaved = false;
  W792.scratchDir = null;
  W792.githubApiCalls = [];
  W792.runCurl = () => { throw new Error('W792.runCurl: no canned response configured'); };
  W792.lastSeamAnswer = null;
  W792.mintedToken = null;
  W792.mintResults = [];
  W792.mintCallDeltas = [];
  W792.resolvedCredential = null;
  W792.lastError = null;
  W792.lastAdapterResult = null;
  W792.lastAdapterCalls = [];
  W792.fixtureRoot = null;
  W792.fixtureRelPath = null;
  W792.guardExitCode = null;
  W792.guardStdout = '';
  W792.refusalError = null;
  W792.refusalAttempts = 0;
});

After({ tags: '@adw-792' }, function () {
  if (W792.ambientSaved) {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    };
    restore('GITHUB_APP_ID', W792.ambientPriorAppId);
    restore('GITHUB_APP_SLUG', W792.ambientPriorAppSlug);
    restore('GITHUB_APP_PRIVATE_KEY_PATH', W792.ambientPriorKeyPath);
  }
  if (W792.scratchDir) {
    fs.rmSync(W792.scratchDir, { recursive: true, force: true });
  }
  if (W792.fixtureRoot) {
    fs.rmSync(W792.fixtureRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers — GitHub API (runCurl) recording seam
// ---------------------------------------------------------------------------

interface CannedResponse { status: number; body: string }

/** Replays `responses` in order; once exhausted, keeps replaying the last one — a second mint's repeated call to the same logical endpoint (e.g. a re-exchange once the installation id is cached) gets a valid answer rather than an artificial "queue exhausted" failure. */
function makeRecordingRunCurl(responses: readonly CannedResponse[]): RunCurl {
  let index = 0;
  return (args, stdinConfig) => {
    W792.githubApiCalls.push({ args, config: stdinConfig });
    const next = responses[Math.min(index, responses.length - 1)];
    index++;
    if (!next) throw new Error('W792 runCurl: no canned response configured');
    return `${next.body}\n${next.status}`;
  };
}

function parseInstallationId(label: string): string {
  const m = /^installation-(.+)$/.exec(label);
  return m ? m[1] : label;
}

function extractJwtFromConfig(config: string): string {
  const match = config.match(/Bearer ([^"\s]+)/);
  assert.ok(match, `Expected a Bearer header in curl config:\n${config}`);
  return match![1];
}

function decodeJwtIssuer(jwt: string): string {
  const payloadB64 = jwt.split('.')[1];
  const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
  return (JSON.parse(json) as { iss: string }).iss;
}

function ensureScratchDir(): string {
  if (!W792.scratchDir) {
    W792.scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-792-'));
  }
  return W792.scratchDir;
}

function generateThrowawayKeyPath(): string {
  const dir = ensureScratchDir();
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const keyPath = path.join(dir, `throwaway-key-${Date.now()}-${Math.random().toString(36).slice(2)}.pem`);
  fs.writeFileSync(keyPath, privateKey, 'utf-8');
  return keyPath;
}

/** Wired to the adapter's real getInstallationToken, whatever W792.appConfig currently is (default `{}`). A defect in isGitHubAppConfigured would surface here even in scenarios that don't expect a mint. */
function mintViaAdapter(owner: string, repo: string): string {
  const config = W792.appConfig ?? {};
  return getInstallationToken(config, owner, repo, { runCurl: W792.runCurl });
}

function isAppConfiguredViaAdapter(): boolean {
  return isGitHubAppConfigured(W792.appConfig ?? {});
}

// ---------------------------------------------------------------------------
// Helpers — context construction (lazy: built when the command seam Given fires)
// ---------------------------------------------------------------------------

function buildProvider(): TokenProvider {
  if (W792.providerSpec.kind === 'scripted') {
    const credential = W792.providerSpec.credential;
    return { credentialEnv: (): NodeJS.ProcessEnv => ({ GH_TOKEN: credential }) };
  }
  return createGitHubTokenProvider({
    pat: W792.pat,
    alternateIdentityPat: W792.alternateIdentityPat,
    isAppConfigured: isAppConfiguredViaAdapter,
    mintInstallationToken: mintViaAdapter,
    ghAuthToken: () => W792.ghCliToken,
  });
}

function buildAndInstallContext(): GitContext {
  assert.ok(W792.pending, 'Expected a prior Given to have configured the target repository');
  const options: GitContextOptions = {
    owner: W792.pending.owner,
    repo: W792.pending.repo,
    selfHost: false,
    tokenProvider: buildProvider(),
    gitIdentity: FIXED_IDENTITY,
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_ROOT,
  };
  assert.ok(W792.spyExec, 'Expected the command seam to have been installed before context construction');
  const ctx = new GitContext(options, { exec: W792.spyExec, fsDeps: makeNoOpFsDeps() });
  W792.ctx = ctx;
  W792.envSnapshot = { ...process.env };
  return ctx;
}

function getContext(): GitContext {
  assert.ok(W792.ctx, 'Expected the command seam Given to have built the context');
  return W792.ctx;
}

// ---------------------------------------------------------------------------
// Helpers — forge operation dispatch (§1, §2, §11, §12, §13, §14)
// ---------------------------------------------------------------------------

function runOperation(ctx: GitContext, operation: string): unknown {
  switch (operation) {
    case 'fetch-issue': return ctx.fetchIssue(7);
    case 'comment-on-issue': ctx.commentOnIssue(7, 'body text'); return undefined;
    case 'close-issue': ctx.closeIssue(7); return undefined;
    case 'add-issue-label': ctx.addIssueLabel(7, 'needs-review'); return undefined;
    case 'delete-issue-comment': ctx.deleteIssueComment(9001); return undefined;
    case 'merge-pr': ctx.mergePR(42); return undefined;
    case 'approve-pr': ctx.approvePR(42); return undefined;
    case 'pr-changed-files': return ctx.fetchPRChangedFiles(42);
    case 'create-label': ctx.createLabel('adw:upgrade', 'ededed', 'Framework upgrade'); return undefined;
    case 'set-secret': ctx.setSecret('ADW_TOKEN', 'secret-value'); return undefined;
    case 'board-project-query': return ctx.moveIssueToStatus(28, 'In Progress');
    default: throw new Error(`Unknown forge operation: "${operation}"`);
  }
}

/** The adapter builder's expected command string for §2's operations — the same arguments runOperation uses. */
function expectedAdapterCommand(operation: string): string {
  switch (operation) {
    case 'fetch-issue': return fetchIssueCmd(OWNER, REPO, 7);
    case 'comment-on-issue': return commentOnIssueCmd(OWNER, REPO, 7);
    case 'add-issue-label': return addIssueLabelCmd(OWNER, REPO, 7, 'needs-review');
    case 'merge-pr': return mergePRCmd(OWNER, REPO, 42);
    case 'approve-pr': return approvePRCmd(OWNER, REPO, 42);
    case 'create-label': return createLabelCmd(OWNER, REPO, 'adw:upgrade', 'ededed', 'Framework upgrade');
    case 'set-secret': return setSecretCmd(OWNER, REPO, 'ADW_TOKEN');
    case 'board-project-query': return projectQueryCmd(OWNER, REPO);
    default: throw new Error(`No adapter builder mapping for operation "${operation}"`);
  }
}

function runOperationTracked(operation: string, captureFailure: boolean): void {
  const ctx = getContext();
  const before = W792.spyCalls.length;
  try {
    const result = runOperation(ctx, operation);
    W792.operationRuns.push({ operation, calls: W792.spyCalls.slice(before), error: null, result });
    W792.lastError = null;
  } catch (err) {
    W792.operationRuns.push({ operation, calls: W792.spyCalls.slice(before), error: err, result: undefined });
    W792.lastError = err;
    if (!captureFailure) throw err;
  }
}

function lastRunForOperation(operation: string): OperationRun {
  const runs = W792.operationRuns.filter((r) => r.operation === operation);
  assert.ok(runs.length > 0, `Expected at least one run of operation "${operation}"`);
  return runs[runs.length - 1];
}

function firstCallForOperation(operation: string): SpyCall {
  const run = lastRunForOperation(operation);
  assert.ok(run.calls.length > 0, `Expected operation "${operation}" to have issued at least one command`);
  return run.calls[0];
}

// ---------------------------------------------------------------------------
// Given — context construction
// ---------------------------------------------------------------------------

Given('a git context for the repository {string} wired to the GitHub forge adapter', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  W792.pending = { owner, repo };
  W792.providerSpec = { kind: 'adapter' };
});

Given(
  'a git context for the repository {string} whose credentials come from a forge-neutral provider answering {string}',
  function (fullName: string, credential: string) {
    const [owner, repo] = fullName.split('/');
    W792.pending = { owner, repo };
    W792.providerSpec = { kind: 'scripted', credential };
  },
);

Given('the command seam records every command with its working directory and child environment', function () {
  const { exec, calls } = makeSpyExec(W792.responseMap);
  W792.spyExec = exec;
  W792.spyCalls = calls;
  buildAndInstallContext();
});

Given('the command seam answers commands matching {string} with {string}', function (match: string, answer: string) {
  W792.responseMap.set(match, answer);
  W792.lastSeamAnswer = answer;
});

Given('the command seam refuses every command', function () {
  const error = new Error('command seam: refused');
  W792.refusalError = error;
  const exec: ExecFn = () => {
    W792.refusalAttempts += 1;
    throw error;
  };
  W792.spyExec = exec;
  W792.spyCalls = [];
  buildAndInstallContext();
});

// ---------------------------------------------------------------------------
// Given — credential configuration for the adapter's real TokenProvider
// ---------------------------------------------------------------------------

Given(
  'the adapter is configured with the personal access token {string} and the gh CLI token {string}',
  function (pat: string, ghCli: string) {
    W792.pat = pat;
    W792.ghCliToken = ghCli;
  },
);

Given(
  'the adapter is configured with the personal access token {string} and the alternate identity token {string}',
  function (pat: string, alternate: string) {
    W792.pat = pat;
    W792.alternateIdentityPat = alternate;
  },
);

// ---------------------------------------------------------------------------
// Given — App configuration + ambient environment (§3-§10)
// ---------------------------------------------------------------------------

Given('the ambient environment carries GitHub App variables for app id {string} and slug {string}', function (appId: string, slug: string) {
  if (!W792.ambientSaved) {
    W792.ambientPriorAppId = process.env.GITHUB_APP_ID;
    W792.ambientPriorAppSlug = process.env.GITHUB_APP_SLUG;
    W792.ambientPriorKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    W792.ambientSaved = true;
  }
  process.env.GITHUB_APP_ID = appId;
  process.env.GITHUB_APP_SLUG = slug;
});

Given('the ambient environment carries no GitHub App variables', function () {
  if (!W792.ambientSaved) {
    W792.ambientPriorAppId = process.env.GITHUB_APP_ID;
    W792.ambientPriorAppSlug = process.env.GITHUB_APP_SLUG;
    W792.ambientPriorKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    W792.ambientSaved = true;
  }
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_SLUG;
  delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;
});

Given(
  'the adapter\'s App configuration names app id {string}, slug {string} and a throwaway private key',
  function (appId: string, appSlug: string) {
    W792.appConfig = { appId, appSlug, privateKeyPath: generateThrowawayKeyPath() };
  },
);

Given('the adapter\'s App configuration is absent', function () {
  W792.appConfig = {};
});

Given('the GitHub API seam records every request', function () {
  W792.githubApiCalls = [];
  W792.runCurl = makeRecordingRunCurl([]);
});

Given(
  'the GitHub API seam answers an installation lookup with {string} and a token exchange with {string}',
  function (installLabel: string, token: string) {
    const id = parseInstallationId(installLabel);
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    W792.runCurl = makeRecordingRunCurl([
      { status: 200, body: `{"id":${id}}` },
      { status: 200, body: `{"token":"${token}","expires_at":"${expiresAt}"}` },
    ]);
  },
);

Given(
  'the GitHub API seam answers an installation lookup with {string} and a token exchange with {string} expiring in {int} minutes',
  function (installLabel: string, token: string, minutes: number) {
    const id = parseInstallationId(installLabel);
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    W792.runCurl = makeRecordingRunCurl([
      { status: 200, body: `{"id":${id}}` },
      { status: 200, body: `{"token":"${token}","expires_at":"${expiresAt}"}` },
    ]);
  },
);

Given('the GitHub API seam answers the installation lookup with a not-found response', function () {
  W792.runCurl = makeRecordingRunCurl([{ status: 404, body: '{"message":"Not Found"}' }]);
});

// ---------------------------------------------------------------------------
// When — App mint / resolution (§3-§10)
// ---------------------------------------------------------------------------

function recordMintDelta(fn: () => string): string {
  const before = W792.githubApiCalls.length;
  const token = fn();
  W792.mintCallDeltas.push(W792.githubApiCalls.length - before);
  return token;
}

When('an installation credential is minted for the repository {string}', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  const token = recordMintDelta(() => mintViaAdapter(owner, repo));
  W792.mintedToken = token;
  W792.mintResults.push(token);
  W792.lastError = null;
});

When('an installation credential is minted for the repository {string} a second time', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  const token = recordMintDelta(() => mintViaAdapter(owner, repo));
  W792.mintedToken = token;
  W792.mintResults.push(token);
  W792.lastError = null;
});

When('an installation credential is minted for the repository {string} and any failure is captured', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  try {
    W792.mintedToken = recordMintDelta(() => mintViaAdapter(owner, repo));
    W792.lastError = null;
  } catch (err) {
    W792.mintedToken = null;
    W792.lastError = err;
  }
});

When('a credential is resolved through the adapter for the repository {string}', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  W792.resolvedCredential = resolveContextToken({
    owner, repo,
    pat: W792.pat,
    isAppConfigured: isAppConfiguredViaAdapter,
    mintInstallationToken: mintViaAdapter,
    ghAuthToken: () => W792.ghCliToken,
  });
  W792.lastError = null;
});

When('a credential is resolved through the adapter for the repository {string} and any failure is captured', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  try {
    W792.resolvedCredential = resolveContextToken({
      owner, repo,
      pat: W792.pat,
      isAppConfigured: isAppConfiguredViaAdapter,
      mintInstallationToken: mintViaAdapter,
      ghAuthToken: () => W792.ghCliToken,
    });
    W792.lastError = null;
  } catch (err) {
    W792.resolvedCredential = null;
    W792.lastError = err;
  }
});

// ---------------------------------------------------------------------------
// When — forge operations (§1, §2, §3, §11, §12, §13, §14)
// ---------------------------------------------------------------------------

When('the forge operation {string} is invoked', function (operation: string) {
  runOperationTracked(operation, false);
});

When('the forge operation {string} is invoked and any failure is captured', function (operation: string) {
  runOperationTracked(operation, true);
});

// ---------------------------------------------------------------------------
// When — the adapter's own gh call site (§11a)
// ---------------------------------------------------------------------------

When('the forge adapter issues the gh command {string}', function (command: string) {
  const runner = createGhCommandRunner(getContext());
  const before = W792.spyCalls.length;
  W792.lastAdapterResult = runner.run(command);
  W792.lastAdapterCalls = W792.spyCalls.slice(before);
});

When('the forge adapter issues its board project query for the repository {string}', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  const runner = createGhCommandRunner(getContext());
  const before = W792.spyCalls.length;
  W792.lastAdapterResult = runner.run(projectQueryCmd(owner, repo), { purpose: 'alternateIdentity' });
  W792.lastAdapterCalls = W792.spyCalls.slice(before);
});

// ---------------------------------------------------------------------------
// Then — §1, §2 command-string assertions
// ---------------------------------------------------------------------------

Then('the executed command for the forge operation {string} is exactly {string}', function (operation: string, command: string) {
  assert.strictEqual(firstCallForOperation(operation).command, command);
});

Then('the executed command for the forge operation {string} is exactly the command the adapter builder produces for it', function (operation: string) {
  assert.strictEqual(firstCallForOperation(operation).command, expectedAdapterCommand(operation));
});

// ---------------------------------------------------------------------------
// Then — §3 core carries no GitHub credential machinery
// ---------------------------------------------------------------------------

Then('every executed command carried the credential {string}', function (credential: string) {
  assert.ok(W792.spyCalls.length > 0, 'Expected at least one recorded command');
  for (const call of W792.spyCalls) {
    assert.strictEqual(call.env.GH_TOKEN, credential);
  }
});

Then('no request reached the GitHub API seam', function () {
  assert.strictEqual(W792.githubApiCalls.length, 0, `Expected no GitHub API requests but got: ${JSON.stringify(W792.githubApiCalls)}`);
});

// ---------------------------------------------------------------------------
// Then — §4-§7 mint / resolution outcomes
// ---------------------------------------------------------------------------

Then('the minted credential is {string}', function (expected: string) {
  assert.strictEqual(W792.mintedToken, expected);
});

Then('the recorded mint request was signed for app id {string}', function (appId: string) {
  assert.ok(W792.githubApiCalls.length > 0, 'Expected at least one recorded GitHub API request');
  const jwt = extractJwtFromConfig(W792.githubApiCalls[0].config);
  assert.strictEqual(decodeJwtIssuer(jwt), appId);
});

Then('the resolved credential is {string}', function (expected: string) {
  assert.strictEqual(W792.resolvedCredential, expected);
});

Then('the recorded mint request looked up the installation for the repository {string}', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  assert.ok(W792.githubApiCalls.length > 0, 'Expected at least one recorded GitHub API request');
  assert.ok(
    W792.githubApiCalls[0].config.includes(`/repos/${owner}/${repo}/installation`),
    `Expected the first recorded request to look up the installation for ${fullName}. Got:\n${W792.githubApiCalls[0].config}`,
  );
});

Then('the resolution failed naming the repository {string}', function (fullName: string) {
  assert.ok(W792.lastError instanceof Error, 'Expected a captured resolution failure');
  assert.ok(
    (W792.lastError as Error).message.includes(fullName),
    `Expected the failure to name "${fullName}" but got: ${(W792.lastError as Error).message}`,
  );
});

Then('the resolution returned no credential', function () {
  assert.strictEqual(W792.resolvedCredential, null);
});

// ---------------------------------------------------------------------------
// Then — §8 credential-on-stdin regression guard
// ---------------------------------------------------------------------------

Then('no recorded request carried a credential in its command arguments', function () {
  assert.ok(W792.githubApiCalls.length > 0, 'Expected at least one recorded GitHub API request');
  const jwt = extractJwtFromConfig(W792.githubApiCalls[0].config);
  for (const call of W792.githubApiCalls) {
    assert.strictEqual(call.args.join(' '), '--config -');
    assert.ok(!call.args.some((a) => /Bearer/.test(a) || a.includes(jwt)));
  }
});

Then('every recorded request carried exactly one authorization header on its standard input', function () {
  assert.ok(W792.githubApiCalls.length > 0, 'Expected at least one recorded GitHub API request');
  for (const call of W792.githubApiCalls) {
    const bearerLines = call.config.split('\n').filter((line) => line.includes('Authorization: Bearer'));
    assert.strictEqual(bearerLines.length, 1, `Expected exactly one Authorization line in:\n${call.config}`);
  }
});

// ---------------------------------------------------------------------------
// Then — §9 sanitized mint failures
// ---------------------------------------------------------------------------

Then('the mint failure names the operation, the repository {string} and the response status', function (fullName: string) {
  assert.ok(W792.lastError instanceof Error, 'Expected a captured mint failure');
  const message = (W792.lastError as Error).message;
  assert.ok(message.includes('installation lookup'), `Expected "installation lookup" in: ${message}`);
  assert.ok(message.includes(fullName), `Expected "${fullName}" in: ${message}`);
  assert.ok(message.includes('HTTP 404'), `Expected "HTTP 404" in: ${message}`);
});

Then('the mint failure discloses no credential', function () {
  assert.ok(W792.lastError instanceof Error, 'Expected a captured mint failure');
  const message = (W792.lastError as Error).message;
  assert.doesNotMatch(message, JWT_SHAPE_PATTERN, `Expected no JWT-shaped token in: ${message}`);
  assert.ok(!message.includes('Bearer'), `Expected no "Bearer" in: ${message}`);
});

// ---------------------------------------------------------------------------
// Then — §10 expiry-aware cache
// ---------------------------------------------------------------------------

Then('both mints produced the credential {string}', function (expected: string) {
  assert.strictEqual(W792.mintResults.length, 2, `Expected two mint results but got ${W792.mintResults.length}`);
  assert.strictEqual(W792.mintResults[0], expected);
  assert.strictEqual(W792.mintResults[1], expected);
});

Then('the second mint issued no further request to the GitHub API seam', function () {
  assert.strictEqual(W792.mintCallDeltas.length, 2, `Expected two recorded mint deltas but got ${W792.mintCallDeltas.length}`);
  assert.strictEqual(W792.mintCallDeltas[1], 0);
});

Then('the second mint issued a further token exchange to the GitHub API seam', function () {
  assert.strictEqual(W792.mintCallDeltas.length, 2, `Expected two recorded mint deltas but got ${W792.mintCallDeltas.length}`);
  assert.strictEqual(W792.mintCallDeltas[1], 1);
});

// ---------------------------------------------------------------------------
// Then — §11 executor seam
// ---------------------------------------------------------------------------

Then('the forge operation {string} returned the value the command seam answered', function (operation: string) {
  const run = lastRunForOperation(operation);
  const answer = W792.lastSeamAnswer;
  assert.ok(answer !== null, 'Expected a prior Given to have seeded a seam answer');
  assert.strictEqual(run.result, answer!.trim());
});

Then('every executed command reached the command seam', function () {
  assert.ok(W792.spyCalls.length > 0, 'Expected at least one command to have reached the command seam');
});

// ---------------------------------------------------------------------------
// Then — §11a the adapter's own gh call site
// ---------------------------------------------------------------------------

Then('the adapter\'s gh command returned the value the command seam answered', function () {
  assert.ok(W792.lastSeamAnswer !== null, 'Expected a prior Given to have seeded a seam answer');
  assert.strictEqual(W792.lastAdapterResult, W792.lastSeamAnswer!.trim());
});

Then('the adapter\'s gh command ran from the framework root directory', function () {
  assert.ok(W792.lastAdapterCalls.length > 0, 'Expected at least one recorded adapter command');
  assert.strictEqual(W792.lastAdapterCalls[W792.lastAdapterCalls.length - 1].cwd, FRAMEWORK_ROOT);
});

Then('the adapter\'s gh command carried the credential {string}', function (credential: string) {
  assert.ok(W792.lastAdapterCalls.length > 0, 'Expected at least one recorded adapter command');
  assert.strictEqual(W792.lastAdapterCalls[W792.lastAdapterCalls.length - 1].env.GH_TOKEN, credential);
});

// ---------------------------------------------------------------------------
// Then — §12 working-directory contract
// ---------------------------------------------------------------------------

Then('the forge operation {string} executed its command from the framework root directory', function (operation: string) {
  assert.strictEqual(firstCallForOperation(operation).cwd, FRAMEWORK_ROOT);
});

// ---------------------------------------------------------------------------
// Then — §13 credential + identity assembly, no process.env mutation
// ---------------------------------------------------------------------------

Then('every executed command carried the context\'s git author and committer identity', function () {
  assert.ok(W792.spyCalls.length > 0, 'Expected at least one recorded command');
  for (const call of W792.spyCalls) {
    assert.strictEqual(call.env.GIT_AUTHOR_NAME, FIXED_IDENTITY.authorName);
    assert.strictEqual(call.env.GIT_AUTHOR_EMAIL, FIXED_IDENTITY.authorEmail);
    assert.strictEqual(call.env.GIT_COMMITTER_NAME, FIXED_IDENTITY.committerName);
    assert.strictEqual(call.env.GIT_COMMITTER_EMAIL, FIXED_IDENTITY.committerEmail);
  }
});

Then('the adapter run left every process environment variable untouched', function () {
  assert.ok(W792.envSnapshot !== null, 'Expected an environment snapshot to have been captured');
  const snap = W792.envSnapshot;
  const snapKeys = new Set(Object.keys(snap));
  const curKeys = new Set(Object.keys(process.env));
  const diffs: string[] = [];
  for (const k of curKeys) { if (!snapKeys.has(k)) diffs.push(`ADDED: ${k}`); }
  for (const k of snapKeys) { if (!curKeys.has(k)) diffs.push(`REMOVED: ${k}`); }
  for (const k of snapKeys) { if (curKeys.has(k) && process.env[k] !== snap[k]) diffs.push(`CHANGED: ${k}`); }
  assert.strictEqual(diffs.length, 0, `Expected no process.env mutation but got: ${diffs.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Then — §14 refused execution, no fallback spawn
// ---------------------------------------------------------------------------

Then('the forge operation {string} failed with the refusal from the command seam', function (operation: string) {
  const run = lastRunForOperation(operation);
  assert.strictEqual(run.error, W792.refusalError);
});

Then('no command ran outside the command seam', function () {
  assert.strictEqual(W792.refusalAttempts, 1, `Expected exactly one attempt through the command seam but got ${W792.refusalAttempts}`);
});

// ---------------------------------------------------------------------------
// Given/When/Then — §15-§18 guard-over-fixture-repository
// ---------------------------------------------------------------------------

Given('a fixture repository containing the file {string}:', function (relPath: string, source: string) {
  W792.fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-792-guard-'));
  W792.fixtureRelPath = relPath;
  const fullPath = path.join(W792.fixtureRoot, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, source, 'utf-8');
});

When('the git\\/gh guard runs over the fixture repository', function () {
  assert.ok(W792.fixtureRoot, 'Expected a prior Given to have written a fixture repository');
  // Drives the real collectTsFiles → scanFiles pipeline over the fixture root,
  // exactly as the CLI entry point does, exercising the EXEMPT_PACKAGES
  // exemption applied during collection — not merely scanFiles in isolation,
  // which never consults it.
  const files = collectTsFiles(W792.fixtureRoot, W792.fixtureRoot);
  const { violations } = scanFiles(files, W792.fixtureRoot);
  W792.guardExitCode = violations.length === 0 ? 0 : 1;
  W792.guardStdout = violations.map((v) => `${v.file}:${v.line}  [${v.rule}]  ${v.command}`).join('\n');
});

Then('the guard run over the fixture repository reports no violation', function () {
  assert.strictEqual(W792.guardExitCode, 0, `Expected the guard to pass. Output:\n${W792.guardStdout}`);
});

Then('the guard run over the fixture repository fails naming {string}', function (relPath: string) {
  assert.notStrictEqual(W792.guardExitCode, 0, `Expected the guard to fail. Output:\n${W792.guardStdout}`);
  assert.ok(
    W792.guardStdout.includes(relPath),
    `Expected the guard output to name "${relPath}". Output:\n${W792.guardStdout}`,
  );
});
