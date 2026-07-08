import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getSafeSubprocessEnv, resolveClaudeCodePath, clearClaudeCodePathCache } from '../environment.ts';

describe('getSafeSubprocessEnv', () => {
  let savedPat: string | undefined;
  let savedAlias: string | undefined;

  beforeEach(() => {
    savedPat = process.env.GITHUB_PAT;
    savedAlias = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    delete process.env.GITHUB_PAT;
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  });

  afterEach(() => {
    if (savedPat !== undefined) {
      process.env.GITHUB_PAT = savedPat;
    } else {
      delete process.env.GITHUB_PAT;
    }
    if (savedAlias !== undefined) {
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN = savedAlias;
    } else {
      delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    }
  });

  it('excludes GITHUB_PERSONAL_ACCESS_TOKEN even when set in process.env', () => {
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_legacy';
    const result = getSafeSubprocessEnv();
    expect(result).not.toHaveProperty('GITHUB_PERSONAL_ACCESS_TOKEN');
  });

  it('forwards GITHUB_PAT when set in process.env', () => {
    process.env.GITHUB_PAT = 'ghp_canonical';
    const result = getSafeSubprocessEnv();
    expect(result.GITHUB_PAT).toBe('ghp_canonical');
  });
});

describe('resolveClaudeCodePath', () => {
  let savedClaudeCodePath: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    savedClaudeCodePath = process.env.CLAUDE_CODE_PATH;
    tempDir = mkdtempSync(join(tmpdir(), 'adw-resolve-claude-path-'));
    clearClaudeCodePathCache();
  });

  afterEach(() => {
    if (savedClaudeCodePath !== undefined) {
      process.env.CLAUDE_CODE_PATH = savedClaudeCodePath;
    } else {
      delete process.env.CLAUDE_CODE_PATH;
    }
    clearClaudeCodePathCache();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('re-resolves when CLAUDE_CODE_PATH changes mid-process instead of returning a stale cached path', () => {
    const first = join(tempDir, 'claude-stub-a');
    writeFileSync(first, '#!/bin/sh\necho a\n', { mode: 0o755 });
    process.env.CLAUDE_CODE_PATH = first;
    expect(resolveClaudeCodePath()).toBe(first);

    const second = join(tempDir, 'claude-stub-b');
    writeFileSync(second, '#!/bin/sh\necho b\n', { mode: 0o755 });
    process.env.CLAUDE_CODE_PATH = second;
    expect(resolveClaudeCodePath()).toBe(second);
  });

  it('returns the cached path when CLAUDE_CODE_PATH is unchanged between calls', () => {
    const configured = join(tempDir, 'claude-stub');
    writeFileSync(configured, '#!/bin/sh\necho ok\n', { mode: 0o755 });
    process.env.CLAUDE_CODE_PATH = configured;
    expect(resolveClaudeCodePath()).toBe(configured);
    expect(resolveClaudeCodePath()).toBe(configured);
  });
});
