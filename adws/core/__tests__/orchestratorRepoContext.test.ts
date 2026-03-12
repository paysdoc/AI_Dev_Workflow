import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform } from '../../providers/types';

vi.mock('../../github/githubApi', () => ({
  getRepoInfo: vi.fn(() => ({ owner: 'local-owner', repo: 'local-repo' })),
}));

import { buildRepoIdentifier } from '../orchestratorCli';
import { getRepoInfo } from '../../github/githubApi';

describe('buildRepoIdentifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns RepoIdentifier from external TargetRepoInfo', () => {
    const targetRepo = { owner: 'ext-owner', repo: 'ext-repo', cloneUrl: 'https://github.com/ext-owner/ext-repo.git' };

    const result = buildRepoIdentifier(targetRepo);

    expect(result).toEqual({
      owner: 'ext-owner',
      repo: 'ext-repo',
      platform: Platform.GitHub,
    });
    expect(getRepoInfo).not.toHaveBeenCalled();
  });

  it('calls getRepoInfo() and returns RepoIdentifier for local repo when targetRepo is null', () => {
    const result = buildRepoIdentifier(null);

    expect(getRepoInfo).toHaveBeenCalledOnce();
    expect(result).toEqual({
      owner: 'local-owner',
      repo: 'local-repo',
      platform: Platform.GitHub,
    });
  });

  it('always sets platform to GitHub', () => {
    const result1 = buildRepoIdentifier({ owner: 'a', repo: 'b', cloneUrl: 'https://github.com/a/b.git' });
    const result2 = buildRepoIdentifier(null);

    expect(result1.platform).toBe(Platform.GitHub);
    expect(result2.platform).toBe(Platform.GitHub);
  });
});
