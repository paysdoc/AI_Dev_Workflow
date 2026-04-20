import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommitAgent, runGenerateBranchNameAgent, extractSlugFromOutput } from '../gitAgent';

// Mock all imports that gitAgent depends on to avoid filesystem/network side effects
vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
  getModelForCommand: vi.fn(() => 'sonnet'),
  getEffortForCommand: vi.fn(() => undefined),
  commitPrefixMap: {
    '/feature': 'feat:',
    '/bug': 'fix:',
    '/chore': 'chore:',
  },
  branchPrefixMap: {
    '/feature': 'feature',
    '/bug': 'bugfix',
    '/chore': 'chore',
    '/pr_review': 'review',
    '/adw_init': 'adwinit',
  },
  branchPrefixAliases: {
    '/feature': ['feat'],
    '/bug': ['bug'],
    '/chore': [],
    '/pr_review': ['test'],
    '/adw_init': ['adwinit'],
  },
}));

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    join: vi.fn((...parts: string[]) => parts.join('/')),
  };
});

import { runClaudeAgentWithCommand } from '../claudeAgent';
const mockRunAgent = vi.mocked(runClaudeAgentWithCommand);

beforeEach(() => {
  mockRunAgent.mockReset();
});

const baseAgentResult = {
  sessionId: 'test-session',
  totalCostUsd: 0.01,
  modelUsage: {},
};

describe('runCommitAgent — result.success guard', () => {
  it('throws when agent returns success=false', async () => {
    mockRunAgent.mockResolvedValueOnce({
      success: false,
      output: 'spawn /Users/martin/.local/bin/claude ENOENT',
      ...baseAgentResult,
    });

    await expect(runCommitAgent('build-agent', '/feature', '{}', '/tmp/logs'))
      .rejects.toThrow("Commit agent 'build-agent' failed:");
  });

  it('includes agent name in the thrown error', async () => {
    mockRunAgent.mockResolvedValueOnce({
      success: false,
      output: 'spawn claude ENOENT',
      ...baseAgentResult,
    });

    await expect(runCommitAgent('review-agent', '/bug', '{}', '/tmp/logs'))
      .rejects.toThrow('review-agent');
  });

  it('truncates long output in the thrown error to 200 chars', async () => {
    const longOutput = 'spawn claude ENOENT ' + 'x'.repeat(300);
    mockRunAgent.mockResolvedValueOnce({
      success: false,
      output: longOutput,
      ...baseAgentResult,
    });

    let thrownError: Error | undefined;
    try {
      await runCommitAgent('build-agent', '/feature', '{}', '/tmp/logs');
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).toBeDefined();
    // The error message should be bounded — not contain 300+ x chars verbatim
    expect(thrownError!.message.length).toBeLessThan(300);
  });

  it('does not throw and returns commitMessage when agent returns success=true', async () => {
    mockRunAgent.mockResolvedValueOnce({
      success: true,
      output: 'build-agent: feat: add NON_RETRYABLE_PATTERNS to execWithRetry',
      ...baseAgentResult,
    });

    const result = await runCommitAgent('build-agent', '/feature', '{}', '/tmp/logs');
    expect(result.commitMessage).toContain('build-agent: feat:');
    expect(result.success).toBe(true);
  });

  it('does not commit garbage when output looks like an error but success=false', async () => {
    // An output that superficially resembles a commit message but is actually an error string
    mockRunAgent.mockResolvedValueOnce({
      success: false,
      output: 'review-agent: feat: spawn /Users/martin/.local/bin/claude ENOENT',
      ...baseAgentResult,
    });

    await expect(runCommitAgent('review-agent', '/feature', '{}', '/tmp/logs'))
      .rejects.toThrow();
  });
});

const mockIssue = {
  number: 42,
  title: 'Test issue',
  body: 'Test body',
  state: 'OPEN',
  author: { login: 'test' },
  labels: [],
  comments: [],
  createdAt: '2026-01-01T00:00:00Z',
} as never;

describe('extractSlugFromOutput', () => {
  it('extracts a clean slug from plain output', () => {
    expect(extractSlugFromOutput('add-user-auth')).toBe('add-user-auth');
  });

  it('strips trailing whitespace and newlines', () => {
    expect(extractSlugFromOutput('  fix-login-error  \n')).toBe('fix-login-error');
  });

  it('strips backtick wrappers', () => {
    expect(extractSlugFromOutput('`update-deps`')).toBe('update-deps');
  });

  it('uses the last non-empty line', () => {
    expect(extractSlugFromOutput('some preamble\nadd-user-auth')).toBe('add-user-auth');
  });

  it('throws when the output is empty', () => {
    expect(() => extractSlugFromOutput('')).toThrow();
  });

  it('throws when slug contains forbidden characters', () => {
    expect(() => extractSlugFromOutput('Add User Auth')).toThrow();
  });
});

describe('runGenerateBranchNameAgent — slug-only contract', () => {
  it('assembles full branch name from a plain slug returned by the LLM', async () => {
    mockRunAgent.mockResolvedValueOnce({
      success: true,
      output: 'add-user-auth',
      ...baseAgentResult,
    });

    const result = await runGenerateBranchNameAgent('/feature', mockIssue, '/tmp/logs');
    expect(result.branchName).toBe('feature-issue-42-add-user-auth');
  });

  it('rejects a drifted prefixed slug from the LLM', async () => {
    mockRunAgent.mockResolvedValueOnce({
      success: true,
      output: 'feature-issue-42-add-user-auth',
      ...baseAgentResult,
    });

    await expect(
      runGenerateBranchNameAgent('/feature', mockIssue, '/tmp/logs')
    ).rejects.toThrow();
  });

  it('rejects a slug with forbidden characters', async () => {
    mockRunAgent.mockResolvedValueOnce({
      success: true,
      output: 'Add User Auth',
      ...baseAgentResult,
    });

    await expect(
      runGenerateBranchNameAgent('/feature', mockIssue, '/tmp/logs')
    ).rejects.toThrow();
  });

  it('rejects an empty slug', async () => {
    mockRunAgent.mockResolvedValueOnce({
      success: true,
      output: '',
      ...baseAgentResult,
    });

    await expect(
      runGenerateBranchNameAgent('/feature', mockIssue, '/tmp/logs')
    ).rejects.toThrow();
  });

  it('assembles bugfix branch from a bug issue', async () => {
    mockRunAgent.mockResolvedValueOnce({
      success: true,
      output: 'fix-login-error',
      ...baseAgentResult,
    });

    const result = await runGenerateBranchNameAgent('/bug', mockIssue, '/tmp/logs');
    expect(result.branchName).toBe('bugfix-issue-42-fix-login-error');
  });
});
