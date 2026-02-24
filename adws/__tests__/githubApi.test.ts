import { describe, it, expect, vi } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

import { execSync } from 'child_process';
import { fetchPRReviews } from '../github/githubApi';

function makeReview(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    user: { login: 'reviewer', type: 'User' },
    body: 'Please fix this',
    state: 'COMMENTED',
    submitted_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('fetchPRReviews', () => {
  it('includes reviews with non-empty body', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([
      makeReview({ body: 'Some feedback', state: 'COMMENTED' }),
    ]));

    const result = fetchPRReviews('owner', 'repo', 1);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('Some feedback');
  });

  it('includes CHANGES_REQUESTED reviews with empty body', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([
      makeReview({ body: '', state: 'CHANGES_REQUESTED' }),
    ]));

    const result = fetchPRReviews('owner', 'repo', 1);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('[Review submitted: CHANGES_REQUESTED]');
  });

  it('includes CHANGES_REQUESTED reviews with null body', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([
      makeReview({ body: null, state: 'CHANGES_REQUESTED' }),
    ]));

    const result = fetchPRReviews('owner', 'repo', 1);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('[Review submitted: CHANGES_REQUESTED]');
  });

  it('excludes PENDING reviews', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([
      makeReview({ body: 'Draft comment', state: 'PENDING' }),
    ]));

    const result = fetchPRReviews('owner', 'repo', 1);
    expect(result).toHaveLength(0);
  });

  it('excludes APPROVED reviews with empty body', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([
      makeReview({ body: '', state: 'APPROVED' }),
    ]));

    const result = fetchPRReviews('owner', 'repo', 1);
    expect(result).toHaveLength(0);
  });

  it('includes APPROVED reviews with non-empty body', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify([
      makeReview({ body: 'Looks good!', state: 'APPROVED' }),
    ]));

    const result = fetchPRReviews('owner', 'repo', 1);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('Looks good!');
  });
});
