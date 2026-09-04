import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { GitContext } from '../gitContext';
import type { GitContextOptions, ExecFn, FsDeps, LogLevel } from '../types';
import { createLiteralTokenProvider } from '../../providers/github/githubTokenProvider';

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('gh-token-abc'),
    gitIdentity: {
      authorName: 'ADW Bot',
      authorEmail: 'bot@adw.dev',
      committerName: 'ADW Bot',
      committerEmail: 'bot@adw.dev',
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  };
}

function makeSpyExec(stdout = 'main\n'): ExecFn {
  return () => stdout;
}

function makeNoOpFsDeps(): FsDeps {
  return {
    existsSync: () => false,
    mkdirSync: () => {},
    copyFileSync: () => {},
    rmSync: () => {},
  };
}

interface LoggedMessage {
  message: string;
  level?: LogLevel;
}

function makeLoggerSpy(): { logger: (message: string, level?: LogLevel) => void; messages: LoggedMessage[] } {
  const messages: LoggedMessage[] = [];
  return {
    logger: (message, level) => { messages.push({ message, level }); },
    messages,
  };
}

// ── Injected logger routing ─────────────────────────────────────────────────

describe('worktree operations route to an injected logger port (issue #793)', () => {
  it('ensureWorktree (create path) delivers its success message to the injected logger', () => {
    const { logger, messages } = makeLoggerSpy();
    const ctx = new GitContext(validOptions(), { exec: makeSpyExec(), fsDeps: makeNoOpFsDeps(), logger });

    ctx.ensureWorktree('feature-issue-793-x');

    expect(messages.some((m) => m.message.includes('feature-issue-793-x'))).toBe(true);
  });

  it('removeWorktreesForIssue delivers its message to the injected logger', () => {
    const { logger, messages } = makeLoggerSpy();
    const ctx = new GitContext(validOptions(), { exec: makeSpyExec(), fsDeps: makeNoOpFsDeps(), logger });

    ctx.removeWorktreesForIssue(793);

    expect(messages.some((m) => m.message.includes('793'))).toBe(true);
  });

  it('the level travels with the message — success on create, info on the env-copy skip', () => {
    const { logger, messages } = makeLoggerSpy();
    const ctx = new GitContext(validOptions(), { exec: makeSpyExec(), fsDeps: makeNoOpFsDeps(), logger });

    ctx.ensureWorktree('feature-issue-793-x');

    const successLine = messages.find((m) => m.message.includes('feature-issue-793-x') && m.level === 'success');
    expect(successLine).toBeDefined();
    const skipLine = messages.find((m) => m.message.includes('skipping copy') && m.level === 'info');
    expect(skipLine).toBeDefined();
  });

  it('with a logger injected, nothing from the operation reaches the console', () => {
    const { logger } = makeLoggerSpy();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const ctx = new GitContext(validOptions(), { exec: makeSpyExec(), fsDeps: makeNoOpFsDeps(), logger });
      ctx.ensureWorktree('feature-issue-793-x');
      expect(consoleSpy.mock.calls.some(([line]) => String(line).includes('feature-issue-793-x'))).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ── Console default ─────────────────────────────────────────────────────────

describe('without a logger injected, the console default reports (issue #793)', () => {
  it('a context constructed with no logger still completes without throwing, and reports to the console', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const ctx = new GitContext(validOptions(), { exec: makeSpyExec(), fsDeps: makeNoOpFsDeps() });
      expect(() => ctx.ensureWorktree('feature-issue-793-x')).not.toThrow();
      expect(consoleSpy.mock.calls.some(([line]) => String(line).includes('feature-issue-793-x'))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ── AC pin — source-level: neither worktree op module imports the application logger ──

describe('worktree op modules source — no application-logger import (AC3)', () => {
  const createSrc = fs.readFileSync(path.join(__dirname, '..', 'worktreeCreateOps.ts'), 'utf-8');
  const removeSrc = fs.readFileSync(path.join(__dirname, '..', 'worktreeRemoveOps.ts'), 'utf-8');

  it('worktreeCreateOps.ts does not reference the core/utils module specifier', () => {
    expect(createSrc).not.toContain('core/utils');
  });

  it('worktreeRemoveOps.ts does not reference the core/utils module specifier', () => {
    expect(removeSrc).not.toContain('core/utils');
  });
});
