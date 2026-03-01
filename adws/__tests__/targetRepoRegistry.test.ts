import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setTargetRepo, getTargetRepo, clearTargetRepo, hasTargetRepo } from '../core/targetRepoRegistry';

vi.mock('../github/githubApi', () => ({
  getRepoInfo: vi.fn(() => ({ owner: 'local-owner', repo: 'local-repo' })),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

import { getRepoInfo } from '../github/githubApi';

describe('targetRepoRegistry', () => {
  beforeEach(() => {
    clearTargetRepo();
    vi.clearAllMocks();
  });

  it('setTargetRepo and getTargetRepo return the set value', () => {
    const repoInfo = { owner: 'ext-owner', repo: 'ext-repo' };
    setTargetRepo(repoInfo);

    const result = getTargetRepo();
    expect(result).toEqual({ owner: 'ext-owner', repo: 'ext-repo' });
    expect(getRepoInfo).not.toHaveBeenCalled();
  });

  it('getTargetRepo falls back to getRepoInfo when registry is not set', () => {
    const result = getTargetRepo();
    expect(result).toEqual({ owner: 'local-owner', repo: 'local-repo' });
    expect(getRepoInfo).toHaveBeenCalledTimes(1);
  });

  it('clearTargetRepo resets the registry', () => {
    setTargetRepo({ owner: 'ext-owner', repo: 'ext-repo' });
    clearTargetRepo();

    const result = getTargetRepo();
    expect(result).toEqual({ owner: 'local-owner', repo: 'local-repo' });
    expect(getRepoInfo).toHaveBeenCalledTimes(1);
  });

  it('hasTargetRepo returns false initially', () => {
    expect(hasTargetRepo()).toBe(false);
  });

  it('hasTargetRepo returns true after setting', () => {
    setTargetRepo({ owner: 'ext-owner', repo: 'ext-repo' });
    expect(hasTargetRepo()).toBe(true);
  });

  it('hasTargetRepo returns false after clearing', () => {
    setTargetRepo({ owner: 'ext-owner', repo: 'ext-repo' });
    clearTargetRepo();
    expect(hasTargetRepo()).toBe(false);
  });

  it('registry overrides getRepoInfo even when they differ', () => {
    setTargetRepo({ owner: 'override-owner', repo: 'override-repo' });

    const result = getTargetRepo();
    expect(result).toEqual({ owner: 'override-owner', repo: 'override-repo' });
    expect(getRepoInfo).not.toHaveBeenCalled();
  });
});
