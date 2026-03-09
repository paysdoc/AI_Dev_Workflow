import { describe, it, expect } from 'vitest';
import type { PRDetails, PRReviewComment, PRListItem } from '../../../types/workflowTypes';
import {
  mapPRDetailsToMergeRequest,
  mapPRReviewCommentToReviewComment,
  mapPRListItemToMergeRequest,
} from '../mappers';

describe('mapPRDetailsToMergeRequest', () => {
  const fullPR: PRDetails = {
    number: 42,
    title: 'feat: add login',
    body: 'Implements #12\n\nDescription here',
    state: 'OPEN',
    headBranch: 'feature/issue-12-login',
    baseBranch: 'main',
    url: 'https://github.com/acme/widgets/pull/42',
    issueNumber: 12,
    reviewComments: [],
  };

  it('maps all fields correctly with full data', () => {
    const result = mapPRDetailsToMergeRequest(fullPR);

    expect(result).toEqual({
      number: 42,
      title: 'feat: add login',
      body: 'Implements #12\n\nDescription here',
      sourceBranch: 'feature/issue-12-login',
      targetBranch: 'main',
      url: 'https://github.com/acme/widgets/pull/42',
      linkedIssueNumber: 12,
    });
  });

  it('maps null issueNumber to undefined linkedIssueNumber', () => {
    const pr: PRDetails = { ...fullPR, issueNumber: null };

    const result = mapPRDetailsToMergeRequest(pr);

    expect(result.linkedIssueNumber).toBeUndefined();
  });

  it('maps empty body as empty string', () => {
    const pr: PRDetails = { ...fullPR, body: '' };

    const result = mapPRDetailsToMergeRequest(pr);

    expect(result.body).toBe('');
  });
});

describe('mapPRReviewCommentToReviewComment', () => {
  const fullComment: PRReviewComment = {
    id: 999,
    author: { login: 'reviewer', name: 'Reviewer', isBot: false },
    body: 'Please fix this',
    path: 'src/app.ts',
    line: 42,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  };

  it('maps all fields correctly with full data', () => {
    const result = mapPRReviewCommentToReviewComment(fullComment);

    expect(result).toEqual({
      id: '999',
      body: 'Please fix this',
      author: 'reviewer',
      createdAt: '2026-01-01T00:00:00Z',
      path: 'src/app.ts',
      line: 42,
    });
  });

  it('converts numeric id to string', () => {
    const result = mapPRReviewCommentToReviewComment(fullComment);

    expect(result.id).toBe('999');
    expect(typeof result.id).toBe('string');
  });

  it('maps null line to undefined', () => {
    const comment: PRReviewComment = { ...fullComment, line: null };

    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.line).toBeUndefined();
  });

  it('maps empty path to undefined', () => {
    const comment: PRReviewComment = { ...fullComment, path: '' };

    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.path).toBeUndefined();
  });

  it('maps bot author login correctly', () => {
    const comment: PRReviewComment = {
      ...fullComment,
      author: { login: 'dependabot[bot]', name: null, isBot: true },
    };

    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.author).toBe('dependabot[bot]');
  });

  it('drops updatedAt field', () => {
    const result = mapPRReviewCommentToReviewComment(fullComment);

    expect(result).not.toHaveProperty('updatedAt');
  });
});

describe('mapPRListItemToMergeRequest', () => {
  const item: PRListItem = {
    number: 5,
    headBranch: 'feature/issue-5-auth',
    updatedAt: '2026-03-01T00:00:00Z',
  };

  it('maps number and sourceBranch from PRListItem', () => {
    const result = mapPRListItemToMergeRequest(item);

    expect(result.number).toBe(5);
    expect(result.sourceBranch).toBe('feature/issue-5-auth');
  });

  it('sets unavailable fields to empty strings', () => {
    const result = mapPRListItemToMergeRequest(item);

    expect(result.title).toBe('');
    expect(result.body).toBe('');
    expect(result.targetBranch).toBe('');
    expect(result.url).toBe('');
  });

  it('does not include linkedIssueNumber', () => {
    const result = mapPRListItemToMergeRequest(item);

    expect(result.linkedIssueNumber).toBeUndefined();
  });
});
