/**
 * Proves the adapter's addLabel/applyLabel stay two distinct error policies —
 * delegation to the real `adws/github/*` functions, not a reimplementation.
 * Deliberately does NOT mock issueApi/labelManager (unlike githubIssueTracker.test.ts):
 * only the underlying gitContextForRepo is faked, so the real fail-open (addLabel)
 * vs. rethrow (applyLabel) policies run end to end through the adapter.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../github/gitContextFactory', () => ({
  gitContextForRepo: vi.fn(() => ({
    addIssueLabel: () => { throw new Error('gh api error: 500'); },
    applyLabel: () => { throw new Error('gh api error: 500'); },
  })),
}));

import { createGitHubIssueTracker } from '../githubIssueTracker';
import { Platform, type RepoIdentifier } from '../../types';

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };

describe('GitHubIssueTracker — label policy separation', () => {
  it('addLabel swallows a throw from the underlying gh call (fail-open)', () => {
    const tracker = createGitHubIssueTracker(REPO_ID);
    expect(() => tracker.addLabel(42, 'hitl')).not.toThrow();
  });

  it('applyLabel propagates a non-"not found" throw from the underlying gh call', () => {
    const tracker = createGitHubIssueTracker(REPO_ID);
    expect(() => tracker.applyLabel(42, 'adw:blocked')).toThrow('gh api error: 500');
  });
});
