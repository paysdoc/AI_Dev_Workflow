/**
 * BDD step definitions for feature-614.feature
 * Receipt-based proof-of-execution for adwUpgrade — verifyAdwRegen gates on receipt
 * freshness, not on a `.adw/` content diff.
 *
 * All step definitions here call `verifyAdwRegen` in-process against a temp git repo
 * fixture. No mock infrastructure or subprocess orchestrator is needed — the gate logic
 * lives entirely in the pure/fs function under test.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'         → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes'    → feature-504.steps.ts (T22)
 *
 * Novel vocabulary introduced here:
 *  - Given 'a target worktree whose complete .adw/ directory and regression vocabulary file are committed with no pending content changes'
 *  - Given 'a target worktree with a complete .adw/ directory and regression vocabulary file'
 *  - Given 'the target worktree carries a regen receipt stamped with framework hash {string}'
 *  - Given 'the target worktree carries no regen receipt'
 *  - Given 'the target worktree is missing the .adw/ config file {string}'
 *  - Given 'the target worktree is missing the regression vocabulary file'
 *  - When  'the .adw\\/ regeneration is verified against framework hash {string}'
 *  - Then  'the regeneration verification passes'
 *  - Then  'the regeneration verification fails'
 *  - Then  'the regeneration verification reports {string} as a missing artefact'
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { verifyAdwRegen, REQUIRED_ADW_FILES } from '../../../adws/phases/worktreeSetup.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Module-level scenario state (reset in Before/After hooks)
// ---------------------------------------------------------------------------

let scenarioTempDir: string | undefined;
let verifyResult: { ok: boolean; missing: readonly string[] } | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@adw.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "ADW Test"', { cwd: dir, stdio: 'pipe' });
}

function seedAdwFilesAndVocab(dir: string): void {
  const adwDir = path.join(dir, '.adw');
  fs.mkdirSync(adwDir, { recursive: true });
  for (const file of REQUIRED_ADW_FILES) {
    fs.writeFileSync(path.join(adwDir, file), `# ${file}\n\nFixture content.\n`);
  }
  const vocabDir = path.join(dir, 'features', 'regression');
  fs.mkdirSync(vocabDir, { recursive: true });
  fs.writeFileSync(path.join(vocabDir, 'vocabulary.md'), '# Vocabulary\n\nFixture content.\n');
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-614
// ---------------------------------------------------------------------------

Before({ tags: '@adw-614' }, function (this: RegressionWorld) {
  scenarioTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-614-'));
  verifyResult = undefined;
});

After({ tags: '@adw-614' }, function (this: RegressionWorld) {
  if (scenarioTempDir) {
    fs.rmSync(scenarioTempDir, { recursive: true, force: true });
    scenarioTempDir = undefined;
  }
  verifyResult = undefined;
});

// ---------------------------------------------------------------------------
// Given — baseline worktrees
// ---------------------------------------------------------------------------

Given(
  'a target worktree whose complete .adw\\/ directory and regression vocabulary file are committed with no pending content changes',
  function () {
    if (!scenarioTempDir) return;
    initGitRepo(scenarioTempDir);
    seedAdwFilesAndVocab(scenarioTempDir);
    execSync('git add -A', { cwd: scenarioTempDir, stdio: 'pipe' });
    execSync('git commit -m "init: seed fixture files"', { cwd: scenarioTempDir, stdio: 'pipe' });
  },
);

Given(
  'a target worktree with a complete .adw\\/ directory and regression vocabulary file',
  function () {
    if (!scenarioTempDir) return;
    initGitRepo(scenarioTempDir);
    seedAdwFilesAndVocab(scenarioTempDir);
    execSync('git add -A', { cwd: scenarioTempDir, stdio: 'pipe' });
    execSync('git commit -m "init: seed fixture files"', { cwd: scenarioTempDir, stdio: 'pipe' });
  },
);

// ---------------------------------------------------------------------------
// Given — receipt and missing-file mutations
// ---------------------------------------------------------------------------

Given(
  'the target worktree carries a regen receipt stamped with framework hash {string}',
  function (hash: string) {
    if (!scenarioTempDir) return;
    const receiptPath = path.join(scenarioTempDir, '.adw', '.regen-receipt');
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `frameworkHash: ${hash}\n`);
    // Commit the receipt so that git status shows zero pending changes (§1 regression).
    execSync('git add .adw/.regen-receipt', { cwd: scenarioTempDir, stdio: 'pipe' });
    execSync('git commit -m "fix: write regen receipt"', { cwd: scenarioTempDir, stdio: 'pipe' });
  },
);

Given(
  'the target worktree carries no regen receipt',
  function () {
    // No-op: the receipt simply does not exist in the worktree.
  },
);

Given(
  'the target worktree is missing the .adw\\/ config file {string}',
  function (file: string) {
    if (!scenarioTempDir) return;
    const filePath = path.join(scenarioTempDir, '.adw', file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  },
);

Given(
  'the target worktree is missing the regression vocabulary file',
  function () {
    if (!scenarioTempDir) return;
    const vocabPath = path.join(scenarioTempDir, 'features', 'regression', 'vocabulary.md');
    if (fs.existsSync(vocabPath)) fs.unlinkSync(vocabPath);
  },
);

// ---------------------------------------------------------------------------
// When — invoke verifyAdwRegen
// ---------------------------------------------------------------------------

When(
  'the .adw\\/ regeneration is verified against framework hash {string}',
  function (hash: string) {
    if (!scenarioTempDir) return;
    verifyResult = verifyAdwRegen(scenarioTempDir, hash);
  },
);

// ---------------------------------------------------------------------------
// Then — assertions on the verification result
// ---------------------------------------------------------------------------

Then(
  'the regeneration verification passes',
  function () {
    assert.ok(verifyResult !== undefined, 'verifyResult must be set by the When step');
    assert.strictEqual(
      verifyResult.ok,
      true,
      `Expected verification to pass but got ok:false, missing:${JSON.stringify(verifyResult.missing)}`,
    );
  },
);

Then(
  'the regeneration verification fails',
  function () {
    assert.ok(verifyResult !== undefined, 'verifyResult must be set by the When step');
    assert.strictEqual(
      verifyResult.ok,
      false,
      `Expected verification to fail but got ok:true`,
    );
  },
);

Then(
  'the regeneration verification reports {string} as a missing artefact',
  function (artifact: string) {
    assert.ok(verifyResult !== undefined, 'verifyResult must be set by the When step');
    const missing = verifyResult.missing as readonly string[];
    const found = missing.some((m) => m.includes(artifact));
    assert.ok(
      found,
      `Expected missing artefacts to include "${artifact}" but got: ${JSON.stringify(missing)}`,
    );
  },
);
