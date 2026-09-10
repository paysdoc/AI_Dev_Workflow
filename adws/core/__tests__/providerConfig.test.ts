import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadProviderConfig, parseCodeHostForge, parseIssueTrackerForge } from '../providerConfig';

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
  it('defaults to github for both forges when .adw/providers.md is absent', () => {
    const cwd = makeWorkspace();
    expect(loadProviderConfig(cwd)).toEqual({ codeHost: 'github', issueTracker: 'github' });
  });

  it('parses a Code Host section and an Issue Tracker URL section', () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, '.adw'), { recursive: true });
    writeFileSync(
      join(cwd, '.adw', 'providers.md'),
      '## Code Host\ngitlab\n\n## Issue Tracker URL\nhttps://example.atlassian.net\n',
    );

    const config = loadProviderConfig(cwd);

    expect(config.codeHost).toBe('gitlab');
    expect(config.issueTracker).toBe('github');
    expect(config.issueTrackerUrl).toBe('https://example.atlassian.net');
  });

  it('accepts jira under Issue Tracker', () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, '.adw'), { recursive: true });
    writeFileSync(
      join(cwd, '.adw', 'providers.md'),
      '## Issue Tracker\njira\n\n## Issue Tracker URL\nhttps://example.atlassian.net\n\n## Issue Tracker Project Key\nADW\n',
    );

    const config = loadProviderConfig(cwd);

    expect(config.issueTracker).toBe('jira');
    expect(config.issueTrackerProjectKey).toBe('ADW');
  });

  it('refuses gitlab under Issue Tracker, naming the section and the value', () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, '.adw'), { recursive: true });
    writeFileSync(join(cwd, '.adw', 'providers.md'), '## Issue Tracker\ngitlab\n');

    expect(() => loadProviderConfig(cwd)).toThrow(
      'Unsupported issue tracker "gitlab" in ## Issue Tracker section of .adw/providers.md (expected one of: github, jira)',
    );
  });

  it('refuses bitbucket under Code Host, naming the section and the value', () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, '.adw'), { recursive: true });
    writeFileSync(join(cwd, '.adw', 'providers.md'), '## Code Host\nbitbucket\n');

    expect(() => loadProviderConfig(cwd)).toThrow(
      'Unsupported code host "bitbucket" in ## Code Host section of .adw/providers.md (expected one of: github, gitlab)',
    );
  });

  it('refuses an unrecognised value under Code Host', () => {
    const cwd = makeWorkspace();
    mkdirSync(join(cwd, '.adw'), { recursive: true });
    writeFileSync(join(cwd, '.adw', 'providers.md'), '## Code Host\nbananas\n');

    expect(() => loadProviderConfig(cwd)).toThrow(
      'Unsupported code host "bananas" in ## Code Host section of .adw/providers.md (expected one of: github, gitlab)',
    );
  });
});

describe('parseCodeHostForge', () => {
  it('is case-insensitive', () => {
    expect(parseCodeHostForge('GitHub', '## Code Host')).toBe('github');
    expect(parseCodeHostForge('GITLAB', '## Code Host')).toBe('gitlab');
  });
});

describe('parseIssueTrackerForge', () => {
  it('is case-insensitive', () => {
    expect(parseIssueTrackerForge('GitHub', '## Issue Tracker')).toBe('github');
    expect(parseIssueTrackerForge('JIRA', '## Issue Tracker')).toBe('jira');
  });
});
