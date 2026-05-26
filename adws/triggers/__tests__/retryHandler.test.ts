import { describe, it, expect, vi } from 'vitest';
import { handleRetryDirective } from '../retryHandler';
import type { AgentState } from '../../types/agentTypes';

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    workflowStage: 'merge_blocked',
    ...overrides,
  };
}

function makeDeps(state: AgentState | null = makeState()) {
  return {
    readTopLevelState: vi.fn().mockReturnValue(state),
    writeTopLevelState: vi.fn(),
  };
}

const ADW_COMMENT = { body: '**ADW ID:** `test-adw-id`' };

// ── handleRetryDirective ──────────────────────────────────────────────────────

describe('handleRetryDirective', () => {
  it('resets merge_blocked → awaiting_merge and clears retry counter, returns true', () => {
    const deps = makeDeps(makeState({ workflowStage: 'merge_blocked', mergeRetryCount: 2 }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(true);
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', {
      workflowStage: 'awaiting_merge',
      mergeRetryCount: 0,
    });
  });

  it('does not write and returns false when workflowStage is awaiting_merge', () => {
    const deps = makeDeps(makeState({ workflowStage: 'awaiting_merge' }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not write and returns false when workflowStage is completed', () => {
    const deps = makeDeps(makeState({ workflowStage: 'completed' }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not write and returns false when workflowStage is abandoned', () => {
    const deps = makeDeps(makeState({ workflowStage: 'abandoned' }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not read/write and returns false when comments have no adw-id', () => {
    const deps = makeDeps();

    const result = handleRetryDirective(42, [{ body: 'no adw id here' }], deps);

    expect(result).toBe(false);
    expect(deps.readTopLevelState).not.toHaveBeenCalled();
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not write and returns false when readTopLevelState returns null', () => {
    const deps = makeDeps(null);

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not write and returns false when comments are empty', () => {
    const deps = makeDeps();

    const result = handleRetryDirective(42, [], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });
});
