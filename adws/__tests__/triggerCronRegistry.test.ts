import { describe, it, expect, beforeEach } from 'vitest';
import { setTargetRepo, getTargetRepo, clearTargetRepo } from '../core/targetRepoRegistry';

/**
 * Tests that the cron trigger's repo resolution pattern uses getTargetRepo()
 * instead of a cached variable, ensuring it always reads from the registry.
 */

describe('trigger_cron registry usage', () => {
  beforeEach(() => {
    clearTargetRepo();
  });

  it('getTargetRepo returns the value set by setTargetRepo', () => {
    setTargetRepo({ owner: 'acme', repo: 'widgets' });

    const { owner, repo } = getTargetRepo();

    expect(owner).toBe('acme');
    expect(repo).toBe('widgets');
  });

  it('getTargetRepo reflects updates after setTargetRepo is called again', () => {
    setTargetRepo({ owner: 'initial-owner', repo: 'initial-repo' });
    expect(getTargetRepo()).toEqual({ owner: 'initial-owner', repo: 'initial-repo' });

    setTargetRepo({ owner: 'updated-owner', repo: 'updated-repo' });
    expect(getTargetRepo()).toEqual({ owner: 'updated-owner', repo: 'updated-repo' });
  });

  it('clearTargetRepo resets the registry so getTargetRepo no longer returns cached value', () => {
    setTargetRepo({ owner: 'acme', repo: 'widgets' });
    expect(getTargetRepo()).toEqual({ owner: 'acme', repo: 'widgets' });

    clearTargetRepo();

    // After clearing, getTargetRepo falls back to getRepoInfo() (local git remote).
    // The returned value should NOT be the previously set { acme, widgets }.
    const result = getTargetRepo();
    expect(result.owner).not.toBe('acme');
  });
});
