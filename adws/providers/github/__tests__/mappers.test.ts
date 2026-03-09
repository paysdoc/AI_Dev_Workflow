import { describe, it, expect } from 'vitest';
import type { PRDetails, PRReviewComment, PRListItem } from '../../../types/workflowTypes';
import type { MergeRequest, ReviewComment } from '../../types';
import {
  mapPRDetailsToMergeRequest,
  mapPRReviewCommentToReviewComment,
  mapPRListItemToMergeRequest,
} from '../mappers';

describe('mapPRDetailsToMergeRequest', () => {
  const basePRDetails: PRDetails = {
    number: 42,
    title: 'Add feature X',
    body: 'Implements #10 - detailed description',
    state: 'OPEN',
    headBranch: 'feature/issue-10-add-x',
    baseBranch: 'main',
    url: 'https://github.com/acme/widgets/pull/42',
    issueNumber: 10,
    reviewComments: [],
  };

  it('maps all fields correctly', () => {
    const result: MergeRequest = mapPRDetailsToMergeRequest(basePRDetails);

    expect(result.number).toBe(42);
    expect(result.title).toBe('Add feature X');
    expect(result.body).toBe('Implements #10 - detailed description');
    expect(result.sourceBranch).toBe('feature/issue-10-add-x');
    expect(result.targetBranch).toBe('main');
    expect(result.url).toBe('https://github.com/acme/widgets/pull/42');
    expect(result.linkedIssueNumber).toBe(10);
  });

  it('converts null issueNumber to undefined linkedIssueNumber', () => {
    const pr: PRDetails = { ...basePRDetails, issueNumber: null };
    const result = mapPRDetailsToMergeRequest(pr);

    expect(result.linkedIssueNumber).toBeUndefined();
  });

  it('converts non-null issueNumber to linkedIssueNumber', () => {
    const pr: PRDetails = { ...basePRDetails, issueNumber: 99 };
    const result = mapPRDetailsToMergeRequest(pr);

    expect(result.linkedIssueNumber).toBe(99);
  });

  it('handles empty body', () => {
    const pr: PRDetails = { ...basePRDetails, body: '' };
    const result = mapPRDetailsToMergeRequest(pr);

    expect(result.body).toBe('');
  });

  it('does not include GitHub-specific fields (state, reviewComments)', () => {
    const result = mapPRDetailsToMergeRequest(basePRDetails);
    const keys = Object.keys(result);

    expect(keys).not.toContain('state');
    expect(keys).not.toContain('reviewComments');
    expect(keys).not.toContain('headBranch');
    expect(keys).not.toContain('baseBranch');
    expect(keys).not.toContain('issueNumber');
  });
});

describe('mapPRReviewCommentToReviewComment', () => {
  const baseComment: PRReviewComment = {
    id: 12345,
    author: { login: 'reviewer-alice', name: 'Alice', isBot: false },
    body: 'Please fix this',
    path: 'src/index.ts',
    line: 42,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T11:00:00Z',
  };

  it('maps all fields correctly', () => {
    const result: ReviewComment = mapPRReviewCommentToReviewComment(baseComment);

    expect(result.id).toBe('12345');
    expect(result.author).toBe('reviewer-alice');
    expect(result.body).toBe('Please fix this');
    expect(result.createdAt).toBe('2026-01-15T10:00:00Z');
    expect(result.path).toBe('src/index.ts');
    expect(result.line).toBe(42);
  });

  it('converts numeric id to string', () => {
    const comment: PRReviewComment = { ...baseComment, id: 99999 };
    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.id).toBe('99999');
    expect(typeof result.id).toBe('string');
  });

  it('extracts author.login to flat author string', () => {
    const comment: PRReviewComment = {
      ...baseComment,
      author: { login: 'bot-user', name: null, isBot: true },
    };
    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.author).toBe('bot-user');
  });

  it('maps empty path string to undefined', () => {
    const comment: PRReviewComment = { ...baseComment, path: '' };
    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.path).toBeUndefined();
  });

  it('maps null line to undefined', () => {
    const comment: PRReviewComment = { ...baseComment, line: null };
    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.line).toBeUndefined();
  });

  it('preserves non-empty path', () => {
    const comment: PRReviewComment = { ...baseComment, path: 'lib/utils.ts' };
    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.path).toBe('lib/utils.ts');
  });

  it('preserves non-null line', () => {
    const comment: PRReviewComment = { ...baseComment, line: 100 };
    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.line).toBe(100);
  });

  it('does not include GitHub-specific fields (updatedAt)', () => {
    const result = mapPRReviewCommentToReviewComment(baseComment);
    const keys = Object.keys(result);

    expect(keys).not.toContain('updatedAt');
  });
});

describe('mapPRListItemToMergeRequest', () => {
  const baseItem: PRListItem = {
    number: 7,
    headBranch: 'feature/issue-7-new-feature',
    updatedAt: '2026-02-01T08:00:00Z',
  };

  it('maps number and headBranch to sourceBranch', () => {
    const result: MergeRequest = mapPRListItemToMergeRequest(baseItem);

    expect(result.number).toBe(7);
    expect(result.sourceBranch).toBe('feature/issue-7-new-feature');
  });

  it('sets title, body, targetBranch, url to empty strings', () => {
    const result = mapPRListItemToMergeRequest(baseItem);

    expect(result.title).toBe('');
    expect(result.body).toBe('');
    expect(result.targetBranch).toBe('');
    expect(result.url).toBe('');
  });

  it('does not include updatedAt from PRListItem', () => {
    const result = mapPRListItemToMergeRequest(baseItem);
    const keys = Object.keys(result);

    expect(keys).not.toContain('updatedAt');
  });

  it('does not set linkedIssueNumber', () => {
    const result = mapPRListItemToMergeRequest(baseItem);

    expect(result.linkedIssueNumber).toBeUndefined();
  });
});
