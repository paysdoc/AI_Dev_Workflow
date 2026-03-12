import { describe, it, expect } from 'vitest';
import {
  getDefaultProvidersConfig,
  parseProvidersMd,
} from '../projectConfig';

// ---------------------------------------------------------------------------
// getDefaultProvidersConfig
// ---------------------------------------------------------------------------

describe('getDefaultProvidersConfig', () => {
  it('returns github defaults for both providers', () => {
    const config = getDefaultProvidersConfig();
    expect(config.codeHost).toBe('github');
    expect(config.issueTracker).toBe('github');
  });

  it('has no URL or project key fields set', () => {
    const config = getDefaultProvidersConfig();
    expect(config.codeHostUrl).toBeUndefined();
    expect(config.issueTrackerUrl).toBeUndefined();
    expect(config.issueTrackerProjectKey).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseProvidersMd
// ---------------------------------------------------------------------------

describe('parseProvidersMd', () => {
  it('parses all sections present', () => {
    const md = [
      '## Code Host',
      'gitlab',
      '',
      '## Code Host URL',
      'https://gitlab.example.com',
      '',
      '## Issue Tracker',
      'jira',
      '',
      '## Issue Tracker URL',
      'https://jira.example.com',
      '',
      '## Issue Tracker Project Key',
      'PROJ',
    ].join('\n');

    const config = parseProvidersMd(md);

    expect(config.codeHost).toBe('gitlab');
    expect(config.codeHostUrl).toBe('https://gitlab.example.com');
    expect(config.issueTracker).toBe('jira');
    expect(config.issueTrackerUrl).toBe('https://jira.example.com');
    expect(config.issueTrackerProjectKey).toBe('PROJ');
  });

  it('parses only required sections (code host + issue tracker)', () => {
    const md = '## Code Host\ngithub\n\n## Issue Tracker\ngithub\n';

    const config = parseProvidersMd(md);

    expect(config.codeHost).toBe('github');
    expect(config.issueTracker).toBe('github');
    expect(config.codeHostUrl).toBeUndefined();
    expect(config.issueTrackerUrl).toBeUndefined();
    expect(config.issueTrackerProjectKey).toBeUndefined();
  });

  it('returns defaults for empty content', () => {
    const config = parseProvidersMd('');
    expect(config).toEqual(getDefaultProvidersConfig());
  });

  it('returns defaults for whitespace-only content', () => {
    const config = parseProvidersMd('   \n  \n  ');
    expect(config).toEqual(getDefaultProvidersConfig());
  });

  it('defaults code host to github when section is missing', () => {
    const md = '## Issue Tracker\ngitlab\n';

    const config = parseProvidersMd(md);

    expect(config.codeHost).toBe('github');
    expect(config.issueTracker).toBe('gitlab');
  });

  it('defaults issue tracker to github when section is missing', () => {
    const md = '## Code Host\ngitlab\n';

    const config = parseProvidersMd(md);

    expect(config.codeHost).toBe('gitlab');
    expect(config.issueTracker).toBe('github');
  });

  it('preserves case for URL values', () => {
    const md = [
      '## Code Host',
      'github',
      '',
      '## Code Host URL',
      'https://GitHub.Enterprise.com',
      '',
      '## Issue Tracker',
      'github',
      '',
      '## Issue Tracker URL',
      'https://GitHub.Enterprise.com',
    ].join('\n');

    const config = parseProvidersMd(md);

    expect(config.codeHostUrl).toBe('https://GitHub.Enterprise.com');
    expect(config.issueTrackerUrl).toBe('https://GitHub.Enterprise.com');
  });

  it('lowercases platform names', () => {
    const md = '## Code Host\nGitHub\n\n## Issue Tracker\nGITLAB\n';

    const config = parseProvidersMd(md);

    expect(config.codeHost).toBe('github');
    expect(config.issueTracker).toBe('gitlab');
  });

  it('trims whitespace from values', () => {
    const md = '## Code Host\n  github  \n\n## Issue Tracker\n  gitlab  \n';

    const config = parseProvidersMd(md);

    expect(config.codeHost).toBe('github');
    expect(config.issueTracker).toBe('gitlab');
  });

  it('preserves unknown platform strings as-is (lowercased)', () => {
    const md = '## Code Host\ncustom-host\n\n## Issue Tracker\ncustom-tracker\n';

    const config = parseProvidersMd(md);

    expect(config.codeHost).toBe('custom-host');
    expect(config.issueTracker).toBe('custom-tracker');
  });

  it('handles issue tracker project key with value', () => {
    const md = '## Issue Tracker Project Key\nMYPROJ-123\n';

    const config = parseProvidersMd(md);

    expect(config.issueTrackerProjectKey).toBe('MYPROJ-123');
  });

  it('ignores extra headings that are not in the mapping', () => {
    const md = [
      '# Provider Configuration',
      '',
      'Some intro text.',
      '',
      '## Code Host',
      'github',
      '',
      '## Issue Tracker',
      'github',
      '',
      '## Notes',
      'Other stuff.',
    ].join('\n');

    const config = parseProvidersMd(md);

    expect(config.codeHost).toBe('github');
    expect(config.issueTracker).toBe('github');
  });

  it('handles URL fields with trailing slashes', () => {
    const md = [
      '## Code Host',
      'github',
      '',
      '## Code Host URL',
      'https://github.com/',
    ].join('\n');

    const config = parseProvidersMd(md);

    expect(config.codeHostUrl).toBe('https://github.com/');
  });
});
