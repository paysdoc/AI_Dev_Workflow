import { describe, it, expect, vi } from 'vitest';
import { executeMerge } from '../adwMerge';
import { makeDeps, makePR, REPO_INFO } from './adwMerge.helpers';

describe('executeMerge — approval gate', () => {
  it('with no hitl label, an unapproved PR still merges (gate satisfied by rule 1)', async () => {
    const deps = makeDeps({
      issueHasLabel: vi.fn().mockReturnValue(false),
      fetchPRApprovalState: vi.fn().mockReturnValue(false),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(deps.mergeWithConflictResolution).toHaveBeenCalled();
  });

  it('terminal MERGED state skips approval check — returns already_merged', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'MERGED' })),
      fetchPRApprovalState: vi.fn().mockReturnValue(false),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('already_merged');
    expect(deps.fetchPRApprovalState).not.toHaveBeenCalled();
  });

  it('terminal CLOSED state skips approval check — returns pr_closed', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'CLOSED' })),
      fetchPRApprovalState: vi.fn().mockReturnValue(false),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('pr_closed');
    expect(deps.fetchPRApprovalState).not.toHaveBeenCalled();
  });

  it('with no hitl and PR approved, merge proceeds', async () => {
    const deps = makeDeps({
      issueHasLabel: vi.fn().mockReturnValue(false),
      fetchPRApprovalState: vi.fn().mockReturnValue(true),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(deps.mergeWithConflictResolution).toHaveBeenCalled();
  });
});

describe('executeMerge — hitl × approved gate matrix', () => {
  it('rule 1: no hitl + not approved → merge (gate open)', async () => {
    const deps = makeDeps({
      issueHasLabel: vi.fn().mockReturnValue(false),
      fetchPRApprovalState: vi.fn().mockReturnValue(false),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(deps.mergeWithConflictResolution).toHaveBeenCalled();
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'completed', mergeRetryCount: 0 });
  });

  it('rule 2: hitl + not approved → defer with reason hitl_blocked_unapproved', async () => {
    const deps = makeDeps({
      issueHasLabel: vi.fn().mockReturnValue(true),
      fetchPRApprovalState: vi.fn().mockReturnValue(false),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('hitl_blocked_unapproved');
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(deps.mergeWithConflictResolution).not.toHaveBeenCalled();
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
  });

  it('rule 3: hitl + approved → merge (gate satisfied by approval)', async () => {
    const deps = makeDeps({
      issueHasLabel: vi.fn().mockReturnValue(true),
      fetchPRApprovalState: vi.fn().mockReturnValue(true),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(deps.mergeWithConflictResolution).toHaveBeenCalled();
  });

  it('rule 4: no hitl + approved → merge (gate open via rule 1)', async () => {
    const deps = makeDeps({
      issueHasLabel: vi.fn().mockReturnValue(false),
      fetchPRApprovalState: vi.fn().mockReturnValue(true),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(deps.mergeWithConflictResolution).toHaveBeenCalled();
  });

  it('defer logs a message naming the issue and PR', async () => {
    const logMessages: string[] = [];
    const logSpy = vi.spyOn(await import('../core'), 'log').mockImplementation((msg: string) => {
      logMessages.push(msg);
    });

    const deps = makeDeps({
      issueHasLabel: vi.fn().mockReturnValue(true),
      fetchPRApprovalState: vi.fn().mockReturnValue(false),
    });

    await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    const deferLog = logMessages.find(m => m.includes('deferring'));
    expect(deferLog).toBeDefined();
    expect(deferLog).toContain('42');
    expect(deferLog).toContain('7');

    logSpy.mockRestore();
  });
});
