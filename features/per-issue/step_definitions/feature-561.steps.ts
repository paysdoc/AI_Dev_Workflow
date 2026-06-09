/**
 * BDD step definitions for feature-561.feature
 * Build continuation prompt points the restarted agent at committed git state
 *
 * §1 Checkpoint commits present → committed-state direction included
 * §2 No checkpoint commits (first pass) → old prompt shape retained
 * §3 Committed-state direction independent of restart trigger
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
import { buildContinuationPrompt } from '../../../adws/phases/planPhase.ts';

interface ScenarioState {
  tmpDir: string;
  baseBranch: string;
  hasCheckpointCommits: boolean;
  previousOutput: string;
  reason: 'token_limit' | 'compaction';
  planContent: string;
  promptResult: string;
}

const state: ScenarioState = {
  tmpDir: '',
  baseBranch: 'main',
  hasCheckpointCommits: false,
  previousOutput: 'previous agent partial output',
  reason: 'token_limit',
  planContent: '## Plan\n\n1. Implement feature A\n2. Implement feature B',
  promptResult: '',
};

function resetState(): void {
  if (state.tmpDir) {
    try { fs.rmSync(state.tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    state.tmpDir = '';
  }
  state.baseBranch = 'main';
  state.hasCheckpointCommits = false;
  state.previousOutput = 'previous agent partial output';
  state.reason = 'token_limit';
  state.planContent = '## Plan\n\n1. Implement feature A\n2. Implement feature B';
  state.promptResult = '';
}

function initTmpGitRepo(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-561-'));
  execSync('git init -b main', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.email "test@adw.test"', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.name "ADW Test"', { cwd: tmpDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(tmpDir, 'init.txt'), 'initial content');
  execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });
  return tmpDir;
}

Before({ tags: '@adw-561' }, function () {
  resetState();
});

After({ tags: '@adw-561' }, function () {
  resetState();
});

// ── §1 / §3 Given — checkpoint commits present ─────────────────────────────

Given('a build worktree whose branch carries checkpoint commits beyond the base branch', function () {
  const tmpDir = initTmpGitRepo();
  execSync('git checkout -b feature-branch', { cwd: tmpDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(tmpDir, 'checkpoint-1.txt'), 'checkpoint 1 work');
  execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git commit -m "checkpoint 1"', { cwd: tmpDir, stdio: 'pipe' });
  state.tmpDir = tmpDir;
  state.baseBranch = 'main';
  state.hasCheckpointCommits = true;
});

// ── §2 Given — no checkpoint commits ──────────────────────────────────────

Given('a build worktree whose branch has no checkpoint commits beyond the base branch', function () {
  const tmpDir = initTmpGitRepo();
  execSync('git checkout -b feature-branch', { cwd: tmpDir, stdio: 'pipe' });
  state.tmpDir = tmpDir;
  state.baseBranch = 'main';
  state.hasCheckpointCommits = false;
});

Given('the previous build agent left partial output', function () {
  state.previousOutput = 'Implemented step 1. Working on step 2. Files modified: src/foo.ts';
});

// ── When ───────────────────────────────────────────────────────────────────

When('a build continuation prompt is built for that worktree', function () {
  state.promptResult = buildContinuationPrompt(
    state.planContent,
    state.previousOutput,
    state.reason,
    state.baseBranch,
    state.hasCheckpointCommits,
  );
});

When('a build continuation prompt is built for that worktree after a context-compaction reset', function () {
  state.reason = 'compaction';
  state.promptResult = buildContinuationPrompt(
    state.planContent,
    state.previousOutput,
    state.reason,
    state.baseBranch,
    state.hasCheckpointCommits,
  );
});

// ── §1 Then — committed-state direction assertions ─────────────────────────

Then('the continuation prompt directs the agent to inspect the committed git log against the base branch', function () {
  assert.ok(
    state.promptResult.includes('git log'),
    `Expected prompt to include 'git log'.\nPrompt:\n${state.promptResult}`,
  );
  assert.ok(
    state.promptResult.includes(`origin/${state.baseBranch}`),
    `Expected prompt to include 'origin/${state.baseBranch}'.\nPrompt:\n${state.promptResult}`,
  );
});

Then('the continuation prompt directs the agent to inspect the committed git diff against the base branch', function () {
  assert.ok(
    state.promptResult.includes('git diff'),
    `Expected prompt to include 'git diff'.\nPrompt:\n${state.promptResult}`,
  );
  assert.ok(
    state.promptResult.includes(`origin/${state.baseBranch}`),
    `Expected prompt to include 'origin/${state.baseBranch}'.\nPrompt:\n${state.promptResult}`,
  );
});

Then('the continuation prompt presents the committed git state as the authoritative record of completed work', function () {
  assert.ok(
    state.promptResult.includes('authoritative'),
    `Expected prompt to include 'authoritative' framing.\nPrompt:\n${state.promptResult}`,
  );
});

Then('the continuation prompt instructs the agent not to redo work that is already committed', function () {
  const lower = state.promptResult.toLowerCase();
  assert.ok(
    lower.includes('do not redo') || lower.includes('not redo') || lower.includes('do not re-do'),
    `Expected prompt to instruct agent not to redo work.\nPrompt:\n${state.promptResult}`,
  );
});

Then('the continuation prompt includes the original plan content', function () {
  assert.ok(
    state.promptResult.includes(state.planContent),
    `Expected prompt to include original plan content.\nPrompt:\n${state.promptResult}`,
  );
});

// ── §2 Then — first-pass (no checkpoint) assertions ───────────────────────

Then('the continuation prompt does not direct the agent to inspect committed git state', function () {
  assert.ok(
    !state.promptResult.includes('authoritative'),
    `Expected prompt NOT to include 'authoritative' framing.\nPrompt:\n${state.promptResult}`,
  );
  assert.ok(
    !state.promptResult.includes('git log'),
    `Expected prompt NOT to include 'git log'.\nPrompt:\n${state.promptResult}`,
  );
});

Then("the continuation prompt carries the previous agent's output as the continuation context", function () {
  assert.ok(
    state.promptResult.includes(state.previousOutput),
    `Expected prompt to include previous agent output.\nPrompt:\n${state.promptResult}`,
  );
});
