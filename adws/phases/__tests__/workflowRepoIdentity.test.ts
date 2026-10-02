import { describe, it, expect } from 'vitest';
import { resolveWorkflowRepoId, workflowLaunchContext } from '../workflowRepoIdentity';
import { Platform } from '@paysdoc/devplatform';
import type { WorkflowConfig } from '../workflowInit';
import type { GitContext } from '@paysdoc/devplatform/git';

type Identity = Pick<WorkflowConfig, 'repoContext' | 'gitContext' | 'targetRepo'>;

describe('resolveWorkflowRepoId', () => {
  it('prefers repoContext.repoId when present', () => {
    const config: Identity = {
      repoContext: { repoId: { owner: 'from-repo-context', repo: 'widget', platform: Platform.GitHub } } as WorkflowConfig['repoContext'],
      gitContext: { owner: 'from-git-context', repo: 'widget' } as unknown as GitContext,
      targetRepo: { owner: 'from-target-repo', repo: 'widget', cloneUrl: '' },
    };
    expect(resolveWorkflowRepoId(config)).toEqual({ owner: 'from-repo-context', repo: 'widget', platform: Platform.GitHub });
  });

  it('falls back to gitContext when repoContext is absent', () => {
    const config: Identity = {
      repoContext: undefined,
      gitContext: { owner: 'from-git-context', repo: 'widget' } as unknown as GitContext,
      targetRepo: { owner: 'from-target-repo', repo: 'widget', cloneUrl: '' },
    };
    expect(resolveWorkflowRepoId(config)).toEqual({ owner: 'from-git-context', repo: 'widget', platform: Platform.GitHub });
  });

  it('falls back to targetRepo when neither repoContext nor gitContext is present', () => {
    const config: Identity = { repoContext: undefined, gitContext: undefined, targetRepo: { owner: 'from-target-repo', repo: 'widget', cloneUrl: '' } };
    expect(resolveWorkflowRepoId(config)).toEqual({ owner: 'from-target-repo', repo: 'widget', platform: Platform.GitHub });
  });

  it('throws an actionable error when the config carries no launch identity', () => {
    const config: Identity = { repoContext: undefined, gitContext: undefined, targetRepo: undefined };
    expect(() => resolveWorkflowRepoId(config)).toThrow(/carries no launch identity/);
  });
});

describe('workflowLaunchContext', () => {
  it('takes selfHost from a self-host GitContext and passes adwId and that GitContext through', () => {
    const gitContext = { selfHost: true } as unknown as GitContext;

    const launchContext = workflowLaunchContext({ adwId: 'adw-self', gitContext });

    expect(launchContext).toEqual({ selfHost: true, adwId: 'adw-self', gitContext });
    expect(launchContext.gitContext).toBe(gitContext);
  });

  it('takes selfHost: false from a target-repository GitContext', () => {
    const gitContext = { selfHost: false } as unknown as GitContext;

    expect(workflowLaunchContext({ adwId: 'adw-target', gitContext }).selfHost).toBe(false);
  });

  it('is not derived from a bound RepoContext, which a self-host run binds too', () => {
    const config = {
      adwId: 'adw-self',
      gitContext: { selfHost: true } as unknown as GitContext,
      repoContext: {} as WorkflowConfig['repoContext'],
    };

    expect(workflowLaunchContext(config).selfHost).toBe(true);
  });

  it('counts a config without a GitContext as self-host, so it never injects', () => {
    expect(workflowLaunchContext({ adwId: 'adw-fixture', gitContext: undefined })).toEqual({
      selfHost: true,
      adwId: 'adw-fixture',
      gitContext: undefined,
    });
  });
});
