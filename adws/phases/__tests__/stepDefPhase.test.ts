import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../agents', () => ({
  runStepDefAgent: vi.fn(),
}));

import { runStepDefAgent } from '../../agents';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import { APPLICATION_TYPE_PROFILES, RunnerMode, type ApplicationProfile } from '../../core/applicationType';
import { executeStepDefPhase } from '../stepDefPhase';
import type { WorkflowConfig } from '../workflowInit';

const mockRunStepDefAgent = vi.mocked(runStepDefAgent);
const adwId = `step-def-phase-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

function makeConfig(applicationProfile: ApplicationProfile | null): WorkflowConfig {
  return {
    issueNumber: 9926,
    adwId,
    issue: { number: 9926, title: 'Step definition phase', body: 'issue body' },
    worktreePath: '/worktrees/step-def-phase',
    logsDir: '/logs/step-def-phase',
    orchestratorStatePath: AgentStateManager.initializeState(adwId, 'orchestrator'),
    gitContext: undefined,
    ...(applicationProfile === null ? {} : { applicationProfile }),
  } as unknown as WorkflowConfig;
}

function executionLog(config: WorkflowConfig): string {
  return fs.readFileSync(path.join(config.orchestratorStatePath, 'execution.log'), 'utf-8');
}

beforeEach(() => {
  mockRunStepDefAgent.mockReset();
  mockRunStepDefAgent.mockResolvedValue({ success: true, output: '{}', removedScenarios: [], totalCostUsd: 0 } as unknown as Awaited<ReturnType<typeof runStepDefAgent>>);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
});

describe('executeStepDefPhase — the generator is told which scenario runner the repository has', () => {
  it("starts the generator in ADW's Playwright mode for a web repository", async () => {
    await executeStepDefPhase(makeConfig(APPLICATION_TYPE_PROFILES.web));

    expect(mockRunStepDefAgent).toHaveBeenCalledOnce();
    const [issueNumber, startedAdwId, runnerMode] = mockRunStepDefAgent.mock.calls[0];
    expect(issueNumber).toBe(9926);
    expect(startedAdwId).toBe(adwId);
    expect(runnerMode).toBe(RunnerMode.AdwPlaywright);
  });

  it('starts the generator in descriptor mode for a cli repository', async () => {
    await executeStepDefPhase(makeConfig(APPLICATION_TYPE_PROFILES.cli));

    expect(mockRunStepDefAgent).toHaveBeenCalledOnce();
    expect(mockRunStepDefAgent.mock.calls[0][2]).toBe(RunnerMode.Descriptor);
  });

  it('keeps passing the logs directory, worktree and issue body after the runner mode', async () => {
    await executeStepDefPhase(makeConfig(APPLICATION_TYPE_PROFILES.web));

    const [, , , logsDir, , worktreePath, issueBody] = mockRunStepDefAgent.mock.calls[0];
    expect(logsDir).toBe('/logs/step-def-phase');
    expect(worktreePath).toBe('/worktrees/step-def-phase');
    expect(issueBody).toBe('issue body');
  });
});

describe('executeStepDefPhase — a config without an application profile', () => {
  it('does not start the generator, and the phase still resolves, since it is non-fatal', async () => {
    const config = makeConfig(null);

    const result = await executeStepDefPhase(config);

    expect(mockRunStepDefAgent).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
    expect(result.phaseCostRecords).toEqual([]);
    expect(executionLog(config)).toContain('Step definition generation error');
    expect(executionLog(config)).toContain('requireApplicationProfile');
  });
});
