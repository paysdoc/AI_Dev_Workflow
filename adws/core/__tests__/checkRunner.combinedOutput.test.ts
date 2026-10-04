import { describe, it, expect } from 'vitest';
import {
  combinedCheckOutput,
  CheckStatus,
  StaticCheckName,
  type CheckVerdict,
} from '../checkRunner';

describe('combinedCheckOutput', () => {
  function verdict(check: StaticCheckName, overrides: Partial<CheckVerdict> = {}): CheckVerdict {
    return { check, command: 'cmd', status: CheckStatus.Passed, exitCode: 0, output: '', ...overrides };
  }

  const baseline = (): CheckVerdict[] => [
    verdict(StaticCheckName.TypeCheck, { output: 'src: 0 errors\n' }),
    verdict(StaticCheckName.AdditionalTypeChecks, { status: CheckStatus.Skipped, exitCode: null }),
    verdict(StaticCheckName.Lint, { status: CheckStatus.Failed, exitCode: 1, output: 'src/a.ts: 2 problems\n' }),
    verdict(StaticCheckName.Build),
  ];

  it('is identical for two equal verdict lists', () => {
    expect(combinedCheckOutput(baseline())).toBe(combinedCheckOutput(baseline()));
  });

  it('changes when the output of any verdict changes', () => {
    const changed = baseline();
    changed[2] = { ...changed[2], output: 'src/a.ts: 1 problem\n' };

    expect(combinedCheckOutput(changed)).not.toBe(combinedCheckOutput(baseline()));
  });

  it('changes when the exit code of any verdict changes', () => {
    const changed = baseline();
    changed[2] = { ...changed[2], exitCode: 2 };

    expect(combinedCheckOutput(changed)).not.toBe(combinedCheckOutput(baseline()));
  });

  it('changes when the status of any verdict changes', () => {
    const changed = baseline();
    changed[2] = { ...changed[2], status: CheckStatus.Passed, exitCode: 0 };

    expect(combinedCheckOutput(changed)).not.toBe(combinedCheckOutput(baseline()));
  });

  it('does not take a change of output in one check for a change in another', () => {
    const moved = baseline();
    moved[0] = { ...moved[0], output: 'src/a.ts: 2 problems\n' };
    moved[2] = { ...moved[2], output: 'src: 0 errors\n' };

    expect(combinedCheckOutput(moved)).not.toBe(combinedCheckOutput(baseline()));
  });

  it('lists the checks in the order given, skipped checks included', () => {
    const combined = combinedCheckOutput(baseline());
    const positions = [
      StaticCheckName.TypeCheck,
      StaticCheckName.AdditionalTypeChecks,
      StaticCheckName.Lint,
      StaticCheckName.Build,
    ].map(check => combined.indexOf(`[${check}]`));

    expect(positions.every(position => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('is sensitive to trailing whitespace, since it does not normalise what a check printed', () => {
    const trimmed = baseline();
    trimmed[2] = { ...trimmed[2], output: 'src/a.ts: 2 problems' };

    expect(combinedCheckOutput(trimmed)).not.toBe(combinedCheckOutput(baseline()));
  });

  it('is the empty string for no verdicts', () => {
    expect(combinedCheckOutput([])).toBe('');
  });
});
