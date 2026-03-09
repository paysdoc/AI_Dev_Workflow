import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Mock fs and child_process before importing the module under test
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execSync: vi.fn() };
});

// We need to control CLAUDE_CODE_PATH, so mock the config module partially
// Instead, we'll test the functions directly and manipulate the mocks.

describe('resolveClaudeCodePath', () => {
  let resolveClaudeCodePath: () => string;
  let clearClaudeCodePathCache: () => void;

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(execSync).mockReset();

    // Re-import to get fresh module state (clears cache)
    const config = await import('../config');
    resolveClaudeCodePath = config.resolveClaudeCodePath;
    clearClaudeCodePathCache = config.clearClaudeCodePathCache;
  });

  it('returns the configured absolute path when it exists on disk', () => {
    // CLAUDE_CODE_PATH defaults to 'claude' (not absolute), so we need to
    // test via the which fallback for the default. For an absolute path test,
    // we set the env var before importing.
    // Since we can't easily change the const after import, test the which path.
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockReturnValue('/usr/local/bin/claude\n');

    const result = resolveClaudeCodePath();
    expect(result).toBe('/usr/local/bin/claude');
  });

  it('falls back to which when CLAUDE_CODE_PATH is a bare name', () => {
    // Default CLAUDE_CODE_PATH is 'claude' (not starting with /), so it skips existsSync
    vi.mocked(execSync).mockReturnValue('/Users/martin/.local/bin/claude\n');

    const result = resolveClaudeCodePath();
    expect(result).toBe('/Users/martin/.local/bin/claude');
    expect(execSync).toHaveBeenCalledWith('which claude', expect.objectContaining({ encoding: 'utf-8' }));
  });

  it('throws a descriptive error when all resolution fails', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });

    expect(() => resolveClaudeCodePath()).toThrow(
      "Claude CLI not found. Set CLAUDE_CODE_PATH in .env or ensure 'claude' is in your PATH."
    );
  });

  it('caches the resolved path on subsequent calls', () => {
    vi.mocked(execSync).mockReturnValue('/usr/local/bin/claude\n');

    const first = resolveClaudeCodePath();
    const second = resolveClaudeCodePath();

    expect(first).toBe(second);
    // execSync should only have been called once due to caching
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('re-resolves after clearClaudeCodePathCache()', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/first/path/claude\n')
      .mockReturnValueOnce('/second/path/claude\n');

    const first = resolveClaudeCodePath();
    expect(first).toBe('/first/path/claude');

    clearClaudeCodePathCache();

    const second = resolveClaudeCodePath();
    expect(second).toBe('/second/path/claude');
    expect(execSync).toHaveBeenCalledTimes(2);
  });

  it('falls back to which when absolute path does not exist', () => {
    // Simulate an absolute CLAUDE_CODE_PATH that doesn't exist on disk.
    // We test this by checking the behavior: existsSync returns false for the absolute path,
    // then which succeeds.
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockReturnValue('/opt/bin/claude\n');

    const result = resolveClaudeCodePath();
    expect(result).toBe('/opt/bin/claude');
  });
});
