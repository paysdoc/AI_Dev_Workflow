import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseResolutionResult,
  runResolutionAgent,
} from '../resolutionAgent';
import type { MismatchItem } from '../validationAgent';

vi.mock('../claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({
    success: true,
    output: JSON.stringify({
      resolved: true,
      decisions: [{ mismatch: 'Plan updated', action: 'updated_plan', reasoning: 'Updated plan to match issue' }],
    }),
    totalCostUsd: 0.8,
    modelUsage: {},
  }),
}));

vi.mock('../../core/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/config')>();
  return {
    ...actual,
    getModelForCommand: vi.fn().mockReturnValue('opus'),
    getEffortForCommand: vi.fn().mockReturnValue('high'),
  };
});

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
  };
});

import { runClaudeAgentWithCommand } from '../claudeAgent';

const mockMismatches: MismatchItem[] = [
  { type: 'plan_only', description: 'Missing login scenario', planReference: 'Section 2.1' },
  { type: 'scenario_only', description: 'Extra signup scenario', scenarioReference: 'Scenario: User signup' },
];

describe('parseResolutionResult', () => {
  it('parses a valid resolved result with decisions', () => {
    const output = JSON.stringify({
      resolved: true,
      decisions: [{ mismatch: 'Login flow', action: 'updated_plan', reasoning: 'Plan updated to match issue' }],
    });

    const result = parseResolutionResult(output);

    expect(result.resolved).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].action).toBe('updated_plan');
    expect(result.decisions[0].reasoning).toBe('Plan updated to match issue');
  });

  it('parses a result with multiple decisions', () => {
    const output = JSON.stringify({
      resolved: false,
      decisions: [
        { mismatch: 'Login flow', action: 'updated_plan', reasoning: 'Updated plan' },
        { mismatch: 'Signup flow', action: 'updated_scenarios', reasoning: 'Updated scenarios' },
      ],
    });

    const result = parseResolutionResult(output);

    expect(result.resolved).toBe(false);
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions[1].action).toBe('updated_scenarios');
  });

  it('parses a result with updated_both action', () => {
    const output = JSON.stringify({
      resolved: true,
      decisions: [{ mismatch: 'Auth flow', action: 'updated_both', reasoning: 'Both artifacts updated' }],
    });

    const result = parseResolutionResult(output);

    expect(result.decisions[0].action).toBe('updated_both');
  });

  it('handles JSON embedded in text output', () => {
    const json = JSON.stringify({ resolved: true, decisions: [] });
    const output = `Here is my analysis:\n${json}\nEnd.`;

    const result = parseResolutionResult(output);

    expect(result.resolved).toBe(true);
  });

  it('defaults decisions to empty array if field is missing', () => {
    const output = JSON.stringify({ resolved: true });

    const result = parseResolutionResult(output);

    expect(result.decisions).toEqual([]);
  });

  it('throws on malformed JSON output', () => {
    expect(() => parseResolutionResult('not valid json')).toThrow();
  });

  it('throws when resolved field is missing', () => {
    expect(() => parseResolutionResult('{"decisions": []}')).toThrow();
  });
});

describe('runResolutionAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runClaudeAgentWithCommand).mockResolvedValue({
      success: true,
      output: JSON.stringify({
        resolved: true,
        decisions: [{ mismatch: 'Plan updated', action: 'updated_plan', reasoning: 'Updated plan to match issue' }],
      }),
      totalCostUsd: 0.8,
      modelUsage: {},
    });
  });

  it('calls runClaudeAgentWithCommand with /resolve_plan_scenarios', async () => {
    await runResolutionAgent(
      'adw123',
      42,
      '/path/to/plan.md',
      '/worktree',
      '{"number":42,"body":"issue body"}',
      mockMismatches,
      '/logs',
    );

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/resolve_plan_scenarios',
      expect.arrayContaining(['adw123', '42', '/path/to/plan.md', '/worktree']),
      'resolution-agent',
      expect.any(String),
      'opus',
      'high',
      undefined,
      undefined,
      undefined,
    );
  });

  it('passes issueJson and mismatches in args', async () => {
    const issueJson = '{"number":42,"body":"issue body"}';
    await runResolutionAgent('adw123', 42, '/path/to/plan.md', '/worktree', issueJson, mockMismatches, '/logs');

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/resolve_plan_scenarios',
      expect.arrayContaining([issueJson, JSON.stringify(mockMismatches)]),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      undefined,
      undefined,
      undefined,
    );
  });

  it('returns resolutionResult with resolved and decisions', async () => {
    const result = await runResolutionAgent(
      'adw123',
      42,
      '/path/to/plan.md',
      '/worktree',
      '{"number":42}',
      mockMismatches,
      '/logs',
    );

    expect(result.resolutionResult.resolved).toBe(true);
    expect(result.resolutionResult.decisions).toHaveLength(1);
    expect(result.totalCostUsd).toBe(0.8);
  });

  it('forwards statePath and cwd to runClaudeAgentWithCommand', async () => {
    await runResolutionAgent(
      'adw123',
      42,
      '/path/to/plan.md',
      '/worktree',
      '{"number":42}',
      mockMismatches,
      '/logs',
      '/mock/state',
      '/mock/cwd',
    );

    expect(runClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/resolve_plan_scenarios',
      expect.any(Array),
      'resolution-agent',
      expect.any(String),
      'opus',
      'high',
      undefined,
      '/mock/state',
      '/mock/cwd',
    );
  });
});
