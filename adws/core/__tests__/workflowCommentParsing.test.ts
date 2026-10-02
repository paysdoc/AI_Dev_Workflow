import { describe, it, expect } from 'vitest';
import { isRetryComment, isCancelComment, RETRY_COMMENT_PATTERN, parseWorkflowStageFromComment } from '../workflowCommentParsing';

describe('isRetryComment', () => {
  it('matches exact "## Retry" heading', () => {
    expect(isRetryComment('## Retry')).toBe(true);
  });

  it('matches "## retry" (case-insensitive)', () => {
    expect(isRetryComment('## retry')).toBe(true);
  });

  it('matches "## Retry" embedded on its own line in a multiline body', () => {
    const body = 'Some context\n## Retry\nMore text below';
    expect(isRetryComment(body)).toBe(true);
  });

  it('rejects "## Retrying"', () => {
    expect(isRetryComment('## Retrying')).toBe(false);
  });

  it('rejects prose containing the word "retry"', () => {
    expect(isRetryComment('please retry the operation')).toBe(false);
  });

  it('rejects "## Cancel"', () => {
    expect(isRetryComment('## Cancel')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isRetryComment('')).toBe(false);
  });
});

describe('isCancelComment / isRetryComment parity', () => {
  it('isCancelComment("## Retry") === false', () => {
    expect(isCancelComment('## Retry')).toBe(false);
  });

  it('isRetryComment("## Cancel") === false', () => {
    expect(isRetryComment('## Cancel')).toBe(false);
  });
});

describe('RETRY_COMMENT_PATTERN', () => {
  it('does not match "## Retry with extra text"', () => {
    expect(RETRY_COMMENT_PATTERN.test('## Retry with extra text')).toBe(false);
  });
});

describe('parseWorkflowStageFromComment — compaction recovery headings', () => {
  const commentHeaded = (heading: string): string => `## ${heading}\n\n**ADW ID:** \`test-adw\``;

  it('reads the build compaction recovery heading as its stage', () => {
    expect(parseWorkflowStageFromComment(commentHeaded(':warning: Context Compaction Recovery'))).toBe('compaction_recovery');
  });

  it('reads the unit-test compaction recovery heading as its stage', () => {
    expect(parseWorkflowStageFromComment(commentHeaded(':warning: Test Compaction Recovery'))).toBe('test_compaction_recovery');
  });
});
