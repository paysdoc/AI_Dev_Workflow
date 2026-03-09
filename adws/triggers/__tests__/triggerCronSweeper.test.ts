import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core/config', () => ({
  GRACE_PERIOD_MS: 300_000,
  MAX_CONCURRENT_PER_REPO: 5,
}));

import type { RawIssue } from '../trigger_cron';
import { hasAdwWorkflowComment, isWithinGracePeriod, filterEligibleIssues } from '../trigger_cron';

const fiveMinutesAgo = new Date(Date.now() - 300_001).toISOString();
const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
const now = Date.now();

function makeIssue(overrides: Partial<RawIssue> = {}): RawIssue {
  return {
    number: 1,
    body: '',
    comments: [],
    createdAt: fiveMinutesAgo,
    updatedAt: fiveMinutesAgo,
    ...overrides,
  };
}

describe('hasAdwWorkflowComment', () => {
  it('returns true when issue has ADW comment', () => {
    const issue = makeIssue({ comments: [{ body: '## :rocket: ADW Workflow Started\n\n<!-- adw-bot -->' }] });
    expect(hasAdwWorkflowComment(issue)).toBe(true);
  });

  it('returns false when issue has no ADW comment', () => {
    const issue = makeIssue({ comments: [{ body: 'Regular comment' }] });
    expect(hasAdwWorkflowComment(issue)).toBe(false);
  });

  it('returns false when issue has no comments', () => {
    const issue = makeIssue({ comments: [] });
    expect(hasAdwWorkflowComment(issue)).toBe(false);
  });
});

describe('isWithinGracePeriod', () => {
  it('returns true for recently updated issues', () => {
    const issue = makeIssue({ updatedAt: twoMinutesAgo });
    expect(isWithinGracePeriod(issue, now)).toBe(true);
  });

  it('returns false for issues updated beyond grace period', () => {
    const issue = makeIssue({ updatedAt: fiveMinutesAgo });
    expect(isWithinGracePeriod(issue, now)).toBe(false);
  });
});

describe('filterEligibleIssues', () => {
  it('filters out issues with ADW comments', () => {
    const issues = [
      makeIssue({ number: 1, comments: [{ body: '<!-- adw-bot -->' }] }),
      makeIssue({ number: 2, comments: [] }),
    ];
    const result = filterEligibleIssues(issues, now);
    expect(result.map((i) => i.number)).toEqual([2]);
  });

  it('filters out issues within grace period', () => {
    const issues = [
      makeIssue({ number: 1, updatedAt: twoMinutesAgo }),
      makeIssue({ number: 2, updatedAt: fiveMinutesAgo }),
    ];
    const result = filterEligibleIssues(issues, now);
    expect(result.map((i) => i.number)).toEqual([2]);
  });

  it('sorts eligible issues oldest first', () => {
    const older = new Date(Date.now() - 600_000).toISOString();
    const issues = [
      makeIssue({ number: 2, createdAt: fiveMinutesAgo, updatedAt: fiveMinutesAgo }),
      makeIssue({ number: 1, createdAt: older, updatedAt: fiveMinutesAgo }),
    ];
    const result = filterEligibleIssues(issues, now);
    expect(result.map((i) => i.number)).toEqual([1, 2]);
  });

  it('returns empty when all issues are filtered out', () => {
    const issues = [
      makeIssue({ number: 1, comments: [{ body: '<!-- adw-bot -->' }] }),
      makeIssue({ number: 2, updatedAt: twoMinutesAgo }),
    ];
    const result = filterEligibleIssues(issues, now);
    expect(result).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(filterEligibleIssues([], now)).toEqual([]);
  });
});
