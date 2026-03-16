/**
 * Unit tests for the Dependency Extraction Agent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../agents/claudeAgent', () => ({
  runClaudeAgentWithCommand: vi.fn(),
}));

vi.mock('../core', () => ({
  log: vi.fn(),
  getModelForCommand: vi.fn().mockReturnValue('haiku'),
  getEffortForCommand: vi.fn().mockReturnValue('low'),
}));

import { parseDependencyArray, runDependencyExtractionAgent } from '../agents/dependencyExtractionAgent';
import { runClaudeAgentWithCommand } from '../agents/claudeAgent';

const mockRun = vi.mocked(runClaudeAgentWithCommand);

describe('parseDependencyArray', () => {
  it('parses a valid JSON array', () => {
    expect(parseDependencyArray('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('returns an empty array for an empty JSON array', () => {
    expect(parseDependencyArray('[]')).toEqual([]);
  });

  it('extracts a JSON array from output with surrounding text', () => {
    expect(parseDependencyArray('Here are the deps: [42, 10]')).toEqual([42, 10]);
  });

  it('returns [] when no JSON array is found', () => {
    expect(parseDependencyArray('no dependencies found')).toEqual([]);
  });

  it('returns [] for malformed JSON', () => {
    expect(parseDependencyArray('[1, 2,')).toEqual([]);
  });

  it('filters out non-integer values', () => {
    expect(parseDependencyArray('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('deduplicates repeated issue numbers', () => {
    const result = parseDependencyArray('[5, 5, 10, 10]');
    expect(result).toHaveLength(2);
    expect(result).toContain(5);
    expect(result).toContain(10);
  });

  it('excludes zero', () => {
    expect(parseDependencyArray('[0, 1, 2]')).toEqual([1, 2]);
  });

  it('excludes negative numbers', () => {
    expect(parseDependencyArray('[-1, 1, 2]')).toEqual([1, 2]);
  });

  it('returns [] for an empty string', () => {
    expect(parseDependencyArray('')).toEqual([]);
  });
});

describe('runDependencyExtractionAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runClaudeAgentWithCommand with /extract_dependencies and haiku model', async () => {
    mockRun.mockResolvedValueOnce({
      success: true,
      output: '[42, 10]',
    });

    await runDependencyExtractionAgent('issue body text', 'logs');

    expect(mockRun).toHaveBeenCalledWith(
      '/extract_dependencies',
      'issue body text',
      'Dependency Extraction',
      expect.stringContaining('dependency-extraction-agent.jsonl'),
      'haiku',
      'low',
      undefined,
      undefined,
      undefined,
    );
  });

  it('returns parsed dependencies on success', async () => {
    mockRun.mockResolvedValueOnce({
      success: true,
      output: '[42, 10]',
    });

    const result = await runDependencyExtractionAgent('issue body', 'logs');

    expect(result.success).toBe(true);
    expect(result.dependencies).toEqual([42, 10]);
  });

  it('returns empty dependencies when agent output has no JSON array', async () => {
    mockRun.mockResolvedValueOnce({
      success: true,
      output: 'No dependencies found.',
    });

    const result = await runDependencyExtractionAgent('issue body', 'logs');

    expect(result.dependencies).toEqual([]);
  });

  it('returns empty dependencies when agent fails', async () => {
    mockRun.mockResolvedValueOnce({
      success: false,
      output: 'Error occurred',
    });

    const result = await runDependencyExtractionAgent('issue body', 'logs');

    expect(result.success).toBe(false);
    expect(result.dependencies).toEqual([]);
  });

  it('passes statePath and cwd through to runClaudeAgentWithCommand', async () => {
    mockRun.mockResolvedValueOnce({
      success: true,
      output: '[]',
    });

    await runDependencyExtractionAgent('body', 'logs/dir', '/state/path', '/work/dir');

    expect(mockRun).toHaveBeenCalledWith(
      '/extract_dependencies',
      'body',
      'Dependency Extraction',
      expect.any(String),
      'haiku',
      'low',
      undefined,
      '/state/path',
      '/work/dir',
    );
  });
});
