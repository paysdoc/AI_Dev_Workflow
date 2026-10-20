import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import type { RecoveryState, WorkflowStage } from '../../types/workflowTypes';
import { detectRecoveryState } from '../../core/workflowCommentParsing';
import { ParkReason, buildParkComment } from '../../forge/parkComment';
import { getPlanFilePath } from '../../agents';
import { parkIfPlanLost, planCreatedByEarlierRun, type LostPlanGateConfig } from '../lostPlanGate';

class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

const ISSUE_NUMBER = 1078;
const EARLIER_PLAN_PATH = `specs/issue-${ISSUE_NUMBER}-adw-lost-gate-sdlc_planner-widget.md`;
const adwId = `lost-gate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const tempDirs: string[] = [];

function resumedAfter(lastCompletedStage: WorkflowStage, planPath: string | null = null): RecoveryState {
  return { canResume: true, lastCompletedStage, adwId, branchName: 'feature-issue-1078-widget', planPath, prUrl: null };
}

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(recoveryState: RecoveryState, commentOnIssue: ((issueNumber: number, body: string) => void) | null = vi.fn()): LostPlanGateConfig {
  return {
    adwId,
    issueNumber: ISSUE_NUMBER,
    orchestratorStatePath: tempDir('adw-lost-gate-state-'),
    worktreePath: tempDir('adw-lost-gate-worktree-'),
    recoveryState,
    repoContext: commentOnIssue ? ({ issueTracker: { commentOnIssue } } as unknown as LostPlanGateConfig['repoContext']) : undefined,
  };
}

function executionLog(config: LostPlanGateConfig): string {
  return fs.readFileSync(path.join(config.orchestratorStatePath, 'execution.log'), 'utf-8');
}

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitSignal(code);
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
  tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

describe('planCreatedByEarlierRun', () => {
  it('is false for a fresh run, which has no earlier run', () => {
    expect(planCreatedByEarlierRun(detectRecoveryState([]))).toBe(false);
  });

  it.each<WorkflowStage>(['starting', 'classified', 'branch_created', 'plan_building'])('is false for a resume whose last completed stage is %s, before any plan was created', (stage) => {
    expect(planCreatedByEarlierRun(resumedAfter(stage))).toBe(false);
  });

  it.each<WorkflowStage>(['plan_created', 'planFile_created', 'plan_validating', 'plan_aligning', 'build_running', 'build_completed', 'build_committing', 'pr_created'])(
    'is true for a resume whose last completed stage is %s, since an earlier run created the plan',
    (stage) => {
      expect(planCreatedByEarlierRun(resumedAfter(stage))).toBe(true);
    },
  );

  it('is false when the state cannot resume, whatever stage it names', () => {
    expect(planCreatedByEarlierRun({ ...resumedAfter('build_running'), canResume: false })).toBe(false);
  });
});

describe('parkIfPlanLost — a run that has not planned yet', () => {
  it.each<[string, RecoveryState]>([
    ['a fresh run', detectRecoveryState([])],
    ['a resume at branch_created', resumedAfter('branch_created')],
    ['a resume at plan_building', resumedAfter('plan_building')],
  ])('returns for %s without exiting, writing state or posting a comment', (_name, recoveryState) => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(recoveryState, commentOnIssue);

    expect(() => parkIfPlanLost(config, 'build')).not.toThrow();

    expect(process.exit).not.toHaveBeenCalled();
    expect(commentOnIssue).not.toHaveBeenCalled();
    expect(AgentStateManager.readTopLevelState(adwId)).toBeNull();
  });
});

describe('parkIfPlanLost — a run resumed after the plan was created', () => {
  const recoveryState = resumedAfter('build_running', EARLIER_PLAN_PATH);

  function park(config: LostPlanGateConfig, phase: 'plan' | 'plan validation' | 'build' = 'build'): void {
    expect(() => parkIfPlanLost(config, phase)).toThrow(ExitSignal);
  }

  it('parks the workflow as worktree_lost, with the reason beside the stage, and ends the process with exit code 0', () => {
    park(makeConfig(recoveryState));

    expect(AgentStateManager.readTopLevelState(adwId)).toMatchObject({ workflowStage: 'worktree_lost', parkReason: 'worktree_lost' });
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('posts the park comment, which names the phase, the plan path of the earlier run and the worktree', () => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(recoveryState, commentOnIssue);

    park(config, 'plan validation');

    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    expect(commentOnIssue).toHaveBeenCalledWith(
      ISSUE_NUMBER,
      buildParkComment(adwId, { reason: ParkReason.WorktreeLost, phase: 'plan validation', worktreePath: config.worktreePath, planPath: EARLIER_PLAN_PATH }),
    );
  });

  it('names the plan path that getPlanFilePath resolves when the earlier comments recorded none', () => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(resumedAfter('plan_created', null), commentOnIssue);

    park(config);

    const fallback = getPlanFilePath(ISSUE_NUMBER, config.worktreePath);
    expect(fallback).toBe(`specs/issue-${ISSUE_NUMBER}-plan.md`);
    expect(commentOnIssue).toHaveBeenCalledWith(
      ISSUE_NUMBER,
      buildParkComment(adwId, { reason: ParkReason.WorktreeLost, phase: 'build', worktreePath: config.worktreePath, planPath: fallback }),
    );
  });

  it('prefers the plan path of the earlier run to a plan file that happens to be in the worktree', () => {
    const commentOnIssue = vi.fn();
    const config = makeConfig(recoveryState, commentOnIssue);
    fs.mkdirSync(path.join(config.worktreePath, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(config.worktreePath, `specs/issue-${ISSUE_NUMBER}-adw-another-sdlc_planner-other.md`), '');

    park(config);

    expect(commentOnIssue.mock.calls[0][1]).toContain(`\`${EARLIER_PLAN_PATH}\``);
  });

  it('records the loss in the execution log, naming the phase, the plan and the worktree', () => {
    const config = makeConfig(recoveryState);

    park(config, 'plan');

    const log = executionLog(config);
    expect(log).toContain('plan phase');
    expect(log).toContain(EARLIER_PLAN_PATH);
    expect(log).toContain(config.worktreePath);
  });

  it('has written the stage by the time the comment is posted', () => {
    const stageAtPost: Array<string | undefined> = [];
    const commentOnIssue = vi.fn(() => {
      stageAtPost.push(AgentStateManager.readTopLevelState(adwId)?.workflowStage);
    });

    park(makeConfig(recoveryState, commentOnIssue));

    expect(stageAtPost).toEqual(['worktree_lost']);
  });

  it('still parks when there is no repository context to post the comment to', () => {
    park(makeConfig(recoveryState, null));

    expect(AgentStateManager.readTopLevelState(adwId)?.workflowStage).toBe('worktree_lost');
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
