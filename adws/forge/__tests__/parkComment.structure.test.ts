import { describe, it, expect } from 'vitest';
import {
  ADW_SIGNATURE,
  ACTIONABLE_COMMENT_PATTERN,
  CANCEL_COMMENT_PATTERN,
  RETRY_COMMENT_PATTERN,
  extractAdwIdFromComment,
  isActionableComment,
  isCancelComment,
  isRetryComment,
  parseWorkflowStageFromComment,
} from '../../core/workflowCommentParsing';
import { ParkReason, buildParkComment, parkDirectives } from '../parkComment';
import { ADW_ID, LINT, REASONS, SAMPLE, lines } from './parkComment.helpers';

describe.each(REASONS)('buildParkComment — %s', (reason) => {
  const evidence = SAMPLE[reason];
  const comment = buildParkComment(ADW_ID, evidence);

  it('opens with the park heading', () => {
    expect(comment.startsWith('## :raised_hand: ADW Parked — ')).toBe(true);
  });

  it('carries the ADW ID line right under the heading, and ends with the ADW signature', () => {
    expect(lines(comment).slice(0, 3)).toEqual([lines(comment)[0], '', `**ADW ID:** \`${ADW_ID}\``]);
    expect(comment.endsWith(ADW_SIGNATURE)).toBe(true);
  });

  it('says that the workflow is parked as human_gated', () => {
    expect(comment).toContain('`human_gated`');
  });

  it('carries both directives, each with its meaning for this park', () => {
    const directives = parkDirectives(evidence);

    expect(comment).toContain(`- \`## Retry\` — ${directives.retry}`);
    expect(comment).toContain(`- \`## Continue\` — ${directives.continue}`);
  });

  it('is never taken for a lifecycle stage', () => {
    expect(parseWorkflowStageFromComment(comment)).toBeNull();
  });

  it('lets a retry find the workflow: the ADW ID can be read from it', () => {
    expect(extractAdwIdFromComment(comment)).toBe(ADW_ID);
  });

  it('has no line that ADW would take for a directive', () => {
    lines(comment).forEach((line) => {
      expect(RETRY_COMMENT_PATTERN.test(line)).toBe(false);
      expect(ACTIONABLE_COMMENT_PATTERN.test(line)).toBe(false);
      expect(CANCEL_COMMENT_PATTERN.test(line)).toBe(false);
    });
    expect(isRetryComment(comment) || isActionableComment(comment) || isCancelComment(comment)).toBe(false);
  });

  it('explains both directives by name', () => {
    expect(comment).toContain('## Retry');
    expect(comment).toContain('## Continue');
  });
});

describe('buildParkComment — the base-branch note', () => {
  it.each([ParkReason.BaselineRed, ParkReason.PreExistingRegression, ParkReason.BaseServerDown])('says for %s that it fails on the base branch, and names it', (reason) => {
    const comment = buildParkComment(ADW_ID, SAMPLE[reason]);

    expect(comment).toContain('This fails on the base branch `trunk`');
  });

  it.each([ParkReason.FixLoopStalled, ParkReason.MissingApplicationType])('carries no base-branch note for %s', (reason) => {
    const comment = buildParkComment(ADW_ID, SAMPLE[reason]);

    expect(comment).not.toContain('base branch');
  });

  it('names the base branch the evidence names', () => {
    const comment = buildParkComment(ADW_ID, { reason: ParkReason.BaselineRed, baseBranch: 'release-7', failedChecks: [LINT] });

    expect(comment).toContain('`release-7`');
    expect(comment).not.toContain('`trunk`');
  });
});

describe('parkDirectives — what each directive does for each park', () => {
  it.each([ParkReason.BaselineRed, ParkReason.BaseServerDown])('%s: Retry re-runs the baseline and parks again if it is still red; Continue waives the baseline', (reason) => {
    const directives = parkDirectives(SAMPLE[reason]);

    expect(directives.retry).toBe('re-runs the baseline and parks the issue again if it is still red');
    expect(directives.continue).toBe('waives the baseline, so that this run fixes the pre-existing failures too');
  });

  it('pre_existing_regression: Retry re-runs the scenario on the base branch; Continue lets this run fix the failure', () => {
    const directives = parkDirectives(SAMPLE[ParkReason.PreExistingRegression]);

    expect(directives.retry).toBe('re-runs the scenario on the base branch and parks the issue again if it still fails there');
    expect(directives.continue).toContain('lets this run fix the pre-existing failure too');
    expect(directives.continue).toContain('waives');
  });

  it('fix_loop_stalled: Retry re-runs the static checks and continues the fix loop; Continue waives nothing and points to Retry', () => {
    const directives = parkDirectives(SAMPLE[ParkReason.FixLoopStalled]);

    expect(directives.retry).toBe('re-runs the static checks and continues the static-check fix loop, parking again on no progress');
    expect(directives.continue).toContain('waives nothing');
    expect(directives.continue).toContain('`## Retry`');
  });

  it('missing_application_type: Retry re-reads the type after adw_init was re-run; Continue waives nothing, because ADW never assumes a type', () => {
    const directives = parkDirectives(SAMPLE[ParkReason.MissingApplicationType]);

    expect(directives.retry).toContain('re-reads `## Application Type`');
    expect(directives.retry).toContain('`adw_init`');
    expect(directives.continue).toContain('waives nothing');
    expect(directives.continue).toContain('never assumes');
  });

  it('gives each reason directives of its own', () => {
    const distinct = new Set(REASONS.map(reason => JSON.stringify(parkDirectives(SAMPLE[reason]))));

    expect(distinct.size).toBe(4);
  });
});
