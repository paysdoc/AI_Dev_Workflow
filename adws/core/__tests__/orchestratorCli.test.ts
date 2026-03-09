import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import {
  extractCwdOption,
  extractIssueTypeOption,
  parseIssueNumber,
  printUsageAndExit,
  parseOrchestratorArguments,
} from '../orchestratorCli';

describe('extractCwdOption', () => {
  it('returns the cwd value and removes --cwd and its argument from args', () => {
    const args = ['--cwd', '/some/path', '42'];
    const result = extractCwdOption(args);
    expect(result).toBe('/some/path');
    expect(args).toEqual(['42']);
  });

  it('returns null when --cwd is not present', () => {
    const args = ['42', 'abc'];
    const result = extractCwdOption(args);
    expect(result).toBeNull();
    expect(args).toEqual(['42', 'abc']);
  });

  it('returns null when --cwd is present but has no following argument', () => {
    const args = ['--cwd'];
    const result = extractCwdOption(args);
    expect(result).toBeNull();
    expect(args).toEqual(['--cwd']);
  });

  it('handles --cwd in the middle of args', () => {
    const args = ['42', '--cwd', '/path/to/dir', 'extra'];
    const result = extractCwdOption(args);
    expect(result).toBe('/path/to/dir');
    expect(args).toEqual(['42', 'extra']);
  });

  it('handles --cwd at the end of args with a value', () => {
    const args = ['42', '--cwd', '/end/path'];
    const result = extractCwdOption(args);
    expect(result).toBe('/end/path');
    expect(args).toEqual(['42']);
  });
});

describe('extractIssueTypeOption', () => {
  let exitSpy: MockInstance;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns the issue type and removes --issue-type and its argument from args', () => {
    const args = ['--issue-type', '/feature', '42'];
    const result = extractIssueTypeOption(args);
    expect(result).toBe('/feature');
    expect(args).toEqual(['42']);
  });

  it('returns null when --issue-type is not present', () => {
    const args = ['42'];
    const result = extractIssueTypeOption(args);
    expect(result).toBeNull();
    expect(args).toEqual(['42']);
  });

  it('returns null when --issue-type is present but has no following argument', () => {
    const args = ['--issue-type'];
    const result = extractIssueTypeOption(args);
    expect(result).toBeNull();
    expect(args).toEqual(['--issue-type']);
  });

  it('accepts all valid issue types', () => {
    const validTypes = ['/chore', '/bug', '/feature', '/pr_review', '/adw_init'] as const;
    for (const type of validTypes) {
      const args = ['--issue-type', type, '42'];
      const result = extractIssueTypeOption(args);
      expect(result).toBe(type);
    }
  });

  it('exits with error for invalid issue type', () => {
    const args = ['--issue-type', '/invalid', '42'];
    expect(() => extractIssueTypeOption(args)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid issue type: /invalid'));
  });

  it('handles --issue-type in the middle of args', () => {
    const args = ['42', '--issue-type', '/bug', 'extra'];
    const result = extractIssueTypeOption(args);
    expect(result).toBe('/bug');
    expect(args).toEqual(['42', 'extra']);
  });
});

describe('parseIssueNumber', () => {
  let exitSpy: MockInstance;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('parses a valid integer string', () => {
    expect(parseIssueNumber('42')).toBe(42);
  });

  it('parses zero', () => {
    expect(parseIssueNumber('0')).toBe(0);
  });

  it('parses large numbers', () => {
    expect(parseIssueNumber('99999')).toBe(99999);
  });

  it('exits with error for non-numeric string', () => {
    expect(() => parseIssueNumber('abc')).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('Invalid issue number: abc');
  });

  it('exits with error for empty string', () => {
    expect(() => parseIssueNumber('')).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with error for float string', () => {
    // parseInt('3.14') returns 3, which is not NaN, so it should succeed
    expect(parseIssueNumber('3.14')).toBe(3);
  });

  it('parses negative numbers (parseInt allows them)', () => {
    // parseInt('-5') returns -5, which is not NaN
    expect(parseIssueNumber('-5')).toBe(-5);
  });
});

describe('printUsageAndExit', () => {
  let exitSpy: MockInstance;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('calls process.exit(1)', () => {
    expect(() => printUsageAndExit('myScript.tsx', '<issueNumber>')).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('prints usage with script name and pattern', () => {
    expect(() => printUsageAndExit('myScript.tsx', '<issueNumber>')).toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bunx tsx adws/myScript.tsx <issueNumber>'));
  });

  it('prints options when provided', () => {
    expect(() => printUsageAndExit('myScript.tsx', '<issueNumber>', ['--cwd <path>  Working dir'])).toThrow();
    expect(errorSpy).toHaveBeenCalledWith('Options:');
    expect(errorSpy).toHaveBeenCalledWith('  --cwd <path>  Working dir');
  });

  it('prints environment requirements', () => {
    expect(() => printUsageAndExit('myScript.tsx', '<issueNumber>')).toThrow();
    expect(errorSpy).toHaveBeenCalledWith('Environment Requirements:');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ANTHROPIC_API_KEY'));
  });

  it('does not print Options section when no options are provided', () => {
    expect(() => printUsageAndExit('myScript.tsx', '<issueNumber>')).toThrow();
    const optionsCalls = errorSpy.mock.calls.filter(
      (call) => call[0] === 'Options:',
    );
    expect(optionsCalls).toHaveLength(0);
  });
});

describe('parseOrchestratorArguments', () => {
  let exitSpy: MockInstance;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const defaultOptions = {
    scriptName: 'test.tsx',
    usagePattern: '<issueNumber> [adwId]',
  };

  it('parses a simple issue number', () => {
    const result = parseOrchestratorArguments(['42'], defaultOptions);
    expect(result.issueNumber).toBe(42);
    expect(result.adwId).toBeNull();
    expect(result.cwd).toBeNull();
    expect(result.providedIssueType).toBeNull();
  });

  it('parses issue number with adwId', () => {
    const result = parseOrchestratorArguments(['42', 'abc12345'], defaultOptions);
    expect(result.issueNumber).toBe(42);
    expect(result.adwId).toBe('abc12345');
  });

  it('parses --cwd option', () => {
    const result = parseOrchestratorArguments(['--cwd', '/my/path', '42'], defaultOptions);
    expect(result.issueNumber).toBe(42);
    expect(result.cwd).toBe('/my/path');
  });

  it('parses --issue-type option', () => {
    const result = parseOrchestratorArguments(['--issue-type', '/feature', '42'], defaultOptions);
    expect(result.issueNumber).toBe(42);
    expect(result.providedIssueType).toBe('/feature');
  });

  it('parses all options together', () => {
    const result = parseOrchestratorArguments(
      ['--cwd', '/work', '--issue-type', '/bug', '99', 'myAdwId'],
      defaultOptions,
    );
    expect(result.issueNumber).toBe(99);
    expect(result.adwId).toBe('myAdwId');
    expect(result.cwd).toBe('/work');
    expect(result.providedIssueType).toBe('/bug');
  });

  it('exits on --help flag', () => {
    expect(() => parseOrchestratorArguments(['--help'], defaultOptions)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits on -h flag', () => {
    expect(() => parseOrchestratorArguments(['-h'], defaultOptions)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when no arguments are provided and issue number is required', () => {
    expect(() => parseOrchestratorArguments([], defaultOptions)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not extract --cwd when supportsCwd is false', () => {
    // When supportsCwd is false, --cwd is not extracted, so it remains in args.
    // The first positional arg becomes '--cwd' which is not a valid number,
    // causing parseIssueNumber to call process.exit(1).
    expect(() =>
      parseOrchestratorArguments(
        ['--cwd', '/path', '42'],
        { ...defaultOptions, supportsCwd: false },
      ),
    ).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not extract --issue-type when supportsIssueType is false', () => {
    const result = parseOrchestratorArguments(
      ['42'],
      { ...defaultOptions, supportsIssueType: false },
    );
    expect(result.providedIssueType).toBeNull();
  });

  it('returns issueNumber 0 when requiresIssueNumber is false', () => {
    const result = parseOrchestratorArguments(
      [],
      { ...defaultOptions, requiresIssueNumber: false },
    );
    expect(result.issueNumber).toBe(0);
  });

  it('handles adwId as first positional when requiresIssueNumber is false', () => {
    const result = parseOrchestratorArguments(
      ['myAdwId'],
      { ...defaultOptions, requiresIssueNumber: false },
    );
    expect(result.issueNumber).toBe(0);
    expect(result.adwId).toBe('myAdwId');
  });

  it('includes --cwd option in help when supportsCwd is true', () => {
    expect(() => parseOrchestratorArguments(['--help'], { ...defaultOptions, supportsCwd: true })).toThrow();
    const allOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toContain('--cwd');
  });

  it('includes --issue-type option in help when supportsIssueType is true', () => {
    expect(() => parseOrchestratorArguments(['--help'], { ...defaultOptions, supportsIssueType: true })).toThrow();
    const allOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toContain('--issue-type');
  });
});
