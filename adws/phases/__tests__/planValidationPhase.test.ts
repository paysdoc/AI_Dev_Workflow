import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import { detectRecoveryState } from '../../core';
import type { RecoveryState, WorkflowStage } from '../../types/workflowTypes';
import { executePlanValidationPhase } from '../planValidationPhase';
import type { WorkflowConfig } from '../workflowInit';

const mockRunValidationAgent = vi.hoisted(() => vi.fn());

vi.mock('../../agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents')>()),
  runValidationAgent: mockRunValidationAgent,
}));

class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

describe('executePlanValidationPhase — a plan that is missing', () => {
  const ISSUE_NUMBER = 33;
  const adwId = `plan-validation-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const PLAN_FILE = `specs/issue-${ISSUE_NUMBER}-adw-${adwId}-sdlc_planner-plan.md`;
  const PARK_HEADING = '## :raised_hand: ADW Parked — The Plan Was Lost with the Worktree';

  let worktree: string;
  let stateDir: string;
  let commentOnIssue: ReturnType<typeof vi.fn>;

  function resumedAfter(lastCompletedStage: WorkflowStage): RecoveryState {
    return { canResume: true, lastCompletedStage, adwId, branchName: 'feature-issue-33-plan-validation', planPath: PLAN_FILE, prUrl: null };
  }

  function validationConfig(recoveryState: RecoveryState): WorkflowConfig {
    return {
      issueNumber: ISSUE_NUMBER,
      adwId,
      issue: { number: ISSUE_NUMBER, title: 'Test issue', body: '', state: 'open', author: 'tester', labels: [], comments: [], createdAt: '2026-01-01T00:00:00Z' },
      issueType: '/feature',
      worktreePath: worktree,
      logsDir: path.join(stateDir, 'logs'),
      orchestratorStatePath: stateDir,
      orchestratorName: 'orchestrator',
      recoveryState,
      ctx: { issueNumber: ISSUE_NUMBER, adwId, issueType: '/feature' },
      repoContext: { issueTracker: { commentOnIssue } },
    } as unknown as WorkflowConfig;
  }

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-plan-validation-'));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-plan-validation-state-'));
    commentOnIssue = vi.fn();
    mockRunValidationAgent.mockReset();
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it.each<WorkflowStage>(['plan_created', 'planFile_created'])(
    'parks as worktree_lost and ends the process with exit code 0 on a resume after %s that finds no plan',
    async (stage) => {
      await expect(executePlanValidationPhase(validationConfig(resumedAfter(stage)))).rejects.toBeInstanceOf(ExitSignal);

      expect(process.exit).toHaveBeenCalledWith(0);
      expect(AgentStateManager.readTopLevelState(adwId)).toMatchObject({ workflowStage: 'worktree_lost', parkReason: 'worktree_lost' });
    },
  );

  it('posts only the park comment, which names the phase, and does not start the validation agent', async () => {
    await expect(executePlanValidationPhase(validationConfig(resumedAfter('plan_created')))).rejects.toBeInstanceOf(ExitSignal);

    expect(mockRunValidationAgent).not.toHaveBeenCalled();
    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    const body = String(commentOnIssue.mock.calls[0][1]);
    expect(body.startsWith(PARK_HEADING)).toBe(true);
    expect(body).toContain('The `plan validation` phase');
    expect(body).toContain(`\`${PLAN_FILE}\``);
    expect(body).toContain(`\`${worktree}\``);
  });

  it('still fails with an error naming the plan file on a fresh run, and does not park', async () => {
    await expect(executePlanValidationPhase(validationConfig(detectRecoveryState([])))).rejects.toThrow('Cannot read plan file');

    expect(process.exit).not.toHaveBeenCalled();
    expect(commentOnIssue).not.toHaveBeenCalled();
    expect(AgentStateManager.readTopLevelState(adwId)).toBeNull();
  });

  it.each<WorkflowStage>(['branch_created', 'plan_building'])(
    'still fails with an error naming the plan file on a resume after %s, which created no plan to lose',
    async (stage) => {
      await expect(executePlanValidationPhase(validationConfig(resumedAfter(stage)))).rejects.toThrow('Cannot read plan file');

      expect(process.exit).not.toHaveBeenCalled();
      expect(AgentStateManager.readTopLevelState(adwId)).toBeNull();
    },
  );

  it.each<WorkflowStage>(['plan_validating', 'plan_aligning', 'build_running'])(
    'skips on a resume after %s, since the validation completed in an earlier run, and needs no plan to do so',
    async (stage) => {
      await expect(executePlanValidationPhase(validationConfig(resumedAfter(stage)))).resolves.toMatchObject({ costUsd: 0 });

      expect(process.exit).not.toHaveBeenCalled();
      expect(mockRunValidationAgent).not.toHaveBeenCalled();
      expect(commentOnIssue).not.toHaveBeenCalled();
    },
  );

  it('does not park when the plan is in the worktree: with no scenario to validate it resolves', async () => {
    const planFile = path.join(worktree, PLAN_FILE);
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, '# Plan\n', 'utf-8');

    await expect(executePlanValidationPhase(validationConfig(resumedAfter('plan_created')))).resolves.toMatchObject({ costUsd: 0 });

    expect(process.exit).not.toHaveBeenCalled();
    expect(commentOnIssue).not.toHaveBeenCalled();
  });
});
