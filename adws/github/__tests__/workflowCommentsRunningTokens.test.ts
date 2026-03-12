import { describe, it, expect } from 'vitest';
import { formatRunningTokenFooter } from '../workflowCommentsBase';
import { formatWorkflowComment, type WorkflowContext } from '../workflowCommentsIssue';
import { formatPRReviewWorkflowComment, type PRReviewWorkflowContext } from '../workflowCommentsPR';

function createBaseContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    issueNumber: 42,
    adwId: 'test-adw-id',
    ...overrides,
  };
}

function createPRContext(overrides: Partial<PRReviewWorkflowContext> = {}): PRReviewWorkflowContext {
  return {
    issueNumber: 42,
    adwId: 'test-adw-id',
    prNumber: 10,
    reviewComments: 3,
    ...overrides,
  };
}

describe('formatRunningTokenFooter', () => {
  it('returns empty string when undefined', () => {
    expect(formatRunningTokenFooter(undefined)).toBe('');
  });

  it('returns formatted string with token count', () => {
    const result = formatRunningTokenFooter({ total: 1234567 });
    expect(result).toContain('Running Token Total:');
    expect(result).toContain('1,234,567 tokens');
  });

  it('handles zero tokens', () => {
    const result = formatRunningTokenFooter({ total: 0 });
    expect(result).toContain('0 tokens');
  });

  it('formats with locale separators', () => {
    const result = formatRunningTokenFooter({ total: 1000000 });
    expect(result).toContain('1,000,000 tokens');
  });

  it('uses blockquote format', () => {
    const result = formatRunningTokenFooter({ total: 100 });
    expect(result).toContain('> **Running Token Total:**');
  });
});

describe('formatWorkflowComment with running token footer', () => {
  const runningTokenTotal = { inputTokens: 500, outputTokens: 300, cacheCreationTokens: 200, total: 1000 };

  it('includes running token footer when ctx.runningTokenTotal is set', () => {
    const ctx = createBaseContext({ runningTokenTotal });
    const result = formatWorkflowComment('implementing', ctx);

    expect(result).toContain('Running Token Total:');
    expect(result).toContain('1,000 tokens');
  });

  it('does NOT include running token footer when ctx.runningTokenTotal is undefined', () => {
    const ctx = createBaseContext();
    const result = formatWorkflowComment('implementing', ctx);

    expect(result).not.toContain('Running Token Total');
  });

  it('places footer before ADW signature', () => {
    const ctx = createBaseContext({ runningTokenTotal });
    const result = formatWorkflowComment('implementing', ctx);

    const footerIndex = result.indexOf('Running Token Total');
    const signatureIndex = result.indexOf('<!-- adw-bot -->');
    expect(footerIndex).toBeLessThan(signatureIndex);
  });

  it('includes footer on starting comment', () => {
    const ctx = createBaseContext({ runningTokenTotal });
    const result = formatWorkflowComment('starting', ctx);

    expect(result).toContain('1,000 tokens');
  });

  it('includes footer on completed comment', () => {
    const ctx = createBaseContext({ runningTokenTotal, branchName: 'feat-1', prUrl: 'https://github.com/test/pull/1' });
    const result = formatWorkflowComment('completed', ctx);

    expect(result).toContain('1,000 tokens');
  });

  it('includes footer on error comment', () => {
    const ctx = createBaseContext({ runningTokenTotal, errorMessage: 'Something failed' });
    const result = formatWorkflowComment('error', ctx);

    expect(result).toContain('1,000 tokens');
  });

  it('includes footer on review_running comment', () => {
    const ctx = createBaseContext({ runningTokenTotal, reviewAttempt: 1, maxReviewAttempts: 3 });
    const result = formatWorkflowComment('review_running', ctx);

    expect(result).toContain('1,000 tokens');
  });

  it('includes footer on default/unknown stage', () => {
    const ctx = createBaseContext({ runningTokenTotal });
    const result = formatWorkflowComment('some_unknown_stage' as any, ctx);

    expect(result).toContain('1,000 tokens');
  });
});

describe('formatPRReviewWorkflowComment with running token footer', () => {
  const runningTokenTotal = { inputTokens: 2000, outputTokens: 1500, cacheCreationTokens: 500, total: 4000 };

  it('includes running token footer when ctx.runningTokenTotal is set', () => {
    const ctx = createPRContext({ runningTokenTotal });
    const result = formatPRReviewWorkflowComment('pr_review_starting', ctx);

    expect(result).toContain('Running Token Total:');
    expect(result).toContain('4,000 tokens');
  });

  it('does NOT include running token footer when ctx.runningTokenTotal is undefined', () => {
    const ctx = createPRContext();
    const result = formatPRReviewWorkflowComment('pr_review_starting', ctx);

    expect(result).not.toContain('Running Token Total');
  });

  it('includes footer on pr_review_completed', () => {
    const ctx = createPRContext({ runningTokenTotal });
    const result = formatPRReviewWorkflowComment('pr_review_completed', ctx);

    expect(result).toContain('4,000 tokens');
  });

  it('includes footer on pr_review_error', () => {
    const ctx = createPRContext({ runningTokenTotal, errorMessage: 'oops' });
    const result = formatPRReviewWorkflowComment('pr_review_error', ctx);

    expect(result).toContain('4,000 tokens');
  });

  it('includes footer on default/unknown PR stage', () => {
    const ctx = createPRContext({ runningTokenTotal });
    const result = formatPRReviewWorkflowComment('some_unknown_pr_stage' as any, ctx);

    expect(result).toContain('4,000 tokens');
  });

  it('places footer before ADW signature on PR comments', () => {
    const ctx = createPRContext({ runningTokenTotal });
    const result = formatPRReviewWorkflowComment('pr_review_implementing', ctx);

    const footerIndex = result.indexOf('Running Token Total');
    const signatureIndex = result.indexOf('<!-- adw-bot -->');
    expect(footerIndex).toBeLessThan(signatureIndex);
  });
});
