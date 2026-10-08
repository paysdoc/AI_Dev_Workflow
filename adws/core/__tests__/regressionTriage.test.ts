import { describe, it, expect } from 'vitest';
import {
  BaseScenarioOutcome,
  describeFailingScenario,
  scenarioMatchesCase,
  triageRegressionFailures,
  withRerunTag,
  type FailingScenario,
  type ScenarioRerun,
} from '../regressionTriage';

const A: FailingScenario = { name: 'The cart total includes the delivery fee', feature: 'Cart' };
const B: FailingScenario = { name: 'Removing the last item empties the cart', feature: 'Cart' };

function scriptedRerun(outcomes: Readonly<Record<string, BaseScenarioOutcome>>): {
  rerunOnBase: ScenarioRerun;
  events: string[];
} {
  const events: string[] = [];
  const rerunOnBase: ScenarioRerun = async (scenario) => {
    events.push(`start ${scenario.name}`);
    await new Promise(resolve => setTimeout(resolve, 2));
    events.push(`end ${scenario.name}`);
    return outcomes[scenario.name] ?? BaseScenarioOutcome.NotRun;
  };
  return { rerunOnBase, events };
}

describe('triageRegressionFailures', () => {
  it('re-runs nothing when the baseline was waived', async () => {
    const { rerunOnBase, events } = scriptedRerun({ [A.name]: BaseScenarioOutcome.Failed });

    const triage = await triageRegressionFailures({ failing: [A, B], waived: true, rerunOnBase });

    expect(triage).toEqual({ kind: 'waived' });
    expect(events).toEqual([]);
  });

  it('classifies the first scenario that also fails on the base branch as pre-existing, and re-runs no other', async () => {
    const { rerunOnBase, events } = scriptedRerun({
      [A.name]: BaseScenarioOutcome.Failed,
      [B.name]: BaseScenarioOutcome.Passed,
    });

    const triage = await triageRegressionFailures({ failing: [A, B], waived: false, rerunOnBase });

    expect(triage).toEqual({
      kind: 'pre_existing',
      scenario: A,
      triaged: [{ scenario: A, outcome: BaseScenarioOutcome.Failed }],
    });
    expect(events).toEqual([`start ${A.name}`, `end ${A.name}`]);
  });

  it('keeps going past a scenario that passed on the base branch to one that fails there', async () => {
    const { rerunOnBase } = scriptedRerun({
      [A.name]: BaseScenarioOutcome.Passed,
      [B.name]: BaseScenarioOutcome.Failed,
    });

    const triage = await triageRegressionFailures({ failing: [A, B], waived: false, rerunOnBase });

    expect(triage).toEqual({
      kind: 'pre_existing',
      scenario: B,
      triaged: [
        { scenario: A, outcome: BaseScenarioOutcome.Passed },
        { scenario: B, outcome: BaseScenarioOutcome.Failed },
      ],
    });
  });

  it('treats a scenario that passed, and one that could not be run, as introduced by the change', async () => {
    const { rerunOnBase } = scriptedRerun({
      [A.name]: BaseScenarioOutcome.Passed,
      [B.name]: BaseScenarioOutcome.NotRun,
    });

    const triage = await triageRegressionFailures({ failing: [A, B], waived: false, rerunOnBase });

    expect(triage).toEqual({
      kind: 'introduced',
      triaged: [
        { scenario: A, outcome: BaseScenarioOutcome.Passed },
        { scenario: B, outcome: BaseScenarioOutcome.NotRun },
      ],
    });
  });

  it('has nothing pre-existing when no scenario failed', async () => {
    const { rerunOnBase, events } = scriptedRerun({});

    const triage = await triageRegressionFailures({ failing: [], waived: false, rerunOnBase });

    expect(triage).toEqual({ kind: 'introduced', triaged: [] });
    expect(events).toEqual([]);
  });

  it('re-runs in the order given, each re-run finishing before the next starts', async () => {
    const { rerunOnBase, events } = scriptedRerun({
      [A.name]: BaseScenarioOutcome.Passed,
      [B.name]: BaseScenarioOutcome.Passed,
    });

    await triageRegressionFailures({ failing: [A, B], waived: false, rerunOnBase });

    expect(events).toEqual([`start ${A.name}`, `end ${A.name}`, `start ${B.name}`, `end ${B.name}`]);
  });

  it('lets an error from the re-run propagate', async () => {
    const rerunOnBase: ScenarioRerun = async () => {
      throw new Error('the base checkout is gone');
    };

    await expect(triageRegressionFailures({ failing: [A], waived: false, rerunOnBase })).rejects.toThrow('the base checkout is gone');
  });
});

describe('scenarioMatchesCase', () => {
  it('matches the exact name', () => {
    expect(scenarioMatchesCase('Cancel resets', 'Cancel resets')).toBe(true);
  });

  it('matches a case named after its rule', () => {
    expect(scenarioMatchesCase('Cancel resets', 'Directives - Cancel resets')).toBe(true);
  });

  it('matches a case that is an example of a scenario outline', () => {
    expect(scenarioMatchesCase('Login', 'Login - Examples - #1.2: Login as admin')).toBe(true);
    expect(scenarioMatchesCase('Login', 'Login - #1.2')).toBe(true);
  });

  it('matches a case named after both its rule and its outline example', () => {
    expect(scenarioMatchesCase('Login', 'Accounts - Login - Examples - #1.2: Login as admin')).toBe(true);
  });

  it('does not match a name that is only part of the case name', () => {
    expect(scenarioMatchesCase('Cancel', 'Cancel resets')).toBe(false);
    expect(scenarioMatchesCase('resets', 'Cancel resets')).toBe(false);
  });

  it('does not match a different scenario', () => {
    expect(scenarioMatchesCase('Retry rearms', 'Cancel resets')).toBe(false);
  });
});

describe('withRerunTag', () => {
  const FEATURE = [
    'Feature: Cart',
    '',
    '  @regression',
    '  Scenario: The cart total includes the delivery fee',
    '    Given a cart',
    '',
    '  Scenario: An empty cart has a total of zero',
    '    Given an empty cart',
    '',
  ].join('\n');

  it('inserts the tag directly above the scenario line, at its indentation', () => {
    const tagged = withRerunTag(FEATURE, 7, 'adw-base-rerun').split('\n');

    expect(tagged[5]).toBe('');
    expect(tagged[6]).toBe('  @adw-base-rerun');
    expect(tagged[7]).toBe('  Scenario: An empty cart has a total of zero');
  });

  it('keeps the scenario’s own tag lines and puts the new line between them and the scenario line', () => {
    const tagged = withRerunTag(FEATURE, 4, 'adw-base-rerun').split('\n');

    expect(tagged.slice(2, 5)).toEqual(['  @regression', '  @adw-base-rerun', '  Scenario: The cart total includes the delivery fee']);
  });

  it('changes nothing else in the content', () => {
    const tagged = withRerunTag(FEATURE, 4, 'adw-base-rerun');

    const without = tagged.split('\n').filter(line => line !== '  @adw-base-rerun').join('\n');
    expect(without).toBe(FEATURE);
  });

  it('keeps CRLF line endings', () => {
    const crlf = FEATURE.split('\n').join('\r\n');

    const tagged = withRerunTag(crlf, 4, 'adw-base-rerun');

    expect(tagged).toContain('  @regression\r\n  @adw-base-rerun\r\n  Scenario:');
    expect(tagged.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('keeps the tabs of an indented scenario line', () => {
    const tabbed = 'Feature: F\n\n\tScenario: S\n\t\tGiven a step\n';

    expect(withRerunTag(tabbed, 3, 'adw-base-rerun')).toBe('Feature: F\n\n\t@adw-base-rerun\n\tScenario: S\n\t\tGiven a step\n');
  });

  it('returns the content as it is when the line does not exist', () => {
    expect(withRerunTag(FEATURE, 0, 'adw-base-rerun')).toBe(FEATURE);
    expect(withRerunTag(FEATURE, 99, 'adw-base-rerun')).toBe(FEATURE);
  });
});

describe('describeFailingScenario', () => {
  it('prefixes the feature when there is one', () => {
    expect(describeFailingScenario({ name: 'S', feature: 'F' })).toBe('F: S');
  });

  it('is the bare name when there is no feature', () => {
    expect(describeFailingScenario({ name: 'S' })).toBe('S');
  });
});
