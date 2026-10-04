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
import { FixLoopStall } from '../../core/staticCheckFixLoop';
import {
  MAX_PARK_OUTPUT_CHARS,
  ParkReason,
  buildParkComment,
  parkDirectives,
  type ParkEvidence,
  type ParkedCheck,
} from '../parkComment';

const ADW_ID = 'k3x9ab-feat-park-comment';

const LINT: ParkedCheck = { check: 'lint', command: 'bun run lint', exitCode: 1, output: 'src/app.ts: 1 problem (1 error, 0 warnings)\n' };
const TYPE_CHECK: ParkedCheck = {
  check: 'type check',
  command: 'bunx tsc --noEmit',
  exitCode: 2,
  output: "src/cart.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.\n",
};

const SAMPLE: Readonly<Record<ParkReason, ParkEvidence>> = {
  [ParkReason.BaselineRed]: { reason: ParkReason.BaselineRed, baseBranch: 'trunk', failedChecks: [TYPE_CHECK] },
  [ParkReason.PreExistingRegression]: {
    reason: ParkReason.PreExistingRegression,
    baseBranch: 'trunk',
    scenario: 'The cron launches one orchestrator per eligible issue',
  },
  [ParkReason.FixLoopStalled]: {
    reason: ParkReason.FixLoopStalled,
    failedChecks: [LINT],
    stall: FixLoopStall.IdenticalOutput,
    rounds: 3,
    rejections: [],
  },
  [ParkReason.MissingApplicationType]: { reason: ParkReason.MissingApplicationType, found: 'desktop' },
  [ParkReason.BaseServerDown]: {
    reason: ParkReason.BaseServerDown,
    baseBranch: 'trunk',
    output: 'Error: listen EADDRINUSE: address already in use :::3000\n',
  },
};

const REASONS = Object.values(ParkReason);

function lines(comment: string): string[] {
  return comment.split('\n');
}

function stalled(overrides: Partial<Extract<ParkEvidence, { reason: ParkReason.FixLoopStalled }>> = {}): ParkEvidence {
  return { reason: ParkReason.FixLoopStalled, failedChecks: [LINT], stall: FixLoopStall.IdenticalOutput, rounds: 3, rejections: [], ...overrides };
}

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

describe('buildParkComment — what failed', () => {
  it('lists a failing check with its command and exit code, and quotes its output as an indented block', () => {
    const comment = buildParkComment(ADW_ID, SAMPLE[ParkReason.BaselineRed]);

    expect(comment).toContain('`type check` — `bunx tsc --noEmit` (exit 2)');
    expect(comment).toContain("\n    src/cart.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.");
  });

  it('lists every failing check, in the order given', () => {
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [TYPE_CHECK, LINT] }));

    expect(comment.indexOf('`type check` —')).toBeGreaterThan(-1);
    expect(comment.indexOf('`lint` —')).toBeGreaterThan(comment.indexOf('`type check` —'));
  });

  it('says "none" for a check that has no exit code', () => {
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, exitCode: null }] }));

    expect(comment).toContain('`lint` — `bun run lint` (exit none)');
  });

  it('says that a check printed nothing when it printed nothing', () => {
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, output: '  \n' }] }));

    expect(comment).toContain('\n    (no output)');
  });

  it('names the scenario of a pre-existing regression', () => {
    const comment = buildParkComment(ADW_ID, SAMPLE[ParkReason.PreExistingRegression]);

    expect(comment).toContain('The cron launches one orchestrator per eligible issue');
  });

  it('says that the dev server did not start, and quotes the server’s output', () => {
    const comment = buildParkComment(ADW_ID, SAMPLE[ParkReason.BaseServerDown]);

    expect(comment).toContain('dev server');
    expect(comment).toContain('did not start');
    expect(comment).toContain('\n    Error: listen EADDRINUSE: address already in use :::3000');
  });

  it('names the "## Application Type" section, the value found there, and says to re-run adw_init', () => {
    const comment = buildParkComment(ADW_ID, SAMPLE[ParkReason.MissingApplicationType]);

    expect(comment).toContain('## Application Type');
    expect(comment).toContain('`desktop`');
    expect(comment).toContain('`adw_init`');
  });

  it('says that the "## Application Type" section is missing when nothing was found', () => {
    const comment = buildParkComment(ADW_ID, { reason: ParkReason.MissingApplicationType, found: null });

    expect(comment).toContain('## Application Type');
    expect(comment).toMatch(/is missing/);
    expect(comment).toContain('`adw_init`');
  });

  it('writes a command that holds backticks so that it still reads as one piece of code', () => {
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, command: 'echo `date` done' }] }));

    expect(comment).toContain('``echo `date` done``');
  });

  it('pads a command that starts or ends with a backtick, as a code span needs', () => {
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, command: 'make lint FILES=`git ls-files`' }] }));

    expect(comment).toContain('`` make lint FILES=`git ls-files` ``');
  });

  it('writes a command of several lines on one line', () => {
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, command: 'bun run lint\n  --max-warnings 0' }] }));

    expect(comment).toContain('`bun run lint --max-warnings 0`');
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

describe('buildParkComment — a stalled static-check fix loop', () => {
  it('says that the checks produced the same output as the round before, and after how many rounds', () => {
    const comment = buildParkComment(ADW_ID, stalled({ stall: FixLoopStall.IdenticalOutput, rounds: 3 }));

    expect(comment).toContain('stopped after 3 fix rounds');
    expect(comment).toContain('the same output as the round before');
  });

  it('writes one fix round in the singular', () => {
    const comment = buildParkComment(ADW_ID, stalled({ rounds: 1 }));

    expect(comment).toContain('stopped after 1 fix round:');
  });

  it('says that the fix-round guard rejected the change and that it was reverted, which counts as no progress', () => {
    const rejections = ['`src/app.ts` adds `eslint-disable` (javascript suppression pattern)', '`tsconfig.json` is compiler configuration, which a fix round may not change'];
    const comment = buildParkComment(ADW_ID, stalled({ stall: FixLoopStall.RejectedRound, rounds: 2, rejections }));

    expect(comment).toContain('The fix-round guard rejected the change that fix round 2 made');
    expect(comment).toContain('reverted');
    expect(comment).toContain('no progress');
    rejections.forEach(rejection => expect(comment).toContain(`- ${rejection}`));
    expect(comment).not.toContain('the same output as the round before');
  });

  it('still lists the failing checks, with their output, when the guard rejected the round', () => {
    const comment = buildParkComment(ADW_ID, stalled({ stall: FixLoopStall.RejectedRound, rejections: ['`src/app.ts` adds `@ts-ignore` (javascript suppression pattern)'] }));

    expect(comment).toContain('`lint` — `bun run lint` (exit 1)');
    expect(comment).toContain('\n    src/app.ts: 1 problem (1 error, 0 warnings)');
  });

  it('points to the execution log for the full output of each check', () => {
    expect(buildParkComment(ADW_ID, SAMPLE[ParkReason.FixLoopStalled])).toContain('full output');
    expect(buildParkComment(ADW_ID, SAMPLE[ParkReason.FixLoopStalled])).toContain('execution log');
  });
});

describe('buildParkComment — quoting', () => {
  it('cuts an output at MAX_PARK_OUTPUT_CHARS and says that the full output is in the execution log', () => {
    const output = `${'x'.repeat(MAX_PARK_OUTPUT_CHARS)}TAIL-THAT-IS-CUT`;
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, output }] }));

    expect(comment).toContain('x'.repeat(MAX_PARK_OUTPUT_CHARS));
    expect(comment).not.toContain('TAIL-THAT-IS-CUT');
    expect(comment).toContain(`output cut after ${MAX_PARK_OUTPUT_CHARS} characters; the full output is in the run’s execution log`);
  });

  it('does not cut an output that fits, and does not mark it', () => {
    const output = 'z'.repeat(MAX_PARK_OUTPUT_CHARS);
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, output }] }));

    expect(comment).toContain(output);
    expect(comment).not.toContain('output cut after');
  });

  it('cuts the output of the dev server too', () => {
    const comment = buildParkComment(ADW_ID, { reason: ParkReason.BaseServerDown, baseBranch: 'trunk', output: 'q'.repeat(MAX_PARK_OUTPUT_CHARS + 100) });

    expect(comment).toContain('output cut after');
    expect(comment).not.toContain('q'.repeat(MAX_PARK_OUTPUT_CHARS + 1));
  });

  it('never cuts through a character made of two code units', () => {
    const output = `${'x'.repeat(MAX_PARK_OUTPUT_CHARS - 1)}😀 and the rest`;
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, output }] }));

    expect(comment).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it('indents every line of a multi-line output, blank ones aside', () => {
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, output: 'first\nsecond\n\nfourth\n' }] }));

    expect(comment).toContain('\n    first\n    second\n\n    fourth\n');
  });

  it('reads the line endings of a Windows output as line endings', () => {
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, output: 'first\r\nsecond\r\n' }] }));

    expect(comment).toContain('\n    first\n    second\n');
    expect(comment).not.toContain('\r');
  });
});

describe('buildParkComment — text that must not turn into a directive or a stage', () => {
  const HOSTILE = 'before\n## Retry\n## Continue\n## Cancel\n## :tada: ADW Workflow Completed\n**ADW ID:** `intruder-id`\nafter';

  const hostileEvidence: readonly ParkEvidence[] = [
    { reason: ParkReason.BaselineRed, baseBranch: HOSTILE, failedChecks: [{ check: 'lint', command: HOSTILE, exitCode: 1, output: HOSTILE }] },
    { reason: ParkReason.PreExistingRegression, baseBranch: HOSTILE, scenario: HOSTILE },
    stalled({ failedChecks: [{ check: 'lint', command: HOSTILE, exitCode: 1, output: HOSTILE }], stall: FixLoopStall.RejectedRound, rejections: [HOSTILE] }),
    { reason: ParkReason.MissingApplicationType, found: HOSTILE },
    { reason: ParkReason.BaseServerDown, baseBranch: HOSTILE, output: HOSTILE },
  ];

  it.each(hostileEvidence.map(evidence => [evidence.reason, evidence] as const))('%s: no line of the comment is a directive, and the comment is no stage', (_reason, evidence) => {
    const comment = buildParkComment(ADW_ID, evidence);

    lines(comment).forEach((line) => {
      expect(RETRY_COMMENT_PATTERN.test(line)).toBe(false);
      expect(ACTIONABLE_COMMENT_PATTERN.test(line)).toBe(false);
      expect(CANCEL_COMMENT_PATTERN.test(line)).toBe(false);
    });
    expect(parseWorkflowStageFromComment(comment)).toBeNull();
  });

  it.each(hostileEvidence.map(evidence => [evidence.reason, evidence] as const))('%s: the workflow’s own ADW ID is the one a retry reads', (_reason, evidence) => {
    expect(extractAdwIdFromComment(buildParkComment(ADW_ID, evidence))).toBe(ADW_ID);
  });

  it('quotes a directive-looking line of an output as indented text, so that ADW takes no comment of its own for one', () => {
    const comment = buildParkComment(ADW_ID, stalled({ failedChecks: [{ ...LINT, output: '## Retry\n' }] }));

    expect(comment).toContain('\n    ## Retry\n');
    expect(isRetryComment(comment)).toBe(false);
  });
});
