import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests that checkIssueNumber includes the --repo flag from the target repo registry.
 */

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { checkIssueNumber } from '../healthCheckChecks';

const mockExecSync = vi.mocked(execSync);

const testRepoInfo = { owner: 'test-owner', repo: 'test-repo' };

describe('checkIssueNumber --repo flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes --repo flag in gh issue view command', () => {
    mockExecSync.mockReturnValue(
      JSON.stringify({ number: 42, title: 'Test Issue', state: 'OPEN' })
    );

    checkIssueNumber(42, testRepoInfo);

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--repo test-owner/test-repo'),
      expect.anything()
    );
  });

  it('returns success with valid issue data', () => {
    mockExecSync.mockReturnValue(
      JSON.stringify({ number: 42, title: 'Test Issue', state: 'OPEN' })
    );

    const result = checkIssueNumber(42, testRepoInfo);

    expect(result.success).toBe(true);
    expect(result.details.title).toBe('Test Issue');
    expect(result.details.state).toBe('OPEN');
  });
});
