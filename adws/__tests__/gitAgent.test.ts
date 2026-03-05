import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatBranchNameArgs,
  extractBranchNameFromOutput,
  validateBranchName,
  formatCommitArgs,
  extractCommitMessageFromOutput,
  runGenerateBranchNameAgent,
  runCommitAgent,
} from '../agents/gitAgent';
import { GitHubIssue, IssueClassSlashCommand } from '../types/dataTypes';

vi.mock('../agents/claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'mock-output',
  }),
}));

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    log: vi.fn(),
  };
});

import { runClaudeAgentWithCommand } from '../agents/claudeAgent';

function createMockIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 123,
    title: 'Add user authentication',
    body: 'Implement OAuth login',
    state: 'open',
    author: { login: 'testuser', isBot: false },
    assignees: [],
    labels: [],
    comments: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    url: 'https://github.com/test/repo/issues/123',
    ...overrides,
  };
}

describe('formatBranchNameArgs', () => {
  it('includes issueClass and issue JSON', () => {
    const issue = createMockIssue();
    const result = formatBranchNameArgs('/feature', issue);

    expect(result).toContain('issueClass: /feature');
    expect(result).toContain('"number":123');
    expect(result).toContain('"title":"Add user authentication"');
  });

  it('does not include adwId', () => {
    const result = formatBranchNameArgs('/feature', createMockIssue());
    expect(result).not.toContain('adwId');
  });

  it('handles different issue classes', () => {
    const issueClasses: IssueClassSlashCommand[] = ['/bug', '/chore', '/pr_review'];

    for (const issueClass of issueClasses) {
      const result = formatBranchNameArgs(issueClass, createMockIssue());
      expect(result).toContain(`issueClass: ${issueClass}`);
    }
  });
});

describe('extractBranchNameFromOutput', () => {
  it('extracts branch name from clean output', () => {
    const result = extractBranchNameFromOutput('feat-issue-123-add-user-auth');
    expect(result).toBe('feat-issue-123-add-user-auth');
  });

  it('handles output with leading/trailing whitespace', () => {
    const result = extractBranchNameFromOutput('  feat-issue-123-add-user-auth  \n');
    expect(result).toBe('feat-issue-123-add-user-auth');
  });

  it('extracts last line when output has extra text', () => {
    const output = 'Creating branch...\nSwitching to main...\nfeat-issue-123-add-user-auth';
    const result = extractBranchNameFromOutput(output);
    expect(result).toBe('feat-issue-123-add-user-auth');
  });

  it('handles output with empty lines', () => {
    const output = '\n\nfeat-issue-123-add-user-auth\n\n';
    const result = extractBranchNameFromOutput(output);
    expect(result).toBe('feat-issue-123-add-user-auth');
  });

  it('strips backticks from LLM output', () => {
    const result = extractBranchNameFromOutput('`feat-issue-123-add-user-auth`');
    expect(result).toBe('feat-issue-123-add-user-auth');
  });

  it('strips triple backticks from LLM output', () => {
    const result = extractBranchNameFromOutput('```feat-issue-123-add-user-auth```');
    expect(result).toBe('feat-issue-123-add-user-auth');
  });
});

describe('validateBranchName', () => {
  it('passes valid branch names through unchanged', () => {
    expect(validateBranchName('feat-issue-123-add-user-auth')).toBe(
      'feat-issue-123-add-user-auth'
    );
  });

  it('strips leading/trailing whitespace', () => {
    expect(validateBranchName('  feat-issue-123  ')).toBe('feat-issue-123');
  });

  it('truncates branch names exceeding 100 characters', () => {
    const longName = 'a'.repeat(110);
    const result = validateBranchName(longName);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('removes trailing dash after truncation', () => {
    const name = 'a'.repeat(99) + '-b';
    const result = validateBranchName(name);
    expect(result).not.toMatch(/-$/);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('removes invalid git branch name characters', () => {
    expect(validateBranchName('feat~branch^name:test')).toBe('featbranchnametest');
    expect(validateBranchName('feat*branch?name')).toBe('featbranchname');
    expect(validateBranchName('feat[branch]name')).toBe('featbranchname');
    expect(validateBranchName('feat@{branch}name')).toBe('featbranchname');
    expect(validateBranchName('feat\\branch')).toBe('featbranch');
  });

  it('replaces double dots with empty string', () => {
    expect(validateBranchName('feat..branch')).toBe('featbranch');
  });

  it('replaces spaces with dashes', () => {
    expect(validateBranchName('feat branch name')).toBe('feat-branch-name');
  });

  it('throws an error for empty output', () => {
    expect(() => validateBranchName('')).toThrow('Branch name is empty after validation');
  });

  it('throws an error when all characters are invalid', () => {
    expect(() => validateBranchName('~^:*?[]\\')).toThrow('Branch name is empty after validation');
  });

  it('removes backticks from branch names', () => {
    expect(validateBranchName('`feat-issue-123-add-auth`')).toBe('feat-issue-123-add-auth');
    expect(validateBranchName('feat-`issue`-123')).toBe('feat-issue-123');
  });
});

describe('formatCommitArgs', () => {
  it('includes agentName, issueClass, and issue context', () => {
    const result = formatCommitArgs('plan-orchestrator', '/feature', '{"number":123}');

    expect(result).toContain('agentName: plan-orchestrator');
    expect(result).toContain('issueClass: /feature');
    expect(result).toContain('issue: {"number":123}');
  });

  it('handles different agent names', () => {
    const agents = ['build-agent', 'pr-review-orchestrator', 'build-orchestrator'];

    for (const agent of agents) {
      const result = formatCommitArgs(agent, '/bug', '{}');
      expect(result).toContain(`agentName: ${agent}`);
    }
  });
});

describe('extractCommitMessageFromOutput', () => {
  it('extracts commit message from clean output', () => {
    const result = extractCommitMessageFromOutput('plan-orchestrator: feat: add implementation plan');
    expect(result).toBe('plan-orchestrator: feat: add implementation plan');
  });

  it('handles output with leading/trailing whitespace', () => {
    const result = extractCommitMessageFromOutput('  plan-orchestrator: feat: add plan  \n');
    expect(result).toBe('plan-orchestrator: feat: add plan');
  });

  it('extracts last line when output has extra text', () => {
    const output = 'Analyzing changes...\nStaging files...\nplan-orchestrator: feat: add implementation plan';
    const result = extractCommitMessageFromOutput(output);
    expect(result).toBe('plan-orchestrator: feat: add implementation plan');
  });

  it('handles output with empty lines', () => {
    const output = '\n\nbuild-agent: fix: resolve login error\n\n';
    const result = extractCommitMessageFromOutput(output);
    expect(result).toBe('build-agent: fix: resolve login error');
  });
});

describe('runGenerateBranchNameAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: 'feat-issue-123-add-user-auth',
    });
  });

  it('calls runClaudeAgentWithCommand with /generate_branch_name', async () => {
    const issue = createMockIssue();
    await runGenerateBranchNameAgent('/feature', issue, '/logs');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/generate_branch_name',
      expect.stringContaining('issueClass: /feature'),
      'Branch Name',
      expect.stringContaining('branchName-agent.jsonl'),
      'sonnet',
      undefined,
      undefined,
    );
  });

  it('uses sonnet model', async () => {
    await runGenerateBranchNameAgent('/feature', createMockIssue(), '/logs');

    const call = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(call[4]).toBe('sonnet');
  });

  it('extracts branch name from result', async () => {
    const result = await runGenerateBranchNameAgent('/feature', createMockIssue(), '/logs');

    expect(result.branchName).toBe('feat-issue-123-add-user-auth');
    expect(result.success).toBe(true);
  });

  it('does not pass cwd to agent (no git operations needed)', async () => {
    await runGenerateBranchNameAgent('/feature', createMockIssue(), '/logs');

    const call = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(call[7]).toBeUndefined();
  });

  it('passes statePath when provided', async () => {
    await runGenerateBranchNameAgent('/feature', createMockIssue(), '/logs', '/state/path');

    const call = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(call[6]).toBe('/state/path');
  });
});

describe('runCommitAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: 'plan-orchestrator: feat: add implementation plan',
    });
  });

  it('calls runClaudeAgentWithCommand with /commit', async () => {
    await runCommitAgent('plan-orchestrator', '/feature', '{"number":123}', '/logs');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/commit',
      expect.stringContaining('agentName: plan-orchestrator'),
      'Commit',
      expect.stringContaining('commit-agent.jsonl'),
      'sonnet',
      undefined,
      undefined,
      undefined
    );
  });

  it('uses sonnet model', async () => {
    await runCommitAgent('build-agent', '/bug', '{}', '/logs');

    const call = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(call[4]).toBe('sonnet');
  });

  it('extracts commit message from result', async () => {
    const result = await runCommitAgent('plan-orchestrator', '/feature', '{}', '/logs');

    expect(result.commitMessage).toBe('plan-orchestrator: feat: add implementation plan');
    expect(result.success).toBe(true);
  });

  it('passes cwd when provided', async () => {
    await runCommitAgent('build-agent', '/feature', '{}', '/logs', undefined, '/worktree/path');

    const call = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(call[7]).toBe('/worktree/path');
  });

  it('passes statePath when provided', async () => {
    await runCommitAgent('build-agent', '/feature', '{}', '/logs', '/state/path');

    const call = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(call[6]).toBe('/state/path');
  });
});
