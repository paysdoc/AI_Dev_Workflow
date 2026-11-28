import { describe, it, expect } from 'vitest';
import type { FeatureFileSource } from '../../proof/featureScenarioIndex';
import { declineNominations, featureOfCandidate } from '../nominationDecline';

const REFUNDED = 'An order is refunded';
const REFUNDED_TWICE = 'An order is refunded twice';

const FEATURE = [
  '@adw-1201',
  'Feature: Refunds',
  '',
  '  @adw-1201 @nominated',
  `  Scenario: ${REFUNDED}`,
  '    Given an order',
  '',
  '  @adw-1201 @nominated',
  `  Scenario: ${REFUNDED_TWICE}`,
  '    Given an order',
  '',
].join('\n');

function linesOf(content: string): string[] {
  return content.split('\n');
}

describe('declineNominations', () => {
  it("replaces @nominated with @nomination-declined on the named scenario's own tag line and leaves every other line byte-identical", () => {
    const { content, declined } = declineNominations(FEATURE, [REFUNDED]);

    expect(declined).toEqual([REFUNDED]);
    expect(linesOf(content)[3]).toBe('  @adw-1201 @nomination-declined');
    expect(linesOf(content).filter((_, index) => index !== 3)).toEqual(linesOf(FEATURE).filter((_, index) => index !== 3));
  });

  it('declines only the named scenarios: another nominated scenario of the same file keeps @nominated', () => {
    const { content } = declineNominations(FEATURE, [REFUNDED]);

    expect(linesOf(content)[7]).toBe('  @adw-1201 @nominated');
  });

  it('handles @nominated on the second of two tag lines', () => {
    const feature = ['Feature: Refunds', '', '  @adw-1201', '  @smoke @nominated', `  Scenario: ${REFUNDED}`, '    Given an order', ''].join('\n');

    const { content, declined } = declineNominations(feature, [REFUNDED]);

    expect(declined).toEqual([REFUNDED]);
    expect(linesOf(content).slice(2, 4)).toEqual(['  @adw-1201', '  @smoke @nomination-declined']);
  });

  it('handles a scenario inside a Rule: block', () => {
    const feature = ['Feature: Refunds', '', '  Rule: Paid orders', '', '    @adw-1201 @nominated', `    Scenario: ${REFUNDED}`, '      Given an order', ''].join('\n');

    const { content, declined } = declineNominations(feature, [REFUNDED]);

    expect(declined).toEqual([REFUNDED]);
    expect(linesOf(content)[4]).toBe('    @adw-1201 @nomination-declined');
  });

  it('leaves a Feature-level @nominated tag and a @nominated-later tag untouched', () => {
    const feature = ['@adw-1201 @nominated', 'Feature: Refunds', '', '  @nominated-later @nominated', `  Scenario: ${REFUNDED}`, '    Given an order', ''].join('\n');

    const { content } = declineNominations(feature, [REFUNDED]);

    expect(linesOf(content)[0]).toBe('@adw-1201 @nominated');
    expect(linesOf(content)[3]).toBe('  @nominated-later @nomination-declined');
  });

  it('is idempotent: an already-declined scenario is unchanged and not reported', () => {
    const once = declineNominations(FEATURE, [REFUNDED]);

    expect(declineNominations(once.content, [REFUNDED])).toEqual({ content: once.content, declined: [] });
  });

  it('returns unparseable content unchanged', () => {
    const unparseable = ['This is not Gherkin', '  @nominated', `  Scenario: ${REFUNDED}`].join('\n');

    expect(declineNominations(unparseable, [REFUNDED])).toEqual({ content: unparseable, declined: [] });
  });

  it('preserves CRLF line endings', () => {
    const crlf = FEATURE.replace(/\n/g, '\r\n');

    const { content } = declineNominations(crlf, [REFUNDED]);

    expect(content).toBe(crlf.replace(`  @adw-1201 @nominated\r\n  Scenario: ${REFUNDED}\r\n`, `  @adw-1201 @nomination-declined\r\n  Scenario: ${REFUNDED}\r\n`));
  });
});

describe('featureOfCandidate', () => {
  const tenTimesTheIssue: FeatureFileSource = { path: 'features/per-issue/feature-12010.feature', content: FEATURE };
  const ofTheIssue: FeatureFileSource = { path: 'features/per-issue/feature-1201.feature', content: FEATURE };

  it('finds feature-<N>.feature holding the scenario', () => {
    expect(featureOfCandidate([tenTimesTheIssue, ofTheIssue], { issueNumber: 1201, scenarioName: REFUNDED })).toBe(ofTheIssue);
  });

  it('returns null when the file is gone or the scenario was renamed', () => {
    expect(featureOfCandidate([ofTheIssue], { issueNumber: 1207, scenarioName: REFUNDED })).toBeNull();
    expect(featureOfCandidate([ofTheIssue], { issueNumber: 1201, scenarioName: 'An order was refunded' })).toBeNull();
  });

  it('never matches feature-<N>0.feature', () => {
    expect(featureOfCandidate([tenTimesTheIssue], { issueNumber: 1201, scenarioName: REFUNDED })).toBeNull();
  });
});
