import { describe, it, expect } from 'vitest';
import {
  isRetryComment,
  isCancelComment,
  RETRY_COMMENT_PATTERN,
  ADW_SIGNATURE,
  parseWorkflowStageFromComment,
  extractLatestAdwId,
  extractPlanPathFromComment,
  detectRecoveryState,
} from '../workflowCommentParsing';
import { getNextStage, shouldExecuteStage } from '../orchestratorLib';
import { buildParkComment, ParkReason } from '../../forge/parkComment';
import { formatWorkflowComment, type WorkflowContext } from '../../forge/workflowCommentsIssue';
import type { WorkflowStage } from '../../types/workflowTypes';
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

describe('detectRecoveryState — a run that posted the retired "Committing Plan" comment', () => {
  // The formatter is gone, so the body a run on the previous release posted is spelled out here.
  const committingPlanBody = `## :floppy_disk: Committing Plan\n\nCommitting implementation plan to branch...\n\n**ADW ID:** \`${ADW_ID}\`${ADW_SIGNATURE}`;

  it('reads the retired heading as no stage', () => {
    expect(parseWorkflowStageFromComment(committingPlanBody)).toBeNull();
  });

  it('resumes after plan_created and keeps the plan path', () => {
    const state = detectRecoveryState([
      issueComment(planCreatedBody(CURRENT_PLAN_PATH), '2026-10-20T10:00:00Z'),
      issueComment(committingPlanBody, '2026-10-20T10:01:00Z'),
    ]);

    expect(state.lastCompletedStage).toBe('plan_created');
    expect(state.canResume).toBe(true);
    expect(state.planPath).toBe(CURRENT_PLAN_PATH);
  });
});

describe('detectRecoveryState — a workflow that adwMerge parked for post_merge_bdd_red and a human brought back with ## Retry', () => {
  const PARKED_ID = 'a6cot9-feat-adwmerge-re-run';
  // The comment parser reads a branch name only under the aliased prefixes: feat, bug, chore, review and test.
  const PARKED_BRANCH = 'feat-issue-1101-post-merge-rerun';
  const PARKED_PLAN_PATH = `specs/issue-1101-adw-${PARKED_ID}-sdlc_planner-post-merge-rerun.md`;
  const PARKED_PR_URL = 'https://github.com/acme/widgets/pull/157';
  const context: WorkflowContext = { issueNumber: 1101, adwId: PARKED_ID, branchName: PARKED_BRANCH, planPath: PARKED_PLAN_PATH, prUrl: PARKED_PR_URL, issueType: '/feature' };

  const LIFECYCLE: readonly WorkflowStage[] = [
    'starting', 'classified', 'branch_created', 'plan_building', 'plan_created', 'plan_validating',
    'plan_aligning', 'build_running', 'build_completed', 'pr_creating', 'pr_created',
  ];
  const at = (minute: number): string => new Date(Date.UTC(2026, 9, 26, 10, minute)).toISOString();

  const lifecycle = LIFECYCLE.map((stage, minute) => issueComment(formatWorkflowComment(stage, context), at(minute)));
  const park = buildParkComment(PARKED_ID, {
    reason: ParkReason.PostMergeBddRed,
    prNumber: 157,
    baseBranch: 'trunk',
    mergedCommits: ['1a2b3c4 Raise the order limit'],
    conflictedFiles: [],
    failures: [{ title: '@adw-1101 Orders: Orders over the limit are refused', detail: 'expected status 422, got 201' }],
  });
  const parked = [...lifecycle, issueComment(park, at(LIFECYCLE.length))];
  const retried = [...parked, issueComment('## Retry', at(LIFECYCLE.length + 1))];
  const resuming = formatWorkflowComment('resuming', { ...context, resumeFrom: getNextStage('pr_created') });
  const resumed = [...retried, issueComment(resuming, at(LIFECYCLE.length + 2))];

  it('reads the park comment as no lifecycle stage, so that it moves the recovery point nowhere', () => {
    expect(parseWorkflowStageFromComment(park)).toBeNull();
  });

  it('keeps pr_created as the recovery point, with the same adwId, branch, plan and pull request, once ## Retry and the resuming comment follow the park', () => {
    expect(detectRecoveryState(resumed)).toEqual({
      lastCompletedStage: 'pr_created',
      adwId: PARKED_ID,
      branchName: PARKED_BRANCH,
      planPath: PARKED_PLAN_PATH,
      prUrl: PARKED_PR_URL,
      canResume: true,
    });
  });

  it('is the recovery state of the run before the park, whichever of the park, ## Retry and the resuming comment have been posted', () => {
    const beforeThePark = detectRecoveryState(lifecycle);

    expect(detectRecoveryState(parked)).toEqual(beforeThePark);
    expect(detectRecoveryState(retried)).toEqual(beforeThePark);
    expect(detectRecoveryState(resumed)).toEqual(beforeThePark);
  });

  it('finds the adwId that ## Retry acts on in the park comment, which carries it', () => {
    expect(extractLatestAdwId(retried)).toBe(PARKED_ID);
  });

  it.each(['plan_created', 'plan_validating', 'plan_aligning', 'build_completed', 'pr_created'] as const)(
    'skips the %s stage on the resumed run, so that it plans, aligns, builds and opens a pull request no second time',
    (stage) => {
      expect(shouldExecuteStage(stage, detectRecoveryState(resumed))).toBe(false);
    },
  );

  it('still runs what follows the pull request', () => {
    expect(shouldExecuteStage('completed', detectRecoveryState(resumed))).toBe(true);
  });
});
