import { describe, it, expect } from 'vitest';
import { mergeReviewResults, REVIEW_AGENT_COUNT } from '../reviewRetry';
import { ReviewAgentResult, ReviewIssue, ReviewResult } from '../reviewAgent';

function createReviewIssue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    reviewIssueNumber: 1,
    screenshotPath: '/path/to/issue.png',
    issueDescription: 'Some issue',
    issueResolution: 'Fix it',
    issueSeverity: 'blocker',
    ...overrides,
  };
}

function createAgentResult(overrides: Partial<ReviewAgentResult> & { reviewResult?: ReviewResult | null } = {}): ReviewAgentResult {
  return {
    success: true,
    output: '{}',
    totalCostUsd: 0.5,
    reviewResult: {
      success: true,
      reviewSummary: 'All good',
      reviewIssues: [],
      screenshots: [],
    },
    passed: true,
    blockerIssues: [],
    ...overrides,
  };
}

describe('REVIEW_AGENT_COUNT', () => {
  it('is 3', () => {
    expect(REVIEW_AGENT_COUNT).toBe(3);
  });
});

describe('mergeReviewResults', () => {
  it('merges issues from multiple agents', () => {
    const result1 = createAgentResult({
      reviewResult: {
        success: false, reviewSummary: 'Issues',
        reviewIssues: [createReviewIssue({ reviewIssueNumber: 1, issueDescription: 'Issue A' })],
        screenshots: [],
      },
    });
    const result2 = createAgentResult({
      reviewResult: {
        success: false, reviewSummary: 'Issues',
        reviewIssues: [createReviewIssue({ reviewIssueNumber: 1, issueDescription: 'Issue B' })],
        screenshots: [],
      },
    });
    const result3 = createAgentResult();

    const merged = mergeReviewResults([result1, result2, result3]);

    expect(merged.mergedIssues).toHaveLength(2);
    expect(merged.mergedIssues[0].issueDescription).toBe('Issue A');
    expect(merged.mergedIssues[1].issueDescription).toBe('Issue B');
  });

  it('deduplicates identical issues by trimmed lowercase description', () => {
    const issue = createReviewIssue({ issueDescription: 'Button is broken' });
    const duplicateIssue = createReviewIssue({ issueDescription: '  Button is broken  ' });
    const caseIssue = createReviewIssue({ issueDescription: 'BUTTON IS BROKEN' });

    const result1 = createAgentResult({
      reviewResult: {
        success: false, reviewSummary: 'Issues',
        reviewIssues: [issue], screenshots: [],
      },
    });
    const result2 = createAgentResult({
      reviewResult: {
        success: false, reviewSummary: 'Issues',
        reviewIssues: [duplicateIssue], screenshots: [],
      },
    });
    const result3 = createAgentResult({
      reviewResult: {
        success: false, reviewSummary: 'Issues',
        reviewIssues: [caseIssue], screenshots: [],
      },
    });

    const merged = mergeReviewResults([result1, result2, result3]);

    expect(merged.mergedIssues).toHaveLength(1);
    expect(merged.mergedIssues[0].issueDescription).toBe('Button is broken');
  });

  it('merges and deduplicates screenshots by path', () => {
    const result1 = createAgentResult({
      reviewResult: {
        success: true, reviewSummary: 'Ok',
        reviewIssues: [], screenshots: ['/path/a.png', '/path/b.png'],
      },
    });
    const result2 = createAgentResult({
      reviewResult: {
        success: true, reviewSummary: 'Ok',
        reviewIssues: [], screenshots: ['/path/b.png', '/path/c.png'],
      },
    });

    const merged = mergeReviewResults([result1, result2]);

    expect(merged.mergedScreenshots).toEqual(['/path/a.png', '/path/b.png', '/path/c.png']);
  });

  it('correctly identifies blockers from merged set', () => {
    const blocker = createReviewIssue({ issueSeverity: 'blocker', issueDescription: 'Critical bug' });
    const skippable = createReviewIssue({ issueSeverity: 'skippable', issueDescription: 'Minor thing' });
    const techDebt = createReviewIssue({ issueSeverity: 'tech-debt', issueDescription: 'Refactor needed' });

    const result1 = createAgentResult({
      reviewResult: {
        success: false, reviewSummary: 'Issues',
        reviewIssues: [blocker, skippable], screenshots: [],
      },
    });
    const result2 = createAgentResult({
      reviewResult: {
        success: false, reviewSummary: 'Issues',
        reviewIssues: [techDebt], screenshots: [],
      },
    });

    const merged = mergeReviewResults([result1, result2]);

    expect(merged.mergedIssues).toHaveLength(3);
    expect(merged.blockerIssues).toHaveLength(1);
    expect(merged.blockerIssues[0].issueDescription).toBe('Critical bug');
    expect(merged.passed).toBe(false);
  });

  it('returns passed: true when no blockers exist', () => {
    const skippable = createReviewIssue({ issueSeverity: 'skippable', issueDescription: 'Minor' });

    const result1 = createAgentResult({
      reviewResult: {
        success: true, reviewSummary: 'Ok',
        reviewIssues: [skippable], screenshots: [],
      },
    });

    const merged = mergeReviewResults([result1]);

    expect(merged.passed).toBe(true);
    expect(merged.blockerIssues).toHaveLength(0);
  });

  it('handles agents returning null reviewResult (unparseable output)', () => {
    const validResult = createAgentResult({
      reviewResult: {
        success: false, reviewSummary: 'Issues',
        reviewIssues: [createReviewIssue({ issueDescription: 'Real issue' })],
        screenshots: ['/path/valid.png'],
      },
    });
    const nullResult = createAgentResult({ reviewResult: null });

    const merged = mergeReviewResults([validResult, nullResult, nullResult]);

    expect(merged.mergedIssues).toHaveLength(1);
    expect(merged.mergedScreenshots).toEqual(['/path/valid.png']);
    expect(merged.blockerIssues).toHaveLength(1);
  });

  it('returns passed: true when all agents return null reviewResult', () => {
    const nullResult = createAgentResult({ reviewResult: null });

    const merged = mergeReviewResults([nullResult, nullResult, nullResult]);

    expect(merged.mergedIssues).toHaveLength(0);
    expect(merged.mergedScreenshots).toHaveLength(0);
    expect(merged.passed).toBe(true);
    expect(merged.blockerIssues).toHaveLength(0);
  });

  it('handles empty results array', () => {
    const merged = mergeReviewResults([]);

    expect(merged.mergedIssues).toHaveLength(0);
    expect(merged.mergedScreenshots).toHaveLength(0);
    expect(merged.passed).toBe(true);
    expect(merged.blockerIssues).toHaveLength(0);
  });

  it('deduplicates across all 3 agents finding the same blocker', () => {
    const blocker = createReviewIssue({ issueDescription: 'Missing validation' });

    const results = Array.from({ length: REVIEW_AGENT_COUNT }, () =>
      createAgentResult({
        reviewResult: {
          success: false, reviewSummary: 'Issues',
          reviewIssues: [blocker], screenshots: ['/shared/screenshot.png'],
        },
      })
    );

    const merged = mergeReviewResults(results);

    expect(merged.mergedIssues).toHaveLength(1);
    expect(merged.mergedScreenshots).toHaveLength(1);
    expect(merged.blockerIssues).toHaveLength(1);
    expect(merged.passed).toBe(false);
  });
});
