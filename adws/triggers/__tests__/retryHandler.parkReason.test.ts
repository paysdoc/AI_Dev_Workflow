import { describe, it, expect, vi } from 'vitest';
import { handleRetryDirective } from '../retryHandler';
import { log } from '../../core/logger';
import { ADW_COMMENT, makeDeps, makeState } from './fixtures/retryHandlerDeps';

vi.mock('../../core/logger', () => ({ log: vi.fn() }));

describe('handleRetryDirective — park reason', () => {
  it('re-arms a human_gated park for post_merge_bdd_red to phase_timeout with resumeAttempts:0 under the same adwId, and resumes nothing itself', () => {
    const deps = makeDeps(makeState({ workflowStage: 'human_gated', parkReason: 'post_merge_bdd_red', resumeAttempts: 2 }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(true);
    expect(deps.writeTopLevelState).toHaveBeenCalledOnce();
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', {
      workflowStage: 'phase_timeout',
      resumeAttempts: 0,
    });
    expect(deps.acquireIssueSpawnLock).not.toHaveBeenCalled();
    expect(deps.spawnDetached).not.toHaveBeenCalled();
    expect(deps.postStageComment).not.toHaveBeenCalled();
  });

  it('names the park reason that the state records in its log line', () => {
    vi.mocked(log).mockClear();
    const deps = makeDeps(makeState({ workflowStage: 'human_gated', parkReason: 'post_merge_bdd_red' }));

    handleRetryDirective(42, [ADW_COMMENT], deps);

    const messages = vi.mocked(log).mock.calls.map((call) => String(call[0]));
    expect(messages).toContainEqual(expect.stringMatching(/human_gated → phase_timeout.*post_merge_bdd_red/));
  });

  it('adds no park reason to its log line when the state records none', () => {
    vi.mocked(log).mockClear();
    const deps = makeDeps(makeState({ workflowStage: 'review_failed' }));

    handleRetryDirective(42, [ADW_COMMENT], deps);

    const messages = vi.mocked(log).mock.calls.map((call) => String(call[0]));
    expect(messages.filter((message) => message.includes('re-armed'))).toEqual([
      'Retry #42: re-armed adwId=test-adw-id review_failed → phase_timeout, cleared resume counter',
    ]);
  });
});
