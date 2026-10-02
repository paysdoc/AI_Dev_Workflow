import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Platform } from '@paysdoc/devplatform';
import type { GitContext } from '@paysdoc/devplatform/git';

vi.mock('../localRepoIdentity', () => ({ readLocalRepoIdentity: vi.fn() }));

import { REPO_ROOT } from '../environment';
import { readLocalRepoIdentity } from '../localRepoIdentity';
import { isSelfHostLaunch, resetFrameworkIdentityMemo } from '../selfHostLaunch';

const mockedReadIdentity = vi.mocked(readLocalRepoIdentity);

beforeEach(() => {
  vi.clearAllMocks();
  resetFrameworkIdentityMemo();
  mockedReadIdentity.mockReturnValue({ owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub });
});

describe('isSelfHostLaunch', () => {
  it('counts a launch without a GitContext as self-host and never reads the framework identity', () => {
    expect(isSelfHostLaunch(undefined)).toBe(true);
    expect(mockedReadIdentity).not.toHaveBeenCalled();
  });

  it('counts a GitContext that does not say selfHost: false as self-host, even without an owner or repo', () => {
    expect(isSelfHostLaunch({} as unknown as GitContext)).toBe(true);
    expect(mockedReadIdentity).not.toHaveBeenCalled();
  });

  it('counts a self-host GitContext as self-host without reading the framework identity', () => {
    expect(isSelfHostLaunch({ selfHost: true, owner: 'acme', repo: 'widgets' })).toBe(true);
    expect(mockedReadIdentity).not.toHaveBeenCalled();
  });

  it("counts a --target-repo GitContext for the framework's own repository as self-host, compared case-insensitively", () => {
    expect(isSelfHostLaunch({ selfHost: false, owner: 'PaysDoc', repo: 'ai_dev_workflow' })).toBe(true);
    expect(mockedReadIdentity).toHaveBeenCalledWith(REPO_ROOT);
  });

  it('keeps a --target-repo GitContext for any other repository a target', () => {
    expect(isSelfHostLaunch({ selfHost: false, owner: 'acme', repo: 'widgets' })).toBe(false);
  });

  it('keeps every selfHost: false launch a target when the framework checkout has no readable origin', () => {
    mockedReadIdentity.mockImplementation(() => {
      throw new Error('Failed to get repo info: no origin');
    });

    expect(isSelfHostLaunch({ selfHost: false, owner: 'paysdoc', repo: 'AI_Dev_Workflow' })).toBe(false);
  });

  it('reads the framework identity once per process', () => {
    isSelfHostLaunch({ selfHost: false, owner: 'acme', repo: 'widgets' });
    isSelfHostLaunch({ selfHost: false, owner: 'paysdoc', repo: 'depaudit' });

    expect(mockedReadIdentity).toHaveBeenCalledTimes(1);
  });
});
