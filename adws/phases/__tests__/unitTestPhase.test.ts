import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { getDefaultProjectConfig } from '../../core/projectConfig';
import type { ProcessOutcome, ProcessRunner, StaticCheckCommands } from '../../core/checkRunner';
import type { TestRetryResult } from '../../agents/testRetry';
import { executeUnitTestPhase, type UnitTestPhaseDeps } from '../unitTestPhase';
import type { WorkflowConfig } from '../workflowInit';

class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

const CHECK_COMMANDS: StaticCheckCommands = {
  typeCheck: 'tc',
  additionalTypeChecks: 'atc',
  runLinter: 'lint',
  runBuild: 'build',
};

const ALL_CHECKS_RAN = ['check:tc', 'check:atc', 'check:lint', 'check:build'];

const PASSING_TEST_RUN: TestRetryResult = {
  passed: true,
  reportPresent: true,
  hasFailures: false,
  testcaseCount: 2,
  costUsd: 0,
  totalRetries: 0,
  failedTests: [],
  modelUsage: {},
  contextResetCount: 0,
};

const tempDirs: string[] = [];
let savedReportPath: string | undefined;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(unitTests: boolean, commands: StaticCheckCommands = CHECK_COMMANDS): WorkflowConfig {
  const projectConfig = getDefaultProjectConfig();
  return {
    issueNumber: 42,
    adwId: 'unit-test-phase',
    issue: { number: 42, title: 'Unit-test phase', body: 'issue body' },
    worktreePath: '/worktrees/unit-test-phase',
    logsDir: tempDir('adw-unit-test-phase-logs-'),
    orchestratorStatePath: tempDir('adw-unit-test-phase-state-'),
    ctx: { issueNumber: 42, adwId: 'unit-test-phase' },
    repoContext: undefined,
    projectConfig: { ...projectConfig, commands: { ...projectConfig.commands, ...commands } },
    adwYmlConfig: { hitl: false, unitTests },
  } as unknown as WorkflowConfig;
}

function recordingProcessRunner(events: string[], outcomes: Readonly<Record<string, ProcessOutcome>> = {}): ProcessRunner {
  return async (command) => {
    events.push(`check:${command}`);
    return outcomes[command] ?? { exitCode: 0, output: '' };
  };
}

function recordingTestRun(events: string[], result: Partial<TestRetryResult> = {}): UnitTestPhaseDeps['runUnitTestsWithRetry'] {
  return async () => {
    events.push('tests');
    return { ...PASSING_TEST_RUN, ...result };
  };
}

function executionLog(config: WorkflowConfig): string {
  return fs.readFileSync(path.join(config.orchestratorStatePath, 'execution.log'), 'utf-8');
}

beforeEach(() => {
  savedReportPath = process.env.ADW_UNIT_TEST_REPORT_PATH;
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitSignal(code);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedReportPath === undefined) delete process.env.ADW_UNIT_TEST_REPORT_PATH;
  else process.env.ADW_UNIT_TEST_REPORT_PATH = savedReportPath;
  tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

describe('executeUnitTestPhase — static checks and the unit-test switch', () => {
  it('runs every static check and skips the test run when unitTests is false', async () => {
    const events: string[] = [];

    const result = await executeUnitTestPhase(makeConfig(false), {
      runProcess: recordingProcessRunner(events),
      runUnitTestsWithRetry: recordingTestRun(events),
    });

    expect(events).toEqual(ALL_CHECKS_RAN);
    expect(result.unitTestsPassed).toBe(true);
  });

  it('runs the static checks before the test run when unitTests is true', async () => {
    const events: string[] = [];

    const result = await executeUnitTestPhase(makeConfig(true), {
      runProcess: recordingProcessRunner(events),
      runUnitTestsWithRetry: recordingTestRun(events),
    });

    expect(events).toEqual([...ALL_CHECKS_RAN, 'tests']);
    expect(result.unitTestsPassed).toBe(true);
  });

  it('runs the checks in the worktree', async () => {
    const config = makeConfig(false);
    const directories: string[] = [];
    const runProcess: ProcessRunner = async (_command, cwd) => {
      directories.push(cwd);
      return { exitCode: 0, output: '' };
    };

    await executeUnitTestPhase(config, { runProcess, runUnitTestsWithRetry: recordingTestRun([]) });

    expect(directories).toEqual(Array(4).fill(config.worktreePath));
  });

  it('runs nothing when every static check is N/A and unitTests is false', async () => {
    const events: string[] = [];
    const notApplicable: StaticCheckCommands = { typeCheck: 'N/A', additionalTypeChecks: 'N/A', runLinter: 'N/A', runBuild: 'N/A' };

    const result = await executeUnitTestPhase(makeConfig(false, notApplicable), {
      runProcess: recordingProcessRunner(events),
      runUnitTestsWithRetry: recordingTestRun(events),
    });

    expect(events).toEqual([]);
    expect(result.unitTestsPassed).toBe(true);
  });
});

describe.each([true, false])('executeUnitTestPhase — a red static check, with unitTests %s', (unitTests) => {
  const redLint = { lint: { exitCode: 1, output: 'lint error in src/a.ts' } };

  it('ends the run with exit code 1 before the test run starts', async () => {
    const events: string[] = [];

    await expect(
      executeUnitTestPhase(makeConfig(unitTests), {
        runProcess: recordingProcessRunner(events, redLint),
        runUnitTestsWithRetry: recordingTestRun(events),
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(events).not.toContain('tests');
  });

  it('still runs every check, and puts the failing check’s output in the execution log', async () => {
    const config = makeConfig(unitTests);
    const events: string[] = [];

    await expect(
      executeUnitTestPhase(config, { runProcess: recordingProcessRunner(events, redLint), runUnitTestsWithRetry: recordingTestRun(events) }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(events).toEqual(ALL_CHECKS_RAN);
    expect(executionLog(config)).toContain('lint error in src/a.ts');
  });

  it('names the failed check and its exit code in the error, but not its output', async () => {
    const config = makeConfig(unitTests);

    await expect(
      executeUnitTestPhase(config, { runProcess: recordingProcessRunner([], redLint), runUnitTestsWithRetry: recordingTestRun([]) }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(config.ctx.errorMessage).toContain('lint (exit 1)');
    expect(config.ctx.errorMessage).not.toContain('lint error in src/a.ts');
  });

  it('records a failed execution state', async () => {
    const config = makeConfig(unitTests);

    await expect(
      executeUnitTestPhase(config, { runProcess: recordingProcessRunner([], redLint), runUnitTestsWithRetry: recordingTestRun([]) }),
    ).rejects.toBeInstanceOf(ExitSignal);

    const state = AgentStateManager.readState(config.orchestratorStatePath);
    expect(state?.execution?.status).toBe('failed');
    expect(state?.execution?.errorMessage).toContain('lint (exit 1)');
  });
});

describe('executeUnitTestPhase — several red static checks', () => {
  it('names every failed check with its exit code, and logs every failing output', async () => {
    const config = makeConfig(false);
    const outcomes = {
      lint: { exitCode: 1, output: 'lint output' },
      build: { exitCode: 2, output: 'build output' },
    };

    await expect(
      executeUnitTestPhase(config, { runProcess: recordingProcessRunner([], outcomes), runUnitTestsWithRetry: recordingTestRun([]) }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(config.ctx.errorMessage).toBe('Static checks failed: lint (exit 1), build (exit 2). No PR was created.');
    expect(executionLog(config)).toContain('lint output');
    expect(executionLog(config)).toContain('build output');
  });

  it('reports a check that was killed, and so has no exit code, as failed', async () => {
    const config = makeConfig(false);
    const outcomes = { atc: { exitCode: null, output: 'Terminated' } };

    await expect(
      executeUnitTestPhase(config, { runProcess: recordingProcessRunner([], outcomes), runUnitTestsWithRetry: recordingTestRun([]) }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(config.ctx.errorMessage).toContain('additional type checks (exit none)');
  });
});

describe('executeUnitTestPhase — a hard-failed unit-test run', () => {
  it('still ends the run with exit code 1 and the unit-test error', async () => {
    const config = makeConfig(true);

    await expect(
      executeUnitTestPhase(config, {
        runProcess: recordingProcessRunner([]),
        runUnitTestsWithRetry: recordingTestRun([], { reportPresent: true, hasFailures: true, passed: false }),
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(config.ctx.errorMessage).toMatch(/^Unit tests hard-failed/);
    expect(AgentStateManager.readState(config.orchestratorStatePath)?.execution?.status).toBe('failed');
  });
});
