import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

import { execSync } from 'child_process';
import {
  parseGitHubPats,
  testPatAccess,
  testRepoAccessWithoutPat,
  resolveGitHubPat,
} from '../core/githubPatResolver';

const mockedExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GITHUB_PAT;
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
});

describe('parseGitHubPats', () => {
  it('returns empty array for undefined', () => {
    expect(parseGitHubPats(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseGitHubPats('')).toEqual([]);
  });

  it('returns single PAT for string without commas', () => {
    expect(parseGitHubPats('ghp_abc123')).toEqual(['ghp_abc123']);
  });

  it('returns multiple PATs for comma-separated string', () => {
    expect(parseGitHubPats('ghp_abc,ghp_def,ghp_ghi')).toEqual([
      'ghp_abc',
      'ghp_def',
      'ghp_ghi',
    ]);
  });

  it('trims whitespace around PATs', () => {
    expect(parseGitHubPats(' ghp_abc , ghp_def , ghp_ghi ')).toEqual([
      'ghp_abc',
      'ghp_def',
      'ghp_ghi',
    ]);
  });

  it('filters out empty entries (e.g., trailing comma)', () => {
    expect(parseGitHubPats('ghp_abc,')).toEqual(['ghp_abc']);
    expect(parseGitHubPats(',ghp_abc')).toEqual(['ghp_abc']);
    expect(parseGitHubPats('ghp_abc,,ghp_def')).toEqual(['ghp_abc', 'ghp_def']);
  });
});

describe('testPatAccess', () => {
  it('returns true when gh api succeeds', () => {
    mockedExecSync.mockReturnValue(Buffer.from('owner/repo'));
    expect(testPatAccess('ghp_token', 'owner', 'repo')).toBe(true);
  });

  it('returns false when gh api throws', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('HTTP 401');
    });
    expect(testPatAccess('ghp_token', 'owner', 'repo')).toBe(false);
  });

  it('passes GH_TOKEN in the env', () => {
    mockedExecSync.mockReturnValue(Buffer.from('owner/repo'));
    testPatAccess('ghp_secret', 'owner', 'repo');

    expect(mockedExecSync).toHaveBeenCalledWith(
      'gh api repos/owner/repo --jq .full_name',
      expect.objectContaining({
        stdio: 'pipe',
        env: expect.objectContaining({ GH_TOKEN: 'ghp_secret' }),
      }),
    );
  });
});

describe('testRepoAccessWithoutPat', () => {
  it('returns true when gh api succeeds without PAT', () => {
    mockedExecSync.mockReturnValue(Buffer.from('owner/repo'));
    expect(testRepoAccessWithoutPat('owner', 'repo')).toBe(true);
  });

  it('returns false when gh api throws without PAT', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('HTTP 404');
    });
    expect(testRepoAccessWithoutPat('owner', 'repo')).toBe(false);
  });
});

describe('resolveGitHubPat', () => {
  it('returns first working PAT with method "pat"', () => {
    process.env.GITHUB_PAT = 'ghp_works';
    mockedExecSync.mockReturnValue(Buffer.from('owner/repo'));

    const result = resolveGitHubPat('owner', 'repo');
    expect(result).toEqual({ pat: 'ghp_works', method: 'pat' });
  });

  it('returns second PAT when first fails', () => {
    process.env.GITHUB_PAT = 'ghp_bad,ghp_good';
    let callCount = 0;
    mockedExecSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('HTTP 401');
      return Buffer.from('owner/repo');
    });

    const result = resolveGitHubPat('owner', 'repo');
    expect(result).toEqual({ pat: 'ghp_good', method: 'pat' });
  });

  it('falls back to gh_auth when no PATs configured', () => {
    // No GITHUB_PAT set
    mockedExecSync.mockReturnValue(Buffer.from('owner/repo'));

    const result = resolveGitHubPat('owner', 'repo');
    expect(result).toEqual({ pat: null, method: 'gh_auth' });
  });

  it('falls back to gh_auth when all PATs fail', () => {
    process.env.GITHUB_PAT = 'ghp_bad1,ghp_bad2';
    let callCount = 0;
    mockedExecSync.mockImplementation(() => {
      callCount++;
      // First two calls (PAT tests) fail, third call (no-PAT test) succeeds
      if (callCount <= 2) throw new Error('HTTP 401');
      return Buffer.from('owner/repo');
    });

    const result = resolveGitHubPat('owner', 'repo');
    expect(result).toEqual({ pat: null, method: 'gh_auth' });
  });

  it('returns method "none" when everything fails', () => {
    process.env.GITHUB_PAT = 'ghp_bad';
    mockedExecSync.mockImplementation(() => {
      throw new Error('HTTP 401');
    });

    const result = resolveGitHubPat('owner', 'repo');
    expect(result).toEqual({ pat: null, method: 'none' });
  });

  it('reads GITHUB_PERSONAL_ACCESS_TOKEN as fallback', () => {
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_alt';
    mockedExecSync.mockReturnValue(Buffer.from('owner/repo'));

    const result = resolveGitHubPat('owner', 'repo');
    expect(result).toEqual({ pat: 'ghp_alt', method: 'pat' });
  });
});
