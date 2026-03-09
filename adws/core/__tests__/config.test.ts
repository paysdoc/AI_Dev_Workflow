import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('config', () => {
  let config: typeof import('../config');

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(execSync).mockReset();

    // Provide a default which-based resolution so the module can load without throwing
    vi.mocked(execSync).mockReturnValue('/usr/local/bin/claude\n');

    config = await import('../config');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('config constants', () => {
    it('exports CLAUDE_CODE_PATH as a string', () => {
      expect(typeof config.CLAUDE_CODE_PATH).toBe('string');
    });

    it('exports GITHUB_PAT (may be undefined if env not set)', () => {
      // GITHUB_PAT is either a string or undefined depending on env
      expect(config.GITHUB_PAT === undefined || typeof config.GITHUB_PAT === 'string').toBe(true);
    });

    it('exports LOGS_DIR as a string path', () => {
      expect(typeof config.LOGS_DIR).toBe('string');
      expect(config.LOGS_DIR).toContain('logs');
    });

    it('exports SPECS_DIR as a string path', () => {
      expect(typeof config.SPECS_DIR).toBe('string');
      expect(config.SPECS_DIR).toContain('specs');
    });

    it('exports AGENTS_STATE_DIR as a string path', () => {
      expect(typeof config.AGENTS_STATE_DIR).toBe('string');
      expect(config.AGENTS_STATE_DIR).toContain('agents');
    });

    it('exports MAX_TEST_RETRY_ATTEMPTS as a number', () => {
      expect(typeof config.MAX_TEST_RETRY_ATTEMPTS).toBe('number');
      expect(config.MAX_TEST_RETRY_ATTEMPTS).toBeGreaterThan(0);
    });

    it('exports MAX_REVIEW_RETRY_ATTEMPTS as a number', () => {
      expect(typeof config.MAX_REVIEW_RETRY_ATTEMPTS).toBe('number');
      expect(config.MAX_REVIEW_RETRY_ATTEMPTS).toBeGreaterThan(0);
    });

    it('exports WORKTREES_DIR as a string path', () => {
      expect(typeof config.WORKTREES_DIR).toBe('string');
      expect(config.WORKTREES_DIR).toContain('.worktrees');
    });

    it('exports TARGET_REPOS_DIR as a string path', () => {
      expect(typeof config.TARGET_REPOS_DIR).toBe('string');
    });

    it('exports COST_REPORT_CURRENCIES as a non-empty array', () => {
      expect(Array.isArray(config.COST_REPORT_CURRENCIES)).toBe(true);
      expect(config.COST_REPORT_CURRENCIES.length).toBeGreaterThan(0);
    });

    it('exports MAX_THINKING_TOKENS as a positive number', () => {
      expect(typeof config.MAX_THINKING_TOKENS).toBe('number');
      expect(config.MAX_THINKING_TOKENS).toBeGreaterThan(0);
    });

    it('exports TOKEN_LIMIT_THRESHOLD as a number between 0 and 1', () => {
      expect(typeof config.TOKEN_LIMIT_THRESHOLD).toBe('number');
      expect(config.TOKEN_LIMIT_THRESHOLD).toBeGreaterThan(0);
      expect(config.TOKEN_LIMIT_THRESHOLD).toBeLessThanOrEqual(1);
    });

    it('exports MAX_TOKEN_CONTINUATIONS as a positive number', () => {
      expect(typeof config.MAX_TOKEN_CONTINUATIONS).toBe('number');
      expect(config.MAX_TOKEN_CONTINUATIONS).toBeGreaterThanOrEqual(1);
    });
  });

  describe('resolveClaudeCodePath', () => {
    it('falls back to which when CLAUDE_CODE_PATH is a bare name', () => {
      config.clearClaudeCodePathCache();
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/claude\n');

      const result = config.resolveClaudeCodePath();
      expect(result).toBe('/usr/local/bin/claude');
      expect(execSync).toHaveBeenCalledWith('which claude', expect.objectContaining({ encoding: 'utf-8' }));
    });

    it('throws when all resolution methods fail', () => {
      config.clearClaudeCodePathCache();
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found');
      });

      expect(() => config.resolveClaudeCodePath()).toThrow(
        "Claude CLI not found. Set CLAUDE_CODE_PATH in .env or ensure 'claude' is in your PATH.",
      );
    });

    it('caches the resolved path on subsequent calls', () => {
      config.clearClaudeCodePathCache();
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/claude\n');

      const first = config.resolveClaudeCodePath();
      const second = config.resolveClaudeCodePath();

      expect(first).toBe(second);
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it('re-resolves after clearClaudeCodePathCache()', () => {
      config.clearClaudeCodePathCache();
      vi.mocked(execSync)
        .mockReturnValueOnce('/first/path/claude\n')
        .mockReturnValueOnce('/second/path/claude\n');

      const first = config.resolveClaudeCodePath();
      expect(first).toBe('/first/path/claude');

      config.clearClaudeCodePathCache();

      const second = config.resolveClaudeCodePath();
      expect(second).toBe('/second/path/claude');
      expect(execSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('getModelForCommand', () => {
    it('returns default model when no issue body is provided', () => {
      expect(config.getModelForCommand('/implement')).toBe('opus');
      expect(config.getModelForCommand('/classify_issue')).toBe('sonnet');
      expect(config.getModelForCommand('/test')).toBe('haiku');
    });

    it('returns default model when body has no /fast or /cheap keywords', () => {
      expect(config.getModelForCommand('/implement', 'A regular issue body')).toBe('opus');
      expect(config.getModelForCommand('/commit', 'No special keywords here')).toBe('sonnet');
    });

    it('returns fast model when body contains /fast', () => {
      const body = 'Please implement this /fast';
      expect(config.getModelForCommand('/implement', body)).toBe('sonnet');
      expect(config.getModelForCommand('/commit', body)).toBe('haiku');
    });

    it('returns fast model when body contains /cheap', () => {
      const body = 'Use /cheap mode for this issue';
      expect(config.getModelForCommand('/implement', body)).toBe('sonnet');
      expect(config.getModelForCommand('/pull_request', body)).toBe('haiku');
    });

    it('handles all slash commands without errors', () => {
      const commands = Object.keys(config.SLASH_COMMAND_MODEL_MAP) as Array<keyof typeof config.SLASH_COMMAND_MODEL_MAP>;
      for (const cmd of commands) {
        expect(() => config.getModelForCommand(cmd)).not.toThrow();
        expect(['opus', 'sonnet', 'haiku']).toContain(config.getModelForCommand(cmd));
      }
    });
  });

  describe('getEffortForCommand', () => {
    it('returns default effort when no issue body is provided', () => {
      expect(config.getEffortForCommand('/implement')).toBe('high');
      expect(config.getEffortForCommand('/classify_issue')).toBe('low');
      expect(config.getEffortForCommand('/test')).toBeUndefined();
    });

    it('returns default effort when body has no keywords', () => {
      expect(config.getEffortForCommand('/commit', 'Normal body')).toBe('medium');
    });

    it('returns fast effort when body contains /fast', () => {
      const body = '/fast';
      expect(config.getEffortForCommand('/commit', body)).toBe('low');
      expect(config.getEffortForCommand('/pull_request', body)).toBe('medium');
      expect(config.getEffortForCommand('/document', body)).toBe('medium');
    });

    it('returns fast effort when body contains /cheap', () => {
      const body = '/cheap';
      expect(config.getEffortForCommand('/commit', body)).toBe('low');
      expect(config.getEffortForCommand('/adw_init', body)).toBe('medium');
    });

    it('returns undefined for commands with no effort', () => {
      expect(config.getEffortForCommand('/test')).toBeUndefined();
      expect(config.getEffortForCommand('/commit_cost')).toBeUndefined();
      expect(config.getEffortForCommand('/test', '/fast')).toBeUndefined();
      expect(config.getEffortForCommand('/commit_cost', '/fast')).toBeUndefined();
    });
  });

  describe('isFastMode', () => {
    it('returns false for undefined', () => {
      expect(config.isFastMode(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(config.isFastMode('')).toBe(false);
    });

    it('returns false for body without keywords', () => {
      expect(config.isFastMode('This is a normal issue body')).toBe(false);
    });

    it('returns true for /fast', () => {
      expect(config.isFastMode('/fast')).toBe(true);
    });

    it('returns true for /cheap', () => {
      expect(config.isFastMode('/cheap')).toBe(true);
    });

    it('returns true when keywords appear mid-sentence', () => {
      expect(config.isFastMode('Please use /fast mode')).toBe(true);
      expect(config.isFastMode('Please use /cheap mode')).toBe(true);
    });

    it('returns false for partial matches like /faster', () => {
      expect(config.isFastMode('/faster')).toBe(false);
    });

    it('returns false for partial matches like /cheapest', () => {
      expect(config.isFastMode('/cheapest')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(config.isFastMode('/FAST')).toBe(true);
      expect(config.isFastMode('/Cheap')).toBe(true);
    });
  });

  describe('getSafeSubprocessEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns an object (not null or undefined)', () => {
      const result = config.getSafeSubprocessEnv();
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('includes whitelisted variables that are set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.HOME = '/home/user';
      process.env.PATH = '/usr/bin';

      const result = config.getSafeSubprocessEnv();
      expect(result.ANTHROPIC_API_KEY).toBe('test-key');
      expect(result.HOME).toBe('/home/user');
      expect(result.PATH).toBe('/usr/bin');
    });

    it('excludes non-whitelisted variables', () => {
      process.env.AWS_SECRET_KEY = 'super-secret';
      process.env.DATABASE_URL = 'postgres://secret@host/db';
      process.env.MY_CUSTOM_VAR = 'custom-value';

      const result = config.getSafeSubprocessEnv();
      expect(result.AWS_SECRET_KEY).toBeUndefined();
      expect(result.DATABASE_URL).toBeUndefined();
      expect(result.MY_CUSTOM_VAR).toBeUndefined();
    });

    it('does not include whitelisted variables that are not set', () => {
      delete process.env.GITHUB_PAT;
      delete process.env.GH_TOKEN;

      const result = config.getSafeSubprocessEnv();
      expect('GITHUB_PAT' in result).toBe(false);
      expect('GH_TOKEN' in result).toBe(false);
    });

    it('includes all expected safe env var names when present', () => {
      const safeVarNames = [
        'ANTHROPIC_API_KEY', 'GITHUB_PAT', 'GH_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN',
        'CLAUDE_CODE_PATH', 'HOME', 'USER', 'PATH', 'SHELL', 'TERM',
        'LANG', 'LC_ALL', 'NODE_PATH', 'NODE_ENV', 'PWD', 'PORT',
      ];
      for (const name of safeVarNames) {
        process.env[name] = `test-${name}`;
      }

      const result = config.getSafeSubprocessEnv();
      for (const name of safeVarNames) {
        expect(result[name]).toBe(`test-${name}`);
      }
    });
  });
});
