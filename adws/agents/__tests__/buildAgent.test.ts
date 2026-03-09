import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBuildAgent, runPrReviewBuildAgent } from '../buildAgent';
import { runClaudeAgentWithCommand } from '../claudeAgent';
import type { GitHubIssue, PRDetails } from '../../core';

vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'Implementation complete',
    totalCostUsd: 0.5,
  }),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    getModelForCommand: vi.fn().mockReturnValue('opus'),
    getEffortForCommand: vi.fn().mockReturnValue('high'),
  };
});

const mockIssue: GitHubIssue = {
  number: 42,
  title: 'Fix login bug',
  body: 'The login button does not work',
  state: 'OPEN',
  author: { login: 'author', isBot: false },
  assignees: [],
  labels: [],
  comments: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  url: 'https://github.com/owner/repo/issues/42',
};

const mockPrDetails: PRDetails = {
  number: 10,
  title: 'Fix login',
  body: 'Fixes issue #42',
  state: 'open',
  headBranch: 'fix-login',
  baseBranch: 'main',
  url: 'https://github.com/owner/repo/pull/10',
  issueNumber: 42,
  reviewComments: [],
};

describe('runBuildAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runClaudeAgentWithCommand with /implement command', async () => {
    await runBuildAgent(mockIssue, '/tmp/logs', 'Step 1: Fix the bug');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/implement',
      expect.any(String),
      'Build',
      expect.stringContaining('build-agent.jsonl'),
      'opus',
      'high',
      undefined,
      undefined,
      undefined,
    );
  });

  it('formats args with issue context and plan content', async () => {
    const planContent = '## Step 1\nFix the login handler';
    await runBuildAgent(mockIssue, '/tmp/logs', planContent);

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const args = callArgs[1] as string;
    expect(args).toContain('## GitHub Issue #42');
    expect(args).toContain('**Title:** Fix login bug');
    expect(args).toContain('https://github.com/owner/repo/issues/42');
    expect(args).toContain('## Implementation Plan');
    expect(args).toContain('Fix the login handler');
  });

  it('returns AgentResult from runClaudeAgentWithCommand', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValueOnce({
      success: true,
      output: 'Build done',
      totalCostUsd: 1.2,
    });

    const result = await runBuildAgent(mockIssue, '/tmp/logs', 'plan');

    expect(result.success).toBe(true);
    expect(result.output).toBe('Build done');
    expect(result.totalCostUsd).toBe(1.2);
  });

  it('returns failure result when agent fails', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValueOnce({
      success: false,
      output: 'Error during build',
      totalCostUsd: 0.3,
    });

    const result = await runBuildAgent(mockIssue, '/tmp/logs', 'plan');

    expect(result.success).toBe(false);
    expect(result.output).toBe('Error during build');
  });

  it('sets output file path in logsDir', async () => {
    await runBuildAgent(mockIssue, '/my/logs/dir', 'plan');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const outputFile = callArgs[3] as string;
    expect(outputFile).toBe('/my/logs/dir/build-agent.jsonl');
  });

  it('passes onProgress callback to runClaudeAgentWithCommand', async () => {
    const onProgress = vi.fn();
    await runBuildAgent(mockIssue, '/tmp/logs', 'plan', onProgress);

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[6]).toBe(onProgress);
  });

  it('passes statePath to runClaudeAgentWithCommand', async () => {
    await runBuildAgent(mockIssue, '/tmp/logs', 'plan', undefined, '/state/path');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[7]).toBe('/state/path');
  });

  it('passes cwd to runClaudeAgentWithCommand', async () => {
    await runBuildAgent(mockIssue, '/tmp/logs', 'plan', undefined, undefined, '/worktree');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[8]).toBe('/worktree');
  });
});

describe('runPrReviewBuildAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runClaudeAgentWithCommand with /implement command', async () => {
    await runPrReviewBuildAgent(mockPrDetails, 'Fix the color', '/tmp/logs');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/implement',
      expect.any(String),
      'PR Review Build',
      expect.stringContaining('pr-review-build-agent.jsonl'),
      'opus',
      'high',
      undefined,
      undefined,
      undefined,
    );
  });

  it('formats args with PR context and revision plan', async () => {
    const revisionPlan = '## Fix\nChange button color to blue';
    await runPrReviewBuildAgent(mockPrDetails, revisionPlan, '/tmp/logs');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const args = callArgs[1] as string;
    expect(args).toContain('## PR #10: Fix login');
    expect(args).toContain('https://github.com/owner/repo/pull/10');
    expect(args).toContain('**Branch:** fix-login');
    expect(args).toContain('## Revision Plan');
    expect(args).toContain('Change button color to blue');
  });

  it('returns AgentResult from runClaudeAgentWithCommand', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValueOnce({
      success: true,
      output: 'PR build done',
      totalCostUsd: 0.8,
    });

    const result = await runPrReviewBuildAgent(mockPrDetails, 'plan', '/tmp/logs');

    expect(result.success).toBe(true);
    expect(result.output).toBe('PR build done');
    expect(result.totalCostUsd).toBe(0.8);
  });

  it('returns failure result when agent fails', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValueOnce({
      success: false,
      output: 'PR build error',
      totalCostUsd: 0.1,
    });

    const result = await runPrReviewBuildAgent(mockPrDetails, 'plan', '/tmp/logs');

    expect(result.success).toBe(false);
    expect(result.output).toBe('PR build error');
  });

  it('sets output file path in logsDir', async () => {
    await runPrReviewBuildAgent(mockPrDetails, 'plan', '/my/logs');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    const outputFile = callArgs[3] as string;
    expect(outputFile).toBe('/my/logs/pr-review-build-agent.jsonl');
  });

  it('passes onProgress callback', async () => {
    const onProgress = vi.fn();
    await runPrReviewBuildAgent(mockPrDetails, 'plan', '/tmp/logs', onProgress);

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[6]).toBe(onProgress);
  });

  it('passes statePath and cwd', async () => {
    await runPrReviewBuildAgent(mockPrDetails, 'plan', '/tmp/logs', undefined, '/state', '/cwd');

    const callArgs = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(callArgs[7]).toBe('/state');
    expect(callArgs[8]).toBe('/cwd');
  });

  it('passes issueBody to getModelForCommand and getEffortForCommand', async () => {
    const { getModelForCommand, getEffortForCommand } = await import('../../core');
    await runPrReviewBuildAgent(mockPrDetails, 'plan', '/tmp/logs', undefined, undefined, undefined, '<!-- adw:fast -->');

    expect(getModelForCommand).toHaveBeenCalledWith('/implement', '<!-- adw:fast -->');
    expect(getEffortForCommand).toHaveBeenCalledWith('/implement', '<!-- adw:fast -->');
  });
});
