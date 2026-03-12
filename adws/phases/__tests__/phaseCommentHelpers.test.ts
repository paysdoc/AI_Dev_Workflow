import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return { ...actual, log: vi.fn() };
});

vi.mock('../../github/workflowCommentsIssue', () => ({
  formatWorkflowComment: vi.fn().mockReturnValue('formatted issue comment'),
}));

vi.mock('../../github/workflowCommentsPR', () => ({
  formatPRReviewWorkflowComment: vi.fn().mockReturnValue('formatted PR comment'),
}));

import { log } from '../../core';
import { formatWorkflowComment } from '../../github/workflowCommentsIssue';
import { formatPRReviewWorkflowComment } from '../../github/workflowCommentsPR';
import { postIssueStageComment, postPRStageComment } from '../phaseCommentHelpers';
import { makeRepoContext } from './helpers/makeRepoContext';
import type { WorkflowContext, PRReviewWorkflowContext } from '../../github';

describe('postIssueStageComment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('formats and posts comment via issueTracker', () => {
    const repoContext = makeRepoContext();
    const ctx: WorkflowContext = { issueNumber: 42, adwId: 'adw-test' };

    postIssueStageComment(repoContext, 42, 'starting', ctx);

    expect(formatWorkflowComment).toHaveBeenCalledWith('starting', ctx);
    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, 'formatted issue comment');
  });

  it('catches and logs errors without throwing', () => {
    const repoContext = makeRepoContext();
    repoContext.issueTracker.commentOnIssue.mockImplementation(() => { throw new Error('API error'); });
    const ctx: WorkflowContext = { issueNumber: 42, adwId: 'adw-test' };

    expect(() => postIssueStageComment(repoContext, 42, 'error', ctx)).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Failed to post workflow comment for stage 'error'"), 'error');
  });
});

describe('postPRStageComment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('formats and posts comment via codeHost', () => {
    const repoContext = makeRepoContext();
    const ctx: PRReviewWorkflowContext = { issueNumber: 1, adwId: 'adw-test', prNumber: 10, reviewComments: 3 };

    postPRStageComment(repoContext, 10, 'pr_review_starting', ctx);

    expect(formatPRReviewWorkflowComment).toHaveBeenCalledWith('pr_review_starting', ctx);
    expect(repoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(10, 'formatted PR comment');
  });

  it('catches and logs errors without throwing', () => {
    const repoContext = makeRepoContext();
    repoContext.codeHost.commentOnMergeRequest.mockImplementation(() => { throw new Error('API error'); });
    const ctx: PRReviewWorkflowContext = { issueNumber: 1, adwId: 'adw-test', prNumber: 10, reviewComments: 3 };

    expect(() => postPRStageComment(repoContext, 10, 'pr_review_error', ctx)).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Failed to post PR workflow comment for stage 'pr_review_error'"), 'error');
  });
});
