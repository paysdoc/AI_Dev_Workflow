import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import {
  findScenarioFiles,
  readScenarioContents,
  buildValidationPrompt,
  parseValidationResult,
  runValidationAgent,
  type ValidationResult,
  type MismatchItem,
} from '../validationAgent';

vi.mock('fs');

vi.mock('../claudeAgent', () => ({
  runClaudeAgent: vi.fn().mockResolvedValue({
    success: true,
    output: '{"aligned": true, "mismatches": [], "summary": "Aligned"}',
    totalCostUsd: 0.5,
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

describe('findScenarioFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns files that contain the issue tag', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'login.feature', isDirectory: () => false, isFile: () => true } as any,
      { name: 'signup.feature', isDirectory: () => false, isFile: () => true } as any,
    ]);
    vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
      if (String(p).includes('login')) return '@adw-42\nFeature: Login' as any;
      return 'Feature: Signup' as any;
    });

    const result = findScenarioFiles(42, '/mock/worktree');

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('login.feature');
  });

  it('returns empty array when no files match the tag', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'other.feature', isDirectory: () => false, isFile: () => true } as any,
    ]);
    vi.mocked(fs.readFileSync).mockReturnValue('Feature: Other\n  @adw-99' as any);

    const result = findScenarioFiles(42, '/mock/worktree');

    expect(result).toHaveLength(0);
  });

  it('skips directories named node_modules and .git', () => {
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      if (String(dir) === '/mock/worktree') {
        return [
          { name: 'node_modules', isDirectory: () => true, isFile: () => false } as any,
          { name: '.git', isDirectory: () => true, isFile: () => false } as any,
        ];
      }
      return [] as any;
    });

    const result = findScenarioFiles(42, '/mock/worktree');

    expect(result).toHaveLength(0);
  });

  it('returns empty array when directory does not exist', () => {
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = findScenarioFiles(42, '/nonexistent');

    expect(result).toHaveLength(0);
  });
});

describe('readScenarioContents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns concatenated content of scenario files', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('Feature: Login' as any);

    const result = readScenarioContents(['/mock/features/login.feature']);

    expect(result).toContain('Feature: Login');
    expect(result).toContain('login.feature');
  });

  it('handles unreadable files gracefully', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = readScenarioContents(['/mock/features/missing.feature']);

    expect(result).toContain('missing.feature');
    expect(result).toContain('[Could not read file]');
  });
});

describe('buildValidationPrompt', () => {
  it('includes plan content in the prompt', () => {
    const prompt = buildValidationPrompt('# My Plan', '# Scenarios', 'Issue #42');

    expect(prompt).toContain('# My Plan');
  });

  it('includes scenario content in the prompt', () => {
    const prompt = buildValidationPrompt('# Plan', 'Feature: Login', 'Issue #42');

    expect(prompt).toContain('Feature: Login');
  });

  it('includes issue context in the prompt', () => {
    const prompt = buildValidationPrompt('# Plan', '# Scenarios', 'Issue #42: Add login');

    expect(prompt).toContain('Issue #42: Add login');
  });

  it('includes instructions about mismatch types', () => {
    const prompt = buildValidationPrompt('# Plan', '# Scenarios', 'Issue #42');

    expect(prompt).toContain('plan_only');
    expect(prompt).toContain('scenario_only');
    expect(prompt).toContain('conflicting');
  });

  it('instructs agent to output JSON', () => {
    const prompt = buildValidationPrompt('# Plan', '# Scenarios', 'Issue #42');

    expect(prompt).toContain('"aligned"');
    expect(prompt).toContain('"mismatches"');
  });
});

describe('parseValidationResult', () => {
  it('parses valid aligned JSON result', () => {
    const output = JSON.stringify({ aligned: true, mismatches: [], summary: 'All good' });

    const result = parseValidationResult(output);

    expect(result.aligned).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.summary).toBe('All good');
  });

  it('parses valid mismatched JSON result', () => {
    const mismatch: MismatchItem = {
      type: 'plan_only',
      description: 'Missing scenario for X',
      planReference: 'Section 2.1',
    };
    const output = JSON.stringify({ aligned: false, mismatches: [mismatch], summary: 'Mismatch found' });

    const result = parseValidationResult(output);

    expect(result.aligned).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].type).toBe('plan_only');
  });

  it('handles JSON embedded in surrounding text', () => {
    const json = JSON.stringify({ aligned: true, mismatches: [], summary: 'OK' });
    const output = `Here is my analysis:\n\`\`\`json\n${json}\n\`\`\`\nDone.`;

    const result = parseValidationResult(output);

    expect(result.aligned).toBe(true);
  });

  it('throws on malformed JSON output', () => {
    expect(() => parseValidationResult('not json at all')).toThrow();
  });

  it('throws on JSON missing required aligned field', () => {
    expect(() => parseValidationResult('{"mismatches": [], "summary": "ok"}')).toThrow();
  });

  it('defaults mismatches to empty array if field is missing', () => {
    const output = JSON.stringify({ aligned: true, summary: 'OK' });

    const result = parseValidationResult(output);

    expect(result.mismatches).toEqual([]);
  });
});

describe('runValidationAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runClaudeAgent).mockResolvedValue({
      success: true,
      output: '{"aligned": true, "mismatches": [], "summary": "Aligned"}',
      totalCostUsd: 0.5,
      modelUsage: {},
    });
  });

  it('calls runClaudeAgent and returns validation result (aligned)', async () => {
    const result = await runValidationAgent('# Plan', '# Scenarios', 'Issue #42', '/logs');

    expect(runClaudeAgent).toHaveBeenCalledWith(
      expect.stringContaining('# Plan'),
      'validation-agent',
      expect.stringContaining('validation-agent'),
      'opus',
      'high',
      undefined,
      undefined,
      undefined,
    );
    expect(result.validationResult.aligned).toBe(true);
    expect(result.totalCostUsd).toBe(0.5);
  });

  it('returns mismatched validation result when agent reports mismatches', async () => {
    vi.mocked(runClaudeAgent).mockResolvedValue({
      success: true,
      output: JSON.stringify({
        aligned: false,
        mismatches: [{ type: 'plan_only', description: 'Missing scenario' }],
        summary: 'Mismatch',
      }),
      totalCostUsd: 0.6,
      modelUsage: {},
    });

    const result = await runValidationAgent('# Plan', '# Scenarios', 'Issue #42', '/logs');

    expect(result.validationResult.aligned).toBe(false);
    expect(result.validationResult.mismatches).toHaveLength(1);
  });
});
