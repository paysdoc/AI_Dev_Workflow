/**
 * feature-796: GitLab/Jira get refusal stubs for the operations grown onto
 * CodeHost/IssueTracker for this migration wave, not new capabilities. Each
 * stub throws naming the method — proven here for one representative method
 * per class; the remaining stubs follow the identical shape.
 */
import { describe, it, expect } from 'vitest';
import { GitLabCodeHost } from '../gitlab/gitlabCodeHost';
import type { GitLabApiClient } from '../gitlab/gitlabApiClient';
import { JiraIssueTracker } from '../jira/jiraIssueTracker';
import type { JiraApiClient } from '../jira/jiraApiClient';
import { Platform, type RepoIdentifier } from '../types';

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitLab };

describe('GitLabCodeHost — refusal stubs', () => {
  it('approvePullRequest throws naming the method', () => {
    const codeHost = new GitLabCodeHost(REPO_ID, {} as GitLabApiClient);
    expect(() => codeHost.approvePullRequest()).toThrow('GitLabCodeHost.approvePullRequest is not implemented');
  });

  it('listMergedPullRequests throws naming the method', () => {
    const codeHost = new GitLabCodeHost(REPO_ID, {} as GitLabApiClient);
    expect(() => codeHost.listMergedPullRequests()).toThrow('GitLabCodeHost.listMergedPullRequests is not implemented');
  });
});

describe('JiraIssueTracker — refusal stubs', () => {
  it('fetchLabels throws naming the method', () => {
    const tracker = new JiraIssueTracker({} as JiraApiClient, 'ADW');
    expect(() => tracker.fetchLabels()).toThrow('JiraIssueTracker.fetchLabels is not implemented');
  });

  it('listIssues throws naming the method', () => {
    const tracker = new JiraIssueTracker({} as JiraApiClient, 'ADW');
    expect(() => tracker.listIssues()).toThrow('JiraIssueTracker.listIssues is not implemented');
  });
});
