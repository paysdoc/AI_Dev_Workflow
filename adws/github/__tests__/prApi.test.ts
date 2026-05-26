import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepoInfo } from '../githubApi';

vi.mock('../../core', () => ({
  execWithRetry: vi.fn(),
  log: vi.fn(),
}));

import { fetchPRApprovalState, isApprovedFromReviewsList, selectPreferredPR } from '../prApi';
import { execWithRetry, log } from '../../core';

const mockExec = vi.mocked(execWithRetry);
const mockLog = vi.mocked(log);

const repoInfo: RepoInfo = { owner: 'acme', repo: 'widgets' };

function makeReview(
  login: string | null,
  state: string,
  submittedAt: string,
): { author: { login: string } | null; state: string; submittedAt: string } {
  return { author: login ? { login } : null, state, submittedAt };
}

// ── isApprovedFromReviewsList ────────────────────────────────────────────────

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

  it('returns false when same reviewer APPROVED then CHANGES_REQUESTED (latest wins)', () => {
    expect(isApprovedFromReviewsList([
      makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'),
      makeReview('alice', 'CHANGES_REQUESTED', '2024-01-02T00:00:00Z'),
    ])).toBe(false);
  });

  it('returns true when same reviewer CHANGES_REQUESTED then APPROVED (latest wins)', () => {
    expect(isApprovedFromReviewsList([
      makeReview('alice', 'CHANGES_REQUESTED', '2024-01-01T00:00:00Z'),
      makeReview('alice', 'APPROVED', '2024-01-02T00:00:00Z'),
    ])).toBe(true);
  });

  it('returns true when same reviewer APPROVED then DISMISSED (DISMISSED is ignored, not substantive)', () => {
    // DISMISSED is filtered out from substantive reviews (only APPROVED/CHANGES_REQUESTED are substantive).
    // The latest substantive review for alice remains APPROVED → returns true.
    expect(isApprovedFromReviewsList([
      makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'),
      makeReview('alice', 'DISMISSED', '2024-01-02T00:00:00Z'),
    ])).toBe(true);
  });

  it('silently ignores reviews with author === null', () => {
    expect(isApprovedFromReviewsList([
      makeReview(null, 'APPROVED', '2024-01-01T00:00:00Z'),
      makeReview('bob', 'APPROVED', '2024-01-02T00:00:00Z'),
    ])).toBe(true);
  });

  it('returns false for only null-author reviews', () => {
    expect(isApprovedFromReviewsList([
      makeReview(null, 'APPROVED', '2024-01-01T00:00:00Z'),
    ])).toBe(false);
  });
});

// ── fetchPRApprovalState ─────────────────────────────────────────────────────

describe('fetchPRApprovalState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when reviewDecision is APPROVED', () => {
    mockExec.mockReturnValue(JSON.stringify({ reviewDecision: 'APPROVED', reviews: [] }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(true);
  });

  it('returns false when reviewDecision is CHANGES_REQUESTED', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: 'CHANGES_REQUESTED',
      reviews: [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(false);
  });

  it('returns false when reviewDecision is REVIEW_REQUIRED', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: 'REVIEW_REQUIRED',
      reviews: [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(false);
  });

  it('returns true when reviewDecision is null and single APPROVED review', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: null,
      reviews: [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(true);
  });

  it('returns true when reviewDecision is null and two reviewers both APPROVED', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: null,
      reviews: [
        makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'),
        makeReview('bob', 'APPROVED', '2024-01-02T00:00:00Z'),
      ],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(true);
  });

  it('returns false when reviewDecision is null and one APPROVED, one CHANGES_REQUESTED', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: null,
      reviews: [
        makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'),
        makeReview('bob', 'CHANGES_REQUESTED', '2024-01-02T00:00:00Z'),
      ],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(false);
  });

  it('returns false when reviewDecision is null and same reviewer APPROVED then CHANGES_REQUESTED', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: null,
      reviews: [
        makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z'),
        makeReview('alice', 'CHANGES_REQUESTED', '2024-01-02T00:00:00Z'),
      ],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(false);
  });

  it('returns true when reviewDecision is null and same reviewer CHANGES_REQUESTED then APPROVED', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: null,
      reviews: [
        makeReview('alice', 'CHANGES_REQUESTED', '2024-01-01T00:00:00Z'),
        makeReview('alice', 'APPROVED', '2024-01-02T00:00:00Z'),
      ],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(true);
  });

  it('returns false when reviewDecision is null and empty reviews list', () => {
    mockExec.mockReturnValue(JSON.stringify({ reviewDecision: null, reviews: [] }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(false);
  });

  it('returns false when reviewDecision is "" and empty reviews list', () => {
    mockExec.mockReturnValue(JSON.stringify({ reviewDecision: '', reviews: [] }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(false);
  });

  it('returns true when reviewDecision is "" and a single APPROVED review (unprotected repo)', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: '',
      reviews: [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(true);
  });

  it('returns false when reviewDecision is "" and a CHANGES_REQUESTED review', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: '',
      reviews: [makeReview('alice', 'CHANGES_REQUESTED', '2024-01-01T00:00:00Z')],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(false);
  });

  it('returns false when reviewDecision is undefined (treated as no decision)', () => {
    mockExec.mockReturnValue(JSON.stringify({ reviewDecision: undefined, reviews: [] }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(false);
  });

  it('returns true when reviewDecision is undefined and a single APPROVED review', () => {
    mockExec.mockReturnValue(JSON.stringify({
      reviewDecision: undefined,
      reviews: [makeReview('alice', 'APPROVED', '2024-01-01T00:00:00Z')],
    }));
    expect(fetchPRApprovalState(42, repoInfo)).toBe(true);
  });

  it('returns false and logs a warning when the gh CLI throws', () => {
    mockExec.mockImplementation(() => { throw new Error('gh: command failed'); });
    expect(fetchPRApprovalState(42, repoInfo)).toBe(false);
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('fetchPRApprovalState'),
      'warn',
    );
  });
});

// ── selectPreferredPR ──────────────────────────────────────────────────────────

function makePREntry(overrides: {
  number?: number;
  state?: string;
  headRefName?: string;
  baseRefName?: string;
  updatedAt?: string;
} = {}) {
  return {
    number: 1,
    state: 'OPEN',
    headRefName: 'feature-branch',
    baseRefName: 'main',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('selectPreferredPR', () => {
  it('returns null for an empty list', () => {
    expect(selectPreferredPR([])).toBeNull();
  });

  it('returns single OPEN PR', () => {
    const pr = makePREntry({ number: 1, state: 'OPEN' });
    expect(selectPreferredPR([pr])).toEqual(pr);
  });

  it('returns OPEN PR over CLOSED even when closed is newer (#508 regression)', () => {
    const closed = makePREntry({ number: 1, state: 'CLOSED', updatedAt: '2024-02-01T00:00:00Z' });
    const open = makePREntry({ number: 2, state: 'OPEN', updatedAt: '2024-01-01T00:00:00Z' });
    expect(selectPreferredPR([closed, open])?.number).toBe(2);
  });

  it('returns most-recently-updated when multiple OPEN PRs exist', () => {
    const older = makePREntry({ number: 1, state: 'OPEN', updatedAt: '2024-01-01T00:00:00Z' });
    const newer = makePREntry({ number: 2, state: 'OPEN', updatedAt: '2024-03-01T00:00:00Z' });
    expect(selectPreferredPR([older, newer])?.number).toBe(2);
  });

  it('falls back to most-recently-updated overall when no OPEN PRs exist', () => {
    const closed = makePREntry({ number: 1, state: 'CLOSED', updatedAt: '2024-01-01T00:00:00Z' });
    const merged = makePREntry({ number: 2, state: 'MERGED', updatedAt: '2024-03-01T00:00:00Z' });
    expect(selectPreferredPR([closed, merged])?.number).toBe(2);
  });
});
