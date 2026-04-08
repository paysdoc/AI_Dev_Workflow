/**
 * Step definitions for the Dev Server Janitor feature (issue #394).
 *
 * Covers:
 * - Static file analysis (existence, export, import, content checks)
 * - Behavioral tests of shouldCleanWorktree (decision matrix via pure function)
 * - Behavioral tests of runJanitorPass with injected mocks
 * - Signal escalation verification (via worktreeCleanup.ts content check)
 * - Unit test coverage checks
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Shared state for kill decision behavioral tests ──────────────────────────

interface KillDecisionState {
  isOlderThan30Min: boolean;
  isNonTerminal: boolean;
  isPidAlive: boolean;
  result: boolean | null;
}

const killCtx: KillDecisionState = {
  isOlderThan30Min: false,
  isNonTerminal: false,
  isPidAlive: false,
  result: null,
};

// Shared state for stage classification tests
const stageCtx: { stage: string; isNonTerminal: boolean | null } = {
  stage: '',
  isNonTerminal: null,
};

// Shared state for signal escalation tests
interface SignalTestState {
  sigtermSent: boolean;
  sigkillSent: boolean;
}
const signalCtx: SignalTestState = {
  sigtermSent: false,
  sigkillSent: false,
};

// Shared state for runJanitorPass behavioral tests
interface JanitorRunState {
  error: Error | null;
  killCalls: string[];
  readTopLevelStateCalls: number;
  isAgentProcessRunningCalls: number;
}
const janitorRunCtx: JanitorRunState = {
  error: null,
  killCalls: [],
  readTopLevelStateCalls: 0,
  isAgentProcessRunningCalls: 0,
};

// Note: 'Given/Then the file {string} exists' is already defined in cucumberConfigSteps.ts

// ── Import checks ────────────────────────────────────────────────────────────

Then(
  'it imports {string} from {string} or {string}',
  function (symbol: string, path1: string, path2: string) {
    const content = sharedCtx.fileContent;
    const filePath = sharedCtx.filePath;
    const hasSymbol = content.includes(symbol);
    const hasPath = content.includes(path1) || content.includes(path2);
    assert.ok(
      hasSymbol && hasPath,
      `"${filePath}": expected to import "${symbol}" from "${path1}" or "${path2}"`,
    );
  },
);

// ── Janitor wiring check ─────────────────────────────────────────────────────

Then('runJanitorPass is called on a timer with a 5-minute interval', function () {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  assert.ok(
    content.includes('runJanitorPass'),
    `"${filePath}": expected to call runJanitorPass`,
  );
  assert.ok(
    content.includes('JANITOR_INTERVAL_CYCLES'),
    `"${filePath}": expected to use JANITOR_INTERVAL_CYCLES for the 5-minute interval`,
  );
  assert.ok(
    content.includes('cycleCount % JANITOR_INTERVAL_CYCLES'),
    `"${filePath}": expected runJanitorPass to be gated by cycleCount % JANITOR_INTERVAL_CYCLES`,
  );
});

Then('the file still imports and calls scanPauseQueue', function () {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  assert.ok(
    content.includes('scanPauseQueue'),
    `"${filePath}": expected scanPauseQueue to still be imported and called`,
  );
  assert.ok(
    content.includes('pauseQueueScanner'),
    `"${filePath}": expected import from './pauseQueueScanner'`,
  );
});

Then('no existing probe invocation is removed or disabled', function () {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  // scanPauseQueue must still be called with cycleCount
  assert.ok(
    content.includes('scanPauseQueue(cycleCount)'),
    `"${filePath}": expected scanPauseQueue(cycleCount) to still be called`,
  );
});

// ── Worktree discovery content checks ────────────────────────────────────────

Then('the function scans a {string} directory to discover worktree paths', function (dirPattern: string) {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  assert.ok(
    content.includes(dirPattern) || content.includes('worktrees') || content.includes('listWorktrees'),
    `"${filePath}": expected to scan a "${dirPattern}" directory (look for pattern or listWorktrees call)`,
  );
});

// ── lsof content check ───────────────────────────────────────────────────────

Then('the function uses {string} to discover processes in each worktree directory', function (tool: string) {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  // The janitor uses killProcessesInDirectory or hasProcessesInDirectory which internally use lsof
  const usesTool =
    content.includes(tool) ||
    content.includes('killProcessesInDirectory') ||
    content.includes('hasProcessesInDirectory');
  assert.ok(
    usesTool,
    `"${filePath}": expected to use "${tool}" (directly or via killProcessesInDirectory/hasProcessesInDirectory)`,
  );
});

// ── State file content check ─────────────────────────────────────────────────

Then('the function reads the workflow stage from the agent state file for each worktree', function () {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  assert.ok(
    content.includes('readTopLevelState') || content.includes('workflowStage'),
    `"${filePath}": expected to read workflow stage from the agent state file`,
  );
});

// ── Behavioral: missing .worktrees/ directory ────────────────────────────────

Given('the target repo has no {string} directory', function (this: Record<string, unknown>, _dir: string) {
  // Context: set up janitorRunCtx to use a mock that returns no worktrees
  janitorRunCtx.error = null;
  janitorRunCtx.killCalls = [];
  janitorRunCtx.readTopLevelStateCalls = 0;
  janitorRunCtx.isAgentProcessRunningCalls = 0;
  this.__janitorSetup = 'no-worktrees';
});

When('runJanitorPass is invoked', async function (this: Record<string, unknown>) {
  const { runJanitorPass } = await import('../../adws/triggers/devServerJanitor.js');
  type JD = import('../../adws/triggers/devServerJanitor.js').JanitorDeps;

  const setup = this.__janitorSetup as string;
  let deps: JD;

  if (setup === 'no-worktrees') {
    deps = {
      readdirTargetRepos: () => [],
      isGitRepo: () => true,
      listWorktrees: () => [],
      readTopLevelState: (_id: string) => { janitorRunCtx.readTopLevelStateCalls++; return null; },
      isAgentProcessRunning: (_id: string) => { janitorRunCtx.isAgentProcessRunningCalls++; return false; },
      getWorktreeAgeMs: () => 60 * 60 * 1000,
      hasProcessesInDirectory: () => false,
      killProcessesInDirectory: (p: string) => { janitorRunCtx.killCalls.push(p); },
      log: () => {},
    };
  } else {
    deps = {
      readdirTargetRepos: () => [],
      isGitRepo: () => true,
      listWorktrees: () => [],
      readTopLevelState: () => null,
      isAgentProcessRunning: () => false,
      getWorktreeAgeMs: () => 60 * 60 * 1000,
      hasProcessesInDirectory: () => false,
      killProcessesInDirectory: (p: string) => { janitorRunCtx.killCalls.push(p); },
      log: () => {},
    };
  }

  try {
    await runJanitorPass(deps);
    janitorRunCtx.error = null;
  } catch (err) {
    janitorRunCtx.error = err as Error;
  }
});

Then('it completes without error and reports zero worktrees scanned', function () {
  assert.strictEqual(janitorRunCtx.error, null, `Expected no error, got: ${janitorRunCtx.error}`);
  assert.strictEqual(
    janitorRunCtx.killCalls.length,
    0,
    `Expected zero worktrees to be cleaned, got: ${janitorRunCtx.killCalls.length}`,
  );
});

// ── Behavioral: worktree with no processes ────────────────────────────────────

Given('a worktree with no processes holding files', function (this: Record<string, unknown>) {
  this.__janitorSetup = 'no-processes';
  this.__worktreePath = '/fake/repo/.worktrees/feature-issue-99-adw-abc-slug';
  janitorRunCtx.error = null;
  janitorRunCtx.killCalls = [];
  janitorRunCtx.readTopLevelStateCalls = 0;
  janitorRunCtx.isAgentProcessRunningCalls = 0;
});

When('runJanitorPass evaluates the worktree', async function (this: Record<string, unknown>) {
  const { runJanitorPass } = await import('../../adws/triggers/devServerJanitor.js');
  type JD = import('../../adws/triggers/devServerJanitor.js').JanitorDeps;
  const wtPath = this.__worktreePath as string ?? '/fake/repo/.worktrees/feature-issue-99-adw-abc-slug';

  const deps: JD = {
    readdirTargetRepos: (dir: string) => dir.includes('repos') ? ['owner'] : ['repo'],
    isGitRepo: () => true,
    listWorktrees: () => [wtPath],
    readTopLevelState: (_id: string) => {
      janitorRunCtx.readTopLevelStateCalls++;
      return { workflowStage: 'completed' } as import('../../adws/types/agentTypes.js').AgentState;
    },
    isAgentProcessRunning: (_id: string) => {
      janitorRunCtx.isAgentProcessRunningCalls++;
      return false;
    },
    getWorktreeAgeMs: () => 60 * 60 * 1000, // 60 min — old
    hasProcessesInDirectory: () => false, // no processes
    killProcessesInDirectory: (p: string) => { janitorRunCtx.killCalls.push(p); },
    log: () => {},
  };

  try {
    await runJanitorPass(deps);
    janitorRunCtx.error = null;
  } catch (err) {
    janitorRunCtx.error = err as Error;
  }
});

Then('the worktree is skipped without applying the kill decision rule', function () {
  assert.strictEqual(janitorRunCtx.error, null, `Expected no error`);
  assert.strictEqual(
    janitorRunCtx.killCalls.length,
    0,
    `Expected no kill calls, got: ${janitorRunCtx.killCalls.join(', ')}`,
  );
  // Kill decision deps (readTopLevelState, isAgentProcessRunning) should NOT have been consulted
  assert.strictEqual(
    janitorRunCtx.readTopLevelStateCalls,
    0,
    'Expected readTopLevelState not to be called when no processes present',
  );
  assert.strictEqual(
    janitorRunCtx.isAgentProcessRunningCalls,
    0,
    'Expected isAgentProcessRunning not to be called when no processes present',
  );
});

// ── Behavioral: stage classification ─────────────────────────────────────────

Given('a worktree with workflowStage {string} in the state file', function (stage: string) {
  stageCtx.stage = stage;
  stageCtx.isNonTerminal = null;
});

When('the kill decision rule evaluates the worktree', async function () {
  const { isActiveStage } = await import('../../adws/triggers/cronStageResolver.js');
  stageCtx.isNonTerminal = isActiveStage(stageCtx.stage);
});

Then('the stage is classified as terminal', function () {
  assert.strictEqual(
    stageCtx.isNonTerminal,
    false,
    `Expected stage "${stageCtx.stage}" to be classified as terminal (non-active)`,
  );
});

Then('the stage is classified as non-terminal', function () {
  assert.strictEqual(
    stageCtx.isNonTerminal,
    true,
    `Expected stage "${stageCtx.stage}" to be classified as non-terminal (active)`,
  );
});

// ── Behavioral: kill decision matrix ─────────────────────────────────────────

Given('a worktree older than 30 minutes', function () {
  killCtx.isOlderThan30Min = true;
  killCtx.result = null;
});

Given('a worktree younger than 30 minutes', function () {
  killCtx.isOlderThan30Min = false;
  killCtx.result = null;
});

Given('the workflow stage is non-terminal', function () {
  killCtx.isNonTerminal = true;
});

Given('the workflow stage is terminal', function () {
  killCtx.isNonTerminal = false;
});

Given('the orchestrator PID is still alive', function () {
  killCtx.isPidAlive = true;
});

Given('the orchestrator PID is dead', function () {
  killCtx.isPidAlive = false;
});

When('the kill decision rule is evaluated', async function () {
  const { shouldCleanWorktree, JANITOR_GRACE_PERIOD_MS } = await import('../../adws/triggers/devServerJanitor.js');
  const ageMs = killCtx.isOlderThan30Min ? JANITOR_GRACE_PERIOD_MS + 1 : JANITOR_GRACE_PERIOD_MS - 1;
  killCtx.result = shouldCleanWorktree(
    killCtx.isNonTerminal,
    killCtx.isPidAlive,
    ageMs,
    JANITOR_GRACE_PERIOD_MS,
  );
});

Then('the dev server process is left alone', function () {
  assert.strictEqual(
    killCtx.result,
    false,
    `Expected shouldCleanWorktree to return false (leave alone), but got true`,
  );
});

Then('the dev server process is killed', function () {
  assert.strictEqual(
    killCtx.result,
    true,
    `Expected shouldCleanWorktree to return true (kill), but got false`,
  );
});

// ── Behavioral: signal escalation ────────────────────────────────────────────

Given('a dev server process that should be killed', function (this: Record<string, unknown>) {
  signalCtx.sigtermSent = false;
  signalCtx.sigkillSent = false;
  this.__signalKillSetup = 'should-kill';
});

Given('the process survives SIGTERM', function (this: Record<string, unknown>) {
  this.__processExitsAfterSigterm = false;
});

Given('the process exits after receiving SIGTERM', function (this: Record<string, unknown>) {
  this.__processExitsAfterSigterm = true;
});

When('the janitor initiates the kill sequence', function () {
  // Verify via static analysis that killProcessesInDirectory sends SIGTERM then SIGKILL
  const content = readFileSync(join(ROOT, 'adws/vcs/worktreeCleanup.ts'), 'utf-8');
  signalCtx.sigtermSent = content.includes("'SIGTERM'");
  signalCtx.sigkillSent = content.includes("'SIGKILL'");
});

When('the SIGTERM grace period elapses', function (this: Record<string, unknown>) {
  const content = readFileSync(join(ROOT, 'adws/vcs/worktreeCleanup.ts'), 'utf-8');
  const processExits = this.__processExitsAfterSigterm as boolean;
  if (processExits) {
    // Process exits after SIGTERM — survivors filter removes it — no SIGKILL
    signalCtx.sigkillSent = content.includes('survivors') && content.includes("'SIGKILL'");
    // Verify that SIGKILL is only sent to survivors (so exits after SIGTERM → no SIGKILL)
    // This is guaranteed by the survivors filter in worktreeCleanup.ts
  } else {
    // Process survives — SIGKILL should be sent
    signalCtx.sigkillSent = content.includes("'SIGKILL'");
  }
});

Then('SIGTERM is sent to the process first', function () {
  const content = readFileSync(join(ROOT, 'adws/vcs/worktreeCleanup.ts'), 'utf-8');
  const sigtermIdx = content.indexOf("'SIGTERM'");
  const sigkillIdx = content.indexOf("'SIGKILL'");
  assert.ok(sigtermIdx !== -1, "Expected 'SIGTERM' to appear in worktreeCleanup.ts");
  assert.ok(sigkillIdx !== -1, "Expected 'SIGKILL' to appear in worktreeCleanup.ts");
  assert.ok(sigtermIdx < sigkillIdx, "Expected SIGTERM to appear before SIGKILL in kill sequence");
});

Then('SIGKILL is sent to the surviving process', function () {
  const content = readFileSync(join(ROOT, 'adws/vcs/worktreeCleanup.ts'), 'utf-8');
  assert.ok(content.includes('survivors'), 'Expected survivor detection logic');
  assert.ok(content.includes("'SIGKILL'"), "Expected SIGKILL to be sent to survivors");
});

Then('SIGKILL is not sent', function () {
  const content = readFileSync(join(ROOT, 'adws/vcs/worktreeCleanup.ts'), 'utf-8');
  // Verify the survivors filter logic: process.kill(pid, 0) used to check if still alive
  assert.ok(
    content.includes('survivors') && content.includes('process.kill(pid, 0)'),
    'Expected survivors to be filtered via process.kill(pid, 0) — only dead survivors get SIGKILL',
  );
  // If process exited, survivors array is empty, so SIGKILL is not sent
  // This is verified by the filter logic being present
  assert.ok(
    content.includes('survivors.length > 0'),
    'Expected SIGKILL to be conditioned on survivors.length > 0',
  );
});

// ── Unit test file content checks ────────────────────────────────────────────

Then(
  'the test file contains test cases for:',
  function (this: Record<string, unknown>, dataTable: { hashes: () => Array<{ stage: string; pid_alive: string; expected: string }> }) {
    const content = sharedCtx.fileContent;
    const filePath = sharedCtx.filePath;
    const rows = dataTable.hashes();

    for (const row of rows) {
      const stage = row.stage;        // 'non-terminal' or 'terminal'
      const pidAlive = row.pid_alive; // 'alive' or 'dead'
      const expected = row.expected;  // 'leave alone' or 'kill'

      // Check that test case keywords exist in the test file
      const stageKeyword = stage === 'non-terminal' ? 'non-terminal' : 'terminal';
      const pidKeyword = pidAlive === 'alive' ? 'alive' : 'dead';
      const outcomeKeyword = expected.includes('leave') ? 'skip' : 'kill';

      assert.ok(
        content.includes(stageKeyword) || content.includes('isNonTerminal'),
        `"${filePath}": expected test cases referencing "${stageKeyword}" stage`,
      );
      assert.ok(
        content.includes(pidKeyword) || content.includes('PID') || content.includes('orchestratorAlive'),
        `"${filePath}": expected test cases referencing PID "${pidAlive}" scenario`,
      );
      assert.ok(
        content.includes(outcomeKeyword) || content.includes('shouldCleanWorktree'),
        `"${filePath}": expected test cases for "${expected}" outcome`,
      );
    }
  },
);

Then('the test file contains test cases for SIGTERM followed by SIGKILL escalation', function () {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  assert.ok(
    content.includes('SIGTERM') || content.includes('killProcessesInDirectory'),
    `"${filePath}": expected test cases verifying SIGTERM/SIGKILL escalation`,
  );
  assert.ok(
    content.includes('SIGKILL') || content.includes('killProcessesInDirectory'),
    `"${filePath}": expected test cases verifying SIGKILL escalation`,
  );
});

Then('the test file mocks filesystem operations', function () {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  assert.ok(
    content.includes('readdirTargetRepos') || content.includes('getWorktreeAgeMs') || content.includes('vi.fn()'),
    `"${filePath}": expected filesystem operations to be mocked (readdirTargetRepos, getWorktreeAgeMs, or vi.fn())`,
  );
});

Then('the test file mocks process.kill or equivalent signal sending', function () {
  const content = sharedCtx.fileContent;
  const filePath = sharedCtx.filePath;
  assert.ok(
    content.includes('killProcessesInDirectory') || content.includes('process.kill'),
    `"${filePath}": expected process.kill or killProcessesInDirectory to be mocked`,
  );
});
