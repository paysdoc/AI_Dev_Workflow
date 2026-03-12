import { describe, it, expect } from 'vitest';
import { isActionableComment, isClearComment, ADW_SIGNATURE } from '../../core/workflowCommentParsing';

/**
 * Tests for the qualifying-issue logic used by the cron trigger.
 * The cron trigger's `isQualifyingIssue` function is module-private,
 * so we replicate its allow-list logic here using the shared `isActionableComment` utility.
 */

interface RawIssue {
  number: number;
  comments: { body: string }[];
  createdAt: string;
}

/** Replicates the cron trigger's isQualifyingIssue allow-list logic for testing. */
function isQualifyingIssue(issue: RawIssue): boolean {
  if (issue.comments.length === 0) return true;

  const latestComment = issue.comments[issue.comments.length - 1];
  return isActionableComment(latestComment.body) || isClearComment(latestComment.body);
}

describe('isQualifyingIssue (cron trigger logic)', () => {
  it('qualifies issue with no comments', () => {
    const issue: RawIssue = { number: 1, comments: [], createdAt: '2025-01-01T00:00:00Z' };
    expect(isQualifyingIssue(issue)).toBe(true);
  });

  it('does not qualify issue where latest comment is ADW comment', () => {
    const issue: RawIssue = {
      number: 2,
      comments: [
        { body: '## :hammer_and_wrench: Implementing Solution\n\n**ADW ID:** `adw-123-abc`' },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(false);
  });

  it('qualifies issue where latest comment contains ## Take action', () => {
    const issue: RawIssue = {
      number: 3,
      comments: [
        { body: '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`' },
        { body: '## Take action\n\nPlease also update the tests' },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(true);
  });

  it('does not qualify issue where latest comment is a human comment without ## Take action', () => {
    const issue: RawIssue = {
      number: 3,
      comments: [
        { body: 'Please also update the tests' },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(false);
  });

  it('does not qualify issue where latest comment has emoji not in heading format', () => {
    const issue: RawIssue = {
      number: 5,
      comments: [{ body: ':thumbsup: this looks good to me' }],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(false);
  });

  it('does not qualify when latest comment is a Vercel bot comment', () => {
    const issue: RawIssue = {
      number: 6,
      comments: [{ body: '[vc]: #abc123\nDeployment preview ready' }],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(false);
  });

  it('does not qualify when latest comment is a generic bot comment', () => {
    const issue: RawIssue = {
      number: 7,
      comments: [{ body: 'Coverage report: 85% (+2.3%) on branch feature/issue-7' }],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(false);
  });

  it('qualifies when latest comment contains ## Take action even with other text', () => {
    const issue: RawIssue = {
      number: 8,
      comments: [{ body: 'Some context here\n\n## Take action\n\nPlease re-run the workflow' }],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(true);
  });

  it('qualifies issue where latest comment is ## Clear', () => {
    const issue: RawIssue = {
      number: 9,
      comments: [
        { body: '## :tada: ADW Workflow Completed\n\n**ADW ID:** `adw-123-abc`' },
        { body: '## Clear' },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(true);
  });

  it('qualifies issue where latest comment is ## clear (lowercase)', () => {
    const issue: RawIssue = {
      number: 10,
      comments: [{ body: '## clear' }],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(true);
  });

  it('qualifies issue where latest comment contains ## Clear with surrounding text', () => {
    const issue: RawIssue = {
      number: 11,
      comments: [{ body: 'Some context\n\n## Clear\n\nPlease reset' }],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(true);
  });
});

describe('webhook issue_comment filtering', () => {
  it('identifies comment with ## Take action as actionable', () => {
    const body = '## Take action\n\nCan you also fix the styling issue?';
    expect(isActionableComment(body)).toBe(true);
  });

  it('identifies comment without directive as non-actionable', () => {
    const body = 'Can you also fix the styling issue?';
    expect(isActionableComment(body)).toBe(false);
  });

  it('identifies ADW system comment as non-actionable', () => {
    const body = '## :rocket: ADW Workflow Started\n\n**ADW ID:** `adw-123-abc`';
    expect(isActionableComment(body)).toBe(false);
  });

  it('identifies Vercel bot comment as non-actionable', () => {
    const body = '[vc]: #abc123\nDeployment preview ready at https://example.vercel.app';
    expect(isActionableComment(body)).toBe(false);
  });
});

describe('cron deferral logic', () => {
  it('qualifying issue with ## Take action comment is detected', () => {
    const issue: RawIssue = {
      number: 10,
      comments: [
        { body: '## :tada: ADW Workflow Completed\n\n**ADW ID:** `adw-123-abc`' },
        { body: '## Take action\n\nActually, can you also handle edge case X?' },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(true);
  });

  it('issue with completed ADW comment only does not qualify', () => {
    const issue: RawIssue = {
      number: 11,
      comments: [
        { body: '## :tada: ADW Workflow Completed\n\n**ADW ID:** `adw-123-abc`' },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(false);
  });

  it('ADW comment with signature marker does not qualify', () => {
    const issue: RawIssue = {
      number: 12,
      comments: [
        { body: `Some update text${ADW_SIGNATURE}` },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(false);
  });

  it('human comment mentioning "adw" without ## Take action does not qualify', () => {
    const issue: RawIssue = {
      number: 13,
      comments: [
        { body: 'Please re-run adw for this issue' },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(false);
  });

  it('human comment without ## Take action does not qualify', () => {
    const issue: RawIssue = {
      number: 14,
      comments: [
        { body: 'Can you also update the documentation?' },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(isQualifyingIssue(issue)).toBe(false);
  });
});
