import { describe, it, expect } from 'vitest';
import {
  issueNumberFromBranch,
  parsePRDetails,
  parsePRReviews,
  parsePRLineComments,
  parsePRListItems,
  selectPreferredPR,
  isApprovedFromReviewsList,
  parsePRApprovalState,
} from '../ghPrParsers';

describe('issueNumberFromBranch', () => {
  it('extracts the issue number from an ADW branch name', () => {
    expect(issueNumberFromBranch('feature-issue-819-slug')).toBe(819);
  });

  it('returns null for a branch with no issue-N pattern', () => {
    expect(issueNumberFromBranch('main')).toBeNull();
  });

  it('returns null for undefined/null input', () => {
    expect(issueNumberFromBranch(undefined)).toBeNull();
    expect(issueNumberFromBranch(null)).toBeNull();
  });
});

describe('parsePRDetails', () => {
  it('prefers "Implements #N" in the body over the branch name', () => {
    const json = JSON.stringify({
      number: 12, title: 'T', body: 'Implements #12\n\nDetails.', state: 'OPEN',
      headRefName: 'feature-issue-7-x', baseRefName: 'main', url: 'https://x',
    });
    expect(parsePRDetails(json).issueNumber).toBe(12);
  });

  it('falls back to the branch name when the body has no marker', () => {
    const json = JSON.stringify({
      number: 7, title: 'T', body: 'no marker here', state: 'OPEN',
      headRefName: 'feature-issue-42-abc-ship', baseRefName: 'main', url: 'https://x',
    });
    expect(parsePRDetails(json).issueNumber).toBe(42);
  });

  it('is null when neither the body nor the branch names an issue', () => {
    const json = JSON.stringify({
      number: 7, title: 'T', body: 'nothing', state: 'OPEN',
      headRefName: 'main', baseRefName: 'main', url: 'https://x',
    });
    expect(parsePRDetails(json).issueNumber).toBeNull();
  });

  it('defaults body to empty string when absent', () => {
    const json = JSON.stringify({
      number: 7, title: 'T', state: 'OPEN', headRefName: 'main', baseRefName: 'main', url: 'https://x',
    });
    expect(parsePRDetails(json).body).toBe('');
  });
});

describe('parsePRReviews', () => {
  it('drops a PENDING review', () => {
    const json = JSON.stringify([{ id: 1, state: 'PENDING', body: 'draft', submitted_at: '2026-01-01T00:00:00Z' }]);
    expect(parsePRReviews(json)).toEqual([]);
  });

  it('keeps an empty-body CHANGES_REQUESTED review with the placeholder text', () => {
    const json = JSON.stringify([{ id: 2, state: 'CHANGES_REQUESTED', body: '', submitted_at: '2026-01-06T00:00:00Z', user: { login: 'maintainer' } }]);
    const reviews = parsePRReviews(json);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].body).toBe('[Review submitted: CHANGES_REQUESTED]');
  });

  it('maps a Bot user to isBot: true', () => {
    const json = JSON.stringify([{ id: 3, state: 'APPROVED', body: 'lgtm', submitted_at: '2026-01-01T00:00:00Z', user: { login: 'bot[bot]', type: 'Bot' } }]);
    expect(parsePRReviews(json)[0].author.isBot).toBe(true);
  });
});

describe('parsePRLineComments', () => {
  it('maps path/line with original_line fallback', () => {
    const json = JSON.stringify([{ id: 1, body: 'nit', original_line: 12, created_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z', user: { login: 'reviewer' } }]);
    const comments = parsePRLineComments(json);
    expect(comments[0].line).toBe(12);
    expect(comments[0].path).toBe('');
  });
});

describe('parsePRListItems', () => {
  it('maps headRefName to headBranch', () => {
    const json = JSON.stringify([{ number: 1, headRefName: 'feature-x', updatedAt: '2026-01-01T00:00:00Z' }]);
    expect(parsePRListItems(json)).toEqual([{ number: 1, headBranch: 'feature-x', updatedAt: '2026-01-01T00:00:00Z' }]);
  });
});

function makePREntry(overrides: Partial<{ number: number; state: string; headRefName: string; baseRefName: string; updatedAt: string }> = {}) {
  return {
    number: 1, state: 'OPEN', headRefName: 'feature-branch', baseRefName: 'main', updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('selectPreferredPR', () => {
  it('returns null for an empty list', () => {
    expect(selectPreferredPR([])).toBeNull();
  });

  it('returns the single OPEN PR', () => {
    const pr = makePREntry({ number: 1, state: 'OPEN' });
    expect(selectPreferredPR([pr])).toEqual(pr);
  });

  it('returns OPEN over CLOSED even when closed is newer (#508 regression)', () => {
    const closed = makePREntry({ number: 1, state: 'CLOSED', updatedAt: '2024-02-01T00:00:00Z' });
    const open = makePREntry({ number: 2, state: 'OPEN', updatedAt: '2024-01-01T00:00:00Z' });
    expect(selectPreferredPR([closed, open])?.number).toBe(2);
  });

  it('returns the most-recently-updated when multiple OPEN PRs exist', () => {
    const older = makePREntry({ number: 1, state: 'OPEN', updatedAt: '2024-01-01T00:00:00Z' });
    const newer = makePREntry({ number: 2, state: 'OPEN', updatedAt: '2024-03-01T00:00:00Z' });
    expect(selectPreferredPR([older, newer])?.number).toBe(2);
  });

  it('falls back to most-recently-updated overall when none are open', () => {
    const closed = makePREntry({ number: 1, state: 'CLOSED', updatedAt: '2024-01-01T00:00:00Z' });
    const merged = makePREntry({ number: 2, state: 'MERGED', updatedAt: '2024-03-01T00:00:00Z' });
    expect(selectPreferredPR([closed, merged])?.number).toBe(2);
  });
});

function makeReview(login: string | null, state: string, submittedAt: string) {
  return { author: login ? { login } : null, state, submittedAt };
}

describe('isApprovedFromReviewsList', () => {
  it('returns false for an empty list', () => {
    expect(isApprovedFromReviewsList([])).toBe(false);
  });

  it('returns true for a single APPROVED review', () => {
    expect(isApprovedFromReviewsList([makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')])).toBe(true);
  });

  it('returns false for a single CHANGES_REQUESTED review', () => {
    expect(isApprovedFromReviewsList([makeReview('alice', 'CHANGES_REQUESTED', '2024-01-01T00:00:00Z')])).toBe(false);
  });

  it('returns true when two reviewers both APPROVED', () => {
    expect(isApprovedFromReviewsList([
      makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'),
      makeReview('bob', 'APPROVED', '2024-01-02T00:00:00Z'),
    ])).toBe(true);
  });

  it('returns false when one reviewer APPROVED and another CHANGES_REQUESTED', () => {
    expect(isApprovedFromReviewsList([
      makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'),
      makeReview('bob', 'CHANGES_REQUESTED', '2024-01-02T00:00:00Z'),
    ])).toBe(false);
  });

  it('returns false when the same reviewer APPROVED then CHANGES_REQUESTED (latest wins)', () => {
    expect(isApprovedFromReviewsList([
      makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'),
      makeReview('alice', 'CHANGES_REQUESTED', '2024-01-02T00:00:00Z'),
    ])).toBe(false);
  });

  it('returns true when the same reviewer CHANGES_REQUESTED then APPROVED (latest wins)', () => {
    expect(isApprovedFromReviewsList([
      makeReview('alice', 'CHANGES_REQUESTED', '2024-01-01T00:00:00Z'),
      makeReview('alice', 'APPROVED', '2024-01-02T00:00:00Z'),
    ])).toBe(true);
  });

  it('returns true when the same reviewer APPROVED then DISMISSED (DISMISSED is not substantive)', () => {
    expect(isApprovedFromReviewsList([
      makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'),
      makeReview('alice', 'DISMISSED', '2024-01-02T00:00:00Z'),
    ])).toBe(true);
  });

  it('silently ignores null-author reviews when a real reviewer approved', () => {
    expect(isApprovedFromReviewsList([
      makeReview(null, 'APPROVED', '2024-01-01T00:00:00Z'),
      makeReview('bob', 'APPROVED', '2024-01-02T00:00:00Z'),
    ])).toBe(true);
  });

  it('returns false for only null-author reviews', () => {
    expect(isApprovedFromReviewsList([makeReview(null, 'APPROVED', '2024-01-01T00:00:00Z')])).toBe(false);
  });
});

describe('parsePRApprovalState', () => {
  it.each([
    ['APPROVED', [], true],
    ['CHANGES_REQUESTED', [], false],
    ['REVIEW_REQUIRED', [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')], false],
    [null, [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')], true],
    [null, [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'), makeReview('bob', 'APPROVED', '2024-01-02T00:00:00Z')], true],
    [null, [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'), makeReview('bob', 'CHANGES_REQUESTED', '2024-01-02T00:00:00Z')], false],
    [null, [], false],
    ['', [], false],
    ['', [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')], true],
    ['', [makeReview('alice', 'CHANGES_REQUESTED', '2024-01-01T00:00:00Z')], false],
    [undefined, [], false],
    [undefined, [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')], true],
  ])('reviewDecision=%s, reviews=%j -> %s', (reviewDecision, reviews, expected) => {
    const json = JSON.stringify({ reviewDecision, reviews });
    expect(parsePRApprovalState(json)).toBe(expected);
  });

  it('the gh-throws case is a port-level error policy, not a parser concern (parser assumes valid JSON)', () => {
    expect(() => parsePRApprovalState('not json')).toThrow();
  });
});
