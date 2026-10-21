import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import { detectRecoveryState } from '../../core';
import type { RecoveryState, WorkflowStage } from '../../types/workflowTypes';
import { executePlanPhase } from '../planPhase';
import type { WorkflowConfig } from '../workflowInit';

const mockRunPlanAgent = vi.hoisted(() => vi.fn());

vi.mock('../../agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents')>()),
  runPlanAgent: mockRunPlanAgent,
}));

class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

describe('executePlanPhase — a resumed run whose plan is gone', () => {
  const ISSUE_NUMBER = 7;
  const adwId = `plan-resume-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const PLAN_FILE = `specs/issue-${ISSUE_NUMBER}-adw-${adwId}-sdlc_planner-plan.md`;
  const PARK_HEADING = '## :raised_hand: ADW Parked — The Plan Was Lost with the Worktree';
  const PLAN_CREATED_HEADING = '## :white_check_mark: Implementation Plan Created';
  const planAgentResult = { success: true, output: 'plan written', totalCostUsd: 0.01, modelUsage: {} };

  let worktree: string;
  let stateDir: string;
  let commentOnIssue: ReturnType<typeof vi.fn>;
  let moveToStatus: ReturnType<typeof vi.fn>;

  function write(relPath: string, contents: string): void {
    const absolute = path.join(worktree, relPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents, 'utf-8');
  }

  function resumedAfter(lastCompletedStage: WorkflowStage): RecoveryState {
    return { canResume: true, lastCompletedStage, adwId, branchName: 'feature-issue-7-resume', planPath: PLAN_FILE, prUrl: null };
  }

  function planConfig(recoveryState: RecoveryState): WorkflowConfig {
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
      branchName: 'feature-issue-7-resume',
      repoContext: { issueTracker: { commentOnIssue, moveToStatus } },
    } as unknown as WorkflowConfig;
  }

  function postedBodies(): string[] {
    return commentOnIssue.mock.calls.map(([, body]) => String(body));
  }

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-plan-resume-'));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-plan-resume-state-'));
    commentOnIssue = vi.fn();
    moveToStatus = vi.fn().mockResolvedValue(true);
    mockRunPlanAgent.mockReset();
    mockRunPlanAgent.mockImplementation(async () => {
      write(PLAN_FILE, '# Plan\n');
      return planAgentResult;
    });
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

  it('parks as worktree_lost and ends the process with exit code 0, without running the planner', async () => {
    await expect(executePlanPhase(planConfig(resumedAfter('plan_created')))).rejects.toBeInstanceOf(ExitSignal);

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(mockRunPlanAgent).not.toHaveBeenCalled();
    expect(AgentStateManager.readTopLevelState(adwId)).toMatchObject({ workflowStage: 'worktree_lost', parkReason: 'worktree_lost' });
  });

  it('posts only the park comment: no opening comment of the phase, and no second "Implementation Plan Created"', async () => {
    await expect(executePlanPhase(planConfig(resumedAfter('build_running')))).rejects.toBeInstanceOf(ExitSignal);

    const bodies = postedBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].startsWith(PARK_HEADING)).toBe(true);
    expect(bodies[0]).toContain(`\`${PLAN_FILE}\``);
    expect(bodies[0]).toContain(`\`${worktree}\``);
    expect(bodies.join('\n')).not.toContain(PLAN_CREATED_HEADING);
    expect(bodies.join('\n')).not.toContain('Building Implementation Plan');
  });

  it('does not move the issue on the board', async () => {
    await expect(executePlanPhase(planConfig(resumedAfter('plan_created')))).rejects.toBeInstanceOf(ExitSignal);

    expect(moveToStatus).not.toHaveBeenCalled();
  });

  it('parks before it awaits anything, so that a phase running beside it has not started when the process ends', async () => {
    const run = executePlanPhase(planConfig(resumedAfter('plan_created')));

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(moveToStatus).not.toHaveBeenCalled();
    await expect(run).rejects.toBeInstanceOf(ExitSignal);
  });

  it('runs the planner once and posts one "Implementation Plan Created" on a fresh run with no plan', async () => {
    const result = await executePlanPhase(planConfig(detectRecoveryState([])));

    expect(process.exit).not.toHaveBeenCalled();
    expect(mockRunPlanAgent).toHaveBeenCalledTimes(1);
    expect(postedBodies().filter(body => body.includes(PLAN_CREATED_HEADING))).toHaveLength(1);
    expect(result.costUsd).toBe(planAgentResult.totalCostUsd);
    expect(AgentStateManager.readTopLevelState(adwId)?.workflowStage).not.toBe('worktree_lost');
  });

  it.each<WorkflowStage>(['classified', 'branch_created', 'plan_building'])(
    'runs the planner as before on a resume at %s, since no plan was created yet, and does not park',
    async (stage) => {
      await executePlanPhase(planConfig(resumedAfter(stage)));

      expect(process.exit).not.toHaveBeenCalled();
      expect(mockRunPlanAgent).toHaveBeenCalledTimes(1);
      expect(postedBodies().filter(body => body.includes(PLAN_CREATED_HEADING))).toHaveLength(1);
      expect(postedBodies().join('\n')).not.toContain(PARK_HEADING);
    },
  );

  it('leaves a plan that is in the worktree alone on a resume after plan_created: no park, no planner, no comment', async () => {
    write(PLAN_FILE, '# Plan from the earlier run\n');

    await expect(executePlanPhase(planConfig(resumedAfter('plan_created')))).resolves.toMatchObject({ costUsd: 0 });

    expect(process.exit).not.toHaveBeenCalled();
    expect(mockRunPlanAgent).not.toHaveBeenCalled();
    expect(commentOnIssue).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(worktree, PLAN_FILE), 'utf-8')).toBe('# Plan from the earlier run\n');
  });

  it('counts an empty plan file as missing, and parks', async () => {
    write(PLAN_FILE, '');

    await expect(executePlanPhase(planConfig(resumedAfter('plan_created')))).rejects.toBeInstanceOf(ExitSignal);

    expect(mockRunPlanAgent).not.toHaveBeenCalled();
    expect(AgentStateManager.readTopLevelState(adwId)?.workflowStage).toBe('worktree_lost');
  });
});
