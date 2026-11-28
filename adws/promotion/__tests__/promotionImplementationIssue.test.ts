import { describe, it, expect } from 'vitest';
import { readAdwLabelNames, shouldSkipScenarioAuthoring } from '../../core/adwLabels';
import { bodyLinksIssue } from '../../forge/issueLinkMarker';
import type { NominationKey } from '../nominationCollector';
import { readProposalCandidates } from '../proposalBody';
import {
  buildPromotionImplementationIssue,
  implementationIssueCandidates,
  implementationIssueFor,
  type ApprovedScenario,
  type ImplementationIssueRef,
} from '../promotionImplementationIssue';

const PROPOSAL = 1400;
const REFUND: ApprovedScenario = { issueNumber: 1201, scenarioName: 'An order is refunded', featurePath: 'features/per-issue/feature-1201.feature' };
const REFUND_TWICE: ApprovedScenario = { issueNumber: 1201, scenarioName: 'An order is refunded twice', featurePath: 'features/per-issue/feature-1201.feature' };
const INVOICE: ApprovedScenario = { issueNumber: 1207, scenarioName: 'An invoice is sent', featurePath: 'features/per-issue/feature-1207.feature' };
const APPROVED: readonly ApprovedScenario[] = [REFUND, REFUND_TWICE, INVOICE];

const spec = buildPromotionImplementationIssue({ proposalNumber: PROPOSAL, approved: APPROVED });

function keyOf({ issueNumber, scenarioName }: NominationKey): NominationKey {
  return { issueNumber, scenarioName };
}

function issueFor(number: number, proposalNumber: number, state = 'OPEN'): ImplementationIssueRef {
  return { number, state, body: buildPromotionImplementationIssue({ proposalNumber, approved: [REFUND] }).body };
}

describe('buildPromotionImplementationIssue — labels and routing', () => {
  it('labels the issue exactly adw:chore and regression-promotion, which routes it to /chore, skips scenario writing and carries no hitl', () => {
    expect(spec.labels).toEqual(['adw:chore', 'regression-promotion']);
    expect(readAdwLabelNames(spec.labels).classification).toBe('/chore');
    expect(shouldSkipScenarioAuthoring(spec.labels)).toBe(true);
    expect(spec.labels).not.toContain('hitl');
  });
});

describe('buildPromotionImplementationIssue — the body', () => {
  it('holds the marker line, names each approved scenario with its feature path, and reads back exactly the approved keys', () => {
    expect(spec.body.split('\n')).toContain(`Promotes: Promotion Proposal #${PROPOSAL}`);
    APPROVED.forEach((scenario) => expect(spec.body).toContain(`#${scenario.issueNumber} · \`${scenario.scenarioName}\` in \`${scenario.featurePath}\``));
    expect(readProposalCandidates(spec.body).map(keyOf)).toEqual(APPROVED.map(keyOf));
  });

  it('tells the pipeline to move each scenario on its own, never a whole feature file', () => {
    expect(spec.body).toContain('Move each scenario listed above on its own into the Regression Suite');
    expect(spec.body).toContain('Never move a whole feature file');
  });

  it('tells the pipeline to reword each scenario to the Vocabulary Registry and register a new phrase only when none fits', () => {
    expect(spec.body).toContain('Reword each moved scenario to the phrases of the Vocabulary Registry');
    expect(spec.body).toContain('Register a new phrase only when no registered phrase fits');
  });

  it('tells the pipeline to move the step definitions each scenario needs out of the files named after its issue', () => {
    expect(spec.body).toContain('Move the step definitions each moved scenario needs');
    expect(spec.body).toContain('out of the files named after its issue');
  });

  it('lists each distinct per-issue feature path once under Touched Files', () => {
    const touched = spec.body.slice(spec.body.indexOf('## Touched Files')).split('\n').filter((line) => line.startsWith('- '));

    expect(touched).toEqual(['- `features/per-issue/feature-1201.feature`', '- `features/per-issue/feature-1207.feature`']);
  });

  it('links neither the proposal nor any candidate issue with Closes or Implements', () => {
    const linked = [PROPOSAL, REFUND.issueNumber, INVOICE.issueNumber].filter((issue) => bodyLinksIssue(spec.body, issue));

    expect(linked).toEqual([]);
  });

  it('round-trips a scenario name holding markdown or HTML characters losslessly', () => {
    const scenarioName = 'A <b>bold</b> `coded` [x] #1 **refund** <!-- aside -->';
    const issue: ImplementationIssueRef = { number: 1600, body: buildPromotionImplementationIssue({ proposalNumber: PROPOSAL, approved: [{ ...REFUND, scenarioName }] }).body };

    expect(implementationIssueCandidates(issue)).toEqual([{ issueNumber: REFUND.issueNumber, scenarioName }]);
  });
});

describe('implementationIssueFor', () => {
  it("finds the proposal's issue by its marker line, open or closed", () => {
    expect(implementationIssueFor(PROPOSAL, [issueFor(1500, PROPOSAL - 1), issueFor(1501, PROPOSAL, 'CLOSED')])?.number).toBe(1501);
  });

  it('does not match #12 for proposal #123, nor a marker that is not on its own line', () => {
    const inline: ImplementationIssueRef = { number: 1503, state: 'OPEN', body: 'See Promotes: Promotion Proposal #123 for the context.' };

    expect(implementationIssueFor(123, [issueFor(1502, 12), inline])).toBeNull();
    expect(implementationIssueFor(12, [issueFor(1504, 123)])).toBeNull();
  });

  it('returns the lowest number of two', () => {
    expect(implementationIssueFor(PROPOSAL, [issueFor(1506, PROPOSAL), issueFor(1505, PROPOSAL)])?.number).toBe(1505);
  });

  it('returns null for an older promotion issue without a marker', () => {
    const older: ImplementationIssueRef = { number: 300, state: 'CLOSED', body: '## Promote feature-1201.feature\n\nMove it into the regression suite.' };

    expect(implementationIssueFor(PROPOSAL, [older])).toBeNull();
  });
});
