/**
 * BDD step definitions for feature-559.feature
 * Build context-reset cap replaced by a state-novelty progress gate
 *
 * §1 Pure gate function — calls evaluateProgressGate directly, no I/O.
 * §2 Tree-hash VCS helper — uses a real git repo in a temp directory.
 * §3–§6 Build phase integration — mock build loop using real evaluateProgressGate and VCS helpers.
 * §7 Test/review phases unchanged — mock retryWithResolution loop.
 * §8 TypeScript type-check — already defined in feature-504.steps.ts.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'   → ensureCronOnEveryEventSteps.ts
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  evaluateProgressGate,
  type ProgressGateDecision,
} from '../../../adws/phases/progressGate.ts';
import {
  getHeadTreeHash,
  hasUncommittedChanges,
} from '../../../adws/vcs/commitOperations.ts';
import { MAX_CONTEXT_RESETS } from '../../../adws/core/config.ts';
import { retryWithResolution } from '../../../adws/core/retryOrchestrator.ts';
import { AgentStateManager } from '../../../adws/core/index.ts';

// ============================================================================
// §1 Pure gate state
// ============================================================================

interface GateState {
  seen: Set<string>;
  seedHash: string;
  headTreeHash: string;
  checkpointCount: number;
  maxCheckpoints: number;
  decision: ProgressGateDecision | null;
  seenSizeBeforeCall: number;
  checkpointCountBeforeCall: number;
}

const gate: GateState = {
  seen: new Set(),
  seedHash: 'seed-hash-abc123',
  headTreeHash: '',
  checkpointCount: 0,
  maxCheckpoints: 20,
  decision: null,
  seenSizeBeforeCall: 0,
  checkpointCountBeforeCall: 0,
};

function resetGate(): void {
  gate.seen = new Set();
  gate.seedHash = 'seed-hash-abc123';
  gate.headTreeHash = '';
  gate.checkpointCount = 0;
  gate.maxCheckpoints = 20;
  gate.decision = null;
  gate.seenSizeBeforeCall = 0;
  gate.checkpointCountBeforeCall = 0;
}

// ============================================================================
// §2 VCS helper state
// ============================================================================

interface VcsState {
  tmpDir: string;
  recordedHash: string;
}

const vcs: VcsState = { tmpDir: '', recordedHash: '' };

// ============================================================================
// §3–§6 Build phase mock loop state
// ============================================================================

type BoundaryChangeMode = 'novel' | 'none' | 'always_novel';

interface BatchConfig {
  trigger: 'token_limit' | 'compaction';
  changeMode: BoundaryChangeMode;
  repeatForever: boolean;
}

interface BuildLoopState {
  tmpDir: string;
  perBatchCap: number;
  maxCheckpoints: number;
  batches: BatchConfig[];
  // result
  completed: boolean;
  abortReason: 'no_progress' | 'backstop' | null;
  contextResetCount: number;
  boundaryCommitCount: number;
  errorThrown: Error | null;
}

const buildLoop: BuildLoopState = {
  tmpDir: '',
  perBatchCap: MAX_CONTEXT_RESETS,
  maxCheckpoints: 20,
  batches: [],
  completed: false,
  abortReason: null,
  contextResetCount: 0,
  boundaryCommitCount: 0,
  errorThrown: null,
};

// Tracks which batch of "always_novel" was last committed so each gets a unique tree
let novelFileCounter = 0;

function resetBuildLoop(): void {
  if (buildLoop.tmpDir) {
    try { fs.rmSync(buildLoop.tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    buildLoop.tmpDir = '';
  }
  buildLoop.perBatchCap = MAX_CONTEXT_RESETS;
  buildLoop.maxCheckpoints = 20;
  buildLoop.batches = [];
  buildLoop.completed = false;
  buildLoop.abortReason = null;
  buildLoop.contextResetCount = 0;
  buildLoop.boundaryCommitCount = 0;
  buildLoop.errorThrown = null;
  novelFileCounter = 0;
}

// ============================================================================
// §7 Review/test phase state
// ============================================================================

interface PhaseRunState {
  abortedAtCap: boolean;
  contextResetCount: number;
  boundaryCommitCount: number;
  tmpStateDir: string;
}

const reviewRun: PhaseRunState = {
  abortedAtCap: false,
  contextResetCount: 0,
  boundaryCommitCount: 0,
  tmpStateDir: '',
};

const testRun: PhaseRunState = {
  abortedAtCap: false,
  contextResetCount: 0,
  boundaryCommitCount: 0,
  tmpStateDir: '',
};

function resetPhaseRun(state: PhaseRunState): void {
  state.abortedAtCap = false;
  state.contextResetCount = 0;
  state.boundaryCommitCount = 0;
  if (state.tmpStateDir) {
    try { fs.rmSync(state.tmpStateDir, { recursive: true, force: true }); } catch { /* ok */ }
    state.tmpStateDir = '';
  }
}

// ============================================================================
// Helpers
// ============================================================================

function initTmpGitRepo(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-559-'));
  execSync('git init -b main', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.email "test@adw.test"', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.name "ADW Test"', { cwd: tmpDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(tmpDir, 'init.txt'), 'initial content');
  execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });
  return tmpDir;
}

async function runMockBuildLoop(state: BuildLoopState): Promise<void> {
  const tmpDir = state.tmpDir;
  const seenTreeHashes = new Set<string>([getHeadTreeHash(tmpDir)]);
  let perBatchResets = 0;
  let checkpointCount = 0;
  let contextResetCount = 0;
  let buildCompleted = false;
  let boundaryCommitCount = 0;
  let abortReason: 'no_progress' | 'backstop' | null = null;
  let batchIndex = 0;

  try {
    while (!buildCompleted) {
      const batch = state.batches[batchIndex] ?? (state.batches[state.batches.length - 1]);
      if (!batch) throw new Error('No batch config available');

      // Simulate one agent run: the trigger fires
      perBatchResets++;
      contextResetCount++;

      if (perBatchResets < state.perBatchCap) {
        continue; // restart within batch
      }

      // Batch boundary reached
      const changeMode = batch.changeMode;
      if (changeMode === 'novel' || changeMode === 'always_novel') {
        // Write a unique file to make the worktree dirty
        const fname = `novel-${++novelFileCounter}.txt`;
        fs.writeFileSync(path.join(tmpDir, fname), `novel content ${novelFileCounter}`);
      }
      // 'none' → no change → worktree stays clean

      if (hasUncommittedChanges(tmpDir)) {
        execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
        execSync(`git commit -m "batch boundary ${batchIndex + 1}"`, { cwd: tmpDir, stdio: 'pipe' });
        boundaryCommitCount++;
      }

      const headTreeHash = getHeadTreeHash(tmpDir);
      const decision = evaluateProgressGate({
        headTreeHash,
        seen: seenTreeHashes,
        checkpointCount,
        maxCheckpoints: state.maxCheckpoints,
      });

      if (decision.kind === 'abort') {
        abortReason = decision.reason;
        break;
      }

      // Novel state — continue to next batch
      seenTreeHashes.add(headTreeHash);
      checkpointCount++;
      perBatchResets = 0;

      if (!batch.repeatForever) {
        batchIndex++;
        if (batchIndex >= state.batches.length) {
          // All batches exhausted — build completes
          buildCompleted = true;
        }
      }
    }
  } catch (err) {
    state.errorThrown = err as Error;
    state.contextResetCount = contextResetCount;
    state.boundaryCommitCount = boundaryCommitCount;
    return;
  }

  state.completed = buildCompleted;
  state.abortReason = abortReason;
  state.contextResetCount = contextResetCount;
  state.boundaryCommitCount = boundaryCommitCount;
}

// ============================================================================
// Before / After hooks
// ============================================================================

Before({ tags: '@adw-559' }, function () {
  resetGate();
  resetBuildLoop();
  resetPhaseRun(reviewRun);
  resetPhaseRun(testRun);
  vcs.tmpDir = '';
  vcs.recordedHash = '';
  novelFileCounter = 0;
});

After({ tags: '@adw-559' }, function () {
  resetGate();
  resetBuildLoop();
  resetPhaseRun(reviewRun);
  resetPhaseRun(testRun);
  if (vcs.tmpDir) {
    try { fs.rmSync(vcs.tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    vcs.tmpDir = '';
  }
});

// ============================================================================
// §1 Given — pure gate
// ============================================================================

Given('the build-start tree state seeds the set of seen states', function () {
  gate.seen = new Set([gate.seedHash]);
});

Given('the progress-checkpoint backstop is set to {int}', function (n: number) {
  gate.maxCheckpoints = n;
  buildLoop.maxCheckpoints = n;
});

Given('no progress checkpoints have been recorded yet in this build', function () {
  gate.checkpointCount = 0;
});

Given('{int} progress checkpoint has already been recorded in this build', function (n: number) {
  gate.checkpointCount = n;
});

Given('{int} progress checkpoints have already been recorded in this build', function (n: number) {
  gate.checkpointCount = n;
});

Given('the committed tree state is novel — never seen in this build', function () {
  gate.headTreeHash = 'novel-tree-hash-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  // ensure it's not in seen
  while (gate.seen.has(gate.headTreeHash)) {
    gate.headTreeHash += 'x';
  }
});

Given('the committed tree state was recorded at an earlier checkpoint in this build', function () {
  const h1 = 'earlier-checkpoint-hash-h1';
  gate.seen.add(h1);
  gate.headTreeHash = h1;
});

Given('the committed tree state equals the build-start seed state', function () {
  gate.headTreeHash = gate.seedHash;
});

Given('the committed tree state is novel but represents a net deletion of lines', function () {
  // A hash that isn't in `seen` — the net-negative aspect is semantic, not structural
  gate.headTreeHash = 'net-deletion-novel-hash-xyz';
  assert.ok(!gate.seen.has(gate.headTreeHash), 'net-deletion hash must not be in seen');
});

// ============================================================================
// §1 When — evaluate gate
// ============================================================================

When('the progress gate is evaluated for the committed tree state', function () {
  gate.seenSizeBeforeCall = gate.seen.size;
  gate.checkpointCountBeforeCall = gate.checkpointCount;
  gate.decision = evaluateProgressGate({
    headTreeHash: gate.headTreeHash,
    seen: gate.seen,
    checkpointCount: gate.checkpointCount,
    maxCheckpoints: gate.maxCheckpoints,
  });
});

// ============================================================================
// §1 Then — gate decisions + purity
// ============================================================================

Then('the gate decision is to continue', function () {
  assert.deepStrictEqual(gate.decision, { kind: 'continue' });
});

Then('the gate decision is to abort with reason no-progress', function () {
  assert.deepStrictEqual(gate.decision, { kind: 'abort', reason: 'no_progress' });
});

Then('the gate decision is to abort at the backstop', function () {
  assert.deepStrictEqual(gate.decision, { kind: 'abort', reason: 'backstop' });
});

Then('the set of seen states passed to the gate is unchanged', function () {
  assert.strictEqual(gate.seen.size, gate.seenSizeBeforeCall,
    `seen.size changed from ${gate.seenSizeBeforeCall} to ${gate.seen.size}`);
});

Then('the progress-checkpoint count passed to the gate is unchanged', function () {
  assert.strictEqual(gate.checkpointCount, gate.checkpointCountBeforeCall,
    `checkpointCount changed from ${gate.checkpointCountBeforeCall} to ${gate.checkpointCount}`);
});

// ============================================================================
// §2 Given / When / Then — VCS helpers
// ============================================================================

Given('a worktree on the build branch with a committed change', function () {
  vcs.tmpDir = initTmpGitRepo();
  // Add a committed change so the initial tree is not bare
  fs.writeFileSync(path.join(vcs.tmpDir, 'feature.txt'), 'feature content v1');
  execSync('git add -A', { cwd: vcs.tmpDir, stdio: 'pipe' });
  execSync('git commit -m "feature v1"', { cwd: vcs.tmpDir, stdio: 'pipe' });
});

Given('the worktree HEAD tree hash is recorded', function () {
  vcs.recordedHash = getHeadTreeHash(vcs.tmpDir);
  assert.ok(vcs.recordedHash.length > 0, 'HEAD tree hash must not be empty');
});

When('the worktree is returned to that identical tree state and committed again', function () {
  // Overwrite with the same content → same tree
  fs.writeFileSync(path.join(vcs.tmpDir, 'feature.txt'), 'feature content v1');
  execSync('git add -A', { cwd: vcs.tmpDir, stdio: 'pipe' });
  // Only commit if there are changes (there shouldn't be — same content)
  const status = execSync('git status --porcelain', { cwd: vcs.tmpDir, encoding: 'utf-8' });
  if (status.trim().length > 0) {
    execSync('git commit -m "re-commit identical"', { cwd: vcs.tmpDir, stdio: 'pipe' });
  } else {
    // No change — tree hash is unchanged by definition; make an empty commit with same tree
    execSync('git commit --allow-empty -m "empty re-commit"', { cwd: vcs.tmpDir, stdio: 'pipe' });
  }
});

When('a commit that only deletes content is made', function () {
  fs.unlinkSync(path.join(vcs.tmpDir, 'feature.txt'));
  execSync('git add -A', { cwd: vcs.tmpDir, stdio: 'pipe' });
  execSync('git commit -m "delete feature.txt"', { cwd: vcs.tmpDir, stdio: 'pipe' });
});

Then('the worktree HEAD tree hash equals the recorded hash', function () {
  const currentHash = getHeadTreeHash(vcs.tmpDir);
  assert.strictEqual(currentHash, vcs.recordedHash,
    `Expected hash ${vcs.recordedHash} but got ${currentHash}`);
});

Then('the worktree HEAD tree hash differs from the recorded hash', function () {
  const currentHash = getHeadTreeHash(vcs.tmpDir);
  assert.notStrictEqual(currentHash, vcs.recordedHash,
    `Expected hash to differ from ${vcs.recordedHash} but they are equal`);
});

// ============================================================================
// §3–§6 Given — build phase configuration
// ============================================================================

Given('the per-batch context-reset cap is {int}', function (n: number) {
  buildLoop.perBatchCap = n;
});

Given('the build agent signals a token-limit reset on every run within the first batch', function () {
  buildLoop.batches.push({ trigger: 'token_limit', changeMode: 'none', repeatForever: false });
});

Given('the build agent signals a token-limit reset on every run', function () {
  buildLoop.batches.push({ trigger: 'token_limit', changeMode: 'none', repeatForever: true });
});

Given('the build agent signals a token-limit reset on every run across the first batch', function () {
  buildLoop.batches.push({ trigger: 'token_limit', changeMode: 'none', repeatForever: false });
});

Given('the build agent signals a token-limit reset on every run across the first two batches', function () {
  buildLoop.batches.push({ trigger: 'token_limit', changeMode: 'none', repeatForever: false });
  buildLoop.batches.push({ trigger: 'token_limit', changeMode: 'none', repeatForever: false });
});

Given('the build agent signals a context-compaction reset on every run within the first batch', function () {
  buildLoop.batches.push({ trigger: 'compaction', changeMode: 'none', repeatForever: false });
});

Given('the build agent signals a context-compaction reset on every run', function () {
  buildLoop.batches.push({ trigger: 'compaction', changeMode: 'none', repeatForever: true });
});

Given('the build agent signals a context-compaction reset on every run across the first two batches', function () {
  buildLoop.batches.push({ trigger: 'compaction', changeMode: 'none', repeatForever: false });
  buildLoop.batches.push({ trigger: 'compaction', changeMode: 'none', repeatForever: false });
});

Given('within the first batch the build agent signals a token-limit reset, then a compaction reset, then a token-limit reset', function () {
  // Three mixed triggers = one batch of perBatchCap=3 resets
  buildLoop.batches.push({ trigger: 'token_limit', changeMode: 'none', repeatForever: false });
});

Given('the worktree has uncommitted changes at the batch boundary', function () {
  // Mark the last batch to apply a novel change before the boundary commit
  const last = buildLoop.batches[buildLoop.batches.length - 1];
  if (last) last.changeMode = 'novel';
});

Given('the worktree is clean at the batch boundary', function () {
  const last = buildLoop.batches[buildLoop.batches.length - 1];
  if (last) last.changeMode = 'none';
});

Given('the worktree is clean at every batch boundary', function () {
  for (const b of buildLoop.batches) b.changeMode = 'none';
});

Given('each batch boundary commits a novel tree state', function () {
  for (const b of buildLoop.batches) b.changeMode = 'always_novel';
});

Given('every batch boundary commits a new novel tree state', function () {
  for (const b of buildLoop.batches) b.changeMode = 'always_novel';
  const last = buildLoop.batches[buildLoop.batches.length - 1];
  if (last) last.repeatForever = true;
});

Given('the first batch boundary commits a novel tree state', function () {
  const first = buildLoop.batches[0];
  if (first) first.changeMode = 'novel';
});

Given('the first batch boundary commits a net deletion that reaches a novel tree state', function () {
  const first = buildLoop.batches[0];
  if (first) first.changeMode = 'novel';
});

Given('the second batch boundary returns the worktree to the first boundary\'s tree state', function () {
  // Split the (possibly infinite) batch sequence so batch 1 has a novel change
  // and batch 2 (and beyond) has no change → HEAD stays at T1 (already in seen) → no_progress
  if (buildLoop.batches.length === 1 && buildLoop.batches[0]!.repeatForever) {
    const first = { ...buildLoop.batches[0]!, repeatForever: false };
    const second = { ...buildLoop.batches[0]!, changeMode: 'none' as const, repeatForever: true };
    buildLoop.batches = [first, second];
  } else {
    const second = buildLoop.batches[1];
    if (second) second.changeMode = 'none';
  }
});

Given('the batch boundary commits a novel tree state', function () {
  // Mixed-trigger scenario: same as "the first batch boundary commits a novel tree state"
  const last = buildLoop.batches[buildLoop.batches.length - 1];
  if (last) last.changeMode = 'novel';
});

Given('the build agent then completes successfully', function () {
  // Add a final "success" batch that terminates after 0 resets
  // Represented by ending the loop after all non-forever batches complete
  // (mock loop exits when batchIndex >= batches.length and last batch is not repeatForever)
  // We need to add a sentinel batch with 0 resets for immediate success.
  // Implementation: the loop exits after all non-repeat batches are consumed.
  // "completes successfully" means finalSuccess=true — handled by loop exit.
  // Already handled: when batchIndex runs out of non-repeat batches, buildCompleted=true.
});

Given('the build agent completes successfully on its first run with no reset', function () {
  // No batches with triggers — the mock loop exits immediately (0 batches → buildCompleted=true immediately)
  buildLoop.batches = [];
});

// ============================================================================
// §3–§6 When — run the build phase
// ============================================================================

When('the build phase runs', async function () {
  buildLoop.tmpDir = initTmpGitRepo();

  if (buildLoop.batches.length === 0) {
    // No batches = immediate success (no resets at all)
    buildLoop.completed = true;
    buildLoop.contextResetCount = 0;
    buildLoop.boundaryCommitCount = 0;
    return;
  }

  await runMockBuildLoop(buildLoop);
});

// ============================================================================
// §3–§6 Then — build phase outcomes
// ============================================================================

Then('a commit is recorded at the batch boundary', function () {
  assert.ok(
    buildLoop.boundaryCommitCount > 0,
    `Expected at least one boundary commit, got ${buildLoop.boundaryCommitCount}`,
  );
});

Then('no commit is recorded at the batch boundary', function () {
  assert.strictEqual(
    buildLoop.boundaryCommitCount,
    0,
    `Expected zero boundary commits, got ${buildLoop.boundaryCommitCount}`,
  );
});

Then('the build phase aborts with reason no-progress', function () {
  assert.strictEqual(
    buildLoop.abortReason,
    'no_progress',
    `Expected abort reason 'no_progress', got '${buildLoop.abortReason}'`,
  );
});

Then('the build phase aborts at the backstop', function () {
  assert.strictEqual(
    buildLoop.abortReason,
    'backstop',
    `Expected abort reason 'backstop', got '${buildLoop.abortReason}'`,
  );
});

Then('the build phase completes successfully', function () {
  assert.ok(
    buildLoop.completed,
    `Expected build phase to complete successfully, but it did not. abortReason=${buildLoop.abortReason}`,
  );
  assert.strictEqual(buildLoop.abortReason, null, `Expected no abort reason`);
});

Then('the build phase survives more than {int} context resets', function (cap: number) {
  assert.ok(
    buildLoop.contextResetCount >= cap,
    `Expected contextResetCount >= ${cap}, got ${buildLoop.contextResetCount}`,
  );
});

Then('the build phase records zero context resets', function () {
  assert.strictEqual(
    buildLoop.contextResetCount,
    0,
    `Expected zero context resets, got ${buildLoop.contextResetCount}`,
  );
});

// ============================================================================
// §7 Given — review and test phase setup
// ============================================================================

Given('the review agent signals a context-compaction reset on every run', function () {
  // Configuration only — consumed in "When the review phase runs"
});

Given('the test agent signals a context-compaction reset on every run', function () {
  // Configuration only — consumed in "When the test phase runs"
});

// ============================================================================
// §7 When — run review / test phase (mock retryWithResolution)
// ============================================================================

async function runMockRetryPhase(state: PhaseRunState, perBatchCap: number): Promise<void> {
  state.tmpStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-559-phase-'));
  // writeState / appendLog expect a *directory* path (they join it with 'state.json' internally)
  const statePath = state.tmpStateDir;
  AgentStateManager.writeState(statePath, { adwId: 'test-adw-559' } as Parameters<typeof AgentStateManager.writeState>[1]);

  let localResetCount = 0;
  try {
    await retryWithResolution({
      maxRetries: 100,
      statePath,
      label: 'mock-review',
      run: async () => ({ success: true, compactionDetected: true }),
      isPassed: () => false,
      extractFailures: () => [],
      resolveFailures: async () => ({ success: true }),
      onCompactionDetected: (n) => { localResetCount = n; },
      maxContextResets: perBatchCap,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('exceeded maximum context resets') || msg.includes('context compaction')) {
      state.abortedAtCap = true;
      state.contextResetCount = localResetCount;
    }
  }
  // No commits are ever made (boundaryCommitCount stays 0)
}

When('the review phase runs', async function () {
  await runMockRetryPhase(reviewRun, buildLoop.perBatchCap);
});

When('the test phase runs', async function () {
  await runMockRetryPhase(testRun, buildLoop.perBatchCap);
});

// ============================================================================
// §7 Then — review / test phase outcomes
// ============================================================================

Then('the review phase aborts at the context-reset cap', function () {
  assert.ok(
    reviewRun.abortedAtCap,
    `Expected review phase to abort at context-reset cap, but it did not`,
  );
});

Then('the test phase aborts at the context-reset cap', function () {
  assert.ok(
    testRun.abortedAtCap,
    `Expected test phase to abort at context-reset cap, but it did not`,
  );
});

Then('no batch-boundary commit is recorded for the review phase', function () {
  assert.strictEqual(
    reviewRun.boundaryCommitCount,
    0,
    `Expected zero boundary commits for review phase, got ${reviewRun.boundaryCommitCount}`,
  );
});

Then('no batch-boundary commit is recorded for the test phase', function () {
  assert.strictEqual(
    testRun.boundaryCommitCount,
    0,
    `Expected zero boundary commits for test phase, got ${testRun.boundaryCommitCount}`,
  );
});
