/**
 * BDD step definitions for feature-535.feature
 * Remove GITHUB_PERSONAL_ACCESS_TOKEN alias, keep GITHUB_PAT canonical.
 *
 * §1 (token resolution) spawns a child bun process from a temp directory so
 *    the module-level GITHUB_PAT constant is re-evaluated with the test env.
 *    The child cwd has no .env file, preventing dotenv and bun auto-dotenv
 *    from loading the project's .env and interfering with the test env.
 * §2 (subprocess forwarding) calls getSafeSubprocessEnv() directly — the
 *    function reads process.env at call time, so Given-step mutations apply.
 * §3 (health check) calls checkEnvironmentVariables() directly — same approach.
 * §4 (TypeScript type-check) — step already defined in feature-504.steps.ts.
 *
 * Steps NOT defined here (already defined elsewhere):
 *   - Given 'the ADW codebase is checked out'         → ensureCronOnEveryEventSteps.ts
 *   - Then  'the ADW TypeScript type-check passes'    → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { getSafeSubprocessEnv } from '../../../adws/core/environment.ts';
import { checkEnvironmentVariables, type CheckResult } from '../../../adws/healthCheckChecks.ts';

// ---------------------------------------------------------------------------
// Per-scenario mutable state
// ---------------------------------------------------------------------------

interface Ctx535 {
  resolvedPat: string | undefined;
  safeEnv: Record<string, string | undefined>;
  healthResult: CheckResult | null;
  origGithubPat: string | undefined;
  origGithubPersonalAccessToken: string | undefined;
}

const ctx: Ctx535 = {
  resolvedPat: undefined,
  safeEnv: {},
  healthResult: null,
  origGithubPat: undefined,
  origGithubPersonalAccessToken: undefined,
};

// ---------------------------------------------------------------------------
// Before / After hooks — save/restore env vars, reset per-scenario state
// ---------------------------------------------------------------------------

Before({ tags: '@adw-535' }, function () {
  ctx.origGithubPat = process.env.GITHUB_PAT;
  ctx.origGithubPersonalAccessToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  delete process.env.GITHUB_PAT;
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  ctx.resolvedPat = undefined;
  ctx.safeEnv = {};
  ctx.healthResult = null;
});

After({ tags: '@adw-535' }, function () {
  if (ctx.origGithubPat !== undefined) {
    process.env.GITHUB_PAT = ctx.origGithubPat;
  } else {
    delete process.env.GITHUB_PAT;
  }
  if (ctx.origGithubPersonalAccessToken !== undefined) {
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = ctx.origGithubPersonalAccessToken;
  } else {
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  }
});

// ---------------------------------------------------------------------------
// Given — environment variable setup
// ---------------------------------------------------------------------------

Given(
  'the environment variable GITHUB_PAT is set to {string} and GITHUB_PERSONAL_ACCESS_TOKEN is unset',
  function (value: string) {
    process.env.GITHUB_PAT = value;
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  },
);

Given(
  'the environment variable GITHUB_PERSONAL_ACCESS_TOKEN is set to {string} and GITHUB_PAT is unset',
  function (value: string) {
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = value;
    delete process.env.GITHUB_PAT;
  },
);

Given(
  'the environment variable GITHUB_PAT is set to {string} and GITHUB_PERSONAL_ACCESS_TOKEN is set to {string}',
  function (pat: string, alias: string) {
    process.env.GITHUB_PAT = pat;
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = alias;
  },
);

Given('the environment variable GITHUB_PAT is set to {string}', function (value: string) {
  process.env.GITHUB_PAT = value;
});

Given(
  'the environment variable GITHUB_PERSONAL_ACCESS_TOKEN is set to {string}',
  function (value: string) {
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = value;
  },
);

// ---------------------------------------------------------------------------
// When — §1: fresh process token resolution
// ---------------------------------------------------------------------------

When('a fresh ADW process resolves the GitHub PAT', function () {
  const projectRoot = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-535-pat-'));
  try {
    // Run from tmpDir (no .env present) so bun auto-dotenv and dotenv.config()
    // find no file and leave process.env as-is in the child.
    const envTsPath = path.join(projectRoot, 'adws', 'core', 'environment.ts');
    const scriptPath = path.join(tmpDir, 'resolve-pat.ts');
    fs.writeFileSync(
      scriptPath,
      `import { GITHUB_PAT } from ${JSON.stringify(envTsPath)};\nprocess.stdout.write(GITHUB_PAT ?? '__UNDEFINED__');\n`,
    );
    const result = spawnSync('bun', [scriptPath], {
      env: { ...process.env },
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 20_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Fresh ADW process failed (exit ${result.status}): ${result.stderr}`);
    }
    const output = (result.stdout ?? '').trim();
    ctx.resolvedPat = output === '__UNDEFINED__' ? undefined : output;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// When — §2: safe subprocess environment builder
// ---------------------------------------------------------------------------

When('ADW builds the safe subprocess environment', function () {
  ctx.safeEnv = getSafeSubprocessEnv() as Record<string, string | undefined>;
});

// ---------------------------------------------------------------------------
// When — §3: environment-variable health check
// ---------------------------------------------------------------------------

When('the ADW environment-variable health check runs', function () {
  ctx.healthResult = checkEnvironmentVariables();
});

// ---------------------------------------------------------------------------
// Then — §1 assertions
// ---------------------------------------------------------------------------

Then('the resolved GitHub PAT equals {string}', function (expected: string) {
  assert.strictEqual(
    ctx.resolvedPat,
    expected,
    `Expected resolved PAT "${expected}", got "${ctx.resolvedPat}"`,
  );
});

Then('the resolved GitHub PAT is empty', function () {
  assert.strictEqual(
    ctx.resolvedPat,
    undefined,
    `Expected resolved PAT to be undefined, got "${ctx.resolvedPat}"`,
  );
});

// ---------------------------------------------------------------------------
// Then — §2 assertions
// ---------------------------------------------------------------------------

Then(
  'the safe subprocess environment includes GITHUB_PAT with value {string}',
  function (expected: string) {
    assert.strictEqual(
      ctx.safeEnv['GITHUB_PAT'],
      expected,
      `Expected safe subprocess env GITHUB_PAT="${expected}", got "${ctx.safeEnv['GITHUB_PAT']}"`,
    );
  },
);

Then('the safe subprocess environment omits GITHUB_PERSONAL_ACCESS_TOKEN', function () {
  assert.ok(
    !('GITHUB_PERSONAL_ACCESS_TOKEN' in ctx.safeEnv),
    'Expected safe subprocess env to omit GITHUB_PERSONAL_ACCESS_TOKEN',
  );
});

Then('the safe subprocess environment omits GITHUB_PAT', function () {
  assert.ok(
    !('GITHUB_PAT' in ctx.safeEnv),
    'Expected safe subprocess env to omit GITHUB_PAT',
  );
});

// ---------------------------------------------------------------------------
// Then — §3 assertions
// ---------------------------------------------------------------------------

Then('the health check lists GITHUB_PAT as a present optional variable', function () {
  assert.ok(ctx.healthResult, 'Expected healthResult to be set');
  const optional = (ctx.healthResult.details['optional'] as string[] | undefined) ?? [];
  assert.ok(
    optional.includes('GITHUB_PAT'),
    `Expected health check optional list to include GITHUB_PAT, got: ${JSON.stringify(optional)}`,
  );
});

Then(
  'the health check does not list GITHUB_PERSONAL_ACCESS_TOKEN as a present optional variable',
  function () {
    assert.ok(ctx.healthResult, 'Expected healthResult to be set');
    const optional = (ctx.healthResult.details['optional'] as string[] | undefined) ?? [];
    assert.ok(
      !optional.includes('GITHUB_PERSONAL_ACCESS_TOKEN'),
      `Expected health check optional list to NOT include GITHUB_PERSONAL_ACCESS_TOKEN, got: ${JSON.stringify(optional)}`,
    );
  },
);

Then('the health check does not list GITHUB_PAT as a present optional variable', function () {
  assert.ok(ctx.healthResult, 'Expected healthResult to be set');
  const optional = (ctx.healthResult.details['optional'] as string[] | undefined) ?? [];
  assert.ok(
    !optional.includes('GITHUB_PAT'),
    `Expected health check optional list to NOT include GITHUB_PAT, got: ${JSON.stringify(optional)}`,
  );
});
