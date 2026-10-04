import { describe, it, expect } from 'vitest';
import { FixLoopStall } from '../../core/staticCheckFixLoop';
import { ParkReason, buildParkComment } from '../parkComment';
import { ADW_ID, LINT, SAMPLE, TYPE_CHECK, stalled } from './parkComment.helpers';

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
