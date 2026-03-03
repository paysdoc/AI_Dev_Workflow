import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatPullRequestArgs, runPullRequestAgent } from '../agents/prAgent';

vi.mock('../agents/claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'https://github.com/vestmatic/vestmatic/pull/11',
    totalCostUsd: 0.5,
  }),
}));

vi.mock('../github/gitOperations', () => ({
  getDefaultBranch: vi.fn().mockReturnValue('stage-3'),
}));

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    log: vi.fn(),
  };
});

import { runClaudeAgentWithCommand } from '../agents/claudeAgent';
import { getDefaultBranch } from '../github/gitOperations';

describe('formatPullRequestArgs', () => {
  it('returns 5-value newline-separated string including defaultBranch', () => {
    const result = formatPullRequestArgs(
      'feature/issue-62-fix-pr',
      '{"number":62}',
      '/specs/plan.md',
      'adw-123',
      'stage-3',
    );

    const lines = result.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('feature/issue-62-fix-pr');
    expect(lines[1]).toBe('{"number":62}');
    expect(lines[2]).toBe('/specs/plan.md');
    expect(lines[3]).toBe('adw-123');
    expect(lines[4]).toBe('stage-3');
  });

  it('includes the default branch as the 5th value', () => {
    const result = formatPullRequestArgs('branch', '{}', '/plan.md', 'id', 'main');

    expect(result).toContain('main');
    expect(result.split('\n')[4]).toBe('main');
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

    const args = vi.mocked(runClaudeAgentWithCommand).mock.calls[0][1] as string;
    const lines = args.split('\n');
    expect(lines[4]).toBe('stage-3');
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
