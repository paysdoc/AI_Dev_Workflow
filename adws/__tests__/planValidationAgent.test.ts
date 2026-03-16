/**
 * Unit tests for the Validation Agent and Resolution Agent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock runClaudeAgentWithCommand and extractJson before importing the modules under test
vi.mock('../agents/claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn(),
}));

vi.mock('../core/jsonParser', () => ({
  extractJson: vi.fn(),
}));

vi.mock('../core/config', () => ({
  getModelForCommand: vi.fn().mockReturnValue('opus'),
  getEffortForCommand: vi.fn().mockReturnValue('high'),
}));

import {
  parseValidationResult,
  findScenarioFiles,
  readScenarioContents,
  runValidationAgent,
  type ValidationResult,
  type MismatchItem,
} from '../agents/validationAgent';
import {
  parseResolutionResult,
  runResolutionAgent,
  type ResolutionResult,
} from '../agents/resolutionAgent';
import { runClaudeAgentWithCommand } from '../agents/claudeAgent';
import { extractJson } from '../core/jsonParser';

const mockRunClaudeAgentWithCommand = vi.mocked(runClaudeAgentWithCommand);
const mockExtractJson = vi.mocked(extractJson);

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
    mockRunClaudeAgentWithCommand.mockReset();
    mockExtractJson.mockReset();
  });

  it('calls runClaudeAgentWithCommand with /validate_plan_scenarios, correct model and effort', async () => {
    const mockOutput = { aligned: true, mismatches: [], summary: 'ok' };
    mockRunClaudeAgentWithCommand.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 0.5 } as Awaited<ReturnType<typeof runClaudeAgentWithCommand>>);
    mockExtractJson.mockReturnValue(mockOutput);

    await runValidationAgent('adw123', 42, '/path/to/plan.md', '/worktree', '/logs', '/state', '/cwd');

    expect(mockRunClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/validate_plan_scenarios',
      expect.arrayContaining(['adw123', '42', '/path/to/plan.md', '/worktree']),
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
    mockRunClaudeAgentWithCommand.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 0.1 } as Awaited<ReturnType<typeof runClaudeAgentWithCommand>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runValidationAgent('adw123', 42, '/path/to/plan.md', '/worktree', '/logs');
    expect(result.validationResult.aligned).toBe(true);
    expect(result.success).toBe(true);
  });

  it('returns validationResult with mismatches when not aligned', async () => {
    const mismatches: MismatchItem[] = [{ type: 'scenario_only', description: 'Extra scenario' }];
    const mockOutput = { aligned: false, mismatches, summary: '1 mismatch' };
    mockRunClaudeAgentWithCommand.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 0.2 } as Awaited<ReturnType<typeof runClaudeAgentWithCommand>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runValidationAgent('adw123', 42, '/path/to/plan.md', '/worktree', '/logs');
    expect(result.validationResult.aligned).toBe(false);
    expect(result.validationResult.mismatches).toHaveLength(1);
  });

  it('propagates the agent cost', async () => {
    const mockOutput = { aligned: true, mismatches: [], summary: '' };
    mockRunClaudeAgentWithCommand.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 1.23 } as Awaited<ReturnType<typeof runClaudeAgentWithCommand>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runValidationAgent('adw123', 42, '/path/to/plan.md', '/worktree', '/logs');
    expect(result.totalCostUsd).toBe(1.23);
  });
});

describe('parseResolutionResult', () => {
  beforeEach(() => {
    mockExtractJson.mockReset();
  });

  it('parses a valid resolved result with decisions', () => {
    const raw: ResolutionResult = {
      resolved: true,
      decisions: [{ mismatch: 'Login flow', action: 'updated_plan', reasoning: 'Plan updated to match issue' }],
    };
    mockExtractJson.mockReturnValue(raw);
    const result = parseResolutionResult(JSON.stringify(raw));
    expect(result.resolved).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].action).toBe('updated_plan');
  });

  it('parses a result with multiple decisions', () => {
    const raw: ResolutionResult = {
      resolved: false,
      decisions: [
        { mismatch: 'Login flow', action: 'updated_plan', reasoning: 'Updated plan' },
        { mismatch: 'Signup flow', action: 'updated_scenarios', reasoning: 'Updated scenarios' },
      ],
    };
    mockExtractJson.mockReturnValue(raw);
    const result = parseResolutionResult(JSON.stringify(raw));
    expect(result.resolved).toBe(false);
    expect(result.decisions).toHaveLength(2);
  });

  it('throws when output is not valid JSON', () => {
    mockExtractJson.mockReturnValue(null);
    expect(() => parseResolutionResult('bad output')).toThrow(/invalid result/i);
  });

  it('throws when resolved field is missing', () => {
    mockExtractJson.mockReturnValue({ decisions: [] } as unknown as ResolutionResult);
    expect(() => parseResolutionResult('{}')).toThrow(/invalid result/i);
  });

  it('defaults decisions to empty array when missing', () => {
    mockExtractJson.mockReturnValue({ resolved: true } as unknown as ResolutionResult);
    const result = parseResolutionResult('{}');
    expect(result.decisions).toEqual([]);
  });
});

describe('runResolutionAgent', () => {
  beforeEach(() => {
    mockRunClaudeAgentWithCommand.mockReset();
    mockExtractJson.mockReset();
  });

  it('calls runClaudeAgentWithCommand with /resolve_plan_scenarios, correct model and effort', async () => {
    const mockOutput: ResolutionResult = { resolved: true, decisions: [] };
    mockRunClaudeAgentWithCommand.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 0.8 } as Awaited<ReturnType<typeof runClaudeAgentWithCommand>>);
    mockExtractJson.mockReturnValue(mockOutput);

    await runResolutionAgent('adw123', 42, '/path/to/plan.md', '/worktree', '{"number":42}', [], '/logs', '/state', '/cwd');

    expect(mockRunClaudeAgentWithCommand).toHaveBeenCalledWith(
      '/resolve_plan_scenarios',
      expect.arrayContaining(['adw123', '42', '/path/to/plan.md', '/worktree']),
      'resolution-agent',
      expect.stringContaining('resolution-agent.jsonl'),
      'opus',
      'high',
      undefined,
      '/state',
      '/cwd',
    );
  });

  it('returns resolutionResult with resolved and decisions', async () => {
    const mockOutput: ResolutionResult = {
      resolved: true,
      decisions: [{ mismatch: 'Login flow', action: 'updated_plan', reasoning: 'Plan updated to match issue' }],
    };
    mockRunClaudeAgentWithCommand.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 0.9 } as Awaited<ReturnType<typeof runClaudeAgentWithCommand>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runResolutionAgent('adw123', 42, '/path/to/plan.md', '/worktree', '{"number":42}', [], '/logs');
    expect(result.resolutionResult.resolved).toBe(true);
    expect(result.resolutionResult.decisions).toHaveLength(1);
    expect(result.success).toBe(true);
  });

  it('propagates the agent cost', async () => {
    const mockOutput: ResolutionResult = { resolved: true, decisions: [] };
    mockRunClaudeAgentWithCommand.mockResolvedValue({ success: true, output: JSON.stringify(mockOutput), totalCostUsd: 2.5 } as Awaited<ReturnType<typeof runClaudeAgentWithCommand>>);
    mockExtractJson.mockReturnValue(mockOutput);

    const result = await runResolutionAgent('adw123', 42, '/path/to/plan.md', '/worktree', '{"number":42}', [], '/logs');
    expect(result.totalCostUsd).toBe(2.5);
  });
});
