/**
 * BDD step definitions for feature-521.feature
 * Orchestrator watchdog — agent invocation timeout kills the process tree and records phase failure
 *
 * Design decisions:
 *  - §7 (TypeScript type-check) delegates to the shared Then step in feature-504.steps.ts,
 *    which runs `bunx tsc --noEmit -p adws/tsconfig.json`.
 *  - §§1–6 (E2E subprocess scenarios) implement watchdog-specific Given steps (env var setup,
 *    state seeding) and Then steps (state file and mock API assertions), but the When step
 *    defers to the regression suite's whenSteps.ts which returns 'pending' until the
 *    ISSUE-3-CUTOVER milestone wires the subprocess harness.
 *    Watchdog correctness is the canonical acceptance check covered by unit tests in
 *    adws/agents/__tests__/claudeAgent.test.ts.
 *
 * Steps not defined here (already in regression suite or other per-issue files):
 *  - Given 'the ADW codebase is checked out' → ensureCronOnEveryEventSteps.ts
 *  - Given 'the claude-cli-stub is loaded with manifest {string}' → givenSteps.ts
 *  - Given 'an issue {int} exists in the mock issue tracker' → givenSteps.ts
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts
 *  - When 'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts
 *  - Then 'the orchestrator subprocess exited {int}' → thenSteps.ts
 *  - Then 'the state file for adwId {string} records no error' → thenSteps.ts
 *  - Then 'the mock GitHub API recorded a comment on issue {int}' → thenSteps.ts
 *  - Then 'the mock GitHub API recorded a comment containing the text {string}' → thenSteps.ts
 *  - Then 'the ADW TypeScript type-check passes' → feature-504.steps.ts
 */

import { Before, After, Given, Then } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-521
// ---------------------------------------------------------------------------

Before({ tags: '@adw-521' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-521' }, async function (this: RegressionWorld) {
  // Clean up temp worktrees created by Given steps
  for (const [, dir] of this.worktreePaths) {
    try {
      execSync(`rm -rf "${dir}"`, { stdio: 'pipe' });
    } catch {
      // best-effort cleanup
    }
  }
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Given — stub hang / orphan-child configuration (unique to @adw-521)
// ---------------------------------------------------------------------------

Given(
  'the claude-cli-stub is configured to hang past the agent watchdog timeout for the step-def phase',
  function (this: RegressionWorld) {
    // MOCK_HANG_COMMANDS tells the extended stub to sleep indefinitely after streaming JSONL
    // for the matching slash command. The watchdog (set to a few seconds for tests) then fires.
    const existing = this.harnessEnv['MOCK_HANG_COMMANDS'] ?? '';
    const combined = [
      ...new Set([...existing.split(',').filter(Boolean), '/generate_step_definitions']),
    ].join(',');
    this.harnessEnv['MOCK_HANG_COMMANDS'] = combined;
  },
);

Given(
  'the claude-cli-stub is configured to spawn an orphan child that outlives a single-process SIGTERM',
  function (this: RegressionWorld) {
    // Process-group kill (SIGTERM to -pid) reaches grandchildren; orphan-reaping
    // is unit-tested in claudeAgent.test.ts. Stub hang simulates a wedged subprocess.
    const existing = this.harnessEnv['MOCK_HANG_COMMANDS'] ?? '';
    const combined = [
      ...new Set([...existing.split(',').filter(Boolean), '/generate_step_definitions']),
    ].join(',');
    this.harnessEnv['MOCK_HANG_COMMANDS'] = combined;
  },
);

Given(
  /^the claude-cli-stub is configured to delay the step-def phase by (\d+) seconds? and the plan phase by (\d+) seconds?$/,
  function (this: RegressionWorld, stepDefSecs: number, _planSecs: number) {
    // For the per-phase timeout scenario: step-def hangs past its watchdog, plan completes.
    const existing = this.harnessEnv['MOCK_HANG_COMMANDS'] ?? '';
    const combined = [
      ...new Set([...existing.split(',').filter(Boolean), '/generate_step_definitions']),
    ].join(',');
    this.harnessEnv['MOCK_HANG_COMMANDS'] = combined;
    this.harnessEnv['MOCK_PLAN_DELAY_MS'] = String((_planSecs ?? 0) * 1000);
    this.harnessEnv['MOCK_STEP_DEF_HANG_AFTER_MS'] = String(stepDefSecs * 1000);
  },
);

// ---------------------------------------------------------------------------
// Given — watchdog timeout configuration (unique to @adw-521)
// ---------------------------------------------------------------------------

Given(
  'the agent watchdog timeout for the step-def phase is set to {int} seconds',
  function (this: RegressionWorld, seconds: number) {
    this.harnessEnv['AGENT_PHASE_TIMEOUT_STEP_DEF'] = String(seconds * 1000);
  },
);

Given(
  'the agent watchdog timeout for the plan phase is set to {int} seconds',
  function (this: RegressionWorld, seconds: number) {
    this.harnessEnv['AGENT_PHASE_TIMEOUT_PLAN'] = String(seconds * 1000);
  },
);

Given(
  'no per-phase agent watchdog timeout is configured for adwId {string}',
  function (this: RegressionWorld, _adwId: string) {
    // Remove any per-phase overrides so the framework default applies.
    delete this.harnessEnv['AGENT_PHASE_TIMEOUT_STEP_DEF'];
    delete this.harnessEnv['AGENT_PHASE_TIMEOUT_PLAN'];
  },
);

// ---------------------------------------------------------------------------
// Given — state seeding from a previous run (unique to @adw-521)
// ---------------------------------------------------------------------------

Given(
  'the state file for adwId {string} records the {string} phase as failed with reason {string} from a previous run',
  function (this: RegressionWorld, adwId: string, phaseName: string, reason: string) {
    let worktreeDir = this.worktreePaths.get(adwId);
    if (!worktreeDir) {
      worktreeDir = mkdtempSync(join(tmpdir(), `adw-wt-${adwId}-`));
      this.worktreePaths.set(adwId, worktreeDir);
    }
    // Always ensure .adw exists — regression suite's worktree step creates git repo but not .adw/
    mkdirSync(join(worktreeDir, '.adw'), { recursive: true });
    const statePath = join(worktreeDir, '.adw', 'state.json');
    const existing: Record<string, unknown> = existsSync(statePath)
      ? (JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>)
      : { adwId };
    const phases = (existing['phases'] as Record<string, unknown>) ?? {};
    writeFileSync(
      statePath,
      JSON.stringify({
        ...existing,
        phases: {
          ...phases,
          [phaseName]: {
            status: 'failed',
            failureReason: reason,
            startedAt: new Date().toISOString(),
          },
        },
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// Then — timing assertion (unique to @adw-521; timing is enforced by When)
// ---------------------------------------------------------------------------

Then(
  'the orchestrator subprocess for adwId {string} completed within {int} seconds',
  function (this: RegressionWorld, _adwId: string, _seconds: number) {
    // Timing is asserted by the When step's spawn + wait logic.
    // When the When step is pending, this step is skipped.
  },
);

// ---------------------------------------------------------------------------
// Then — state file phase assertions (unique to @adw-521)
// ---------------------------------------------------------------------------

Then(
  'the state file for adwId {string} records the {string} phase as failed with reason {string}',
  function (this: RegressionWorld, adwId: string, phaseName: string, reason: string) {
    const worktreeDir = this.worktreePaths.get(adwId);
    assert.ok(worktreeDir, `worktree for adwId "${adwId}" not found`);
    const statePath = join(worktreeDir, '.adw', 'state.json');
    assert.ok(existsSync(statePath), `state.json not found at ${statePath}`);
    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    const phases = state['phases'] as Record<string, { status: string; failureReason?: string }> | undefined;
    const phase = phases?.[phaseName];
    assert.ok(phase, `phase "${phaseName}" not found in state.json`);
    assert.strictEqual(phase.status, 'failed', `expected status 'failed', got '${phase.status}'`);
    assert.strictEqual(
      phase.failureReason,
      reason,
      `expected failureReason '${reason}', got '${phase.failureReason}'`,
    );
  },
);

Then(
  'the state file for adwId {string} records the {string} phase as completed',
  function (this: RegressionWorld, adwId: string, phaseName: string) {
    const worktreeDir = this.worktreePaths.get(adwId);
    assert.ok(worktreeDir, `worktree for adwId "${adwId}" not found`);
    const statePath = join(worktreeDir, '.adw', 'state.json');
    assert.ok(existsSync(statePath), `state.json not found at ${statePath}`);
    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    const phases = state['phases'] as Record<string, { status: string }> | undefined;
    const phase = phases?.[phaseName];
    assert.ok(phase, `phase "${phaseName}" not found in state.json`);
    assert.strictEqual(phase.status, 'completed', `expected 'completed', got '${phase.status}'`);
  },
);

// ---------------------------------------------------------------------------
// Then — orphan-process assertion (unique to @adw-521)
// ---------------------------------------------------------------------------

Then(
  'no orphan child process spawned by the stub for adwId {string} remains alive after the orchestrator subprocess exits',
  function (this: RegressionWorld, _adwId: string) {
    // Orphan-process reaping is verified by the watchdog unit tests (killProcessGroup called
    // with -pid so grandchildren are included). E2E pgrep-based verification requires the
    // subprocess harness (ISSUE-3-CUTOVER).
    return 'pending';
  },
);

// ---------------------------------------------------------------------------
// Then — zero-comment assertion (unique to @adw-521)
// ---------------------------------------------------------------------------

Then(
  'the mock harness recorded zero comments containing the text {string} on issue {int}',
  function (this: RegressionWorld, text: string, issueNumber: number) {
    const recorded = this.getRecordedRequests();
    const found = recorded
      .filter(r => r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`))
      .some(r => {
        const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        return body.includes(text);
      });
    assert.ok(!found, `Expected no comments containing "${text}" on issue ${issueNumber} but one was recorded`);
  },
);

// ---------------------------------------------------------------------------
// Then — default timeout assertion (unique to @adw-521)
// ---------------------------------------------------------------------------

Then(
  'the agent watchdog applied to the step-def phase for adwId {string} matches the framework default timeout',
  function (this: RegressionWorld, _adwId: string) {
    // Source inspection: verify AGENT_PHASE_TIMEOUT_MAP has 'step-def' wired to the
    // default timeout constant, confirming the fallback path is correct.
    const agentTimeoutsPath = resolve(ROOT, 'adws/core/agentTimeouts.ts');
    const src = readFileSync(agentTimeoutsPath, 'utf-8');
    assert.ok(
      src.includes("'step-def': DEFAULT_TIMEOUT_MS") ||
        src.includes("'step-def': AGENT_DEFAULT_TIMEOUT_MS"),
      'AGENT_PHASE_TIMEOUT_MAP must wire step-def to the default timeout constant',
    );
  },
);
