import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockEnsureRepoWorkspace,
  mockIsRepoCloned,
  mockCloneRepo,
  mockGetTargetRepoWorkspacePath,
  mockEnsureWorkspaceTrusted,
} = vi.hoisted(() => ({
  mockEnsureRepoWorkspace: vi.fn(),
  mockIsRepoCloned: vi.fn(),
  mockCloneRepo: vi.fn(),
  mockGetTargetRepoWorkspacePath: vi.fn(),
  mockEnsureWorkspaceTrusted: vi.fn(),
}));

vi.mock('../../gitContext', () => ({
  ensureRepoWorkspace: mockEnsureRepoWorkspace,
  isRepoCloned: mockIsRepoCloned,
  cloneRepo: mockCloneRepo,
  getTargetRepoWorkspacePath: mockGetTargetRepoWorkspacePath,
}));

vi.mock('../workspaceTrust', () => ({
  ensureWorkspaceTrusted: mockEnsureWorkspaceTrusted,
}));

import { ensureTargetRepoWorkspace } from '../targetRepoManager';
import type { TargetRepoInfo } from '../../types/issueTypes';

const TARGET_REPO: TargetRepoInfo = {
  owner: 'acme',
  repo: 'webapp',
  cloneUrl: 'https://github.com/acme/webapp.git',
};

beforeEach(() => {
  mockEnsureRepoWorkspace.mockReset();
  mockIsRepoCloned.mockReset();
  mockCloneRepo.mockReset();
  mockGetTargetRepoWorkspacePath.mockReset();
  mockEnsureWorkspaceTrusted.mockReset();
  mockEnsureWorkspaceTrusted.mockReturnValue({ action: 'trusted' });
});

describe('ensureTargetRepoWorkspace — workspace trust wiring (#846)', () => {
  it('calls ensureWorkspaceTrusted with the exact workspace path on the fresh-clone branch', () => {
    mockEnsureRepoWorkspace.mockReturnValue('/repos/acme/webapp');
    const getDefaultBranch = vi.fn(() => 'main');

    const result = ensureTargetRepoWorkspace(TARGET_REPO, getDefaultBranch);

    expect(result).toBe('/repos/acme/webapp');
    expect(getDefaultBranch).not.toHaveBeenCalled();
    expect(mockEnsureWorkspaceTrusted).toHaveBeenCalledTimes(1);
    expect(mockEnsureWorkspaceTrusted).toHaveBeenCalledWith(
      '/repos/acme/webapp',
      expect.objectContaining({ log: expect.any(Function) }),
    );
  });

  it('calls ensureWorkspaceTrusted with the exact workspace path on the already-cloned (fetch) branch', () => {
    mockEnsureRepoWorkspace.mockImplementation((_owner: string, _repo: string, _cloneUrl: string, deps: { getDefaultBranch: () => string }) => {
      deps.getDefaultBranch();
      return '/repos/acme/webapp';
    });
    const getDefaultBranch = vi.fn(() => 'main');

    const result = ensureTargetRepoWorkspace(TARGET_REPO, getDefaultBranch);

    expect(result).toBe('/repos/acme/webapp');
    expect(getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(mockEnsureWorkspaceTrusted).toHaveBeenCalledTimes(1);
    expect(mockEnsureWorkspaceTrusted).toHaveBeenCalledWith(
      '/repos/acme/webapp',
      expect.objectContaining({ log: expect.any(Function) }),
    );
  });

  it('passes the SSH-converted clone URL to ensureRepoWorkspace, existing behaviour unchanged', () => {
    mockEnsureRepoWorkspace.mockReturnValue('/repos/acme/webapp');

    ensureTargetRepoWorkspace(TARGET_REPO, () => 'main');

    expect(mockEnsureRepoWorkspace).toHaveBeenCalledWith(
      'acme',
      'webapp',
      'git@github.com:acme/webapp.git',
      expect.objectContaining({ getDefaultBranch: expect.any(Function), log: expect.any(Function) }),
    );
  });

  it('still returns the workspace path when workspace trust is skipped — trust never gates the ensure', () => {
    mockEnsureRepoWorkspace.mockReturnValue('/repos/acme/webapp');
    mockEnsureWorkspaceTrusted.mockReturnValue({ action: 'skipped', reason: 'x' });

    const result = ensureTargetRepoWorkspace(TARGET_REPO, () => 'main');

    expect(result).toBe('/repos/acme/webapp');
  });
});
