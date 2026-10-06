import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentStateManager } from '../../core/agentState';
import { BaselineStatus } from '../../core/baselineGate';
import { devServerPort } from '../../core/devServerLifecycle';
import { ParkReason, buildParkComment, parkDirectives } from '../../forge/parkComment';
import { executeBaselinePhase } from '../baselinePhase';
import {
  APPLICATION_URL,
  BASE_BRANCH,
  BASE_COMMIT,
  ExitSignal,
  LINT_FAILS,
  LINT_OUTPUT,
  scriptedRunner,
  scriptedServer,
  setUpPhase,
  spyOnConsoleAndExit,
  type PhaseHarness,
} from './baselinePhase.helpers';

let harness: PhaseHarness;

afterEach(() => {
  vi.restoreAllMocks();
  harness.cleanup();
});

beforeEach(spyOnConsoleAndExit);

function topLevelState() {
  return AgentStateManager.readTopLevelState(harness.adwId);
}

describe('executeBaselinePhase — a green base branch', () => {
  beforeEach(() => {
    harness = setUpPhase({ runLinter: 'lint' });
  });

  it('records that the baseline passed, with the base branch, its commit and when, and starts no agent', async () => {
    const { runProcess } = scriptedRunner();
    const now = new Date('2026-10-04T10:00:00.000Z');

    const result = await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess, now: () => now });

    expect(result).toMatchObject({ costUsd: 0, modelUsage: {}, phaseCostRecords: [] });
    expect(topLevelState()?.baseline).toEqual({
      status: BaselineStatus.Passed,
      baseBranch: BASE_BRANCH,
      baseCommit: BASE_COMMIT,
      recordedAt: now.toISOString(),
    });
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('posts no comment and parks nothing', async () => {
    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess });

    expect(harness.commentOnIssue).not.toHaveBeenCalled();
    expect(topLevelState()?.workflowStage).toBeUndefined();
    expect(topLevelState()?.parkReason).toBeUndefined();
  });

  it('logs the base branch and the commit it checked out', async () => {
    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess });

    const log = harness.executionLog();
    expect(log).toContain(BASE_BRANCH);
    expect(log).toContain(BASE_COMMIT);
    expect(log).toContain(harness.checkout.path);
  });

  it('runs the install and the checks in the base checkout, never in the issue worktree', async () => {
    const { runProcess, calls } = scriptedRunner();

    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess });

    expect(calls).toEqual([
      { command: 'install-deps', cwd: harness.checkout.path },
      { command: 'lint', cwd: harness.checkout.path },
    ]);
    expect(calls.some(call => call.cwd === harness.worktreePath)).toBe(false);
  });

  it('logs each check in the format of the static-check gate, labelled as the base branch’s', async () => {
    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess });

    const log = harness.executionLog();
    expect(log).toContain('Base branch check passed: lint — lint');
    expect(log).toContain('Base branch check skipped (N/A): type check');
  });

  it('asks the shared checkout once and never removes it: the re-runs share it, and the process exit removes it', async () => {
    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess });

    expect(harness.baseWorktree.ensure).toHaveBeenCalledTimes(1);
    expect(harness.baseWorktree.remove).not.toHaveBeenCalled();
  });
});

describe('executeBaselinePhase — a red base branch', () => {
  beforeEach(() => {
    harness = setUpPhase({ runLinter: 'lint' });
  });

  async function runRed(): Promise<void> {
    const { runProcess } = scriptedRunner({ lint: LINT_FAILS });
    await expect(executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess })).rejects.toThrow(ExitSignal);
  }

  it('parks the workflow as human_gated for baseline_red, exits 0 and records no baseline', async () => {
    await runRed();

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(topLevelState()).toMatchObject({ workflowStage: 'human_gated', parkReason: 'baseline_red' });
    expect(topLevelState()?.baseline).toBeUndefined();
  });

  it('posts exactly the baseline_red park comment, naming the failing check and quoting its output', async () => {
    await runRed();

    expect(harness.commentOnIssue).toHaveBeenCalledTimes(1);
    const expected = buildParkComment(harness.adwId, {
      reason: ParkReason.BaselineRed,
      baseBranch: BASE_BRANCH,
      failedChecks: [{ check: 'lint', command: 'lint', exitCode: 1, output: LINT_OUTPUT }],
    });
    expect(harness.commentOnIssue).toHaveBeenCalledWith(990, expected);
    expect(expected).toContain('`lint`');
    expect(expected).toContain(`    ${LINT_OUTPUT}`);
    expect(expected).toContain(`\`${BASE_BRANCH}\``);
    const directives = parkDirectives({ reason: ParkReason.BaselineRed, baseBranch: BASE_BRANCH, failedChecks: [] });
    expect(expected).toContain(directives.retry);
    expect(expected).toContain(directives.continue);
  });

  it('logs the full output of the failing check', async () => {
    await runRed();

    expect(harness.executionLog()).toContain(LINT_OUTPUT);
    expect(harness.executionLog()).toContain('Base branch check failed: lint (exit 1)');
  });

  it('parks when the install fails, naming "install dependencies" and its command, before any check runs', async () => {
    const { runProcess, calls } = scriptedRunner({ 'install-deps': { exitCode: 1, output: 'E404 no such package' } });

    await expect(executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess })).rejects.toThrow(ExitSignal);

    expect(calls.map(call => call.command)).toEqual(['install-deps']);
    expect(topLevelState()?.parkReason).toBe('baseline_red');
    const comment = String(harness.commentOnIssue.mock.calls[0]?.[1]);
    expect(comment).toContain('`install dependencies`');
    expect(comment).toContain('`install-deps`');
    expect(comment).toContain('E404 no such package');
    expect(harness.executionLog()).toContain('E404 no such package');
  });
});

describe('executeBaselinePhase — the dev server of the base branch', () => {
  const SERVER_COMMAND = 'npm run dev -- --port {PORT}';

  beforeEach(() => {
    harness = setUpPhase({ runLinter: 'lint', startDevServer: SERVER_COMMAND, healthCheckPath: '/health' });
  });

  it('parks for base_server_down, quoting the server’s output, when the server does not start', async () => {
    const server = scriptedServer({ healthy: false, output: 'Error: listen EADDRINUSE' });

    await expect(
      executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess, startDevServer: server.startDevServer }),
    ).rejects.toThrow(ExitSignal);

    expect(topLevelState()).toMatchObject({ workflowStage: 'human_gated', parkReason: 'base_server_down' });
    expect(harness.commentOnIssue).toHaveBeenCalledWith(
      990,
      buildParkComment(harness.adwId, { reason: ParkReason.BaseServerDown, baseBranch: BASE_BRANCH, output: 'Error: listen EADDRINUSE' }),
    );
    expect(harness.executionLog()).toContain('Error: listen EADDRINUSE');
  });

  it('starts the declared server in the base checkout, on the run’s port, with the base branch’s health path and a log of its own', async () => {
    const server = scriptedServer({ healthy: true, output: '' });

    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess, startDevServer: server.startDevServer });

    expect(server.specs).toEqual([
      {
        command: SERVER_COMMAND,
        cwd: harness.checkout.path,
        port: devServerPort(APPLICATION_URL),
        healthPath: '/health',
        outputPath: `${harness.config.logsDir}/base-dev-server.log`,
      },
    ]);
    expect(topLevelState()?.baseline).toMatchObject({ status: BaselineStatus.Passed });
  });

  it('starts no server while a check is red', async () => {
    const server = scriptedServer({ healthy: true, output: '' });
    const { runProcess } = scriptedRunner({ lint: LINT_FAILS });

    await expect(
      executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess, startDevServer: server.startDevServer }),
    ).rejects.toThrow(ExitSignal);

    expect(server.specs).toEqual([]);
    expect(topLevelState()?.parkReason).toBe('baseline_red');
  });

  it('falls back to "/" as the health path when the base branch names none', async () => {
    harness.cleanup();
    harness = setUpPhase({ runLinter: 'lint', startDevServer: SERVER_COMMAND });
    // The parsed config fills in "/" for a missing path.
    const server = scriptedServer({ healthy: true, output: '' });

    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess, startDevServer: server.startDevServer });

    expect(server.specs[0]?.healthPath).toBe('/');
  });
});

describe('executeBaselinePhase — a base branch that declares no dev server', () => {
  it('starts no server when the section says N/A', async () => {
    harness = setUpPhase({ runLinter: 'lint', startDevServer: 'N/A' });
    const server = scriptedServer({ healthy: false, output: 'never' });

    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess, startDevServer: server.startDevServer });

    expect(server.specs).toEqual([]);
  });

  it('starts no server when the section is missing, although the parsed config defaults to one', async () => {
    harness = setUpPhase({ runLinter: 'lint' });
    const server = scriptedServer({ healthy: false, output: 'never' });

    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess, startDevServer: server.startDevServer });

    expect(server.specs).toEqual([]);
  });
});
