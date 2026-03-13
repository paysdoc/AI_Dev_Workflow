/**
 * Unit tests for the Validation Agent and Resolution Agent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock runClaudeAgent and extractJson before importing the modules under test
vi.mock('../agents/claudeAgent', () => ({
  runClaudeAgent: vi.fn(),
}));

vi.mock('../core/jsonParser', () => ({
  extractJson: vi.fn(),
}));

vi.mock('../core/config', () => ({
  getModelForCommand: vi.fn().mockReturnValue('opus'),
  getEffortForCommand: vi.fn().mockReturnValue('high'),
}));

import {
  buildValidationPrompt,
  parseValidationResult,
  findScenarioFiles,
  readScenarioContents,
  runValidationAgent,
  type ValidationResult,
  type MismatchItem,
} from '../agents/validationAgent';
import {
  buildResolutionPrompt,
  parseResolutionResult,
  runResolutionAgent,
  type ResolutionResult,
} from '../agents/resolutionAgent';
import { runClaudeAgent } from '../agents/claudeAgent';
import { extractJson } from '../core/jsonParser';

const mockRunClaudeAgent = vi.mocked(runClaudeAgent);
const mockExtractJson = vi.mocked(extractJson);

describe('buildValidationPrompt', () => {
  it('includes plan content, scenario content, and issue context', () => {
    const prompt = buildValidationPrompt('## Plan\nDo X', '## Feature\nGiven X', 'Issue #1');
    expect(prompt).toContain('## Plan\nDo X');
    expect(prompt).toContain('## Feature\nGiven X');
    expect(prompt).toContain('Issue #1');
  });

  it('includes instructions about mismatch types', () => {
    const prompt = buildValidationPrompt('plan', 'scenarios', 'issue');
    expect(prompt).toContain('plan_only');
    expect(prompt).toContain('scenario_only');
    expect(prompt).toContain('conflicting');
  });

  it('specifies JSON output format with aligned field', () => {
    const prompt = buildValidationPrompt('plan', 'scenarios', 'issue');
    expect(prompt).toContain('"aligned"');
    expect(prompt).toContain('"mismatches"');
  });
});

describe('parseValidationResult', () => {
  beforeEach(() => {
    mockExtractJson.mockReset();
  });

  it('parses a valid aligned result', () => {
    const raw = JSON.stringify({ aligned: true, mismatches: [], summary: 'All good' });
    mockExtractJson.mockReturnValue({ aligned: true, mismatches: [], summary: 'All good' });
    const result = parseValidationResult(raw);
    expect(result.aligned).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.summary).toBe('All good');
  });

  it('parses a mismatched result with items', () => {
    const mismatches: MismatchItem[] = [
      { type: 'plan_only', description: 'Missing scenario for X', planReference: 'Section 2' },
    ];
    mockExtractJson.mockReturnValue({ aligned: false, mismatches, summary: 'Found 1 mismatch' });
    const result = parseValidationResult(JSON.stringify({ aligned: false, mismatches, summary: 'Found 1 mismatch' }));
    expect(result.aligned).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].type).toBe('plan_only');
  });

  it('throws when output is not valid JSON', () => {
    mockExtractJson.mockReturnValue(null);
    expect(() => parseValidationResult('not json')).toThrow(/invalid result/i);
  });

  it('throws when aligned field is missing', () => {
    mockExtractJson.mockReturnValue({ mismatches: [], summary: '' } as unknown as ValidationResult);
    expect(() => parseValidationResult('{}')).toThrow(/invalid result/i);
  });

  it('defaults mismatches to empty array when missing', () => {
    mockExtractJson.mockReturnValue({ aligned: true, summary: 'ok' } as unknown as ValidationResult);
    const result = parseValidationResult('{}');
    expect(result.mismatches).toEqual([]);
  });
});

describe('findScenarioFiles', () => {
  it('returns empty array when worktree path does not exist', () => {
    const result = findScenarioFiles(999, '/nonexistent/path');
    expect(result).toEqual([]);
  });
});

describe('readScenarioContents', () => {
  it('returns empty string for empty path list', () => {
    const result = readScenarioContents([]);
    expect(result).toBe('');
  });

  it('handles unreadable files gracefully', () => {
    const result = readScenarioContents(['/nonexistent/file.feature']);
    expect(result).toContain('[Could not read file]');
  });
});

describe('runValidationAgent', () => {
  beforeEach(() => {
    mockRunClaudeAgent.mockReset();
    mockExtractJson.mockReset();
  });

  it('calls runClaudeAgent with correct model and effort', async () => {
    const mockResult = {
      success: true,
      output: JSON.stringify({ aligned: true, mismatches: [], summary: 'ok' }),
      totalCostUsd: 0.5,
    };
    mockRunClaudeAgent.mockResolvedValue(mockResult as ReturnType<typeof runClaudeAgent> extends Promise<infer T> ? T : never);
    mockExtractJson.mockReturnValue({ aligned: true, mismatches: [], summary: 'ok' });

    await runValidationAgent('plan content', 'scenario content', 'issue context', '/logs', '/state', '/cwd');

    expect(mockRunClaudeAgent).toHaveBeenCalledWith(
      expect.stringContaining('plan content'),
      'validation-agent',
      expect.stringContaining('validation-agent.jsonl'),
      'opus',
      'high',
      undefined,
      '/state',
      '/cwd',
    );
  });

  it('returns validationResult with aligned=true', async () => {
    const mockOutput = { aligned: true, mismatches: [], summary: 'All aligned' };
    mockRunClaudeAgent.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 0.1 } as Awaited<ReturnType<typeof runClaudeAgent>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runValidationAgent('plan', 'scenarios', 'issue', '/logs');
    expect(result.validationResult.aligned).toBe(true);
    expect(result.success).toBe(true);
  });

  it('returns validationResult with mismatches when not aligned', async () => {
    const mismatches: MismatchItem[] = [{ type: 'scenario_only', description: 'Extra scenario' }];
    const mockOutput = { aligned: false, mismatches, summary: '1 mismatch' };
    mockRunClaudeAgent.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 0.2 } as Awaited<ReturnType<typeof runClaudeAgent>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runValidationAgent('plan', 'scenarios', 'issue', '/logs');
    expect(result.validationResult.aligned).toBe(false);
    expect(result.validationResult.mismatches).toHaveLength(1);
  });

  it('propagates the agent cost', async () => {
    const mockOutput = { aligned: true, mismatches: [], summary: '' };
    mockRunClaudeAgent.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 1.23 } as Awaited<ReturnType<typeof runClaudeAgent>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runValidationAgent('plan', 'scenarios', 'issue', '/logs');
    expect(result.totalCostUsd).toBe(1.23);
  });
});

describe('buildResolutionPrompt', () => {
  it('includes the GitHub issue body as the source of truth', () => {
    const prompt = buildResolutionPrompt('issue body', 'plan', 'scenarios', []);
    expect(prompt).toContain('issue body');
    expect(prompt).toContain('SOLE ARBITER OF TRUTH');
  });

  it('formats each mismatch in the prompt', () => {
    const mismatches: MismatchItem[] = [
      { type: 'plan_only', description: 'Mismatch A', planReference: 'Section 1' },
    ];
    const prompt = buildResolutionPrompt('issue', 'plan', 'scenarios', mismatches);
    expect(prompt).toContain('Mismatch A');
    expect(prompt).toContain('plan_only');
    expect(prompt).toContain('Section 1');
  });

  it('specifies JSON output format with decision field', () => {
    const prompt = buildResolutionPrompt('issue', 'plan', 'scenarios', []);
    expect(prompt).toContain('"decision"');
    expect(prompt).toContain('"reasoning"');
  });
});

describe('parseResolutionResult', () => {
  beforeEach(() => {
    mockExtractJson.mockReset();
  });

  it('parses a valid resolution result', () => {
    const raw: ResolutionResult = {
      updatedPlan: '# Updated plan',
      reasoning: 'Issue said X',
      decision: 'plan_updated',
    };
    mockExtractJson.mockReturnValue(raw);
    const result = parseResolutionResult(JSON.stringify(raw));
    expect(result.decision).toBe('plan_updated');
    expect(result.reasoning).toBe('Issue said X');
    expect(result.updatedPlan).toBe('# Updated plan');
  });

  it('parses a result with updated scenarios', () => {
    const raw: ResolutionResult = {
      updatedScenarios: [{ path: '/a.feature', content: 'Feature: ...' }],
      reasoning: 'Scenario updated',
      decision: 'scenarios_updated',
    };
    mockExtractJson.mockReturnValue(raw);
    const result = parseResolutionResult(JSON.stringify(raw));
    expect(result.updatedScenarios).toHaveLength(1);
    expect(result.decision).toBe('scenarios_updated');
  });

  it('throws when output is not valid JSON', () => {
    mockExtractJson.mockReturnValue(null);
    expect(() => parseResolutionResult('bad output')).toThrow(/invalid result/i);
  });

  it('throws when reasoning or decision are missing', () => {
    mockExtractJson.mockReturnValue({ updatedPlan: 'x' } as unknown as ResolutionResult);
    expect(() => parseResolutionResult('{}')).toThrow(/invalid result/i);
  });

  it('defaults updatedScenarios to undefined when not an array', () => {
    mockExtractJson.mockReturnValue({ reasoning: 'ok', decision: 'plan_updated' } as ResolutionResult);
    const result = parseResolutionResult('{}');
    expect(result.updatedScenarios).toBeUndefined();
  });
});

describe('runResolutionAgent', () => {
  beforeEach(() => {
    mockRunClaudeAgent.mockReset();
    mockExtractJson.mockReset();
  });

  it('calls runClaudeAgent with correct model and effort', async () => {
    const mockOutput: ResolutionResult = { reasoning: 'ok', decision: 'plan_updated' };
    mockRunClaudeAgent.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 0.8 } as Awaited<ReturnType<typeof runClaudeAgent>>);
    mockExtractJson.mockReturnValue(mockOutput);

    await runResolutionAgent('issue body', 'plan', 'scenarios', [], '/logs', '/state', '/cwd');

    expect(mockRunClaudeAgent).toHaveBeenCalledWith(
      expect.stringContaining('issue body'),
      'resolution-agent',
      expect.stringContaining('resolution-agent.jsonl'),
      'opus',
      'high',
      undefined,
      '/state',
      '/cwd',
    );
  });

  it('returns resolutionResult with decision', async () => {
    const mockOutput: ResolutionResult = { reasoning: 'Updated plan to match issue', decision: 'plan_updated', updatedPlan: '# New plan' };
    mockRunClaudeAgent.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 0.9 } as Awaited<ReturnType<typeof runClaudeAgent>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runResolutionAgent('issue', 'plan', 'scenarios', [], '/logs');
    expect(result.resolutionResult.decision).toBe('plan_updated');
    expect(result.resolutionResult.updatedPlan).toBe('# New plan');
    expect(result.success).toBe(true);
  });

  it('propagates the agent cost', async () => {
    const mockOutput: ResolutionResult = { reasoning: 'done', decision: 'both_updated' };
    mockRunClaudeAgent.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 2.5 } as Awaited<ReturnType<typeof runClaudeAgent>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runResolutionAgent('issue', 'plan', 'scenarios', [], '/logs');
    expect(result.totalCostUsd).toBe(2.5);
  });
});
