import { describe, it, expect } from 'vitest';
import { resolveWorkflowRepoId } from '../workflowRepoIdentity';
import { Platform } from '../../providers/types';
import type { WorkflowConfig } from '../workflowInit';
import type { GitContext } from '../../gitContext';

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
