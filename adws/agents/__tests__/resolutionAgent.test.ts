import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildResolutionPrompt,
  parseResolutionResult,
  runResolutionAgent,
} from '../resolutionAgent';
import type { MismatchItem } from '../validationAgent';

vi.mock('../claudeAgent', () => ({
  runClaudeAgent: vi.fn().mockResolvedValue({
    success: true,
    output: JSON.stringify({
      reasoning: 'Updated plan to match issue',
      decision: 'plan_updated',
      updatedPlan: '# Updated Plan',
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

import { runClaudeAgent } from '../claudeAgent';

const mockMismatches: MismatchItem[] = [
  { type: 'plan_only', description: 'Missing login scenario', planReference: 'Section 2.1' },
  { type: 'scenario_only', description: 'Extra signup scenario', scenarioReference: 'Scenario: User signup' },
];

describe('buildResolutionPrompt', () => {
  it('includes the issue body prominently as the source of truth', () => {
    const prompt = buildResolutionPrompt(
      'The login feature should support MFA',
      '# Plan',
      '# Scenarios',
      mockMismatches,
    );

    expect(prompt).toContain('The login feature should support MFA');
    expect(prompt).toContain('SOURCE OF TRUTH');
  });

  it('labels the issue as the sole arbiter of truth', () => {
    const prompt = buildResolutionPrompt('issue body', '# Plan', '# Scenarios', mockMismatches);

    expect(prompt).toContain('SOLE ARBITER OF TRUTH');
  });

  it('includes all identified mismatches', () => {
    const prompt = buildResolutionPrompt('issue body', '# Plan', '# Scenarios', mockMismatches);

    expect(prompt).toContain('Missing login scenario');
    expect(prompt).toContain('Extra signup scenario');
    expect(prompt).toContain('plan_only');
    expect(prompt).toContain('scenario_only');
  });

  it('includes mismatch plan and scenario references', () => {
    const prompt = buildResolutionPrompt('issue body', '# Plan', '# Scenarios', mockMismatches);

    expect(prompt).toContain('Section 2.1');
    expect(prompt).toContain('User signup');
  });

  it('includes plan and scenario content', () => {
    const prompt = buildResolutionPrompt('issue body', '# The Plan', '# The Scenarios', mockMismatches);

    expect(prompt).toContain('# The Plan');
    expect(prompt).toContain('# The Scenarios');
  });

  it('instructs agent to output JSON with required fields', () => {
    const prompt = buildResolutionPrompt('issue body', '# Plan', '# Scenarios', mockMismatches);

    expect(prompt).toContain('"reasoning"');
    expect(prompt).toContain('"decision"');
    expect(prompt).toContain('"updatedPlan"');
  });
});

describe('parseResolutionResult', () => {
  it('parses a valid plan_updated result', () => {
    const output = JSON.stringify({
      updatedPlan: '# Updated Plan',
      reasoning: 'Changed plan to match issue',
      decision: 'plan_updated',
    });

    const result = parseResolutionResult(output);

    expect(result.updatedPlan).toBe('# Updated Plan');
    expect(result.reasoning).toBe('Changed plan to match issue');
    expect(result.decision).toBe('plan_updated');
  });

  it('parses a valid scenarios_updated result', () => {
    const output = JSON.stringify({
      updatedScenarios: [{ path: '/features/login.feature', content: 'Feature: Login' }],
      reasoning: 'Added missing scenario',
      decision: 'scenarios_updated',
    });

    const result = parseResolutionResult(output);

    expect(result.updatedScenarios).toHaveLength(1);
    expect(result.updatedScenarios![0].path).toBe('/features/login.feature');
    expect(result.decision).toBe('scenarios_updated');
  });

  it('parses a valid both_updated result', () => {
    const output = JSON.stringify({
      updatedPlan: '# New Plan',
      updatedScenarios: [{ path: '/f.feature', content: 'Feature: X' }],
      reasoning: 'Both needed updating',
      decision: 'both_updated',
    });

    const result = parseResolutionResult(output);

    expect(result.updatedPlan).toBe('# New Plan');
    expect(result.updatedScenarios).toHaveLength(1);
    expect(result.decision).toBe('both_updated');
  });

  it('handles JSON embedded in text output', () => {
    const json = JSON.stringify({ reasoning: 'Updated', decision: 'plan_updated' });
    const output = `Here is my analysis:\n${json}\nEnd.`;

    const result = parseResolutionResult(output);

    expect(result.reasoning).toBe('Updated');
  });

  it('throws on malformed JSON output', () => {
    expect(() => parseResolutionResult('not valid json')).toThrow();
  });

  it('throws when required fields are missing', () => {
    expect(() => parseResolutionResult('{"updatedPlan": "x"}')).toThrow();
  });

  it('sets updatedScenarios to undefined when field is missing', () => {
    const output = JSON.stringify({ reasoning: 'Updated plan', decision: 'plan_updated' });

    const result = parseResolutionResult(output);

    expect(result.updatedScenarios).toBeUndefined();
  });
});

describe('runResolutionAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runClaudeAgent).mockResolvedValue({
      success: true,
      output: JSON.stringify({
        updatedPlan: '# Updated Plan',
        reasoning: 'Updated plan to match issue',
        decision: 'plan_updated',
      }),
      totalCostUsd: 0.8,
      modelUsage: {},
    });
  });

  it('calls runClaudeAgent with a prompt containing the issue body', async () => {
    await runResolutionAgent(
      'The issue body with requirements',
      '# Plan',
      '# Scenarios',
      mockMismatches,
      '/logs',
    );

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.stringContaining('The issue body with requirements'),
      'resolution-agent',
      expect.any(String),
      'opus',
      'high',
      undefined,
      undefined,
      undefined,
    );
  });

  it('returns resolutionResult with updatedPlan', async () => {
    const result = await runResolutionAgent('issue body', '# Plan', '# Scenarios', mockMismatches, '/logs');

    expect(result.resolutionResult.updatedPlan).toBe('# Updated Plan');
    expect(result.resolutionResult.decision).toBe('plan_updated');
    expect(result.totalCostUsd).toBe(0.8);
  });

  it('forwards statePath and cwd to runClaudeAgent', async () => {
    await runResolutionAgent(
      'issue body',
      '# Plan',
      '# Scenarios',
      mockMismatches,
      '/logs',
      '/mock/state',
      '/mock/cwd',
    );

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.any(String),
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
