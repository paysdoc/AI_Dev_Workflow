import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatPullRequestArgs, runPullRequestAgent } from '../prAgent';

vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'https://github.com/vestmatic/vestmatic/pull/11',
    totalCostUsd: 0.5,
  }),
}));

vi.mock('../../vcs/branchOperations', () => ({
  getDefaultBranch: vi.fn().mockReturnValue('stage-3'),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
  };
});

import { runClaudeAgentWithCommand } from '../claudeAgent';
import { getDefaultBranch } from '../../vcs/branchOperations';

describe('formatPullRequestArgs', () => {
  it('returns an array of 5 elements with correct values', () => {
    const result = formatPullRequestArgs(
      'feature/issue-62-fix-pr',
      '{"number":62}',
      '/specs/plan.md',
      'adw-123',
      'stage-3',
    );

    expect(result).toHaveLength(5);
    expect(result[0]).toBe('feature/issue-62-fix-pr');
    expect(result[1]).toBe('{"number":62}');
    expect(result[2]).toBe('/specs/plan.md');
    expect(result[3]).toBe('adw-123');
    expect(result[4]).toBe('stage-3');
  });

  it('includes the default branch as the 5th element', () => {
    const result = formatPullRequestArgs('branch', '{}', '/plan.md', 'id', 'main');

    expect(result[4]).toBe('main');
  });
});

describe('runPullRequestAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDefaultBranch).mockReturnValue('stage-3');
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: 'https://github.com/vestmatic/vestmatic/pull/11',
      totalCostUsd: 0.5,
    });
  });

  it('resolves default branch using cwd parameter', async () => {
    await runPullRequestAgent(
      'feature/branch',
      '{"number":62}',
      '/plan.md',
      'adw-123',
      '/logs',
      undefined,
      '/worktree/path',
    );

    expect(getDefaultBranch).toHaveBeenCalledWith('/worktree/path');
  });

  it('includes resolved default branch in args passed to agent', async () => {
    await runPullRequestAgent(
      'feature/branch',
      '{"number":62}',
      '/plan.md',
      'adw-123',
      '/logs',
    );

    const args = vi.mocked(runClaudeAgentWithCommand).mock.calls[0][1] as string[];
    expect(args[4]).toBe('stage-3');
  });

  it('calls getDefaultBranch with undefined when cwd is not provided', async () => {
    await runPullRequestAgent(
      'feature/branch',
      '{"number":62}',
      '/plan.md',
      'adw-123',
      '/logs',
    );

    expect(getDefaultBranch).toHaveBeenCalledWith(undefined);
  });

  it('returns the extracted PR URL', async () => {
    const result = await runPullRequestAgent(
      'feature/branch',
      '{"number":62}',
      '/plan.md',
      'adw-123',
      '/logs',
    );

    expect(result.prUrl).toBe('https://github.com/vestmatic/vestmatic/pull/11');
  });
});
