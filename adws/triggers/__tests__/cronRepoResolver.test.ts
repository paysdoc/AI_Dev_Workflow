import { describe, it, expect } from 'vitest';
import { resolveCronRepo, buildCronTargetRepoArgs } from '../cronRepoResolver';

describe('resolveCronRepo', () => {
  it('returns target repo when --target-repo is provided', () => {
    const args = ['--target-repo', 'paysdoc/paysdoc.nl', '--clone-url', 'https://github.com/paysdoc/paysdoc.nl.git'];
    const fallback = () => ({ owner: 'paysdoc', repo: 'AI_Dev_Workflow' });

    const result = resolveCronRepo(args, fallback);

    expect(result.repoInfo).toEqual({ owner: 'paysdoc', repo: 'paysdoc.nl' });
  });

  it('falls back to local repo when --target-repo is not provided', () => {
    const args: string[] = [];
    const fallback = () => ({ owner: 'paysdoc', repo: 'AI_Dev_Workflow' });

    const result = resolveCronRepo(args, fallback);

    expect(result.repoInfo).toEqual({ owner: 'paysdoc', repo: 'AI_Dev_Workflow' });
    expect(result.targetRepo).toBeNull();
  });

  it('preserves clone URL from --target-repo args', () => {
    const args = ['--target-repo', 'paysdoc/paysdoc.nl', '--clone-url', 'https://github.com/paysdoc/paysdoc.nl.git'];
    const fallback = () => ({ owner: 'paysdoc', repo: 'AI_Dev_Workflow' });

    const result = resolveCronRepo(args, fallback);

    expect(result.targetRepo).not.toBeNull();
    expect(result.targetRepo!.cloneUrl).toBe('https://github.com/paysdoc/paysdoc.nl.git');
  });
});

describe('buildCronTargetRepoArgs', () => {
  it('uses clone URL from targetRepo when available', () => {
    const repoInfo = { owner: 'paysdoc', repo: 'paysdoc.nl' };
    const targetRepo = { owner: 'paysdoc', repo: 'paysdoc.nl', cloneUrl: 'https://github.com/paysdoc/paysdoc.nl.git' };

    const result = buildCronTargetRepoArgs(repoInfo, targetRepo, () => null);

    expect(result).toEqual([
      '--target-repo', 'paysdoc/paysdoc.nl',
      '--clone-url', 'https://github.com/paysdoc/paysdoc.nl.git',
    ]);
  });

  it('uses fallback clone URL when targetRepo is null', () => {
    const repoInfo = { owner: 'paysdoc', repo: 'AI_Dev_Workflow' };

    const result = buildCronTargetRepoArgs(repoInfo, null, () => 'git@github.com:paysdoc/AI_Dev_Workflow.git');

    expect(result).toEqual([
      '--target-repo', 'paysdoc/AI_Dev_Workflow',
      '--clone-url', 'git@github.com:paysdoc/AI_Dev_Workflow.git',
    ]);
  });

  it('omits --clone-url when targetRepo is null and fallback returns null', () => {
    const repoInfo = { owner: 'paysdoc', repo: 'AI_Dev_Workflow' };

    const result = buildCronTargetRepoArgs(repoInfo, null, () => null);

    expect(result).toEqual(['--target-repo', 'paysdoc/AI_Dev_Workflow']);
  });
});
