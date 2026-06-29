import { describe, it, expect, vi } from 'vitest';
import { resolvePrReviewTarget } from '../resolvePrReviewTarget';

function makeComment(adwId: string): { body: string } {
  return { body: `**ADW ID:** \`${adwId}\`` };
}

describe('resolvePrReviewTarget', () => {
  describe('reuse path', () => {
    it('returns reuse when issue comments carry an existing adwId', () => {
      const generateAdwId = vi.fn(() => 'should-not-be-called');
      const result = resolvePrReviewTarget(
        { issueNumber: 100, title: 'Some PR' },
        {
          fetchIssueComments: () => [makeComment('existing-adw-id')],
          generateAdwId,
        },
      );
      expect(result.kind).toBe('reuse');
      if (result.kind === 'reuse') {
        expect(result.issueNumber).toBe(100);
        expect(result.adwId).toBe('existing-adw-id');
      }
      expect(generateAdwId).not.toHaveBeenCalled();
    });

    it('reuses the latest (newest) adwId when multiple ADW comments exist', () => {
      const generateAdwId = vi.fn(() => 'should-not-be-called');
      const result = resolvePrReviewTarget(
        { issueNumber: 200, title: 'Multi-comment PR' },
        {
          fetchIssueComments: () => [
            makeComment('older-adw-id'),
            makeComment('newer-adw-id'),
          ],
          generateAdwId,
        },
      );
      expect(result.kind).toBe('reuse');
      if (result.kind === 'reuse') {
        expect(result.adwId).toBe('newer-adw-id');
      }
      expect(generateAdwId).not.toHaveBeenCalled();
    });
  });

  describe('fresh path', () => {
    it('generates a fresh adwId when the issue has no ADW comments', () => {
      const generateAdwId = vi.fn(() => 'fresh-generated-id');
      const result = resolvePrReviewTarget(
        { issueNumber: 300, title: 'Brand New PR' },
        {
          fetchIssueComments: () => [],
          generateAdwId,
        },
      );
      expect(result.kind).toBe('fresh');
      if (result.kind === 'fresh') {
        expect(result.issueNumber).toBe(300);
        expect(result.adwId).toBe('fresh-generated-id');
      }
      expect(generateAdwId).toHaveBeenCalledOnce();
      expect(generateAdwId).toHaveBeenCalledWith('Brand New PR');
    });

    it('generates a fresh adwId when comments exist but contain no ADW id', () => {
      const generateAdwId = vi.fn(() => 'another-fresh-id');
      const result = resolvePrReviewTarget(
        { issueNumber: 400, title: 'PR with non-ADW comments' },
        {
          fetchIssueComments: () => [{ body: 'just a regular comment' }],
          generateAdwId,
        },
      );
      expect(result.kind).toBe('fresh');
      if (result.kind === 'fresh') {
        expect(result.adwId).toBe('another-fresh-id');
      }
      expect(generateAdwId).toHaveBeenCalledOnce();
    });
  });

  describe('skip path', () => {
    it('returns skip when issueNumber is null', () => {
      const fetchIssueComments = vi.fn(() => []);
      const generateAdwId = vi.fn(() => 'should-not-be-called');
      const result = resolvePrReviewTarget(
        { issueNumber: null, title: 'Issue-less PR' },
        { fetchIssueComments, generateAdwId },
      );
      expect(result.kind).toBe('skip');
      if (result.kind === 'skip') {
        expect(result.reason).toBe('not-issue-linked');
      }
      expect(fetchIssueComments).not.toHaveBeenCalled();
      expect(generateAdwId).not.toHaveBeenCalled();
    });
  });
});
