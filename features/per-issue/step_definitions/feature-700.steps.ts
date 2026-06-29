/**
 * BDD step definitions for feature-700.feature
 *
 * GitContext: absorb bootstrap construction + enforce token veracity (HITL)
 *
 * §1  Token veracity at the launch boundary — new steps (W700 local world)
 * §2a Built context resolves its base path to the target workspace — new step
 * §2b/§3 Regression guards → feature-659.steps.ts (shared W, no new steps here)
 * §4a Whole-repo guard → feature-691.steps.ts (no new steps here)
 * §4b Guard ratchet: zero allowlisted files — new When + Then
 * §5  TypeScript type-check → feature-504.steps.ts (no new steps here)
 * G18 "the ADW codebase is checked out" → ensureCronOnEveryEventSteps.ts
 *
 * Step-definition note (from feature file):
 *   - §1 uses a #700-local world (W700) with injectable token SOURCES.
 *     `a launch GitContext is built for owner X repo Y` calls the REAL
 *     `buildLaunchGitContext` with the REAL `resolveContextToken` bound to test
 *     sources (mint fn, appConfigured flag) — the deleted fall-through is what is
 *     under test, not a fake resolver.
 *   - The ambient GH_TOKEN is seeded via the existing step from feature-659.steps.ts
 *     (`the parent process environment has auth token`); its After restores GH_TOKEN.
 *     The W700 After only resets W700 state and MUST NOT touch GH_TOKEN.
 *   - §2b/§3 resolve entirely to feature-659.steps.ts — no redefinitions here.
 *   - §4a resolves to feature-691.steps.ts — no redefinitions here.
 */

import * as path from 'path';
import { execSync } from 'child_process';
import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { buildLaunchGitContext } from '../../../adws/core/launchGitContext.ts';
import { resolveContextToken } from '../../../adws/gitContext/tokenResolver.ts';
import { TARGET_REPOS_ROOT, FRAMEWORK_ROOT } from './gitContextSharedWorld.ts';
import type { GitContext } from '../../../adws/gitContext/index.ts';
import type { TargetRepoInfo } from '../../../adws/types/issueTypes.ts';

// ---------------------------------------------------------------------------
// #700 local world state
// ---------------------------------------------------------------------------

interface World700 {
  appConfigured: boolean;
  unavailableMints: Set<string>;
  ctx: GitContext | null;
  lastError: Error | null;
  guardOutput: string | null;
  guardExitCode: number | null;
}

const W700: World700 = {
  appConfigured: false,
  unavailableMints: new Set(),
  ctx: null,
  lastError: null,
  guardOutput: null,
  guardExitCode: null,
};

After(function () {
  // Reset only W700 state — MUST NOT touch GH_TOKEN (feature-659's After owns that)
  W700.appConfigured = false;
  W700.unavailableMints = new Set();
  W700.ctx = null;
  W700.lastError = null;
  W700.guardOutput = null;
  W700.guardExitCode = null;
});

// ---------------------------------------------------------------------------
// Deterministic mint: token is `installation-token::{owner}/{repo}`
// So assertions can reconstruct the expected value without hard-coding.
// ---------------------------------------------------------------------------

function makeMint(unavailableMints: Set<string>) {
  return (owner: string, repo: string): string => {
    const key = `${owner}/${repo}`;
    if (unavailableMints.has(key)) {
      throw new Error(`App not installed on ${key}`);
    }
    return `installation-token::${key}`;
  };
}

function expectedMintToken(owner: string, repo: string): string {
  return `installation-token::${owner}/${repo}`;
}

// Fixed identity for §1 — we only care about the token, not the identity
const FIXED_IDENTITY = {
  authorName: 'ADW Bot',
  authorEmail: 'adw-bot@users.noreply.github.com',
  committerName: 'ADW Bot',
  committerEmail: 'adw-bot@users.noreply.github.com',
};

// ---------------------------------------------------------------------------
// §1 — Token-source configuration
// ---------------------------------------------------------------------------

Given('the GitHub App is configured to mint installation tokens bound to each owner and repo', function () {
  W700.appConfigured = true;
});

Given('the GitHub App is not configured to mint installation tokens', function () {
  W700.appConfigured = false;
});

Given('the installation mint for owner {string} repo {string} is unavailable', function (owner: string, repo: string) {
  W700.unavailableMints.add(`${owner}/${repo}`);
});

// ---------------------------------------------------------------------------
// §1 + §2a — Launch-boundary build
// ---------------------------------------------------------------------------

When('a launch GitContext is built for owner {string} repo {string}', function (owner: string, repo: string) {
  const targetRepo: TargetRepoInfo = {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };

  // Inject the REAL resolveContextToken with test-controlled sources.
  // Neutralise PAT and ghAuthToken so only the App/ambient paths are observable.
  // process.env.GH_TOKEN holds the ambient sentinel (seeded by feature-659's step).
  const resolveToken = (o: string, r: string) =>
    resolveContextToken({
      owner: o,
      repo: r,
      pat: undefined,
      isAppConfigured: () => W700.appConfigured,
      mintInstallationToken: makeMint(W700.unavailableMints),
      ghAuthToken: () => '',
    });

  try {
    W700.ctx = buildLaunchGitContext(targetRepo, {
      resolveToken,
      resolveGitIdentity: () => FIXED_IDENTITY,
      frameworkRepoRoot: FRAMEWORK_ROOT,
      targetReposDir: TARGET_REPOS_ROOT,
    });
    W700.lastError = null;
  } catch (err) {
    W700.ctx = null;
    W700.lastError = err instanceof Error ? err : new Error(String(err));
  }
});

// ---------------------------------------------------------------------------
// §1 assertions — token veracity
// ---------------------------------------------------------------------------

Then(
  'the built context carries the installation token bound to owner {string} repo {string} as its per-command GitHub token',
  function (owner: string, repo: string) {
    assert.ok(W700.ctx !== null, `Expected a context to be built but got error: ${W700.lastError?.message}`);
    const env = W700.ctx.commandEnv();
    const expected = expectedMintToken(owner, repo);
    assert.strictEqual(
      env['GH_TOKEN'],
      expected,
      `Expected GH_TOKEN to be the bound mint "${expected}" but got "${env['GH_TOKEN']}"`,
    );
  },
);

Then(
  'the built context does not carry the foreign ambient token {string}',
  function (foreignToken: string) {
    assert.ok(W700.ctx !== null, 'Expected a context to be built');
    // commandEnv with the ambient process.env as base — the context must OVERRIDE
    const env = W700.ctx.commandEnv(process.env);
    const values = Object.values(env).filter(Boolean) as string[];
    assert.ok(
      !values.includes(foreignToken),
      `Expected context env NOT to carry foreign token "${foreignToken}" but it was found`,
    );
  },
);

Then(
  'building the launch context fails loudly naming owner {string} repo {string}',
  function (owner: string, repo: string) {
    assert.ok(W700.lastError !== null, 'Expected the build to throw but it succeeded');
    const msg = W700.lastError.message;
    assert.ok(
      msg.includes(owner) && msg.includes(repo),
      `Expected error message to name "${owner}/${repo}" but got: "${msg}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// §2a — base-path assertion
// ---------------------------------------------------------------------------

Then(
  'the built context base path is the target workspace for owner {string} repo {string}',
  function (owner: string, repo: string) {
    assert.ok(W700.ctx !== null, `Expected a context to be built but got error: ${W700.lastError?.message}`);
    const expected = path.join(TARGET_REPOS_ROOT, owner, repo);
    assert.strictEqual(
      W700.ctx.basePath,
      expected,
      `Expected basePath to be "${expected}" but got "${W700.ctx.basePath}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// §4b — guard ratchet capstone: zero allowlisted files
// ---------------------------------------------------------------------------

When('the git\\/gh guard ratchet is measured across the repository', function () {
  try {
    const output = execSync('bunx tsx adws/checkGitGhGuard.ts', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    W700.guardOutput = output;
    W700.guardExitCode = 0;
  } catch (err: unknown) {
    const spawnErr = err as { stdout?: string; stderr?: string; status?: number };
    W700.guardOutput = (spawnErr.stdout ?? '') + (spawnErr.stderr ?? '');
    W700.guardExitCode = spawnErr.status ?? 1;
  }
});

Then('the git\\/gh guard reports zero allowlisted files', function () {
  assert.ok(W700.guardOutput !== null, 'Expected guard output to be captured');
  const match = W700.guardOutput.match(/(\d+)\s+allowlisted/);
  assert.ok(
    match !== null,
    `Expected guard output to contain "N allowlisted" count but got: ${W700.guardOutput}`,
  );
  const allowlisted = parseInt(match[1], 10);
  assert.strictEqual(
    allowlisted,
    0,
    `Expected 0 allowlisted files but guard reported ${allowlisted}`,
  );
});
