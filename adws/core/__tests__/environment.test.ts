import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getSafeSubprocessEnv, buildClaudeLaunchEnv, resolveClaudeCodePath, clearClaudeCodePathCache } from '../environment.ts';

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

describe('buildClaudeLaunchEnv', () => {
  const touched = ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'ADW_RECORDING_SENTINEL', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY'];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(touched.map((name) => [name, process.env[name]]));
    touched.forEach((name) => delete process.env[name]);
  });

  afterEach(() => {
    touched.forEach((name) => {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    });
  });

  it('disables auto-memory when no overlay is given', () => {
    expect(buildClaudeLaunchEnv().CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
  });

  it('disables auto-memory even when the process environment or the overlay turns it on', () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0';

    expect(buildClaudeLaunchEnv().CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    expect(buildClaudeLaunchEnv({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' }).CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
  });

  it('lets overlay keys win over the allowlisted environment', () => {
    process.env.GH_TOKEN = 'from-process';

    expect(buildClaudeLaunchEnv({ GH_TOKEN: 'from-overlay' }).GH_TOKEN).toBe('from-overlay');
    expect(buildClaudeLaunchEnv().GH_TOKEN).toBe('from-process');
  });

  it('leaves out a process variable that is not on the allowlist', () => {
    process.env.ADW_RECORDING_SENTINEL = 'leak';

    expect(buildClaudeLaunchEnv()).not.toHaveProperty('ADW_RECORDING_SENTINEL');
  });

  it('forwards ANTHROPIC_API_KEY when it is set, and omits it when it is not', () => {
    expect(buildClaudeLaunchEnv()).not.toHaveProperty('ANTHROPIC_API_KEY');

    process.env.ANTHROPIC_API_KEY = 'sk-ant-forwarded';

    expect(buildClaudeLaunchEnv().ANTHROPIC_API_KEY).toBe('sk-ant-forwarded');
  });

  it('does not mutate process.env', () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0';
    const before = { ...process.env };

    buildClaudeLaunchEnv({ GH_TOKEN: 'overlay', EXTRA: 'value' });

    expect(process.env).toEqual(before);
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
