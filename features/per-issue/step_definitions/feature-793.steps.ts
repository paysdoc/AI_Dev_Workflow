/**
 * BDD step definitions for feature-793.feature
 *
 * The last GitHub conventions leave the git core: the workspace manager
 * clones the URL it is handed, bootstrap identity splits into generic git
 * reads (core) and GitHub derivation (adapter), and the two worktree
 * operations log through an injected port instead of importing ADW's logger.
 *
 * FOUR BINDING POINTS, ONE HELPER EACH (per the plan's step-definition note —
 * if any of these four functions is renamed or relocated, only the helper
 * changes, no scenario does):
 *   (1) the core workspace manager       → ensureRepoWorkspace (adws/gitContext)
 *   (2) the core identity resolver       → readEnvGitIdentity ?? readGitConfigIdentity (adws/gitContext)
 *   (3) the GitHub identity resolver     → resolveBootstrapGitIdentity / readLocalRepoInfo / parseGitHubRemoteUrl (adws/providers/github/githubIdentity)
 *   (4) the ADW clone-URL preparation    → convertToSshUrl, re-exported from adws/core/targetRepoManager
 *
 * Reuses gitContextSharedWorld.ts for the context-based sections (§9-§12) —
 * FRAMEWORK_ROOT, TARGET_REPOS_ROOT, makeFullOptions, makeNoOpFsDeps,
 * makeSpyExec, parseAuthor, W — and keeps issue-793 bookkeeping in a
 * module-private world (w793), as feature-790.steps.ts does with w790.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts (T22)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { Given, When, Then, After } from '@cucumber/cucumber';
import type { DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext, ensureRepoWorkspace, readEnvGitIdentity, readGitConfigIdentity, readOriginRemoteUrl } from '../../../adws/gitContext/index.ts';
import { createLiteralTokenProvider } from '../../../adws/providers/github/githubTokenProvider.ts';
import type { GitContextDeps, GitIdentity, LogLevel } from '../../../adws/gitContext/index.ts';
import { resolveBootstrapGitIdentity, readLocalRepoInfo } from '../../../adws/providers/github/githubIdentity.ts';
import type { RepoInfo } from '../../../adws/providers/github/githubIdentity.ts';
import { convertToSshUrl } from '../../../adws/core/targetRepoManager.ts';
import { buildLaunchGitContext } from '../../../adws/core/launchGitContext.ts';
import { setLogAdwId, resetLogAdwId } from '../../../adws/core/logger.ts';
import {
  W, makeSpyExec, makeFullOptions, makeNoOpFsDeps, parseAuthor, FRAMEWORK_ROOT, TARGET_REPOS_ROOT,
} from './gitContextSharedWorld.ts';

// ---------------------------------------------------------------------------
// BINDING POINT (2): the core identity resolver — a composition, since no
// composite resolver survives the split in the core itself.
// ---------------------------------------------------------------------------

type FakeExec = (cmd: string, opts?: unknown) => string;

function resolveCoreIdentity(env: NodeJS.ProcessEnv, exec: FakeExec): GitIdentity | null {
  return readEnvGitIdentity(env) ?? readGitConfigIdentity({ env, exec: exec as never });
}

// BINDING POINT (3): the GitHub identity resolver.
function resolveGitHubIdentity(env: NodeJS.ProcessEnv, exec: FakeExec): GitIdentity {
  return resolveBootstrapGitIdentity({ env, exec: exec as never });
}

function makeGitConfigExec(gitConfig: { name: string; email: string } | null): FakeExec {
  return (cmd: string): string => {
    if (gitConfig === null) throw new Error('git config not available');
    if (cmd === 'git config user.name') return gitConfig.name + '\n';
    if (cmd === 'git config user.email') return gitConfig.email + '\n';
    throw new Error(`Unexpected: ${cmd}`);
  };
}

// ---------------------------------------------------------------------------
// Module-private world
// ---------------------------------------------------------------------------

interface RecordedWorkspaceCall {
  command: string;
  cwd?: string;
}

interface LoggedMessage {
  message: string;
  level?: LogLevel;
}

interface World793 {
  // §1-4: workspace manager
  workspaceOwner: string;
  workspaceRepo: string;
  workspaceCloneUrl: string;
  workspaceAlreadyCloned: boolean;
  workspaceCalls: RecordedWorkspaceCall[];
  workspaceResultPath: string | null;
  defaultBranchConsulted: boolean;

  // §5-8: identity resolution
  identityEnv: NodeJS.ProcessEnv;
  identityGitConfig: { name: string; email: string } | null;
  identityResult: GitIdentity | null;
  identityThrew: boolean;
  checkoutTempDir: string | null;
  derivedRepoInfoResult: RepoInfo | null;
  derivedRepoInfoError: Error | null;
  originRemoteReadResult: string | null;
  originRemoteReadError: Error | null;
  commandEnvSpyCall: { env: NodeJS.ProcessEnv } | null;

  // §9-12: worktree ops + logger
  ctxOwner: string;
  ctxRepo: string;
  ctx: GitContext | null;
  loggerInjected: boolean;
  loggerSink: LoggedMessage[];
  lastOperationMarker: string;
  consoleCaptured: string[] | null;
  originalConsoleLog: typeof console.log | null;

  // §11: production-built context
  prodTempDir: string | null;
}

const w793: World793 = {
  workspaceOwner: '',
  workspaceRepo: '',
  workspaceCloneUrl: '',
  workspaceAlreadyCloned: false,
  workspaceCalls: [],
  workspaceResultPath: null,
  defaultBranchConsulted: false,

  identityEnv: {},
  identityGitConfig: null,
  identityResult: null,
  identityThrew: false,
  checkoutTempDir: null,
  derivedRepoInfoResult: null,
  derivedRepoInfoError: null,
  originRemoteReadResult: null,
  originRemoteReadError: null,
  commandEnvSpyCall: null,

  ctxOwner: '',
  ctxRepo: '',
  ctx: null,
  loggerInjected: false,
  loggerSink: [],
  lastOperationMarker: '',
  consoleCaptured: null,
  originalConsoleLog: null,

  prodTempDir: null,
};

After(function () {
  if (w793.originalConsoleLog !== null) {
    console.log = w793.originalConsoleLog;
    w793.originalConsoleLog = null;
  }
  if (w793.checkoutTempDir !== null) {
    fs.rmSync(w793.checkoutTempDir, { recursive: true, force: true });
    w793.checkoutTempDir = null;
  }
  if (w793.prodTempDir !== null) {
    fs.rmSync(w793.prodTempDir, { recursive: true, force: true });
    w793.prodTempDir = null;
    resetLogAdwId();
  }
  w793.workspaceOwner = '';
  w793.workspaceRepo = '';
  w793.workspaceCloneUrl = '';
  w793.workspaceAlreadyCloned = false;
  w793.workspaceCalls = [];
  w793.workspaceResultPath = null;
  w793.defaultBranchConsulted = false;
  w793.identityEnv = {};
  w793.identityGitConfig = null;
  w793.identityResult = null;
  w793.identityThrew = false;
  w793.derivedRepoInfoResult = null;
  w793.derivedRepoInfoError = null;
  w793.originRemoteReadResult = null;
  w793.originRemoteReadError = null;
  w793.commandEnvSpyCall = null;
  w793.ctxOwner = '';
  w793.ctxRepo = '';
  w793.ctx = null;
  w793.loggerInjected = false;
  w793.loggerSink = [];
  w793.lastOperationMarker = '';
  w793.consoleCaptured = null;
  W.ctx = null;
  W.spyCalls = [];
  W.responseMap = new Map();
});

// ── §1-4: workspace manager Givens ──────────────────────────────────────────

Given('a workspace manager for the repository {string} with no local clone present', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  w793.workspaceOwner = owner;
  w793.workspaceRepo = repo;
  w793.workspaceAlreadyCloned = false;
});

Given('a workspace manager for the repository {string} whose local clone is already present', function (fullName: string) {
  const [owner, repo] = fullName.split('/');
  w793.workspaceOwner = owner;
  w793.workspaceRepo = repo;
  w793.workspaceAlreadyCloned = true;
});

Given('the clone URL handed to the workspace manager is {string}', function (url: string) {
  w793.workspaceCloneUrl = url;
});

Given('the workspace manager records the commands it runs', function () {
  w793.workspaceCalls = [];
  w793.defaultBranchConsulted = false;
});

Given('an ADW target repository {string} that publishes the clone URL {string}', function (fullName: string, publishedUrl: string) {
  const [owner, repo] = fullName.split('/');
  w793.workspaceOwner = owner;
  w793.workspaceRepo = repo;
  w793.workspaceCloneUrl = publishedUrl;
  w793.workspaceAlreadyCloned = false;
});

// ── §1-4: workspace manager Whens ───────────────────────────────────────────

When('the workspace is ensured for that repository', function () {
  w793.workspaceResultPath = ensureRepoWorkspace(w793.workspaceOwner, w793.workspaceRepo, w793.workspaceCloneUrl, {
    targetReposDir: TARGET_REPOS_ROOT,
    getDefaultBranch: () => { w793.defaultBranchConsulted = true; return 'main'; },
    exec: (cmd, opts) => { w793.workspaceCalls.push({ command: cmd, cwd: opts.cwd }); },
    fsDeps: { existsSync: () => w793.workspaceAlreadyCloned, mkdirSync: () => {} },
    log: () => {},
  });
});

// BINDING POINT (1) composed with BINDING POINT (4) — deliberately NOT
// ensureTargetRepoWorkspace, which would build a real gitContextForRepo (real
// credential mint) and spawn with the real execSync. This composes the same
// two calls production makes, minus the credential and the spawn.
When('the target repository workspace is ensured the way ADW ensures it', function () {
  w793.workspaceCalls = [];
  w793.defaultBranchConsulted = false;
  const converted = convertToSshUrl(w793.workspaceCloneUrl);
  w793.workspaceResultPath = ensureRepoWorkspace(w793.workspaceOwner, w793.workspaceRepo, converted, {
    targetReposDir: TARGET_REPOS_ROOT,
    getDefaultBranch: () => { w793.defaultBranchConsulted = true; return 'main'; },
    exec: (cmd, opts) => { w793.workspaceCalls.push({ command: cmd, cwd: opts.cwd }); },
    fsDeps: { existsSync: () => false, mkdirSync: () => {} },
    log: () => {},
  });
});

// ── §1-4: workspace manager Thens ───────────────────────────────────────────

function findCloneCall(): RecordedWorkspaceCall | undefined {
  return w793.workspaceCalls.find((c) => c.command.startsWith('git clone'));
}

Then('the recorded clone command carries the clone URL {string}', function (url: string) {
  const cloneCall = findCloneCall();
  assert.ok(cloneCall !== undefined, `Expected a recorded "git clone" command, got: ${JSON.stringify(w793.workspaceCalls)}`);
  assert.ok(cloneCall!.command.includes(url), `Expected the clone command to carry "${url}", got: ${cloneCall!.command}`);
});

Then('the recorded clone command is exactly {string}', function (expected: string) {
  const cloneCall = findCloneCall();
  assert.ok(cloneCall !== undefined, `Expected a recorded "git clone" command, got: ${JSON.stringify(w793.workspaceCalls)}`);
  assert.strictEqual(cloneCall!.command, expected);
});

Then('no clone command was recorded', function () {
  assert.strictEqual(findCloneCall(), undefined, `Expected no "git clone" command, got: ${JSON.stringify(w793.workspaceCalls)}`);
});

Then('the recorded workspace commands are exactly {string}', function (expected: string) {
  assert.strictEqual(w793.workspaceCalls.length, 1, `Expected exactly one recorded command, got: ${JSON.stringify(w793.workspaceCalls)}`);
  assert.strictEqual(w793.workspaceCalls[0].command, expected);
});

Then('the default-branch reader was consulted', function () {
  assert.ok(w793.defaultBranchConsulted, 'Expected the injected getDefaultBranch thunk to have been called');
});

Then("the workspace path returned is the repository's directory under the target repositories root", function () {
  assert.strictEqual(w793.workspaceResultPath, path.join(TARGET_REPOS_ROOT, w793.workspaceOwner, w793.workspaceRepo));
});

// ── §5-6: core identity resolution ──────────────────────────────────────────

Given('the core identity resolution sees the environment:', function (table: DataTable) {
  w793.identityEnv = table.rowsHash();
});

Given('the core identity resolution sees a git config of {string}', function (authorStr: string) {
  const parsed = parseAuthor(authorStr);
  w793.identityGitConfig = { name: parsed.name, email: parsed.email };
});

Given('the core identity resolution sees no git config at all', function () {
  w793.identityGitConfig = null;
});

When('the core resolves a git identity', function () {
  try {
    w793.identityResult = resolveCoreIdentity(w793.identityEnv, makeGitConfigExec(w793.identityGitConfig));
    w793.identityThrew = false;
  } catch {
    w793.identityResult = null;
    w793.identityThrew = true;
  }
});

Then('the core answered with no forge address', function () {
  if (w793.identityThrew || w793.identityResult === null) return;
  const fields = [
    w793.identityResult.authorName, w793.identityResult.authorEmail,
    w793.identityResult.committerName, w793.identityResult.committerEmail,
  ];
  for (const field of fields) {
    assert.ok(!field.includes('github.com'), `Expected no forge address, but a field contained "github.com": ${field}`);
  }
});

// ── §7-8: the GitHub boundary's identity resolution ─────────────────────────

Given('the GitHub identity resolution sees the environment:', function (table: DataTable) {
  w793.identityEnv = table.rowsHash();
});

Given('the GitHub identity resolution sees a git config of {string}', function (authorStr: string) {
  const parsed = parseAuthor(authorStr);
  w793.identityGitConfig = { name: parsed.name, email: parsed.email };
});

Given('the GitHub identity resolution sees no git config at all', function () {
  w793.identityGitConfig = null;
});

When('the GitHub boundary resolves a git identity', function () {
  w793.identityResult = resolveGitHubIdentity(w793.identityEnv, makeGitConfigExec(w793.identityGitConfig));
  w793.identityThrew = false;
});

Then('the resolved git identity is {string} for both author and committer', function (expected: string) {
  assert.ok(w793.identityResult !== null, 'Expected a resolved git identity');
  const parsed = parseAuthor(expected);
  assert.strictEqual(w793.identityResult!.authorName, parsed.name);
  assert.strictEqual(w793.identityResult!.authorEmail, parsed.email);
  assert.strictEqual(w793.identityResult!.committerName, parsed.name);
  assert.strictEqual(w793.identityResult!.committerEmail, parsed.email);
});

// The consequence that matters in production: a split identity still reaches git's environment.

When('the resolved identity is carried into a git command by a context', function () {
  assert.ok(w793.identityResult !== null, 'Expected a resolved GitHub identity');
  const { exec, calls } = makeSpyExec(new Map());
  const options = {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('token-793'),
    gitIdentity: w793.identityResult,
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_ROOT,
  };
  const ctx = new GitContext(options, { exec, fsDeps: makeNoOpFsDeps() });
  ctx.remoteUrl();
  w793.commandEnvSpyCall = calls[calls.length - 1];
});

Then('the git command spawned with author {string} and committer {string} in its environment', function (authorStr: string, committerStr: string) {
  assert.ok(w793.commandEnvSpyCall !== null, 'Expected a recorded git command');
  const author = parseAuthor(authorStr);
  const committer = parseAuthor(committerStr);
  const env = w793.commandEnvSpyCall!.env;
  assert.strictEqual(env['GIT_AUTHOR_NAME'], author.name);
  assert.strictEqual(env['GIT_AUTHOR_EMAIL'], author.email);
  assert.strictEqual(env['GIT_COMMITTER_NAME'], committer.name);
  assert.strictEqual(env['GIT_COMMITTER_EMAIL'], committer.email);
});

// ── §8: real throwaway checkouts ────────────────────────────────────────────

Given('a local checkout whose origin remote URL is {string}', function (remote: string) {
  w793.checkoutTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-793-checkout-'));
  execSync('git init -q', { cwd: w793.checkoutTempDir, stdio: 'pipe' });
  execSync(`git remote add origin "${remote}"`, { cwd: w793.checkoutTempDir, stdio: 'pipe' });
});

When('the repository identity is derived from that checkout through the GitHub boundary', function () {
  assert.ok(w793.checkoutTempDir !== null, 'Expected a checkout to be set up');
  try {
    w793.derivedRepoInfoResult = readLocalRepoInfo(w793.checkoutTempDir);
    w793.derivedRepoInfoError = null;
  } catch (err) {
    w793.derivedRepoInfoResult = null;
    w793.derivedRepoInfoError = err as Error;
  }
});

When('the origin remote URL is read through the core', function () {
  assert.ok(w793.checkoutTempDir !== null, 'Expected a checkout to be set up');
  try {
    w793.originRemoteReadResult = readOriginRemoteUrl(w793.checkoutTempDir);
    w793.originRemoteReadError = null;
  } catch (err) {
    w793.originRemoteReadResult = null;
    w793.originRemoteReadError = err as Error;
  }
});

Then('the derived identity is owner {string} and repository {string}', function (owner: string, repo: string) {
  assert.ok(
    w793.derivedRepoInfoResult !== null,
    `Expected a derived identity but it failed: ${w793.derivedRepoInfoError?.message}`,
  );
  assert.strictEqual(w793.derivedRepoInfoResult!.owner, owner);
  assert.strictEqual(w793.derivedRepoInfoResult!.repo, repo);
});

Then('deriving the repository identity fails rather than returning a forge identity', function () {
  assert.ok(w793.derivedRepoInfoError instanceof Error, 'Expected identity derivation to fail, but it returned a result');
});

Then('the core read returns the remote URL {string} unchanged', function (expected: string) {
  assert.strictEqual(w793.originRemoteReadError, null, `Expected no error, got: ${w793.originRemoteReadError}`);
  assert.strictEqual(w793.originRemoteReadResult, expected);
});

// ── §9-12: worktree operations + the injected logger port ──────────────────

function parseCtxRepo(fullName: string): void {
  const [owner, repo] = fullName.split('/');
  w793.ctxOwner = owner;
  w793.ctxRepo = repo;
  w793.loggerSink = [];
}

Given('a git context for the repository {string} with a logger injected', function (fullName: string) {
  parseCtxRepo(fullName);
  w793.loggerInjected = true;
});

Given('a git context for the repository {string} with no logger injected', function (fullName: string) {
  parseCtxRepo(fullName);
  w793.loggerInjected = false;
});

Given('the worktree spawn seam records the commands it is given', function () {
  const { exec, calls } = makeSpyExec(new Map());
  W.spyCalls = calls;
  const options = makeFullOptions(w793.ctxOwner, w793.ctxRepo, 'token-793', 'ADW Fixture Bot', 'fixture-bot@adw.dev');
  const deps: GitContextDeps = { exec, fsDeps: makeNoOpFsDeps() };
  if (w793.loggerInjected) {
    deps.logger = (message, level) => { w793.loggerSink.push({ message, level }); };
  }
  const ctx = new GitContext(options, deps);
  W.ctx = ctx;
  w793.ctx = ctx;
});

Given('the console output of the run is captured', function () {
  w793.consoleCaptured = [];
  w793.originalConsoleLog = console.log;
  console.log = (...args: unknown[]) => { w793.consoleCaptured!.push(args.map(String).join(' ')); };
});

Given('a production-built git context over a real local repository', function () {
  w793.prodTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-793-prod-'));
  execSync('git init -q -b main', { cwd: w793.prodTempDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(w793.prodTempDir, 'README.md'), '# temp\n');
  execSync('git add -A', { cwd: w793.prodTempDir, stdio: 'pipe' });
  execSync('git -c user.name=Temp -c user.email=temp@example.com commit -q -m initial', { cwd: w793.prodTempDir, stdio: 'pipe' });
  execSync('git branch feature-issue-793-x', { cwd: w793.prodTempDir, stdio: 'pipe' });

  w793.ctx = buildLaunchGitContext(null, {
    frameworkRepoRoot: w793.prodTempDir,
    getRepoInfo: () => ({ owner: 'acme', repo: 'webapp' }),
    tokenProvider: { credentialEnv: () => ({ GH_TOKEN: 'fake-prod-token' }) },
  });
});

Given('the ADW workflow id is set to {string}', function (adwId: string) {
  setLogAdwId(adwId);
});

When('the worktree for branch {string} is ensured through the context', function (branch: string) {
  assert.ok(w793.ctx !== null, 'Expected a GitContext to be set up');
  w793.lastOperationMarker = branch;
  w793.ctx.ensureWorktree(branch);
});

When('the worktrees for issue {int} are removed through the context', function (issueNumber: number) {
  assert.ok(w793.ctx !== null, 'Expected a GitContext to be set up');
  w793.lastOperationMarker = String(issueNumber);
  w793.ctx.removeWorktreesForIssue(issueNumber);
});

Then('the injected logger received a message containing {string}', function (substr: string) {
  assert.ok(
    w793.loggerSink.some((m) => m.message.includes(substr)),
    `Expected a logged message containing "${substr}", got: ${JSON.stringify(w793.loggerSink)}`,
  );
});

Then('the injected logger received a message containing {string} at level {string}', function (substr: string, level: string) {
  assert.ok(
    w793.loggerSink.some((m) => m.message.includes(substr) && m.level === level),
    `Expected a logged message containing "${substr}" at level "${level}", got: ${JSON.stringify(w793.loggerSink)}`,
  );
});

Then('the captured console output contains {string}', function (substr: string) {
  assert.ok(w793.consoleCaptured !== null, 'Expected console output to have been captured');
  assert.ok(
    w793.consoleCaptured!.some((line) => line.includes(substr)),
    `Expected captured console output to contain "${substr}", got: ${JSON.stringify(w793.consoleCaptured)}`,
  );
});

Then('the captured console output carries no message from the operation', function () {
  assert.ok(w793.consoleCaptured !== null, 'Expected console output to have been captured');
  assert.ok(
    !w793.consoleCaptured!.some((line) => line.includes(w793.lastOperationMarker)),
    `Expected no captured console line to mention "${w793.lastOperationMarker}", got: ${JSON.stringify(w793.consoleCaptured)}`,
  );
});

const ADW_EMOJI_PREFIXES = ['\u{1F4CB}', '\u{274C}', '\u{2705}', '\u{26A0}\u{FE0F}'];
const ISO_TIMESTAMP_RE = /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/;

Then('the captured console output carries an ADW-formatted line containing {string}', function (substr: string) {
  assert.ok(w793.consoleCaptured !== null, 'Expected console output to have been captured');
  const line = w793.consoleCaptured!.find((l) => l.includes(substr));
  assert.ok(line !== undefined, `Expected a captured line containing "${substr}", got: ${JSON.stringify(w793.consoleCaptured)}`);
  assert.ok(ISO_TIMESTAMP_RE.test(line!), `Expected an ISO-timestamped line but got: ${line}`);
  assert.ok(line!.includes('[mdtv54]'), `Expected the line to carry the [mdtv54] adwId segment but got: ${line}`);
  assert.ok(
    ADW_EMOJI_PREFIXES.some((emoji) => line!.includes(emoji)),
    `Expected an emoji-prefixed ADW log line but got: ${line}`,
  );
});

// ── §12: the git commands themselves do not move ───────────────────────────

Then('the recorded worktree commands are exactly:', function (table: DataTable) {
  const expected = table.raw().map((row) => row[0]);
  const actual = W.spyCalls.map((c) => c.command);
  assert.deepStrictEqual(actual, expected);
});
