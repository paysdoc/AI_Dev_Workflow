import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommitAgent } from '../gitAgent';

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
