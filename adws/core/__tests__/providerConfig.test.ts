import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadProviderConfig, parsePlatform } from '../providerConfig';
import { Platform } from '../../providers/types';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function makeWorkspace(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'adw-providerconfig-'));
  return tempDir;
}

describe('loadProviderConfig', () => {
  it('defaults to GitHub for both platforms when .adw/providers.md is absent', () => {
    const cwd = makeWorkspace();
    expect(loadProviderConfig(cwd)).toEqual({ codeHost: Platform.GitHub, issueTracker: Platform.GitHub });
  });

  it('parses a Code Host section and an Issue Tracker URL section', () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, '.adw'), { recursive: true });
    writeFileSync(
      join(cwd, '.adw', 'providers.md'),
      '## Code Host\ngitlab\n\n## Issue Tracker URL\nhttps://example.atlassian.net\n',
    );

    const config = loadProviderConfig(cwd);

    expect(config.codeHost).toBe(Platform.GitLab);
    expect(config.issueTracker).toBe(Platform.GitHub);
    expect(config.issueTrackerUrl).toBe('https://example.atlassian.net');
  });

  it('throws naming the section and the unknown platform', () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, '.adw'), { recursive: true });
    writeFileSync(join(cwd, '.adw', 'providers.md'), '## Code Host\nbitbucketX\n');

    expect(() => loadProviderConfig(cwd)).toThrow(
      'Unknown platform "bitbucketX" in ## Code Host section of .adw/providers.md',
    );
  });
});

describe('parsePlatform', () => {
  it('is case-insensitive', () => {
    expect(parsePlatform('GitHub', '## Code Host')).toBe(Platform.GitHub);
  });
});
