import { describe, it, expect } from 'vitest';
import {
  isRetryComment,
  isCancelComment,
  RETRY_COMMENT_PATTERN,
  parseWorkflowStageFromComment,
  extractPlanPathFromComment,
  detectRecoveryState,
} from '../workflowCommentParsing';
import { formatWorkflowComment } from '../../forge/workflowCommentsIssue';
import type { IssueComment } from '@paysdoc/devplatform';

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

const ADW_ID = 'a69x2i-bug-resume-recovers';
const CURRENT_PLAN_PATH = 'specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-fix-resume-plan-path-parsing.md';
const LEGACY_PLAN_PATH = 'specs/issue-1080-plan.md';

const planCreatedBody = (planPath: string, planOutput?: string): string =>
  formatWorkflowComment('plan_created', { issueNumber: 1080, adwId: ADW_ID, planPath, planOutput });

const issueComment = (body: string, createdAt: string): IssueComment =>
  ({ id: createdAt, author: 'adw-bot', createdAt, body });

describe('extractPlanPathFromComment', () => {
  it('ignores a spec path that is not a plan file', () => {
    expect(extractPlanPathFromComment('See `specs/prd/specs-worktree-only-and-docs-relocation.md`')).toBeNull();
  });
});

describe('detectRecoveryState — plan path', () => {
  it('recovers a current-format plan path from an Implementation Plan Created comment', () => {
    const state = detectRecoveryState([issueComment(planCreatedBody(CURRENT_PLAN_PATH), '2026-10-20T10:00:00Z')]);

    expect(state.planPath).toBe(CURRENT_PLAN_PATH);
    expect(state.lastCompletedStage).toBe('plan_created');
    expect(state.canResume).toBe(true);
  });

  it('still recovers a legacy issue-N-plan.md path', () => {
    const state = detectRecoveryState([issueComment(planCreatedBody(LEGACY_PLAN_PATH), '2026-10-20T10:00:00Z')]);

    expect(state.planPath).toBe(LEGACY_PLAN_PATH);
    expect(state.lastCompletedStage).toBe('plan_created');
    expect(state.canResume).toBe(true);
  });

  it('takes the plan file line, not a plan named in the plan summary', () => {
    const summary = 'Follows `specs/issue-930-adw-6k869a-feat-promote-930-sce-sdlc_planner-promote-930-plan-commit-regression.md`.';
    const state = detectRecoveryState([issueComment(planCreatedBody(CURRENT_PLAN_PATH, summary), '2026-10-20T10:00:00Z')]);

    expect(state.planPath).toBe(CURRENT_PLAN_PATH);
  });

  it('keeps the recovered plan path when a later stage comment carries none', () => {
    const state = detectRecoveryState([
      issueComment(planCreatedBody(CURRENT_PLAN_PATH), '2026-10-20T10:00:00Z'),
      issueComment(formatWorkflowComment('build_running', { issueNumber: 1080, adwId: ADW_ID }), '2026-10-20T10:05:00Z'),
    ]);

    expect(state.planPath).toBe(CURRENT_PLAN_PATH);
    expect(state.lastCompletedStage).toBe('build_running');
  });
});
