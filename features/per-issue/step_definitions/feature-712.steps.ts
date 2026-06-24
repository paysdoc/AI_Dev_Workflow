/**
 * BDD step definitions for feature-712.feature
 * upgradeGate reads the authoritative .adw-version from the remote default branch
 * before worktree setup — stale reused worktree fix (#197/#203 root cause).
 *
 * Execution model (mirrors the feature-544 sibling)
 * -------------------------------------------------
 * The Before({tags:'@adw-712'}) hook wires the regression mock harness so the reused
 * regression Given steps (G4/G1/G12) and the W1 orchestrator invocation resolve against
 * a live mockContext.
 *
 * W1 returns 'pending' under ISSUE-3-CUTOVER, so §1–§3 are reported as pending (not
 * failed). The Given steps still run and set up fixture state for future readiness.
 * §4–§6 call readRemoteAdwVersion() directly (no subprocess) — these go GREEN now.
 * §7 relies on globally-registered T22 and needs no new steps.
 *
 * Steps NOT defined here (already registered globally):
 *  Given 'the ADW codebase is checked out'                                      → ensureCronOnEveryEventSteps.ts (G18)
 *  Given 'an issue {int} exists in the mock issue tracker'                      → givenSteps.ts (G4)
 *  Given 'the worktree for adwId {string} is initialised at branch {string}'    → givenSteps.ts (G11)
 *  Given 'the mock GitHub API is configured to accept issue comments'           → givenSteps.ts (G1)
 *  Given 'the mock GitHub API is configured to accept label applications'       → givenSteps.ts (G12)
 *  Given 'the target remote has no upgrade claim branch ...'                    → feature-544.steps.ts
 *  Given 'an upgrade claim branch ... already exists ..., tracked by issue ...' → feature-544.steps.ts
 *  When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (W1)
 *  Then  'the orchestrator subprocess exited {int}'                             → thenSteps.ts (T5)
 *  Then  'the mock GitHub API recorded a comment on issue {int}'                → thenSteps.ts (T2)
 *  Then  'the claude classifier was invoked for issue {int}'                    → feature-542.steps.ts
 *  Then  'the mock GitHub API recorded the creation of an upgrade tracking issue carrying the {string} label' → feature-544.steps.ts
 *  Then  'the mock GitHub API recorded no creation of an upgrade tracking issue' → feature-544.steps.ts
 *  Then  'ADW spawned the upgrade orchestrator for the tracking issue'          → feature-544.steps.ts
 *  Then  'ADW spawned no upgrade orchestrator for issue {int}'                  → feature-544.steps.ts
 *  Then  'ADW registered a dependency of issue {int} on the upgrade tracking issue' → feature-544.steps.ts
 *  Then  'ADW returned issue {int} to the Todo lane'                            → feature-544.steps.ts
 *  Then  'the mock harness recorded zero ADW-workflow-marker comment posts on issue {int}' → feature-544.steps.ts
 *  Then  'the ADW TypeScript type-check passes'                                 → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { readRemoteAdwVersion, writeAdwVersion, ADW_VERSION_FILENAME } from '../../../adws/core/adwVersion.ts';
import { computeFrameworkHash } from '../../../adws/core/hashComputer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

const GIT = process.env['REAL_GIT_PATH'] ?? 'git';

/**
 * A syntactically-valid SHA256 digest (64 hex chars) that the live framework cannot hash
 * to — seeds a guaranteed stale-local condition for §1 and a genuine mismatch for §2/§3.
 */
const STALE_HASH = '1'.repeat(64);

// ── Module-level per-scenario state for §4–§6 (direct readRemoteAdwVersion tests) ─

const ctx: {
  /** Path to the local clone used as workspacePath in §4–§6 When step. */
  workspacePath: string;
  /** Return value of the last readRemoteAdwVersion() call. */
  readResult: string | null | undefined;
} = {
  workspacePath: '',
  readResult: undefined,
};

/** Temp dirs accumulated for After cleanup. */
const tempDirs: string[] = [];

function mktemp(prefix: string): string {
  const p = fs.mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(p);
  return p;
}

function git(args: string, cwd: string): string {
  return execSync(
    `"${GIT}" ${args}`,
    { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

function resetCtx(): void {
  ctx.workspacePath = '';
  ctx.readResult = undefined;
}

// ── Hooks — scoped to @adw-712 ────────────────────────────────────────────────────

Before({ tags: '@adw-712' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  resetCtx();
  tempDirs.length = 0;
});

After({ tags: '@adw-712' }, async function (this: RegressionWorld) {
  for (const dir of tempDirs) {
    if (dir && fs.existsSync(dir)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
  resetCtx();
  tempDirs.length = 0;
});

// ── §1 Given — stale local worktree (seeded for future subprocess validation) ────────

Given(
  'the reused worktree for adwId {string} records a stale framework version behind the default branch',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree found for adwId "${adwId}" — expected G11 to have initialised it`);
    // Seed a stale local .adw-version — simulates the reused-worktree that bit #197.
    // The gate now reads from the REMOTE, so this stale file must not affect the gate
    // decision. Under ISSUE-3-CUTOVER the subprocess never runs; seeded for readiness.
    writeAdwVersion(worktreePath, STALE_HASH);
  },
);

// ── §1 Given — remote default branch carries the current framework hash ─────────────

Given(
  'the target repository\'s remote default branch records a framework version matching the current framework',
  function (this: RegressionWorld) {
    // Fixture marker: records the intended remote state for the subprocess harness.
    // Under ISSUE-3-CUTOVER W1 never runs, so this is a no-op beyond documentation.
    // When the CUTOVER resolves, this step should seed origin/<default>:.adw-version
    // with computeFrameworkHash(ROOT) in the target repo workspace.
    this.harnessEnv = {
      ...this.harnessEnv,
      ADW_TEST_REMOTE_VERSION: computeFrameworkHash(ROOT),
    };
  },
);

// ── §2/§3 Given — remote default branch carries a stale hash ────────────────────────

Given(
  'the target repository\'s remote default branch records a framework version that differs from the current framework',
  function (this: RegressionWorld) {
    // Fixture marker: records the intended mismatch state for the subprocess harness.
    // Under ISSUE-3-CUTOVER W1 never runs, so this is a no-op beyond documentation.
    // When the CUTOVER resolves, this step should seed origin/<default>:.adw-version
    // with STALE_HASH in the target repo workspace.
    this.harnessEnv = {
      ...this.harnessEnv,
      ADW_TEST_REMOTE_VERSION: STALE_HASH,
    };
  },
);

// ── §2/§3 Then — no throwaway feature worktree (pending under ISSUE-3-CUTOVER) ──────

Then(
  'no feature worktree is created for issue {int}',
  function (this: RegressionWorld, _issueNumber: number) {
    return 'pending';
    // ISSUE-3-CUTOVER: when W1 drives a real subprocess, inspect the target clone's
    // .worktrees/ directory for the absence of any per-issue feature-issue-<n>-* worktree.
    // This verifies the "park before building a worktree" invariant (AC2).
  },
);

// ── §2 Then — won claim branch pushed to target namespace (pending under CUTOVER) ────

Then(
  'the won upgrade claim branch is pushed to the target repository\'s remote namespace',
  function (this: RegressionWorld) {
    return 'pending';
    // ISSUE-3-CUTOVER: when W1 drives a real subprocess, list refs on the target repo's
    // bare origin and confirm the adw-upgrade-<hash> branch is present there (not only
    // in the framework repo's remote namespace). Verifies the claim-needs-target-worktree
    // invariant from 94059b5 remains intact after the gate reorder.
  },
);

// ── §4–§6 helpers — create a hermetic bare origin + local clone ─────────────────────

/**
 * Creates a bare "origin" with a committed initial state on `defaultBranch`,
 * optionally including `.adw-version`, and returns a local clone that tracks it.
 *
 * @param defaultBranch  Branch name to create (e.g. "main").
 * @param adwVersionContent  Content to commit as `.adw-version`, or null to omit the file.
 * @returns workspacePath — absolute path to the local clone (usable as cwd for git show).
 */
function createRepoWithRemote(defaultBranch: string, adwVersionContent: string | null): string {
  const originDir = mktemp('adw-712-origin-');
  execSync(`"${GIT}" init --bare "${originDir}"`, { stdio: 'pipe' });

  const seedDir = mktemp('adw-712-seed-');
  execSync(`"${GIT}" init "${seedDir}"`, { stdio: 'pipe' });
  git(`-C "${seedDir}" config user.email "test@adw.local"`, seedDir);
  git(`-C "${seedDir}" config user.name "ADW Test"`, seedDir);

  fs.writeFileSync(path.join(seedDir, 'README.md'), 'test repo\n');
  execSync(`"${GIT}" -C "${seedDir}" add README.md`, { stdio: 'pipe' });

  if (adwVersionContent !== null) {
    fs.writeFileSync(path.join(seedDir, ADW_VERSION_FILENAME), `${adwVersionContent}\n`);
    execSync(`"${GIT}" -C "${seedDir}" add "${ADW_VERSION_FILENAME}"`, { stdio: 'pipe' });
  }

  execSync(`"${GIT}" -C "${seedDir}" commit -m "initial commit"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${seedDir}" branch -M "${defaultBranch}"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${seedDir}" remote add origin "${originDir}"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${seedDir}" push origin "${defaultBranch}"`, { stdio: 'pipe' });

  const workspacePath = mktemp('adw-712-ws-');
  execSync(`"${GIT}" init "${workspacePath}"`, { stdio: 'pipe' });
  git(`-C "${workspacePath}" config user.email "test@adw.local"`, workspacePath);
  git(`-C "${workspacePath}" config user.name "ADW Test"`, workspacePath);
  execSync(`"${GIT}" -C "${workspacePath}" remote add origin "${originDir}"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${workspacePath}" fetch --all`, { stdio: 'pipe' });
  execSync(
    `"${GIT}" -C "${workspacePath}" checkout -b "${defaultBranch}" "origin/${defaultBranch}"`,
    { stdio: 'pipe' },
  );

  return workspacePath;
}

// ── §4/§6 Given — bare origin with .adw-version committed ─────────────────────────

Given(
  'a target repository whose remote default branch {string} records a framework version of {string}',
  function (this: RegressionWorld, defaultBranch: string, version: string) {
    ctx.workspacePath = createRepoWithRemote(defaultBranch, version);
  },
);

// ── §5 Given — bare origin without .adw-version ────────────────────────────────────

Given(
  'a target repository whose remote default branch {string} records no framework version',
  function (this: RegressionWorld, defaultBranch: string) {
    ctx.workspacePath = createRepoWithRemote(defaultBranch, null);
  },
);

// ── §6 Given — stale LOCAL checkout (must NOT affect the remote read) ──────────────

Given(
  'the reused local checkout records a stale framework version of {string}',
  function (this: RegressionWorld, staleVersion: string) {
    assert.ok(ctx.workspacePath, 'workspacePath must be set by the preceding Given step');
    // Write the stale version to the local checkout's .adw-version — NOT committed to the
    // remote. readRemoteAdwVersion reads origin/<default>:.adw-version, so this file must
    // not affect the result. The contract under test: the remote value wins.
    fs.writeFileSync(path.join(ctx.workspacePath, ADW_VERSION_FILENAME), `${staleVersion}\n`);
  },
);

// ── §4–§6 When — call the authoritative remote reader ─────────────────────────────

When(
  'the stored framework version is read from the remote default branch {string}',
  function (this: RegressionWorld, defaultBranch: string) {
    assert.ok(ctx.workspacePath, 'workspacePath must be set by the preceding Given step');
    ctx.readResult = readRemoteAdwVersion(defaultBranch, ctx.workspacePath);
  },
);

// ── §4/§6 Then — result matches the committed remote hash ─────────────────────────

Then(
  'the framework version read from the remote is {string}',
  function (this: RegressionWorld, expectedVersion: string) {
    assert.strictEqual(
      ctx.readResult,
      expectedVersion,
      `Expected readRemoteAdwVersion to return "${expectedVersion}" but got "${String(ctx.readResult)}"`,
    );
  },
);

// ── §5 Then — result is null (no .adw-version on remote) ──────────────────────────

Then(
  'the framework version read from the remote is no recorded version',
  function (this: RegressionWorld) {
    assert.strictEqual(
      ctx.readResult,
      null,
      `Expected readRemoteAdwVersion to return null but got "${String(ctx.readResult)}"`,
    );
  },
);
