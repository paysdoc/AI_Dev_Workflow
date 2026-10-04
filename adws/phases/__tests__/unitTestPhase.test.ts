import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import { getDefaultProjectConfig, type CommandsConfig } from '../../core/projectConfig';
import type { CheckVerdict, ProcessOutcome, ProcessRunner, StaticCheckCommands } from '../../core/checkRunner';
import type { FixRoundPort } from '../../core/staticCheckFixLoop';
import type { ModelUsageMap } from '../../cost';
import type { TestRetryResult } from '../../agents/testRetry';
import { decideRetryAction } from '../../triggers/retryHandler';
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

const GREEN: ProcessOutcome = { exitCode: 0, output: '' };
const RED_LINT: ProcessOutcome = { exitCode: 1, output: 'lint error in src/a.ts' };
const RED_BUILD: ProcessOutcome = { exitCode: 2, output: 'build error in src/b.ts' };

const CLEAN_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-let total = 0;', '+const total = 0;'].join('\n');
const SUPPRESSING_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', ' let total = 0;', '+// @ts-ignore'].join('\n');
const ACME_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', ' let total = 0;', '+// @acme-off'].join('\n');

const tempDirs: string[] = [];
const adwIds: string[] = [];
let savedReportPath: string | undefined;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

interface Workflow {
  readonly config: WorkflowConfig;
  /** The bodies of the comments posted on the issue, oldest first. */
  readonly comments: () => string[];
}

function makeWorkflow(unitTests: boolean, commands: Partial<CommandsConfig> = CHECK_COMMANDS): Workflow {
  const projectConfig = getDefaultProjectConfig();
  const adwId = `unit-test-phase-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  adwIds.push(adwId);
  const commentOnIssue = vi.fn();
  const config = {
    issueNumber: 42,
    adwId,
    issue: { number: 42, title: 'Unit-test phase', body: 'issue body' },
    worktreePath: '/worktrees/unit-test-phase',
    logsDir: tempDir('adw-unit-test-phase-logs-'),
    orchestratorStatePath: tempDir('adw-unit-test-phase-state-'),
    ctx: { issueNumber: 42, adwId },
    repoContext: { issueTracker: { moveToStatus: vi.fn(async () => undefined), commentOnIssue, applyLabel: vi.fn() } },
    projectConfig: { ...projectConfig, commands: { ...projectConfig.commands, ...commands } },
    adwYmlConfig: { hitl: false, unitTests },
  } as unknown as WorkflowConfig;
  return { config, comments: () => commentOnIssue.mock.calls.map(([, body]) => String(body)) };
}

function makeConfig(unitTests: boolean, commands: Partial<CommandsConfig> = CHECK_COMMANDS): WorkflowConfig {
  return makeWorkflow(unitTests, commands).config;
}

/** A command's outcomes in the order it is run; the last one repeats once the queue is spent. */
type Outcomes = Readonly<Record<string, readonly ProcessOutcome[]>>;

function scriptedProcessRunner(events: string[], outcomes: Outcomes = {}): ProcessRunner {
  const timesRun: Record<string, number> = {};
  return async (command) => {
    events.push(`check:${command}`);
    const queue = outcomes[command] ?? [GREEN];
    const run = timesRun[command] ?? 0;
    timesRun[command] = run + 1;
    return queue[Math.min(run, queue.length - 1)];
  };
}

function recordingProcessRunner(events: string[], outcomes: Readonly<Record<string, ProcessOutcome>> = {}): ProcessRunner {
  return scriptedProcessRunner(events, Object.fromEntries(Object.entries(outcomes).map(([command, outcome]) => [command, [outcome]])));
}

function recordingTestRun(events: string[], result: Partial<TestRetryResult> = {}): UnitTestPhaseDeps['runUnitTestsWithRetry'] {
  return async () => {
    events.push('tests');
    return { ...PASSING_TEST_RUN, ...result };
  };
}

interface ScriptedFixRound {
  readonly diff?: string;
  readonly costUsd?: number;
  readonly modelUsage?: ModelUsageMap;
  readonly error?: Error;
}

/** The n-th `fix` call, across every run of the phase that uses the port, gets the n-th scripted round. */
function scriptedFixRounds(events: string[], ...rounds: ScriptedFixRound[]) {
  const fixed: { readonly failed: readonly CheckVerdict[]; readonly round: number }[] = [];
  const kept: number[] = [];
  const discarded: number[] = [];
  const port: FixRoundPort = {
    async fix(failed, round) {
      const scripted = rounds[fixed.length] ?? {};
      fixed.push({ failed, round });
      events.push(`fix:${fixed.length}`);
      if (scripted.error) throw scripted.error;
      return { diff: scripted.diff ?? CLEAN_DIFF, costUsd: scripted.costUsd ?? 0, modelUsage: scripted.modelUsage ?? {} };
    },
    keep: (round) => {
      events.push(`keep:${round}`);
      kept.push(round);
    },
    discard: (round) => {
      events.push(`discard:${round}`);
      discarded.push(round);
    },
  };
  return { port, fixed, kept, discarded };
}

function executionLog(config: WorkflowConfig): string {
  return fs.readFileSync(path.join(config.orchestratorStatePath, 'execution.log'), 'utf-8');
}

function parkComments(workflow: Workflow): string[] {
  return workflow.comments().filter(body => body.includes('ADW Parked'));
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
  adwIds.splice(0).forEach(adwId => fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true }));
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

  it('starts no fix round and needs no git context when every check is green on the first run', async () => {
    const events: string[] = [];
    const rounds = scriptedFixRounds(events);

    const result = await executeUnitTestPhase(makeConfig(true), {
      runProcess: recordingProcessRunner(events),
      runUnitTestsWithRetry: recordingTestRun(events),
      fixRounds: rounds.port,
    });

    expect(rounds.fixed).toEqual([]);
    expect(result.costUsd).toBe(0);
  });

  it('logs the output of a check that passed, as it logged it before', async () => {
    const config = makeConfig(false);

    await executeUnitTestPhase(config, { runProcess: recordingProcessRunner([]), runUnitTestsWithRetry: recordingTestRun([]) });

    expect(executionLog(config)).toContain('Static check passed: lint — lint');
  });
});

describe.each([true, false])('executeUnitTestPhase — a red static check the fix loop fixes, with unitTests %s', (unitTests) => {
  it('hands the failing check to the fix loop, runs the checks again, and completes', async () => {
    const events: string[] = [];
    const rounds = scriptedFixRounds(events, {});
    const config = makeConfig(unitTests);

    const result = await executeUnitTestPhase(config, {
      runProcess: scriptedProcessRunner(events, { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun(events),
      fixRounds: rounds.port,
    });

    expect(result.unitTestsPassed).toBe(true);
    expect(rounds.fixed).toHaveLength(1);
    expect(rounds.fixed[0].failed.map(verdict => [verdict.check, verdict.command, verdict.exitCode])).toEqual([['lint', 'lint', 1]]);
    expect(rounds.kept).toEqual([1]);
    expect(config.ctx.errorMessage).toBeUndefined();
  });

  it('runs the whole set of checks once, then the round, then the whole set again, and only then the test run', async () => {
    const events: string[] = [];
    const rounds = scriptedFixRounds(events, {});

    await executeUnitTestPhase(makeConfig(unitTests), {
      runProcess: scriptedProcessRunner(events, { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun(events),
      fixRounds: rounds.port,
    });

    expect(events).toEqual([...ALL_CHECKS_RAN, 'fix:1', 'keep:1', ...ALL_CHECKS_RAN, ...(unitTests ? ['tests'] : [])]);
  });

  it('logs the failing check’s output, and the round, in the execution log', async () => {
    const config = makeConfig(unitTests);

    await executeUnitTestPhase(config, {
      runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([]),
      fixRounds: scriptedFixRounds([], {}).port,
    });

    expect(executionLog(config)).toContain('lint error in src/a.ts');
    expect(executionLog(config)).toContain('Static-check fix round 1');
    expect(executionLog(config)).toContain('Static checks green after 1 fix round');
  });

  it('adds the cost and the model usage of the rounds to the cost of the phase', async () => {
    const usage: ModelUsageMap = { 'model-a': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.25 } };
    const rounds = scriptedFixRounds([], { costUsd: 0.25, modelUsage: usage });

    const result = await executeUnitTestPhase(makeConfig(unitTests), {
      runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([], { costUsd: 1 }),
      fixRounds: rounds.port,
    });

    expect(result.costUsd).toBeCloseTo(unitTests ? 1.25 : 0.25);
    expect(result.modelUsage['model-a'].costUSD).toBeCloseTo(0.25);
    expect(result.phaseCostRecords.length).toBeGreaterThan(0);
  });

  it('hands one round every failing check at once', async () => {
    const rounds = scriptedFixRounds([], {});

    await executeUnitTestPhase(makeConfig(unitTests), {
      runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN], build: [RED_BUILD, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([]),
      fixRounds: rounds.port,
    });

    expect(rounds.fixed).toHaveLength(1);
    expect(rounds.fixed[0].failed.map(verdict => verdict.check)).toEqual(['lint', 'build']);
  });

  it('carries on past any fixed number of rounds while the output keeps changing', async () => {
    const rounds = scriptedFixRounds([], ...Array.from({ length: 9 }, () => ({})));
    const changing = Array.from({ length: 9 }, (_unused, index) => ({ exitCode: 1, output: `${9 - index} problems` }));

    const result = await executeUnitTestPhase(makeConfig(unitTests), {
      runProcess: scriptedProcessRunner([], { lint: [...changing, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([]),
      fixRounds: rounds.port,
    });

    expect(result.unitTestsPassed).toBe(true);
    expect(rounds.fixed).toHaveLength(9);
  });
});

describe.each([true, false])('executeUnitTestPhase — a fix loop that stalls, with unitTests %s', (unitTests) => {
  async function stall(workflow: Workflow, events: string[], rounds = scriptedFixRounds(events, {}), outcomes: Outcomes = { lint: [RED_LINT, RED_LINT] }) {
    const run = executeUnitTestPhase(workflow.config, {
      runProcess: scriptedProcessRunner(events, outcomes),
      runUnitTestsWithRetry: recordingTestRun(events),
      fixRounds: rounds.port,
    });
    await expect(run).rejects.toBeInstanceOf(ExitSignal);
    return rounds;
  }

  it('parks the workflow as human_gated and exits with code 0', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, []);

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage).toBe('human_gated');
  });

  it('posts one park comment that names the check and its command, quotes its output, and explains "## Retry"', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, []);

    const [comment, ...others] = parkComments(workflow);
    expect(others).toEqual([]);
    expect(comment.startsWith('## :raised_hand: ADW Parked')).toBe(true);
    expect(comment).toContain('`lint` — `lint` (exit 1)');
    expect(comment).toContain('\n    lint error in src/a.ts');
    expect(comment).toContain('`## Retry` —');
    expect(comment).toContain('stopped after 1 fix round');
  });

  it('puts the failing output in the execution log', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, []);

    expect(executionLog(workflow.config)).toContain('lint error in src/a.ts');
    expect(executionLog(workflow.config)).toContain('human_gated');
  });

  it('never starts the test run', async () => {
    const events: string[] = [];

    await stall(makeWorkflow(unitTests), events);

    expect(events).not.toContain('tests');
  });

  it('is no failure: no error is recorded and no error comment is posted', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, []);

    expect(workflow.config.ctx.errorMessage).toBeUndefined();
    expect(workflow.comments().some(body => body.includes('ADW Workflow Error'))).toBe(false);
    expect(AgentStateManager.readState(workflow.config.orchestratorStatePath)?.execution?.status).not.toBe('failed');
  });

  it('names every check that still fails', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, [], undefined, { lint: [RED_LINT, RED_LINT], build: [RED_BUILD, RED_BUILD] });

    const [comment] = parkComments(workflow);
    expect(comment).toContain('`lint` — `lint` (exit 1)');
    expect(comment).toContain('`build` — `build` (exit 2)');
    expect(comment).toContain('build error in src/b.ts');
  });

  it('reports a check that was killed, and so has no exit code, as failing', async () => {
    const workflow = makeWorkflow(unitTests);
    const killed = { exitCode: null, output: 'Terminated' };

    await stall(workflow, [], undefined, { atc: [killed, killed] });

    expect(parkComments(workflow)[0]).toContain('`additional type checks` — `atc` (exit none)');
  });

  it('parks after a round that was kept but changed nothing the checks print', async () => {
    const events: string[] = [];
    const workflow = makeWorkflow(unitTests);

    const rounds = await stall(workflow, events);

    expect(rounds.kept).toEqual([1]);
    expect(rounds.discarded).toEqual([]);
  });
});

describe.each([true, false])('executeUnitTestPhase — a fix round the guard rejects, with unitTests %s', (unitTests) => {
  it('discards the round, runs the checks no more, and parks with the guard’s reasons', async () => {
    const events: string[] = [];
    const workflow = makeWorkflow(unitTests);
    const rounds = scriptedFixRounds(events, { diff: SUPPRESSING_DIFF });

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner(events, { lint: [RED_LINT, GREEN] }),
        runUnitTestsWithRetry: recordingTestRun(events),
        fixRounds: rounds.port,
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(rounds.discarded).toEqual([1]);
    expect(rounds.kept).toEqual([]);
    expect(events.filter(event => event === 'check:lint')).toHaveLength(1);
    expect(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage).toBe('human_gated');
    const [comment] = parkComments(workflow);
    expect(comment).toContain('The fix-round guard rejected the change that fix round 1 made');
    expect(comment).toContain('`src/a.ts` adds `@ts-ignore` (javascript suppression pattern)');
    expect(events).not.toContain('tests');
  });

  it('logs the guard’s reasons in the execution log', async () => {
    const workflow = makeWorkflow(unitTests);

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
        runUnitTestsWithRetry: recordingTestRun([]),
        fixRounds: scriptedFixRounds([], { diff: SUPPRESSING_DIFF }).port,
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(executionLog(workflow.config)).toContain('rejected by the fix-round guard');
    expect(executionLog(workflow.config)).toContain('`src/a.ts` adds `@ts-ignore`');
  });
});

describe('executeUnitTestPhase — the repository’s own suppression patterns', () => {
  it('rejects a round that adds a pattern the repository lists in "## Suppression Patterns"', async () => {
    const workflow = makeWorkflow(true, { ...CHECK_COMMANDS, suppressionPatterns: '- `@acme-off`' });
    const rounds = scriptedFixRounds([], { diff: ACME_DIFF });

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
        runUnitTestsWithRetry: recordingTestRun([]),
        fixRounds: rounds.port,
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(rounds.discarded).toEqual([1]);
    expect(parkComments(workflow)[0]).toContain('adds `@acme-off` (suppression pattern from .adw/commands.md)');
  });

  it('accepts the same round when the repository lists no such pattern', async () => {
    const rounds = scriptedFixRounds([], { diff: ACME_DIFF });

    await executeUnitTestPhase(makeConfig(true), {
      runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([]),
      fixRounds: rounds.port,
    });

    expect(rounds.kept).toEqual([1]);
  });

  it('logs an entry that tries to remove a framework pattern, and still rejects the suppression', async () => {
    const workflow = makeWorkflow(true, { ...CHECK_COMMANDS, suppressionPatterns: '- !@ts-ignore' });
    const rounds = scriptedFixRounds([], { diff: SUPPRESSING_DIFF });

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
        runUnitTestsWithRetry: recordingTestRun([]),
        fixRounds: rounds.port,
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(executionLog(workflow.config)).toContain('!@ts-ignore');
    expect(rounds.discarded).toEqual([1]);
  });
});

describe.each([true, false])('executeUnitTestPhase — "## Retry" on a parked workflow, with unitTests %s', (unitTests) => {
  it('re-arms the parked stage, and the resumed phase starts a round although the check prints what it printed when the loop stopped', async () => {
    const events: string[] = [];
    const workflow = makeWorkflow(unitTests);
    const rounds = scriptedFixRounds(events, {}, {});
    const runProcess = scriptedProcessRunner(events, { lint: [RED_LINT, RED_LINT, RED_LINT, GREEN] });
    const deps = { runProcess, runUnitTestsWithRetry: recordingTestRun(events), fixRounds: rounds.port };

    await expect(executeUnitTestPhase(workflow.config, deps)).rejects.toBeInstanceOf(ExitSignal);
    expect(decideRetryAction(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage)).toEqual({
      kind: 'rearm_phase_timeout',
      from: 'human_gated',
    });
    expect(rounds.fixed).toHaveLength(1);

    const result = await executeUnitTestPhase(workflow.config, deps);

    expect(result.unitTestsPassed).toBe(true);
    expect(rounds.fixed).toHaveLength(2);
    expect(rounds.fixed[1].round).toBe(1);
    expect(rounds.fixed[1].failed[0].output).toBe(rounds.fixed[0].failed[0].output);
    expect(events.filter(event => event === 'tests')).toHaveLength(unitTests ? 1 : 0);
  });
});

describe('executeUnitTestPhase — a fix round that fails with an error', () => {
  it('lets the error propagate, and parks nothing', async () => {
    const error = new Error('the fix agent timed out');
    const workflow = makeWorkflow(true);

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT] }),
        runUnitTestsWithRetry: recordingTestRun([]),
        fixRounds: scriptedFixRounds([], { error }).port,
      }),
    ).rejects.toBe(error);

    expect(process.exit).not.toHaveBeenCalled();
    expect(parkComments(workflow)).toEqual([]);
    expect(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage).not.toBe('human_gated');
  });

  it('asks for the git context of the workflow only once a check is red', async () => {
    const workflow = makeWorkflow(true);

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT] }),
        runUnitTestsWithRetry: recordingTestRun([]),
      }),
    ).rejects.toThrow(/requireWorkflowGitContext/);
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

  it('is not a park: no park comment, and no human_gated stage', async () => {
    const workflow = makeWorkflow(true);

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: recordingProcessRunner([]),
        runUnitTestsWithRetry: recordingTestRun([], { reportPresent: true, hasFailures: true, passed: false }),
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(parkComments(workflow)).toEqual([]);
    expect(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage).not.toBe('human_gated');
  });
});
