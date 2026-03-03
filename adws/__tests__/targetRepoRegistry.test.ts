import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setTargetRepo, getTargetRepo, clearTargetRepo, hasTargetRepo, resolveTargetRepoCwd } from '../core/targetRepoRegistry';

vi.mock('../github/githubApi', () => ({
  getRepoInfo: vi.fn(() => ({ owner: 'local-owner', repo: 'local-repo' })),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../core/targetRepoManager', () => ({
  getTargetRepoWorkspacePath: vi.fn((owner: string, repo: string) => `/repos/${owner}/${repo}`),
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

describe('resolveTargetRepoCwd', () => {
  beforeEach(() => {
    clearTargetRepo();
    vi.clearAllMocks();
  });

  it('returns explicit cwd when provided', () => {
    const result = resolveTargetRepoCwd('/explicit/path');
    expect(result).toBe('/explicit/path');
  });

  it('returns workspace path from registry when no explicit cwd and registry is set', () => {
    setTargetRepo({ owner: 'ext-owner', repo: 'ext-repo' });

    const result = resolveTargetRepoCwd();
    expect(result).toBe('/repos/ext-owner/ext-repo');
  });

  it('returns undefined when no explicit cwd and registry is not set', () => {
    const result = resolveTargetRepoCwd();
    expect(result).toBeUndefined();
  });

  it('explicit cwd takes priority over registry', () => {
    setTargetRepo({ owner: 'ext-owner', repo: 'ext-repo' });

    const result = resolveTargetRepoCwd('/explicit/path');
    expect(result).toBe('/explicit/path');
  });
});
