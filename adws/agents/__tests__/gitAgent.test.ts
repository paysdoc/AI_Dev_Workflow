import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatBranchNameArgs,
  extractBranchNameFromOutput,
  validateBranchName,
  formatCommitArgs,
  extractCommitMessageFromOutput,
  mapIssueClassToKeyword,
  buildCommitPrefix,
  validateCommitMessage,
  runGenerateBranchNameAgent,
  runCommitAgent,
} from '../gitAgent';
import { GitHubIssue, IssueClassSlashCommand } from '../../types/dataTypes';
import { OrchestratorId } from '../../core/constants';

vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: 'mock-output',
  }),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
  };
});

import { runClaudeAgentWithCommand } from '../claudeAgent';

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
  it('returns array with issueClass and issue JSON', () => {
    const issue = createMockIssue();
    const result = formatBranchNameArgs('/feature', issue);

    expect(result).toEqual(['/feature', JSON.stringify(issue)]);
  });

  it('does not include adwId', () => {
    const result = formatBranchNameArgs('/feature', createMockIssue());
    expect(result.join(' ')).not.toContain('adwId');
  });

  it('handles different issue classes', () => {
    const issueClasses: IssueClassSlashCommand[] = ['/bug', '/chore', '/pr_review'];

    for (const issueClass of issueClasses) {
      const result = formatBranchNameArgs(issueClass, createMockIssue());
      expect(result[0]).toBe(issueClass);
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

describe('mapIssueClassToKeyword', () => {
  it('maps /feature to feat', () => {
    expect(mapIssueClassToKeyword('/feature')).toBe('feat');
  });

  it('maps /bug to fix', () => {
    expect(mapIssueClassToKeyword('/bug')).toBe('fix');
  });

  it('maps /chore to chore', () => {
    expect(mapIssueClassToKeyword('/chore')).toBe('chore');
  });

  it('maps /pr_review to review', () => {
    expect(mapIssueClassToKeyword('/pr_review')).toBe('review');
  });

  it('maps /adw_init to adwinit', () => {
    expect(mapIssueClassToKeyword('/adw_init')).toBe('adwinit');
  });

  it('falls back to stripping leading / for unknown issue classes', () => {
    expect(mapIssueClassToKeyword('/unknown')).toBe('unknown');
    expect(mapIssueClassToKeyword('/custom_type')).toBe('custom_type');
  });

  it('returns value as-is if no leading /', () => {
    expect(mapIssueClassToKeyword('feature')).toBe('feature');
  });
});

describe('buildCommitPrefix', () => {
  it('builds prefix for build-agent with /feature', () => {
    expect(buildCommitPrefix('build-agent', '/feature')).toBe('build-agent: feat');
  });

  it('builds prefix for plan-orchestrator with /bug', () => {
    expect(buildCommitPrefix('plan-orchestrator', '/bug')).toBe('plan-orchestrator: fix');
  });

  it('builds prefix for document-agent with /chore', () => {
    expect(buildCommitPrefix('document-agent', '/chore')).toBe('document-agent: chore');
  });
});

describe('formatCommitArgs', () => {
  it('returns 2-element array with prefix and issue context', () => {
    const result = formatCommitArgs(OrchestratorId.Plan, '/feature', '{"number":123}');

    expect(result).toEqual(['plan-orchestrator: feat', '{"number":123}']);
  });

  it('constructs correct prefix for different agent names and issue classes', () => {
    expect(formatCommitArgs('build-agent', '/bug', '{}')).toEqual(['build-agent: fix', '{}']);
    expect(formatCommitArgs('document-agent', '/chore', '{}')).toEqual(['document-agent: chore', '{}']);
    expect(formatCommitArgs(OrchestratorId.PrReview, '/pr_review', '{}')).toEqual([
      'pr-review-orchestrator: review',
      '{}',
    ]);
  });

  it('returns exactly 2 elements', () => {
    const result = formatCommitArgs('any-agent', '/feature', '{"number":1}');
    expect(result).toHaveLength(2);
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

describe('validateCommitMessage', () => {
  it('returns message as-is when it already has the correct prefix', () => {
    const msg = 'build-agent: feat: add provider config';
    expect(validateCommitMessage(msg, 'build-agent: feat')).toBe(msg);
  });

  it('prepends prefix when message has no prefix (just a description)', () => {
    expect(validateCommitMessage('add provider config', 'build-agent: feat')).toBe(
      'build-agent: feat: add provider config'
    );
  });

  it('strips malformed prefix /feature: feat: and replaces with correct prefix', () => {
    expect(validateCommitMessage('/feature: feat: add provider config', 'build-agent: feat')).toBe(
      'build-agent: feat: add provider config'
    );
  });

  it('strips malformed prefix feat: (missing agent name) and replaces', () => {
    expect(validateCommitMessage('feat: add provider config', 'build-agent: feat')).toBe(
      'build-agent: feat: add provider config'
    );
  });

  it('strips malformed prefix /bug: #126: and replaces with correct prefix', () => {
    expect(validateCommitMessage('/bug: #126: fix invalid field', 'build-agent: fix')).toBe(
      'build-agent: fix: fix invalid field'
    );
  });

  it('handles leading/trailing whitespace', () => {
    expect(validateCommitMessage('  build-agent: feat: add config  ', 'build-agent: feat')).toBe(
      'build-agent: feat: add config'
    );
  });

  it('handles whitespace-only message after stripping', () => {
    const result = validateCommitMessage('feat: ', 'build-agent: feat');
    expect(result.startsWith('build-agent: feat: ')).toBe(true);
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
      expect.arrayContaining(['/feature']),
      'Branch Name',
      expect.stringContaining('branchName-agent.jsonl'),
      'sonnet',
      'low',
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
    expect(call[8]).toBeUndefined();
  });

  it('passes statePath when provided', async () => {
    await runGenerateBranchNameAgent('/feature', createMockIssue(), '/logs', '/state/path');

    const call = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(call[7]).toBe('/state/path');
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

  it('calls runClaudeAgentWithCommand with /commit and 2-element args', async () => {
    await runCommitAgent(OrchestratorId.Plan, '/feature', '{"number":123}', '/logs');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/commit',
      ['plan-orchestrator: feat', '{"number":123}'],
      'Commit',
      expect.stringContaining('commit-agent.jsonl'),
      'sonnet',
      'medium',
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
    const result = await runCommitAgent(OrchestratorId.Plan, '/feature', '{}', '/logs');

    expect(result.commitMessage).toBe('plan-orchestrator: feat: add implementation plan');
    expect(result.success).toBe(true);
  });

  it('validates and corrects malformed commit message', async () => {
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: '/feature: feat: add provider config',
    });

    const result = await runCommitAgent('build-agent', '/feature', '{}', '/logs');

    expect(result.commitMessage).toBe('build-agent: feat: add provider config');
  });

  it('passes cwd when provided', async () => {
    await runCommitAgent('build-agent', '/feature', '{}', '/logs', undefined, '/worktree/path');

    const call = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(call[8]).toBe('/worktree/path');
  });

  it('passes statePath when provided', async () => {
    await runCommitAgent('build-agent', '/feature', '{}', '/logs', '/state/path');

    const call = vi.mocked(runClaudeAgentWithCommand).mock.calls[0];
    expect(call[7]).toBe('/state/path');
  });
});
