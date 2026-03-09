import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { shouldExecuteStage, hasUncommittedChanges, getNextStage } from '../orchestratorLib';
import { STAGE_ORDER } from '../../github/workflowCommentsBase';
import { RecoveryState, WorkflowStage } from '../../types/dataTypes';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

function createRecoveryState(overrides: Partial<RecoveryState> = {}): RecoveryState {
  return {
    lastCompletedStage: null,
    adwId: null,
    branchName: null,
    planPath: null,
    prUrl: null,
    canResume: false,
    ...overrides,
  };
}

describe('shouldExecuteStage', () => {
  it('returns true when recoveryState.canResume is false', () => {
    const state = createRecoveryState({ canResume: false });
    expect(shouldExecuteStage('classified', state)).toBe(true);
  });

  it('returns true when lastCompletedStage is null', () => {
    const state = createRecoveryState({ canResume: true, lastCompletedStage: null });
    expect(shouldExecuteStage('classified', state)).toBe(true);
  });

  it('returns true when target stage is after the last completed stage', () => {
    const state = createRecoveryState({
      canResume: true,
      lastCompletedStage: 'classified',
    });
    expect(shouldExecuteStage('branch_created', state)).toBe(true);
  });

  it('returns false when target stage is at the last completed stage', () => {
    const state = createRecoveryState({
      canResume: true,
      lastCompletedStage: 'classified',
    });
    expect(shouldExecuteStage('classified', state)).toBe(false);
  });

  it('returns false when target stage is before the last completed stage', () => {
    const state = createRecoveryState({
      canResume: true,
      lastCompletedStage: 'plan_created',
    });
    expect(shouldExecuteStage('classified', state)).toBe(false);
  });
});

describe('hasUncommittedChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when git status returns empty string', () => {
    mockedExecSync.mockReturnValue('');
    expect(hasUncommittedChanges()).toBe(false);
  });

  it('returns true when git status returns non-empty string', () => {
    mockedExecSync.mockReturnValue(' M src/index.ts\n');
    expect(hasUncommittedChanges()).toBe(true);
  });

  it('returns false when execSync throws', () => {
    mockedExecSync.mockImplementation(() => { throw new Error('git error'); });
    expect(hasUncommittedChanges()).toBe(false);
  });

  it('passes cwd parameter to execSync when provided', () => {
    mockedExecSync.mockReturnValue('');
    hasUncommittedChanges('/some/path');

    expect(mockedExecSync).toHaveBeenCalledWith(
      'git status --porcelain',
      expect.objectContaining({ cwd: '/some/path' })
    );
  });

  it('does not include cwd when not provided', () => {
    mockedExecSync.mockReturnValue('');
    hasUncommittedChanges();

    const callArgs = mockedExecSync.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs.cwd).toBeUndefined();
  });
});

describe('getNextStage', () => {
  it('returns the stage after the given stage in STAGE_ORDER', () => {
    const stage: WorkflowStage = 'classified';
    const expected = STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1];
    expect(getNextStage(stage)).toBe(expected);
  });

  it('returns starting when given the last stage', () => {
    const lastStage = STAGE_ORDER[STAGE_ORDER.length - 1];
    expect(getNextStage(lastStage)).toBe('starting');
  });

  it('returns starting when given an invalid stage', () => {
    expect(getNextStage('invalid_stage' as WorkflowStage)).toBe('starting');
  });
});
