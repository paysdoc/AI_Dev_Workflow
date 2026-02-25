import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { checkEnvironmentVariables, checkGitHubCLI } from '../healthCheckChecks';

const mockedExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkEnvironmentVariables - multi-PAT', () => {
  it('reports patCount in details', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const result = checkEnvironmentVariables();
    // GITHUB_PATS is computed at module load time; without GITHUB_PAT env var, it's 0
    expect(result.details).toHaveProperty('patCount');
    expect(typeof result.details.patCount).toBe('number');
  });
});

describe('checkGitHubCLI - multi-PAT', () => {
  it('reports githubPatCount instead of hasGitHubPAT', () => {
    // Return strings (as execSync does when encoding: 'utf-8' is used by execCommand)
    mockedExecSync.mockImplementation((cmd: unknown) => {
      if (typeof cmd === 'string' && cmd.includes('which')) return '/usr/bin/gh';
      if (typeof cmd === 'string' && cmd.includes('auth status')) return 'Logged in to github.com';
      return '';
    });

    const result = checkGitHubCLI();
    expect(result.details).toHaveProperty('githubPatCount');
    expect(result.details).not.toHaveProperty('hasGitHubPAT');
    expect(typeof result.details.githubPatCount).toBe('number');
  });

  it('does not show warning when PATs are configured even if gh auth fails', () => {
    // With GITHUB_PAT set in .env, GITHUB_PATS.length > 0, so no warning even when unauthenticated
    mockedExecSync.mockImplementation((cmd: unknown) => {
      if (typeof cmd === 'string' && cmd.includes('which')) return '/usr/bin/gh';
      if (typeof cmd === 'string' && cmd.includes('auth status')) return 'not logged in to any accounts';
      return '';
    });

    const result = checkGitHubCLI();
    // Warning is only shown when BOTH gh auth fails AND no PATs configured
    // Since GITHUB_PATS is loaded from env at import time, behavior depends on .env
    if (result.details.githubPatCount === 0) {
      expect(result.warning).toBe('GitHub CLI not authenticated and no GITHUB_PAT set');
    } else {
      expect(result.warning).toBeUndefined();
    }
  });
});
