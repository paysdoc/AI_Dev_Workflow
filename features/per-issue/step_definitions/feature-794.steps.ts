/**
 * BDD step definitions for feature-794.feature
 *
 * Launch boundary mints forge providers bound to the context's identity.
 *
 * §1   the boundary hands back providers at all
 * §2   every minted provider carries the context's identity (Scenario Outline)
 * §3   the uninjected path is the one that ships (anti-vacuity)
 * §4   one identity read, not several
 * §5   the target argument wins, the remote is never consulted
 * §6   the three named consumers (Scenario Outline: cron / merge / workflow init)
 * §7   providers are minted before the workspace exists
 * §8   selection stays config-driven and GitHub-defaulted
 * §9   the context half is unchanged (regression net)
 * §10  the result cannot be re-pointed after the fact
 * §11  downstream receives the boundary's providers rather than building its own
 * §12  type-check backstop → feature-504.steps.ts (T22); G18 → ensureCronOnEveryEventSteps.ts
 *
 * Driven through the boundary's existing injection seams (LaunchGitContextDeps),
 * exactly as feature-660/feature-700/feature-791 drive it — no framework source
 * file is read as text; every assertion targets an object the system produces.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { buildLaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import type { LaunchBoundary, LaunchGitContextDeps } from '../../../adws/core/launchGitContext.ts';
import { createRepoContext } from '../../../adws/providers/repoContext.ts';
import type { MintProvidersOptions } from '../../../adws/providers/repoContext.ts';
import type { BoundProviders, RepoIdentifier, RepoContext } from '../../../adws/providers/types.ts';
import { Platform } from '../../../adws/providers/types.ts';
import { resolveCronRepo } from '../../../adws/triggers/cronRepoResolver.ts';
import { parseTargetRepoArgs } from '../../../adws/core/orchestratorCli.ts';
import type { TargetRepoInfo } from '../../../adws/types/issueTypes.ts';

// ── World state ──────────────────────────────────────────────────────────────

interface MintedRecord {
  kind: 'issue tracker' | 'code host' | 'board manager';
  repoId: RepoIdentifier;
}

interface World794 {
  frameworkRoot: string;
  targetReposDir: string;
  remoteAnswers: RepoIdentifier[];
  remoteCallCount: number;
  remoteConfigured: boolean;
  mintedRecords: MintedRecord[];
  recordMinting: boolean;
  tokenSource: (() => string) | null;
  boundary: LaunchBoundary | null;
  lastError: Error | null;
  capturedProviders: BoundProviders | null;
  fixtureWorkspace: string | null;
  fixtureOriginRepo: { owner: string; repo: string } | null;
  repoContext: RepoContext | null;
  repoContextError: Error | null;
  envs: NodeJS.ProcessEnv[];
  tempDirs: string[];
  /** #817 seam: the boundary's declared platform, folded into LaunchGitContextDeps.platform by makeDeps(). Undeclared -> deps.platform is omitted, so the boundary defaults to Platform.GitHub. */
  declaredPlatform: Platform | undefined;
}

const w: World794 = {
  frameworkRoot: '',
  targetReposDir: '',
  remoteAnswers: [],
  remoteCallCount: 0,
  remoteConfigured: false,
  mintedRecords: [],
  recordMinting: false,
  tokenSource: null,
  boundary: null,
  lastError: null,
  capturedProviders: null,
  fixtureWorkspace: null,
  fixtureOriginRepo: null,
  repoContext: null,
  repoContextError: null,
  envs: [],
  tempDirs: [],
  declaredPlatform: undefined,
};

function resetWorld(): void {
  w.frameworkRoot = '';
  w.targetReposDir = '';
  w.remoteAnswers = [];
  w.remoteCallCount = 0;
  w.remoteConfigured = false;
  w.mintedRecords = [];
  w.recordMinting = false;
  w.tokenSource = null;
  w.boundary = null;
  w.lastError = null;
  w.capturedProviders = null;
  w.fixtureWorkspace = null;
  w.fixtureOriginRepo = null;
  w.repoContext = null;
  w.repoContextError = null;
  w.envs = [];
  w.tempDirs = [];
  w.declaredPlatform = undefined;
}

// §11 exercises validateGitRemote -> gitContextForRepo — a non-injectable production
// factory that resolves a REAL credential for whatever owner/repo it is given. This
// file's fixture identities ("acme/webapp", "octo/infra") are not real GitHub App
// installations, so the App-mint path 404s. Clearing the App gate for each scenario's
// duration lets resolution fall through to `gh auth token` (already-authenticated in
// this environment) for the LOCAL git remote read validateGitRemote performs — no
// GitHub API call is made against the fake repo. Saved and restored per scenario.
let savedGithubAppId: string | undefined;

Before({ tags: '@adw-794' }, function () {
  resetWorld();
  savedGithubAppId = process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_ID;
});

After({ tags: '@adw-794' }, function () {
  if (savedGithubAppId === undefined) delete process.env.GITHUB_APP_ID;
  else process.env.GITHUB_APP_ID = savedGithubAppId;
  for (const dir of w.tempDirs) {
    if (dir && fs.existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  w.tempDirs = [];
});

// ── Shared helpers ───────────────────────────────────────────────────────────

const FIXED_IDENTITY = {
  authorName: 'ADW Test Bot',
  authorEmail: 'bot@test.dev',
  committerName: 'ADW Test Bot',
  committerEmail: 'bot@test.dev',
};

function makeTargetRepo(owner: string, repo: string): TargetRepoInfo {
  return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

function splitRepo(repoStr: string): RepoIdentifier {
  const [owner, repo] = repoStr.split('/');
  return { owner, repo, platform: Platform.GitHub };
}

/** Records at most one read per call; the last configured answer repeats forever. */
function fakeGetRepoInfo(): RepoIdentifier {
  assert.ok(
    w.remoteConfigured,
    'getRepoInfo not configured — call "the local git remote at the launch boundary answers ..." first',
  );
  const idx = Math.min(w.remoteCallCount, w.remoteAnswers.length - 1);
  const answer = w.remoteAnswers[idx];
  w.remoteCallCount += 1;
  return answer;
}

/** Stand-in provider triple for the recording mintProviders seam — never used for its own behaviour. */
function makeStandInProviders(): BoundProviders {
  return {
    issueTracker: {} as BoundProviders['issueTracker'],
    codeHost: {} as BoundProviders['codeHost'],
    boardManager: {} as BoundProviders['boardManager'],
  };
}

function makeDeps(): LaunchGitContextDeps {
  const deps: LaunchGitContextDeps = {
    getRepoInfo: fakeGetRepoInfo,
    resolveToken: w.tokenSource ? () => w.tokenSource!() : () => 'test-sentinel-token',
    resolveGitIdentity: () => FIXED_IDENTITY,
    frameworkRepoRoot: w.frameworkRoot,
    targetReposDir: w.targetReposDir,
  };
  if (w.declaredPlatform !== undefined) {
    deps.platform = w.declaredPlatform;
  }
  if (w.recordMinting) {
    deps.mintProviders = (options: MintProvidersOptions): BoundProviders => {
      w.mintedRecords.push({ kind: 'issue tracker', repoId: options.repoId });
      w.mintedRecords.push({ kind: 'code host', repoId: options.repoId });
      w.mintedRecords.push({ kind: 'board manager', repoId: options.repoId });
      return makeStandInProviders();
    };
  }
  return deps;
}

function assertMintedFor(kind: MintedRecord['kind'], repoStr: string): void {
  const { owner, repo } = splitRepo(repoStr);
  assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
  void w.boundary.providers; // triggers the memoised mint on first access
  const records = w.mintedRecords.filter((r) => r.kind === kind);
  assert.ok(records.length > 0, `Expected a "${kind}" minting to have been recorded`);
  const last = records[records.length - 1];
  assert.strictEqual(last.repoId.owner, owner, `Expected ${kind} owner to be "${owner}"`);
  assert.strictEqual(last.repoId.repo, repo, `Expected ${kind} repo to be "${repo}"`);
}

/** Resolves the real git binary so worktree setup is unaffected by any mock `git` wrapper on PATH. */
function realGit(): string {
  return process.env['REAL_GIT_PATH'] ?? 'git';
}

/** Initialises a throwaway git repo whose `origin` remote points at the given owner/repo. */
function initFixtureWorkspace(dir: string, repoFullName: string): void {
  const git = realGit();
  execSync(`"${git}" init`, { cwd: dir, stdio: 'pipe' });
  execSync(`"${git}" remote add origin https://github.com/${repoFullName}`, { cwd: dir, stdio: 'pipe' });
  execSync(`"${git}" config user.email "test@test.com"`, { cwd: dir, stdio: 'pipe' });
  execSync(`"${git}" config user.name "Test User"`, { cwd: dir, stdio: 'pipe' });
  execSync(`"${git}" commit --allow-empty -m "init"`, { cwd: dir, stdio: 'pipe' });
}

// ── §1 setup — throwaway roots ────────────────────────────────────────────────

Given('a launch boundary rooted in throwaway framework and target-repos directories', function () {
  w.frameworkRoot = mkdtempSync(path.join(tmpdir(), 'adw-794-framework-'));
  w.targetReposDir = mkdtempSync(path.join(tmpdir(), 'adw-794-target-repos-'));
  w.tempDirs.push(w.frameworkRoot, w.targetReposDir);
});

// ── §2/§4/§5/§6/§7 setup — the recording mintProviders seam ───────────────────

Given('every provider the boundary mints is recorded with the identity it was minted from', function () {
  w.recordMinting = true;
});

// ── Remote-reader setup (§3b, §4, §5, §6, §9) ─────────────────────────────────

Given('the local git remote at the launch boundary answers {string}', function (repoStr: string) {
  w.remoteAnswers = [splitRepo(repoStr)];
  w.remoteConfigured = true;
  w.remoteCallCount = 0;
});

Given(
  'the local git remote at the launch boundary answers {string} first and {string} on every later read',
  function (first: string, second: string) {
    w.remoteAnswers = [splitRepo(first), splitRepo(second)];
    w.remoteConfigured = true;
    w.remoteCallCount = 0;
  },
);

// ── §1/§2/§3/§4/§5 — asking the boundary ──────────────────────────────────────

When('the launch boundary is asked for the repository {string}', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  w.boundary = buildLaunchBoundary(makeTargetRepo(owner, repo), makeDeps());
});

When('the launch boundary is asked with no target repository', function () {
  w.boundary = buildLaunchBoundary(null, makeDeps());
});

// ── §1/§7/§8 — the boundary hands back all three providers ───────────────────

Then(
  'the boundary result carries a git context, an issue tracker, a code host and a board manager',
  function () {
    assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
    assert.ok(w.boundary.gitContext, 'Expected a git context');
    const providers = w.boundary.providers;
    assert.ok(providers.issueTracker, 'Expected an issue tracker');
    assert.ok(providers.codeHost, 'Expected a code host');
    assert.ok(providers.boardManager, 'Expected a board manager');
  },
);

// ── §2/§3/§4/§5/§6/§10 — identity assertions ──────────────────────────────────

Then('the boundary\'s git context names the repository {string}', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
  assert.strictEqual(w.boundary.gitContext.owner, owner);
  assert.strictEqual(w.boundary.gitContext.repo, repo);
});

Then('the boundary\'s code host reports the repository {string}', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
  const identifier = w.boundary.providers.codeHost.getRepoIdentifier();
  assert.strictEqual(identifier.owner, owner);
  assert.strictEqual(identifier.repo, repo);
});

Then('the boundary\'s issue tracker was minted for the repository {string}', function (repoStr: string) {
  assertMintedFor('issue tracker', repoStr);
});

Then('the boundary\'s code host was minted for the repository {string}', function (repoStr: string) {
  assertMintedFor('code host', repoStr);
});

Then('the boundary\'s board manager was minted for the repository {string}', function (repoStr: string) {
  assertMintedFor('board manager', repoStr);
});

// ── §4/§5 — remote-read counting ──────────────────────────────────────────────

Then('the launch boundary read the local git remote at most once', function () {
  assert.ok(w.remoteCallCount <= 1, `Expected at most one read of the local git remote, got ${w.remoteCallCount}`);
});

Then('the launch boundary never read the local git remote', function () {
  assert.strictEqual(w.remoteCallCount, 0, `Expected zero reads of the local git remote, got ${w.remoteCallCount}`);
});

// ── §6 — the three named consumers' own launch-argument resolvers ────────────

When(
  'the {string} consumer resolves the launch arguments {string} and asks the boundary',
  function (consumer: string, argsString: string) {
    const args = argsString.split(/\s+/).filter(Boolean);
    let targetRepo: TargetRepoInfo | null;
    if (consumer === 'cron') {
      targetRepo = resolveCronRepo(args, fakeGetRepoInfo).targetRepo;
    } else if (consumer === 'merge' || consumer === 'workflow init') {
      targetRepo = parseTargetRepoArgs([...args]);
    } else {
      throw new Error(`Unknown consumer in step text: "${consumer}"`);
    }
    w.boundary = buildLaunchBoundary(targetRepo, makeDeps());
  },
);

// ── §7 — workspace not yet cloned ─────────────────────────────────────────────

Given('the workspace for the repository {string} has not been cloned', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  const dir = path.join(w.targetReposDir, owner, repo);
  assert.ok(!fs.existsSync(dir), `Expected the workspace at ${dir} not to exist yet`);
});

// ── §8 — provider configuration fixtures ──────────────────────────────────────

Given('the workspace for the repository {string} carries no provider configuration', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  fs.mkdirSync(path.join(w.targetReposDir, owner, repo), { recursive: true });
});

Given(
  'the workspace for the repository {string} carries the provider configuration:',
  function (repoStr: string, config: string) {
    const { owner, repo } = splitRepo(repoStr);
    const adwDir = path.join(w.targetReposDir, owner, repo, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });
    fs.writeFileSync(path.join(adwDir, 'providers.md'), config);
  },
);

When(
  'the boundary\'s providers are requested for the repository {string} and any failure is captured',
  function (repoStr: string) {
    const { owner, repo } = splitRepo(repoStr);
    w.lastError = null;
    w.capturedProviders = null;
    try {
      w.boundary = buildLaunchBoundary(makeTargetRepo(owner, repo), makeDeps());
      w.capturedProviders = w.boundary.providers;
    } catch (err) {
      w.lastError = err instanceof Error ? err : new Error(String(err));
    }
  },
);

Then('the provider request failed naming the platform {string}', function (platform: string) {
  assert.ok(w.lastError, 'Expected the provider request to fail');
  assert.ok(
    w.lastError.message.toLowerCase().includes(platform.toLowerCase()),
    `Expected the error to name platform "${platform}", got: ${w.lastError.message}`,
  );
});

Then('the boundary handed back no providers', function () {
  assert.strictEqual(w.capturedProviders, null, 'Expected no providers to have been captured');
});

// ── §9 — the context half is unchanged ────────────────────────────────────────

Then(
  'the boundary\'s git context works from the target-repos root path for {string}',
  function (repoStr: string) {
    const { owner, repo } = splitRepo(repoStr);
    assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
    assert.strictEqual(w.boundary.gitContext.basePath, path.join(w.targetReposDir, owner, repo));
  },
);

Then('the boundary\'s git context works from the framework root path', function () {
  assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
  assert.strictEqual(w.boundary.gitContext.basePath, w.frameworkRoot);
});

Given('the boundary resolves credentials from a source that answers a new credential each time', function () {
  let calls = 0;
  w.tokenSource = () => { calls += 1; return `credential-${calls}`; };
});

When('the boundary\'s git context assembles the environment for two commands', function () {
  assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
  w.envs = [w.boundary.gitContext.commandEnv(), w.boundary.gitContext.commandEnv()];
});

Then('the two commands carried different credentials', function () {
  assert.strictEqual(w.envs.length, 2, 'Expected two assembled command environments');
  assert.notStrictEqual(w.envs[0].GH_TOKEN, w.envs[1].GH_TOKEN);
});

// ── §10 — the result cannot be re-pointed ─────────────────────────────────────

When('the boundary result is re-pointed at the repository {string}', function (repoStr: string) {
  const { owner, repo } = splitRepo(repoStr);
  assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
  const mutable = w.boundary as unknown as { repoId: RepoIdentifier; gitContext: unknown };
  try {
    mutable.repoId = { owner, repo, platform: Platform.GitHub };
  } catch {
    // Frozen — throws under ES module strict mode. Swallow; the Then step verifies identity below.
  }
  try {
    mutable.gitContext = { owner, repo };
  } catch {
    // Same — swallow and verify.
  }
});

// ── §11 — downstream receives, it does not construct ──────────────────────────

Given('a cloned workspace whose origin remote names the repository {string}', function (repoStr: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-794-fixture-'));
  initFixtureWorkspace(dir, repoStr);
  w.fixtureWorkspace = dir;
  w.fixtureOriginRepo = splitRepo(repoStr);
  w.tempDirs.push(dir);
});

When('a repo context is built for that workspace from the boundary\'s providers', function () {
  assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
  assert.ok(w.fixtureWorkspace !== null, 'Expected a fixture workspace to have been set up');
  w.repoContext = createRepoContext({
    repoId: w.boundary.repoId,
    cwd: w.fixtureWorkspace,
    providers: w.boundary.providers,
  });
});

When(
  'a repo context is built for that workspace from the boundary\'s providers and any failure is captured',
  function () {
    assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
    assert.ok(w.fixtureWorkspace !== null, 'Expected a fixture workspace to have been set up');
    w.repoContextError = null;
    try {
      w.repoContext = createRepoContext({
        repoId: w.boundary.repoId,
        cwd: w.fixtureWorkspace,
        providers: w.boundary.providers,
      });
    } catch (err) {
      w.repoContextError = err instanceof Error ? err : new Error(String(err));
    }
  },
);

Then(
  'the repo context carries the same issue tracker and code host instances the boundary minted',
  function () {
    assert.ok(w.repoContext !== null, 'Expected a repo context to have been built');
    assert.ok(w.boundary !== null, 'Expected a launch boundary to have been built');
    assert.strictEqual(w.repoContext.issueTracker, w.boundary.providers.issueTracker);
    assert.strictEqual(w.repoContext.codeHost, w.boundary.providers.codeHost);
  },
);

Then('building the repo context failed naming the repository the remote actually points at', function () {
  assert.ok(w.repoContextError, 'Expected building the repo context to fail');
  assert.ok(w.fixtureOriginRepo !== null, 'Expected a fixture workspace to have been set up');
  assert.ok(
    w.repoContextError.message.includes(w.fixtureOriginRepo.owner),
    `Expected the error to name the remote's actual owner "${w.fixtureOriginRepo.owner}", got: ${w.repoContextError.message}`,
  );
});

// §12 reuses "the ADW codebase is checked out" (G18) and "the ADW TypeScript
// type-check passes" (T22) — no new step definitions.

// ---------------------------------------------------------------------------
// Cross-file seam (#817): feature-817.steps.ts drives the platform-declaration
// scenarios through the REUSED Given/When steps above, against this file's
// module-private world — whose makeDeps() never set deps.platform before now.
// Adding new Given/Then phrases for "declares the platform" here would be an
// AmbiguousStepDefinition once feature-817.steps.ts also matched them, so the
// declaration is a setter (folded into makeDeps() above) and the read is an
// accessor, both exported instead. Resets to `undefined` per scenario are the
// caller's responsibility (feature-817.steps.ts's own Before/After), so the
// undeclared-platform row still exercises `deps.platform ?? Platform.GitHub`.
// No `@adw-794` phrase text changes.
// ---------------------------------------------------------------------------

/** Sets (or clears, with `undefined`) the boundary's declared platform for the next `makeDeps()` call. */
export function setDeclaredPlatform(platform: Platform | undefined): void {
  w.declaredPlatform = platform;
}

/** The most recently built launch boundary, or null if none has been built yet this scenario. */
export function getBuiltBoundary(): LaunchBoundary | null {
  return w.boundary;
}
