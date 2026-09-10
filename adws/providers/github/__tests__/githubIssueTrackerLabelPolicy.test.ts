/**
 * Proves the adapter's addLabel/applyLabel stay two distinct error policies —
 * addLabel fails open (swallows), applyLabel rethrows anything that is not a
 * "not found" error. Driven over a real GitContext with an exec fake that
 * throws on every command — no `vi.mock` of any `adws/github/*` module.
 */
import { describe, it, expect } from 'vitest';
import { createGitHubIssueTracker } from '../githubIssueTracker';
import { Platform, type RepoIdentifier } from '../../types';
import { makeCtx } from './gitContextFixture';

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };

describe('GitHubIssueTracker — label policy separation', () => {
  it('addLabel swallows a throw from the underlying gh call (fail-open)', () => {
    const exec = (): string => { throw new Error('gh api error: 500'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);
    expect(() => tracker.addLabel(42, 'hitl')).not.toThrow();
  });

  it('applyLabel propagates a non-"not found" throw from the underlying gh call', () => {
    const exec = (): string => { throw new Error('gh api error: 500'); };
    const tracker = createGitHubIssueTracker(makeCtx({}, exec), REPO_ID);
    expect(() => tracker.applyLabel(42, 'adw:blocked')).toThrow('gh api error: 500');
  });
});
