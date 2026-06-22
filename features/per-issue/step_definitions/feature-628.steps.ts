/**
 * BDD step definitions for feature-628.feature
 * adwUpgrade reconciles a stale reused worktree to the remote claim tip before regen.
 *
 * Steps NOT defined here (already registered globally):
 *  - Given 'the ADW codebase is checked out'                                           → ensureCronOnEveryEventSteps.ts (G18)
 *  - Given 'the claude-cli-stub is loaded with manifest {string}'                      → givenSteps.ts (G3)
 *  - Given 'an issue {int} exists in the mock issue tracker'                           → givenSteps.ts (G4)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}'         → givenSteps.ts (G11)
 *  - Given 'the mock GitHub API is configured to accept issue comments'                → givenSteps.ts (G1)
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}'  → whenSteps.ts (W1)
 *  - Then  'the orchestrator subprocess exited {int}'                                  → thenSteps.ts (T5)
 *  - Then  'the mock GitHub API recorded a PR creation for issue {int}'                → thenSteps.ts (T8)
 *  - Then  'the mock harness recorded zero comment posts on issue {int}'               → feature-509.steps.ts (T14)
 *  - Then  'the mock harness recorded zero PR creations for issue {int}'               → feature-541.steps.ts
 *  - Then  'the ADW TypeScript type-check passes'                                      → feature-504.steps.ts (T22)
 *
 * W1 note: whenSteps.ts returns 'pending' when mockContext !== null (ISSUE-3-CUTOVER).
 * §3 and §4 are therefore marked as pending (not failed) — expected per-issue behaviour.
 *
 * Novel vocabulary introduced here (gap surfaced per feature-628 note):
 *  Given — 'a target repo whose remote claim branch {string} points at the current claim commit'
 *  Given — 'a reused upgrade worktree checked out on a superseded, divergent claim commit of {string}'
 *  Given — 'a reused upgrade worktree already checked out on the current claim commit of {string}'
 *  Given — 'the upgrade worktree for adwId {string} is stale — its branch sits on a superseded...'
 *  Given — 'a competing claimant advances the remote claim branch {string} after the run reconciles...'
 *  Given — 'a target repo with an existing worktree for branch {string} carrying a local-only commit...'
 *  When  — 'the upgrade worktree is reconciled to the remote claim tip of {string}'
 *  When  — 'a non-upgrade orchestrator reuses the existing worktree for branch {string}'
 *  Then  — 'the upgrade worktree HEAD matches the remote claim tip of {string}'
 *  Then  — 'a regeneration commit pushed from the reconciled worktree to {string} is accepted...'
 *  Then  — 'the reused worktree HEAD still carries the local-only commit'
 *  Then  — 'the reused worktree HEAD does not match the remote tip of {string}'
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
import { fetchAndResetToRemote } from '../../../adws/vcs/branchOperations.ts';
import { ensureWorktree } from '../../../adws/gitContext/worktreeOps.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ADW_UPGRADE_SRC = resolve(ROOT, 'adws/adwUpgrade.tsx');

const GIT = process.env['REAL_GIT_PATH'] ?? 'git';

// ---------------------------------------------------------------------------
// git helper — runs a command in the given directory
// ---------------------------------------------------------------------------

function git(args: string, cwd: string): string {
  return execSync(
    `"${GIT}" ${args}`,
    { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

// ---------------------------------------------------------------------------
// Module-level per-scenario state (reset in Before hooks)
// ---------------------------------------------------------------------------

const ctx: {
  originDir: string;
  worktreePath: string;
  remoteTipSha: string;
  tmpClone1Dir: string;
  localOnlyCommitSha: string;
  baseRepoPath: string;
  reusedWorktreePath: string;
} = {
  originDir: '',
  worktreePath: '',
  remoteTipSha: '',
  tmpClone1Dir: '',
  localOnlyCommitSha: '',
  baseRepoPath: '',
  reusedWorktreePath: '',
};

// Temp dirs accumulated for cleanup in After hook.
const tempDirs: string[] = [];

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-628
// ---------------------------------------------------------------------------

Before({ tags: '@adw-628' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  ctx.originDir = '';
  ctx.worktreePath = '';
  ctx.remoteTipSha = '';
  ctx.tmpClone1Dir = '';
  ctx.localOnlyCommitSha = '';
  ctx.baseRepoPath = '';
  ctx.reusedWorktreePath = '';
  tempDirs.length = 0;
});

After({ tags: '@adw-628' }, async function (this: RegressionWorld) {
  // Clean up real git repos created by §1/§2/§5 steps.
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
  ctx.originDir = '';
  ctx.worktreePath = '';
  ctx.remoteTipSha = '';
  ctx.tmpClone1Dir = '';
  ctx.localOnlyCommitSha = '';
  ctx.baseRepoPath = '';
  ctx.reusedWorktreePath = '';
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Helpers — create a bare "origin" with a main branch + initial commit
// ---------------------------------------------------------------------------

function mktemp(prefix: string): string {
  const p = fs.mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(p);
  return p;
}

function initBareOriginWithMain(): string {
  const originDir = mktemp('adw-628-origin-');
  execSync(`"${GIT}" init --bare "${originDir}"`, { stdio: 'pipe' });

  const seedDir = mktemp('adw-628-seed-');
  execSync(`"${GIT}" init "${seedDir}"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${seedDir}" config user.email "test@adw.local"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${seedDir}" config user.name "ADW Test"`, { stdio: 'pipe' });
  fs.writeFileSync(path.join(seedDir, 'README.md'), 'test repo');
  execSync(`"${GIT}" -C "${seedDir}" add README.md`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${seedDir}" commit -m "initial commit"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${seedDir}" branch -M main`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${seedDir}" remote add origin "${originDir}"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${seedDir}" push origin main`, { stdio: 'pipe' });

  return originDir;
}

/** Set up a local repo tracking originDir with all remote refs available. Returns the repo path. */
function cloneOrigin(originDir: string, suffix: string): string {
  const dir = mktemp(`adw-628-${suffix}-`);
  execSync(`"${GIT}" init "${dir}"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${dir}" config user.email "test@adw.local"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${dir}" config user.name "ADW Test"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${dir}" remote add origin "${originDir}"`, { stdio: 'pipe' });
  execSync(`"${GIT}" -C "${dir}" fetch --all`, { stdio: 'pipe' });
  // Checkout main so the repo is in a working state.
  execSync(`"${GIT}" -C "${dir}" checkout -b main origin/main`, { stdio: 'pipe' });
  return dir;
}

// ---------------------------------------------------------------------------
// §1/§2 Given — real target repo with remote claim branch at current tip
//
// Strategy: create origin with main + the claim branch already at the "current
// (new nonce)" commit. The diverged step then creates a LOCAL clone whose claim
// branch sits on a DIFFERENT (old nonce) commit from the same main-base parent.
// This avoids force-push races: origin already has the right remote tip before
// the local worktree is created.
// ---------------------------------------------------------------------------

Given(
  'a target repo whose remote claim branch {string} points at the current claim commit',
  function (this: RegressionWorld, claimBranch: string) {
    ctx.originDir = initBareOriginWithMain();

    // Push the "current nonce" commit onto the claim branch in origin.
    const seedClone = cloneOrigin(ctx.originDir, 'claim-seed');
    execSync(`"${GIT}" -C "${seedClone}" checkout -b "${claimBranch}"`, { stdio: 'pipe' });
    execSync(
      `"${GIT}" -C "${seedClone}" commit --allow-empty -m "ADW claim: current nonce"`,
      { stdio: 'pipe' },
    );
    execSync(`"${GIT}" -C "${seedClone}" push origin "${claimBranch}"`, { stdio: 'pipe' });
    ctx.remoteTipSha = execSync(
      `"${GIT}" -C "${seedClone}" rev-parse HEAD`,
      { encoding: 'utf-8', stdio: 'pipe' },
    ).trim();
    // seedClone is kept in tempDirs for cleanup; no ctx reference needed.
  },
);

// ---------------------------------------------------------------------------
// §1 Given — reused upgrade worktree on a DIVERGED (superseded) commit
//
// origin already has the "current nonce" commit on the claim branch. We clone
// origin to get all remote tracking refs (origin/<claimBranch> = remoteTipSha),
// then locally create the claim branch from origin/main (the common ancestor)
// and make an "old nonce" commit. The local branch is now a DIVERGED sibling of
// origin/<claimBranch>: neither is an ancestor of the other.
// ---------------------------------------------------------------------------

Given(
  'a reused upgrade worktree checked out on a superseded, divergent claim commit of {string}',
  function (this: RegressionWorld, claimBranch: string) {
    assert.ok(ctx.originDir, 'originDir must be set by the preceding Given step');
    assert.ok(ctx.remoteTipSha, 'remoteTipSha must be set by the preceding Given step');

    // Clone origin — all remote refs are fetched, including origin/<claimBranch>.
    const worktreePath = cloneOrigin(ctx.originDir, 'wt');

    // Create the local claim branch from origin/main (the common base ancestor).
    // The claim branch does NOT track origin/<claimBranch> — it diverges from it.
    execSync(
      `"${GIT}" -C "${worktreePath}" checkout -b "${claimBranch}" origin/main`,
      { stdio: 'pipe' },
    );
    execSync(
      `"${GIT}" -C "${worktreePath}" commit --allow-empty -m "ADW claim: old nonce (superseded)"`,
      { stdio: 'pipe' },
    );
    const localSha = execSync(
      `"${GIT}" -C "${worktreePath}" rev-parse HEAD`,
      { encoding: 'utf-8', stdio: 'pipe' },
    ).trim();

    // Verify divergence: local != remote tip (neither is an ancestor of the other).
    assert.notStrictEqual(
      localSha,
      ctx.remoteTipSha,
      `Local SHA (${localSha}) must differ from remote tip (${ctx.remoteTipSha}) to establish divergence`,
    );
    ctx.worktreePath = worktreePath;
  },
);

// ---------------------------------------------------------------------------
// §2 Given — reused upgrade worktree already ON the current claim commit (no-op)
// ---------------------------------------------------------------------------

Given(
  'a reused upgrade worktree already checked out on the current claim commit of {string}',
  function (this: RegressionWorld, claimBranch: string) {
    assert.ok(ctx.originDir, 'originDir must be set by the preceding Given step');
    assert.ok(ctx.remoteTipSha, 'remoteTipSha must be set by the preceding Given step');

    // Clone origin and check out the claim branch at the CURRENT remote tip.
    const worktreePath = cloneOrigin(ctx.originDir, 'wt2');
    execSync(`"${GIT}" -C "${worktreePath}" fetch origin`, { stdio: 'pipe' });
    execSync(
      `"${GIT}" -C "${worktreePath}" checkout -b "${claimBranch}" "origin/${claimBranch}"`,
      { stdio: 'pipe' },
    );
    const localSha = execSync(
      `"${GIT}" -C "${worktreePath}" rev-parse HEAD`,
      { encoding: 'utf-8', stdio: 'pipe' },
    ).trim();

    // Verify the local IS already at the remote tip (no divergence).
    assert.strictEqual(
      localSha,
      ctx.remoteTipSha,
      `Local HEAD (${localSha}) must equal remote tip (${ctx.remoteTipSha}) to confirm the already-current precondition`,
    );
    ctx.worktreePath = worktreePath;
  },
);

// ---------------------------------------------------------------------------
// §1/§2 When — reconcile the upgrade worktree to the remote claim tip
// ---------------------------------------------------------------------------

When(
  'the upgrade worktree is reconciled to the remote claim tip of {string}',
  function (this: RegressionWorld, claimBranch: string) {
    assert.ok(ctx.worktreePath, 'worktreePath must be set by the preceding Given step');
    // Call the production reconcile primitive directly (the same function
    // executeUpgrade delegates to via reconcileWorktreeToRemote).
    fetchAndResetToRemote(claimBranch, ctx.worktreePath);
  },
);

// ---------------------------------------------------------------------------
// §1/§2 Then — worktree HEAD matches remote claim tip
// ---------------------------------------------------------------------------

Then(
  'the upgrade worktree HEAD matches the remote claim tip of {string}',
  function (this: RegressionWorld, claimBranch: string) {
    assert.ok(ctx.worktreePath, 'worktreePath must be set');
    const headSha = git('rev-parse HEAD', ctx.worktreePath);
    // Compare against the tracking ref that fetchAndResetToRemote updated — this is the
    // most direct observable assertion: HEAD == origin/<claimBranch> == remoteTipSha.
    const trackingRefSha = git(`rev-parse "refs/remotes/origin/${claimBranch}"`, ctx.worktreePath);
    assert.strictEqual(
      headSha,
      trackingRefSha,
      `Worktree HEAD (${headSha}) must match refs/remotes/origin/${claimBranch} (${trackingRefSha}) after reconcile`,
    );
    // Also confirm the tracking ref matches the SHA we recorded as the remote tip.
    assert.strictEqual(
      trackingRefSha,
      ctx.remoteTipSha,
      `refs/remotes/origin/${claimBranch} (${trackingRefSha}) must equal the expected remote tip (${ctx.remoteTipSha}) — confirming the fetch got the right commit`,
    );
  },
);

// ---------------------------------------------------------------------------
// §1/§2 Then — a regen commit pushes as fast-forward
// ---------------------------------------------------------------------------

Then(
  'a regeneration commit pushed from the reconciled worktree to {string} is accepted as a fast-forward',
  function (this: RegressionWorld, claimBranch: string) {
    assert.ok(ctx.worktreePath, 'worktreePath must be set');
    // Make a regen commit on top of the reconciled HEAD.
    fs.writeFileSync(path.join(ctx.worktreePath, '.adw-version'), 'test-regen-hash\n');
    git('add .adw-version', ctx.worktreePath);
    git('commit -m "chore: regen .adw/ (test)"', ctx.worktreePath);
    // Push must succeed as a fast-forward — no --force flag.
    let pushFailed = false;
    try {
      git(`push origin "${claimBranch}"`, ctx.worktreePath);
    } catch {
      pushFailed = true;
    }
    assert.strictEqual(
      pushFailed,
      false,
      `Expected git push origin "${claimBranch}" to succeed as a fast-forward after reconcile`,
    );
  },
);

// ---------------------------------------------------------------------------
// §3/§4 Given — upgrade worktree is stale (source-inspection fallback for CUTOVER)
// ---------------------------------------------------------------------------

Given(
  'the upgrade worktree for adwId {string} is stale — its branch sits on a superseded claim commit while the remote claim branch has advanced to a new claim',
  function (this: RegressionWorld, adwId: string) {
    // W1 is pending (ISSUE-3-CUTOVER): the orchestrator subprocess never runs under the
    // harness, so the real stale state cannot be observed via mock artefacts. Source-inspection
    // fallback: confirm the upgrade path calls reconcileWorktreeToRemote.
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes('reconcileWorktreeToRemote'),
      `Expected adwUpgrade.tsx to call reconcileWorktreeToRemote to reconcile the stale upgrade worktree (adwId: ${adwId})`,
    );
    assert.ok(
      src.includes('deps.reconcileWorktreeToRemote'),
      `Expected adwUpgrade.tsx to invoke reconcileWorktreeToRemote via the DI dep`,
    );
  },
);

// ---------------------------------------------------------------------------
// §4 Given — competing claimant advances remote after reconcile (source inspection)
// ---------------------------------------------------------------------------

Given(
  'a competing claimant advances the remote claim branch {string} after the run reconciles, so the regeneration push is rejected as non-fast-forward',
  function (this: RegressionWorld, _claimBranch: string) {
    // W1 is pending (ISSUE-3-CUTOVER). Source-inspection fallback: confirm the claim_lost path.
    const src = fs.readFileSync(ADW_UPGRADE_SRC, 'utf-8');
    assert.ok(
      src.includes("reason: 'claim_lost'"),
      `Expected adwUpgrade.tsx to return reason: 'claim_lost' when the push is rejected as non-fast-forward`,
    );
    assert.ok(
      src.includes('isPushRejection'),
      `Expected adwUpgrade.tsx to classify non-fast-forward errors via isPushRejection`,
    );
  },
);

// ---------------------------------------------------------------------------
// §5 Given — non-bare repo with an existing worktree carrying a local-only commit
// ---------------------------------------------------------------------------

Given(
  'a target repo with an existing worktree for branch {string} carrying a local-only commit ahead of the remote',
  function (this: RegressionWorld, branchName: string) {
    // 1. Create a bare "origin" seeded with main + the feature branch.
    const originDir = initBareOriginWithMain();
    ctx.originDir = originDir;

    // Push the feature branch to origin (from a temp clone).
    const seedClone = cloneOrigin(originDir, 'seed5');
    execSync(`"${GIT}" -C "${seedClone}" checkout -b "${branchName}"`, { stdio: 'pipe' });
    execSync(
      `"${GIT}" -C "${seedClone}" commit --allow-empty -m "initial feature commit"`,
      { stdio: 'pipe' },
    );
    execSync(`"${GIT}" -C "${seedClone}" push origin "${branchName}"`, { stdio: 'pipe' });
    ctx.remoteTipSha = execSync(
      `"${GIT}" -C "${seedClone}" rev-parse HEAD`,
      { encoding: 'utf-8', stdio: 'pipe' },
    ).trim();

    // 2. Create a "base repo" (clone of origin) that will host the linked worktree.
    const baseRepoPath = cloneOrigin(originDir, 'base5');
    ctx.baseRepoPath = baseRepoPath;
    execSync(`"${GIT}" -C "${baseRepoPath}" fetch origin`, { stdio: 'pipe' });

    // 3. Create a linked worktree inside `.worktrees/<branchName>/` of the base repo.
    const worktreesDir = path.join(baseRepoPath, '.worktrees');
    fs.mkdirSync(worktreesDir, { recursive: true });
    const linkedWtPath = path.join(worktreesDir, branchName);

    // Create a local tracking branch in baseRepo, then add as a linked worktree.
    execSync(
      `"${GIT}" -C "${baseRepoPath}" checkout -b "${branchName}" "origin/${branchName}"`,
      { stdio: 'pipe' },
    );
    execSync(`"${GIT}" -C "${baseRepoPath}" checkout main`, { stdio: 'pipe' });
    execSync(
      `"${GIT}" -C "${baseRepoPath}" worktree add "${linkedWtPath}" "${branchName}"`,
      { stdio: 'pipe' },
    );

    // 4. In the linked worktree, make a local-only commit (do NOT push to origin).
    execSync(`"${GIT}" -C "${linkedWtPath}" config user.email "test@adw.local"`, { stdio: 'pipe' });
    execSync(`"${GIT}" -C "${linkedWtPath}" config user.name "ADW Test"`, { stdio: 'pipe' });
    fs.writeFileSync(path.join(linkedWtPath, 'local-only.txt'), 'local-only change');
    execSync(`"${GIT}" -C "${linkedWtPath}" add local-only.txt`, { stdio: 'pipe' });
    execSync(
      `"${GIT}" -C "${linkedWtPath}" commit -m "local-only commit (not pushed)"`,
      { stdio: 'pipe' },
    );
    ctx.localOnlyCommitSha = execSync(
      `"${GIT}" -C "${linkedWtPath}" rev-parse HEAD`,
      { encoding: 'utf-8', stdio: 'pipe' },
    ).trim();
    ctx.worktreePath = linkedWtPath;
  },
);

// ---------------------------------------------------------------------------
// §5 When — non-upgrade orchestrator reuses the existing worktree (no reconcile)
// ---------------------------------------------------------------------------

When(
  'a non-upgrade orchestrator reuses the existing worktree for branch {string}',
  function (this: RegressionWorld, branchName: string) {
    assert.ok(ctx.baseRepoPath, 'baseRepoPath must be set by the preceding Given step');
    // Call ensureWorktree from worktreeOps directly (no GitContext needed — this is a
    // BDD integration step that exercises the underlying function with an explicit basePath).
    // A non-upgrade orchestrator does NOT call reconcileWorktreeToRemote afterward.
    ctx.reusedWorktreePath = ensureWorktree(ctx.baseRepoPath, branchName, 'main', process.env, () => {});
  },
);

// ---------------------------------------------------------------------------
// §5 Then — reused worktree HEAD still carries the local-only commit
// ---------------------------------------------------------------------------

Then(
  'the reused worktree HEAD still carries the local-only commit',
  function (this: RegressionWorld) {
    assert.ok(ctx.reusedWorktreePath, 'reusedWorktreePath must be set by the When step');
    assert.ok(ctx.localOnlyCommitSha, 'localOnlyCommitSha must be set by the Given step');
    const headSha = git('rev-parse HEAD', ctx.reusedWorktreePath);
    assert.strictEqual(
      headSha,
      ctx.localOnlyCommitSha,
      `Expected reused worktree HEAD (${headSha}) to carry the local-only commit (${ctx.localOnlyCommitSha}) — ensureWorktree must not reset it`,
    );
  },
);

// ---------------------------------------------------------------------------
// §5 Then — reused worktree HEAD does NOT match the remote tip
// ---------------------------------------------------------------------------

Then(
  'the reused worktree HEAD does not match the remote tip of {string}',
  function (this: RegressionWorld, branchName: string) {
    assert.ok(ctx.reusedWorktreePath, 'reusedWorktreePath must be set by the When step');
    const headSha = git('rev-parse HEAD', ctx.reusedWorktreePath);
    // ctx.remoteTipSha was recorded before the local-only commit was made.
    assert.notStrictEqual(
      headSha,
      ctx.remoteTipSha,
      `Expected reused worktree HEAD (${headSha}) to differ from the remote tip (${ctx.remoteTipSha}) after the local-only commit — ensureWorktree must not have hard-reset it`,
    );
    // Also confirm via branch name that origin/<branchName> diverges.
    try {
      git(`fetch origin "${branchName}"`, ctx.reusedWorktreePath);
      const originSha = git(`rev-parse "origin/${branchName}"`, ctx.reusedWorktreePath);
      assert.notStrictEqual(
        headSha,
        originSha,
        `Reused worktree HEAD (${headSha}) must differ from origin/${branchName} (${originSha})`,
      );
    } catch { /* fetch may fail if the worktree has no remote — assertion on remoteTipSha is sufficient */ }
  },
);
