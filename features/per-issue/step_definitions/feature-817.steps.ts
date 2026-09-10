/**
 * BDD step definitions for feature-817.feature
 *
 * Domain model consolidation into the provider package (#817): raw GitHub
 * payload shapes become adapter-owned, the old framework repo-identity type
 * collapses into RepoIdentifier without losing the platform discriminator,
 * and the extraction guard's scope widens to hold the result.
 *
 * §1 and §5 reuse the guard fixture-tree Given/When/Then from
 * feature-816.steps.ts verbatim — no redefinitions here. Because this file's
 * scenarios carry @adw-817, not @adw-816, feature-816.steps.ts's own
 * Before/After (tag-scoped to @adw-816) never run for them; this file calls
 * the two small exports feature-816.steps.ts added for exactly this reuse
 * (`resetGuardFixtureTree`, `getGuardStdout`) from its own Before/After below,
 * so every scenario still gets a fresh fixture tree.
 *
 * §2, §3 and §4's first row introduce the type-probe harness: a throwaway
 * module written as a DIRECT CHILD of `adws/` (so its `../` specifiers
 * resolve exactly as a real one-level-down module's would), compiled via a
 * temp `adws/tsconfig.probe-<rand>.json` that extends the real project config
 * and narrows `include` to just the probe — never passed to `tsc` as a bare
 * file argument, which would discard `compilerOptions` entirely.
 *
 * §4's boundary-driven rows reuse feature-794.steps.ts's Given/When steps
 * against ITS module-private world, via the small setter/accessor seam it
 * exports for this purpose (`setDeclaredPlatform`, `getBuiltBoundary`) — no
 * `@adw-794` phrase text changes.
 *
 * §6 reuses `the git/gh guard runs across the whole ADW repository` / `the
 * guard run reports no violations` (feature-769.steps.ts) and `the ADW
 * TypeScript type-check passes` (feature-504.steps.ts) — no redefinitions.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { resetGuardFixtureTree, getGuardStdout } from './feature-816.steps.ts';
import { setDeclaredPlatform, getBuiltBoundary } from './feature-794.steps.ts';
import type { Platform } from '../../../adws/providers/types.ts';

const REPO_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Type-probe harness state
// ---------------------------------------------------------------------------

let probeDir: string | null = null;
let probeTsconfigPath: string | null = null;
let probeStdout = '';
let probeExitCode = 0;

function cleanupProbe(): void {
  if (probeTsconfigPath && fs.existsSync(probeTsconfigPath)) {
    fs.unlinkSync(probeTsconfigPath);
  }
  if (probeDir && fs.existsSync(probeDir)) {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
  probeDir = null;
  probeTsconfigPath = null;
  probeStdout = '';
  probeExitCode = 0;
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-817
// ---------------------------------------------------------------------------

Before({ tags: '@adw-817' }, function () {
  cleanupProbe();
  resetGuardFixtureTree();
  setDeclaredPlatform(undefined);
});

After({ tags: '@adw-817' }, function () {
  cleanupProbe();
  resetGuardFixtureTree();
  setDeclaredPlatform(undefined);
});

// ---------------------------------------------------------------------------
// §2/§3/§4 — the type-probe harness
// ---------------------------------------------------------------------------

Given('a type probe module that reads:', function (source: string) {
  probeDir = fs.mkdtempSync(path.join(REPO_ROOT, 'adws', 'zzProbe817-'));
  fs.writeFileSync(path.join(probeDir, 'probe.ts'), source, 'utf-8');
});

When('the type probe is compiled against the ADW project', function () {
  assert.ok(probeDir, 'Expected a prior Given to have written a type probe module');
  const probeDirName = path.basename(probeDir);
  const rand = Math.random().toString(36).slice(2, 10);
  const tsconfigPath = path.join(REPO_ROOT, 'adws', `tsconfig.probe-${rand}.json`);
  const config = {
    extends: './tsconfig.json',
    include: [`./${probeDirName}/probe.ts`],
  };
  fs.writeFileSync(tsconfigPath, JSON.stringify(config), 'utf-8');
  probeTsconfigPath = tsconfigPath;

  try {
    const output = execSync(`bunx tsc --noEmit -p "${tsconfigPath}"`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      // Cucumber itself runs under NODE_OPTIONS="--import tsx" (.adw/scenarios.md);
      // cleared here to match the established fixture-tree spawn convention
      // (feature-816.steps.ts) even though this spawn's cwd has node_modules.
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    probeStdout = output;
    probeExitCode = 0;
  } catch (err: unknown) {
    const spawnErr = err as { stdout?: string; stderr?: string; status?: number };
    probeStdout = (spawnErr.stdout ?? '') + (spawnErr.stderr ?? '');
    probeExitCode = spawnErr.status ?? 1;
  }
});

Then('the type probe compiles', function () {
  assert.strictEqual(
    probeExitCode,
    0,
    `Expected the type probe to compile cleanly but got:\n${probeStdout}`,
  );
});

Then('the type probe fails to compile naming the missing member {string}', function (member: string) {
  assert.notStrictEqual(probeExitCode, 0, `Expected the type probe to fail to compile. Output:\n${probeStdout}`);
  assert.ok(
    probeStdout.includes('probe.ts('),
    `Expected a diagnostic naming the probe file. Output:\n${probeStdout}`,
  );
  assert.ok(
    probeStdout.includes(`'${member}'`),
    `Expected a diagnostic mentioning the missing member "${member}". Output:\n${probeStdout}`,
  );
});

Then('the type probe fails to compile reporting the missing property {string}', function (property: string) {
  assert.notStrictEqual(probeExitCode, 0, `Expected the type probe to fail to compile. Output:\n${probeStdout}`);
  assert.ok(
    probeStdout.includes('probe.ts('),
    `Expected a diagnostic naming the probe file. Output:\n${probeStdout}`,
  );
  assert.ok(
    probeStdout.includes(`'${property}'`),
    `Expected a diagnostic mentioning the missing property "${property}". Output:\n${probeStdout}`,
  );
});

// ---------------------------------------------------------------------------
// §4 — the platform discriminator, driven through feature-794.steps.ts's seam
// ---------------------------------------------------------------------------

Given('the launch boundary declares the platform {string}', function (platformName: string) {
  setDeclaredPlatform(platformName as Platform);
});

Then('the boundary\'s repo identity declares the platform {string}', function (platformName: string) {
  const boundary = getBuiltBoundary();
  assert.ok(boundary, 'Expected a launch boundary to have been built');
  assert.strictEqual(boundary.repoId.platform, platformName);
});

// ---------------------------------------------------------------------------
// §5 — the parameterised rule citation, reading feature-816.steps.ts's last stdout
// ---------------------------------------------------------------------------

Then('the guard failure over the guard fixture tree cites the {string} rule', function (ruleName: string) {
  const stdout = getGuardStdout();
  assert.ok(
    stdout.includes(`[${ruleName}]`),
    `Expected "[${ruleName}]" in guard output:\n${stdout}`,
  );
});

// ---------------------------------------------------------------------------
// Cross-file seam (#823): feature-823.steps.ts reuses this file's type-probe
// harness (never redefining its Given/When/Then phrases) and needs its own
// accessor/reset, since this file's own Before/After (tag-scoped to @adw-817)
// never run for @adw-823 scenarios.
// ---------------------------------------------------------------------------

/** The last type-probe compile's exit code and captured stdout (+ stderr on failure). */
export function getTypeProbeResult(): { exitCode: number; stdout: string } {
  return { exitCode: probeExitCode, stdout: probeStdout };
}

/** Removes the current probe directory/tsconfig (if any) and clears run state — mirrors this file's own `cleanupProbe`. */
export function resetTypeProbe(): void {
  cleanupProbe();
}
