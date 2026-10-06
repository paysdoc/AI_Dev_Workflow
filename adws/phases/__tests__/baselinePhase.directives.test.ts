import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentStateManager } from '../../core/agentState';
import { BaselineStatus } from '../../core/baselineGate';
import { decideRetryAction } from '../../triggers/retryHandler';
import { executeBaselinePhase } from '../baselinePhase';
import {
  BASE_BRANCH,
  ExitSignal,
  LINT_FAILS,
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

describe('executeBaselinePhase — a waived baseline', () => {
  beforeEach(() => {
    harness = setUpPhase({ runLinter: 'lint' });
  });

  it('checks nothing out and runs nothing, and says why', async () => {
    const waiver = { status: BaselineStatus.Waived, waivedPark: 'baseline_red', recordedAt: '2026-10-04T09:00:00.000Z' } as const;
    AgentStateManager.writeTopLevelState(harness.adwId, { adwId: harness.adwId, baseline: waiver });
    const { runProcess, calls } = scriptedRunner({ lint: LINT_FAILS });
    const server = scriptedServer({ healthy: true, output: '' });

    const result = await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess, startDevServer: server.startDevServer });

    expect(result.costUsd).toBe(0);
    expect(harness.baseWorktree.ensure).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(server.specs).toEqual([]);
    expect(process.exit).not.toHaveBeenCalled();
    expect(harness.executionLog()).toMatch(/waived by `## Continue`/);
    expect(harness.executionLog()).toMatch(/pre-existing failures too/);
    expect(topLevelState()?.baseline).toEqual(waiver);
  });
});

describe('executeBaselinePhase — "## Retry"', () => {
  beforeEach(() => {
    harness = setUpPhase({ runLinter: 'lint' });
  });

  it('leaves a park that "## Retry" re-arms, and the resumed phase runs the checks again and parks again while the base is red', async () => {
    const first = scriptedRunner({ lint: LINT_FAILS });
    await expect(executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: first.runProcess })).rejects.toThrow(ExitSignal);
    expect(decideRetryAction(topLevelState()?.workflowStage)).toEqual({ kind: 'rearm_phase_timeout', from: 'human_gated' });

    const second = scriptedRunner({ lint: LINT_FAILS });
    await expect(executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: second.runProcess })).rejects.toThrow(ExitSignal);

    expect(second.calls.map(call => call.command)).toEqual(['install-deps', 'lint']);
    expect(harness.commentOnIssue).toHaveBeenCalledTimes(2);
    expect(topLevelState()).toMatchObject({ workflowStage: 'human_gated', parkReason: 'baseline_red' });
  });

  it('records the passed baseline when the resumed phase finds the base branch green', async () => {
    await expect(
      executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner({ lint: LINT_FAILS }).runProcess }),
    ).rejects.toThrow(ExitSignal);

    await executeBaselinePhase(harness.config, { baseWorktree: harness.baseWorktree, runProcess: scriptedRunner().runProcess });

    expect(topLevelState()?.baseline).toMatchObject({ status: BaselineStatus.Passed, baseBranch: BASE_BRANCH });
    expect(harness.commentOnIssue).toHaveBeenCalledTimes(1);
  });
});
