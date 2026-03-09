import { describe, it, expect } from 'vitest';
import { formatWorkflowComment, type WorkflowContext } from '../workflowCommentsIssue';
import type { ReviewIssue } from '../../agents/reviewAgent';

function createBaseContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    issueNumber: 42,
    adwId: 'test-adw-id',
    ...overrides,
  };
}

function createReviewIssue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    reviewIssueNumber: 1,
    screenshotPath: '/img/issue-1.png',
    issueDescription: 'Button is misaligned',
    issueResolution: 'Adjust CSS margin',
    issueSeverity: 'blocker',
    ...overrides,
  };
}

describe('formatWorkflowComment - review_running', () => {
  it('contains review running header and ADW ID', () => {
    const ctx = createBaseContext({ reviewAttempt: 1, maxReviewAttempts: 3 });
    const result = formatWorkflowComment('review_running', ctx);

    expect(result).toContain('Review Running');
    expect(result).toContain('`test-adw-id`');
    expect(result).toContain('<!-- adw-bot -->');
  });

  it('shows attempt info when provided', () => {
    const ctx = createBaseContext({ reviewAttempt: 2, maxReviewAttempts: 3 });
    const result = formatWorkflowComment('review_running', ctx);

    expect(result).toContain('2/3');
  });

  it('omits attempt info when not provided', () => {
    const ctx = createBaseContext();
    const result = formatWorkflowComment('review_running', ctx);

    expect(result).not.toContain('Attempt');
    expect(result).toContain('Review Running');
  });
});

describe('formatWorkflowComment - review_passed', () => {
  it('contains passed header and ADW ID', () => {
    const ctx = createBaseContext({ reviewSummary: 'All checks passed' });
    const result = formatWorkflowComment('review_passed', ctx);

    expect(result).toContain('Review Passed');
    expect(result).toContain('`test-adw-id`');
    expect(result).toContain('All checks passed');
  });

  it('shows non-blocker issues in details section', () => {
    const nonBlocker = createReviewIssue({ issueSeverity: 'tech-debt', reviewIssueNumber: 2, issueDescription: 'Consider refactoring' });
    const ctx = createBaseContext({ reviewIssues: [nonBlocker] });
    const result = formatWorkflowComment('review_passed', ctx);

    expect(result).toContain('<details>');
    expect(result).toContain('Non-blocker issues (1)');
    expect(result).toContain('Consider refactoring');
    expect(result).toContain('tech-debt');
  });

  it('excludes blocker issues from non-blocker details', () => {
    const blocker = createReviewIssue({ issueSeverity: 'blocker' });
    const nonBlocker = createReviewIssue({ issueSeverity: 'skippable', reviewIssueNumber: 2, issueDescription: 'Minor style issue' });
    const ctx = createBaseContext({ reviewIssues: [blocker, nonBlocker] });
    const result = formatWorkflowComment('review_passed', ctx);

    expect(result).toContain('Non-blocker issues (1)');
    expect(result).toContain('Minor style issue');
    expect(result).not.toContain('Button is misaligned');
  });

  it('omits details section when no non-blocker issues', () => {
    const ctx = createBaseContext({ reviewIssues: [] });
    const result = formatWorkflowComment('review_passed', ctx);

    expect(result).not.toContain('<details>');
  });

  it('handles missing reviewSummary gracefully', () => {
    const ctx = createBaseContext();
    const result = formatWorkflowComment('review_passed', ctx);

    expect(result).toContain('Review Passed');
    expect(result).toContain('`test-adw-id`');
  });

  it('handles missing reviewIssues gracefully', () => {
    const ctx = createBaseContext();
    const result = formatWorkflowComment('review_passed', ctx);

    expect(result).not.toContain('<details>');
  });
});

describe('formatWorkflowComment - review_failed', () => {
  it('contains failed header and lists blocker issues', () => {
    const blockers = [
      createReviewIssue({ reviewIssueNumber: 1, issueDescription: 'Button broken' }),
      createReviewIssue({ reviewIssueNumber: 2, issueDescription: 'Form missing validation' }),
    ];
    const ctx = createBaseContext({ reviewIssues: blockers });
    const result = formatWorkflowComment('review_failed', ctx);

    expect(result).toContain('Review Failed');
    expect(result).toContain('Remaining blocker issues (2)');
    expect(result).toContain('Button broken');
    expect(result).toContain('Form missing validation');
    expect(result).toContain('`test-adw-id`');
  });

  it('filters out non-blocker issues from the list', () => {
    const issues = [
      createReviewIssue({ issueSeverity: 'blocker', issueDescription: 'Critical bug' }),
      createReviewIssue({ issueSeverity: 'tech-debt', issueDescription: 'Should refactor' }),
    ];
    const ctx = createBaseContext({ reviewIssues: issues });
    const result = formatWorkflowComment('review_failed', ctx);

    expect(result).toContain('Remaining blocker issues (1)');
    expect(result).toContain('Critical bug');
    expect(result).not.toContain('Should refactor');
  });

  it('handles empty reviewIssues', () => {
    const ctx = createBaseContext({ reviewIssues: [] });
    const result = formatWorkflowComment('review_failed', ctx);

    expect(result).toContain('Review Failed');
    expect(result).not.toContain('Remaining blocker issues');
  });

  it('handles missing reviewIssues', () => {
    const ctx = createBaseContext();
    const result = formatWorkflowComment('review_failed', ctx);

    expect(result).toContain('Review Failed');
  });
});

describe('formatWorkflowComment - review_patching', () => {
  it('shows issue being patched with description and resolution', () => {
    const issue = createReviewIssue({
      reviewIssueNumber: 3,
      issueDescription: 'API returns wrong status code',
      issueResolution: 'Change status from 200 to 201',
    });
    const ctx = createBaseContext({ patchingIssue: issue });
    const result = formatWorkflowComment('review_patching', ctx);

    expect(result).toContain('Patching Review Issue');
    expect(result).toContain('#3');
    expect(result).toContain('API returns wrong status code');
    expect(result).toContain('Change status from 200 to 201');
    expect(result).toContain('`test-adw-id`');
  });

  it('handles missing patchingIssue gracefully', () => {
    const ctx = createBaseContext();
    const result = formatWorkflowComment('review_patching', ctx);

    expect(result).toContain('Patching Review Issue');
    expect(result).toContain('Applying patch for review issue');
    expect(result).toContain('`test-adw-id`');
  });

  it('handles patchingIssue with no resolution', () => {
    const issue = createReviewIssue({
      reviewIssueNumber: 1,
      issueResolution: '',
    });
    const ctx = createBaseContext({ patchingIssue: issue });
    const result = formatWorkflowComment('review_patching', ctx);

    expect(result).toContain('#1');
    expect(result).not.toContain('Proposed resolution');
  });
});
