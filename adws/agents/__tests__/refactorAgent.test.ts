import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runRefactorAgent } from '../refactorAgent';

vi.mock('../claudeAgent', async () => {
  const { AuthRequiredError: ARE, RateLimitError: RLE } = await import('../../types/agentTypes');
  return {
    runClaudeAgentWithCommand: vi.fn(),
    AuthRequiredError: ARE,
    RateLimitError: RLE,
  };
});

vi.mock('../../core', () => ({
  log: vi.fn(),
  getModelForCommand: vi.fn(() => 'sonnet'),
  getEffortForCommand: vi.fn(() => 'high'),
}));

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    join: vi.fn((...parts: string[]) => parts.join('/')),
  };
});

import { runClaudeAgentWithCommand } from '../claudeAgent';
import { getModelForCommand, getEffortForCommand } from '../../core';
const mockRunAgent = vi.mocked(runClaudeAgentWithCommand);
const mockGetModel = vi.mocked(getModelForCommand);
const mockGetEffort = vi.mocked(getEffortForCommand);

const baseAgentResult = {
  success: true,
  output: 'Refactor complete.',
  sessionId: 'test-session',
  totalCostUsd: 0.02,
  modelUsage: {},
};

const refactorBlocker = {
  reviewIssueNumber: 1,
  issueDescription: 'adws/agents/reviewAgent.ts: violates nesting-depth rule\nadws/phases/reviewPhase.ts: violates nesting-depth rule',
  issueResolution: 'Run /refactor on the listed files',
  issueSeverity: 'blocker' as const,
  remediationStrategy: 'refactor' as const,
};

beforeEach(() => {
  mockRunAgent.mockReset();
  mockRunAgent.mockResolvedValue(baseAgentResult);
  mockGetModel.mockReturnValue('sonnet');
  mockGetEffort.mockReturnValue('high');
});

describe('runRefactorAgent — slash command routing', () => {
  it('invokes runClaudeAgentWithCommand with /refactor as the command', async () => {
    await runRefactorAgent('test-adw', refactorBlocker, '/tmp/logs');
    expect(mockRunAgent).toHaveBeenCalled();
    const [command] = mockRunAgent.mock.calls[0]!;
    expect(command).toBe('/refactor');
  });

  it('passes issueDescription as the args string', async () => {
    await runRefactorAgent('test-adw', refactorBlocker, '/tmp/logs');
    const [, args] = mockRunAgent.mock.calls[0]!;
    expect(Array.isArray(args)).toBe(true);
    const argsStr = (args as string[]).join(' ');
    expect(argsStr).toContain(refactorBlocker.issueDescription);
  });

  it('uses refactor-agent.jsonl as the output file name', async () => {
    await runRefactorAgent('test-adw', refactorBlocker, '/tmp/logs');
    const [, , , outputFile] = mockRunAgent.mock.calls[0]!;
    expect(String(outputFile)).toContain('refactor-agent.jsonl');
  });

  it('looks up model via getModelForCommand(/refactor)', async () => {
    await runRefactorAgent('test-adw', refactorBlocker, '/tmp/logs');
    expect(mockGetModel).toHaveBeenCalled();
    const [[firstArg]] = mockGetModel.mock.calls;
    expect(firstArg).toBe('/refactor');
    const [, , , , model] = mockRunAgent.mock.calls[0]!;
    expect(model).toBe('sonnet');
  });

  it('looks up effort via getEffortForCommand(/refactor)', async () => {
    await runRefactorAgent('test-adw', refactorBlocker, '/tmp/logs');
    expect(mockGetEffort).toHaveBeenCalled();
    const [[firstArg]] = mockGetEffort.mock.calls;
    expect(firstArg).toBe('/refactor');
    const [, , , , , effort] = mockRunAgent.mock.calls[0]!;
    expect(effort).toBe('high');
  });

  it('returns the AgentResult from runClaudeAgentWithCommand', async () => {
    const result = await runRefactorAgent('test-adw', refactorBlocker, '/tmp/logs');
    expect(result).toEqual(baseAgentResult);
  });
});
