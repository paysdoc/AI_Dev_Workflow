import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../core/costReport', () => ({
  formatCostBreakdownMarkdown: vi.fn(() => '| Model | Cost |\n|---|---|\n| claude | $0.10 |'),
}));

import { execSync } from 'child_process';
import {
  formatPRReviewWorkflowComment,
  postPRWorkflowComment,
  type PRReviewWorkflowContext,
} from '../workflowCommentsPR';
import type { PRReviewWorkflowStage } from '../../core';

const testRepoInfo = { owner: 'test-owner', repo: 'test-repo' };

function makeCtx(overrides: Partial<PRReviewWorkflowContext> = {}): PRReviewWorkflowContext {
  return {
    issueNumber: 42,
    adwId: 'adw-test-abc123',
    prNumber: 10,
    reviewComments: 3,
    ...overrides,
  };
}

describe('formatPRReviewWorkflowComment', () => {
  it('formats pr_review_starting', () => {
    const result = formatPRReviewWorkflowComment('pr_review_starting', makeCtx());

    expect(result).toContain('Addressing PR Review Comments');
    expect(result).toContain('3');
    expect(result).toContain('adw-test-abc123');
  });

  it('formats pr_review_planning', () => {
    const result = formatPRReviewWorkflowComment('pr_review_planning', makeCtx());

    expect(result).toContain('Planning PR Review Changes');
  });

  it('formats pr_review_planned with output', () => {
    const ctx = makeCtx({ revisionPlanOutput: 'Step 1: fix X\nStep 2: fix Y' });
    const result = formatPRReviewWorkflowComment('pr_review_planned', ctx);

    expect(result).toContain('Revision Plan Created');
    expect(result).toContain('Step 1: fix X');
  });

  it('formats pr_review_planned without output', () => {
    const result = formatPRReviewWorkflowComment('pr_review_planned', makeCtx());

    expect(result).toContain('Revision Plan Created');
  });

  it('formats pr_review_implementing', () => {
    const result = formatPRReviewWorkflowComment('pr_review_implementing', makeCtx());

    expect(result).toContain('Implementing Review Changes');
  });

  it('formats pr_review_implemented with build output', () => {
    const ctx = makeCtx({ revisionBuildOutput: 'Fixed 3 files' });
    const result = formatPRReviewWorkflowComment('pr_review_implemented', ctx);

    expect(result).toContain('Review Changes Implemented');
    expect(result).toContain('Fixed 3 files');
  });

  it('formats pr_review_testing', () => {
    const result = formatPRReviewWorkflowComment('pr_review_testing', makeCtx());

    expect(result).toContain('Running Validation Tests');
  });

  it('formats pr_review_test_failed with attempt info', () => {
    const ctx = makeCtx({ testAttempt: 2, maxTestAttempts: 3 });
    const result = formatPRReviewWorkflowComment('pr_review_test_failed', ctx);

    expect(result).toContain('Tests Failed');
    expect(result).toContain('2/3');
  });

  it('formats pr_review_test_passed', () => {
    const result = formatPRReviewWorkflowComment('pr_review_test_passed', makeCtx());

    expect(result).toContain('All Tests Passed');
  });

  it('formats pr_review_test_max_attempts with failed tests', () => {
    const ctx = makeCtx({ maxTestAttempts: 3, failedTests: ['test1.ts', 'test2.ts'] });
    const result = formatPRReviewWorkflowComment('pr_review_test_max_attempts', ctx);

    expect(result).toContain('Exceeded Maximum Retry');
    expect(result).toContain('test1.ts');
    expect(result).toContain('test2.ts');
  });

  it('formats pr_review_committing', () => {
    const result = formatPRReviewWorkflowComment('pr_review_committing', makeCtx());

    expect(result).toContain('Committing Review Changes');
  });

  it('formats pr_review_pushed', () => {
    const result = formatPRReviewWorkflowComment('pr_review_pushed', makeCtx());

    expect(result).toContain('Changes Pushed');
  });

  it('formats pr_review_completed with cost breakdown', () => {
    const ctx = makeCtx({
      costBreakdown: { totalCostUsd: 0.1, modelUsage: {}, currencies: [] },
    });
    const result = formatPRReviewWorkflowComment('pr_review_completed', ctx);

    expect(result).toContain('PR Review Comments Addressed');
    expect(result).toContain('Cost Breakdown');
  });

  it('formats pr_review_completed without cost breakdown', () => {
    const result = formatPRReviewWorkflowComment('pr_review_completed', makeCtx());

    expect(result).toContain('PR Review Comments Addressed');
    expect(result).not.toContain('Cost Breakdown');
  });

  it('formats pr_review_error with error message', () => {
    const ctx = makeCtx({ errorMessage: 'Something went wrong' });
    const result = formatPRReviewWorkflowComment('pr_review_error', ctx);

    expect(result).toContain('PR Review Workflow Error');
    expect(result).toContain('Something went wrong');
  });

  it('formats pr_review_error with cost breakdown', () => {
    const ctx = makeCtx({
      errorMessage: 'fail',
      costBreakdown: { totalCostUsd: 0.05, modelUsage: {}, currencies: [] },
    });
    const result = formatPRReviewWorkflowComment('pr_review_error', ctx);

    expect(result).toContain('Cost Breakdown');
  });

  it('formats unknown stage with default message', () => {
    const result = formatPRReviewWorkflowComment('unknown_stage' as PRReviewWorkflowStage, makeCtx());

    expect(result).toContain('ADW PR Review Update');
    expect(result).toContain('unknown_stage');
  });

  it('all comments include ADW signature', () => {
    const stages: PRReviewWorkflowStage[] = [
      'pr_review_starting', 'pr_review_planning', 'pr_review_testing',
      'pr_review_test_passed', 'pr_review_pushed',
    ];

    for (const stage of stages) {
      const result = formatPRReviewWorkflowComment(stage, makeCtx());
      expect(result).toContain('<!-- adw-bot -->');
    }
  });
});

describe('postPRWorkflowComment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats and posts a comment to the PR', () => {
    vi.mocked(execSync).mockReturnValue('' as any);

    postPRWorkflowComment(10, 'pr_review_starting', makeCtx(), testRepoInfo);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('gh pr comment 10'),
      expect.any(Object),
    );
  });

  it('does not throw when comment posting fails', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });

    expect(() => postPRWorkflowComment(10, 'pr_review_starting', makeCtx(), testRepoInfo)).not.toThrow();
  });
});
