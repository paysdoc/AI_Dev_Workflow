/**
 * BDD step definitions for feature-816.feature
 *
 * Extraction-readiness guard rule — extractable packages import nothing from
 * the framework (#816).
 *
 * §1-§6 fixture-tree scenarios spawn the REAL CLI entry point
 * (`bunx tsx adws/checkGitGhGuard.ts`) over a temp fixture root, so a rule
 * that is not wired into COLLECTION (not just scanning) fails the scenario —
 * see the feature file's "load-bearing trap" note. Driving `scanFiles`/
 * `scanExtractionScope` in-process would bypass collection and pass
 * vacuously.
 *
 * §7-§8 reuse existing steps — `the git/gh guard runs across the whole ADW
 * repository` / `the guard run reports no violations` (feature-769.steps.ts)
 * and `the ADW TypeScript type-check passes` (feature-504.steps.ts) — no
 * redefinitions here.
 *
 * PASS is asserted on stdout content, not exit code: `main()` carries the
 * pre-existing #796 stale-transitional-entry ratchet, which fails the build
 * whenever a SANCTIONED_CONSTRUCTION_SITES transitional entry's file is
 * absent from the scanned tree — true of every fixture tree here, since none
 * of the 28 real transitional files exist outside the real repository. That
 * ratchet is unrelated to this issue's rule and out of scope to change here
 * (see the plan's ADW-WARNING), so a fixture-tree run always exits non-zero
 * regardless of the extraction rule's verdict. "Passes" therefore means "no
 * rule violation line appears in stdout", not "exit 0"; "fails naming X"
 * still checks exit non-zero (harmless — always true here — and future-proof
 * if the ratchet is ever made tree-aware) AND that X is named in stdout.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const REPO_ROOT = process.cwd();
const VIOLATION_LINE_RE = /\[(git-gh-shellout|cwd-derived-identity|unsanctioned-construction|extraction-readiness)\]/;

let fixtureRoot: string | null = null;
let guardStdout = '';
let guardExitCode = 0;
let lastNamedPath: string | null = null;

Before({ tags: '@adw-816' }, function () {
  fixtureRoot = null;
  guardStdout = '';
  guardExitCode = 0;
  lastNamedPath = null;
});

After({ tags: '@adw-816' }, function () {
  if (fixtureRoot) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  fixtureRoot = null;
});

// ---------------------------------------------------------------------------
// Given — additive fixture tree
// ---------------------------------------------------------------------------

Given('a guard fixture tree holding the file {string}:', function (relPath: string, source: string) {
  if (fixtureRoot === null) {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-816-guard-'));
  }
  const fullPath = path.join(fixtureRoot, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, source, 'utf-8');
});

// ---------------------------------------------------------------------------
// When — spawn the real CLI entry point over the fixture root
// ---------------------------------------------------------------------------

When('the guard runner executes over the guard fixture tree', function () {
  assert.ok(fixtureRoot, 'Expected a prior Given to have written a guard fixture tree');
  const scriptPath = path.join(REPO_ROOT, 'adws/checkGitGhGuard.ts');

  try {
    const output = execSync(`bunx tsx "${scriptPath}"`, {
      cwd: fixtureRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
      // Cucumber itself runs under NODE_OPTIONS="--import tsx" (.adw/scenarios.md).
      // Inherited as-is, that env var makes the CHILD node process also try to
      // --import tsx — resolved from `cwd`, i.e. the fixture root, which has no
      // node_modules — crashing before the guard's own `bunx tsx` load ever runs.
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    guardStdout = output;
    guardExitCode = 0;
  } catch (err: unknown) {
    const spawnErr = err as { stdout?: string; stderr?: string; status?: number };
    guardStdout = (spawnErr.stdout ?? '') + (spawnErr.stderr ?? '');
    guardExitCode = spawnErr.status ?? 1;
  }
});

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('the guard run over the guard fixture tree passes', function () {
  assert.ok(
    !VIOLATION_LINE_RE.test(guardStdout),
    `Expected no rule violation line in guard output but got:\n${guardStdout}`,
  );
});

Then('the guard run over the guard fixture tree fails naming {string}', function (relPath: string) {
  lastNamedPath = relPath;
  assert.notStrictEqual(guardExitCode, 0, `Expected the guard to fail. Output:\n${guardStdout}`);
  assert.ok(
    guardStdout.includes(relPath),
    `Expected the guard output to name "${relPath}". Output:\n${guardStdout}`,
  );
});

Then('the guard failure over the guard fixture tree cites the extraction-readiness rule', function () {
  assert.ok(
    guardStdout.includes('[extraction-readiness]'),
    `Expected "[extraction-readiness]" in guard output:\n${guardStdout}`,
  );
});

Then('the guard failure over the guard fixture tree cites no extraction-readiness rule', function () {
  assert.ok(
    !guardStdout.includes('[extraction-readiness]'),
    `Expected no "[extraction-readiness]" in guard output:\n${guardStdout}`,
  );
});

Then('the guard failure over the guard fixture tree names the import specifier {string}', function (specifier: string) {
  assert.ok(
    guardStdout.includes(specifier),
    `Expected the guard output to name the import specifier "${specifier}". Output:\n${guardStdout}`,
  );
});

Then('the guard failure over the guard fixture tree reports line {int}', function (line: number) {
  assert.ok(lastNamedPath, 'Expected a prior "fails naming" step to have named the offending path');
  const needle = `${lastNamedPath}:${line}  [extraction-readiness]`;
  assert.ok(
    guardStdout.includes(needle),
    `Expected "${needle}" in guard output:\n${guardStdout}`,
  );
});

// ---------------------------------------------------------------------------
// Cross-file seam (#817): feature-817.steps.ts reuses the Given/When/Then
// above (never redefines them) but is NOT tagged @adw-816, so the Before/After
// hooks above never run for its scenarios. These two exports let it force
// isolation itself — resetting/removing the fixture tree between its own
// scenarios, and reading the last guard run's stdout for its own assertions —
// without touching any step text.
// ---------------------------------------------------------------------------

/** Removes the current guard fixture tree (if any) and clears run state. Safe to call with no prior fixture tree. */
export function resetGuardFixtureTree(): void {
  if (fixtureRoot) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  fixtureRoot = null;
  guardStdout = '';
  guardExitCode = 0;
  lastNamedPath = null;
}

/** The last guard run's captured stdout (+ stderr on failure). */
export function getGuardStdout(): string {
  return guardStdout;
}
