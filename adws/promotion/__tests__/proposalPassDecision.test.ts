import { describe, it, expect } from 'vitest';
import { NominationState, type Nomination, type NominationKey } from '../nominationCollector';
import { buildPromotionProposal, type PromotionCandidate } from '../proposalBody';
import {
  MAX_PROPOSAL_CANDIDATES,
  openProposalCandidates,
  proposalPassBlocker,
  proposedCandidates,
  selectProposalCandidates,
  type ProposalIssueRef,
  type ProposalPassBlocker,
} from '../proposalPassDecision';

const NOW = new Date('2026-11-28T12:00:00Z');
const DAY_MS = 86_400_000;
const INTERVAL_DAYS = 7;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function proposal(number: number, state: string | undefined, createdAt: string | undefined, candidates: readonly NominationKey[] = []): ProposalIssueRef {
  const analysed: PromotionCandidate[] = candidates.map((key) => ({ ...key, featurePath: `features/per-issue/feature-${key.issueNumber}.feature`, qualification: 'q', fit: 'f', overlaps: [] }));
  return { number, state, createdAt, body: buildPromotionProposal(analysed, NOW).body };
}

function nomination(issueNumber: number, scenarioName: string, state: NominationState = NominationState.AwaitingProposal): Nomination {
  return { issueNumber, scenarioName, featurePath: `features/per-issue/feature-${issueNumber}.feature`, state };
}

const REFUND: NominationKey = { issueNumber: 1201, scenarioName: 'An order is refunded' };
const INVOICE: NominationKey = { issueNumber: 1207, scenarioName: 'An invoice is sent' };
const PARCEL: NominationKey = { issueNumber: 1210, scenarioName: 'A parcel is shipped' };

describe('proposalPassBlocker', () => {
  const cases: ReadonlyArray<readonly [string, readonly ProposalIssueRef[], ProposalPassBlocker | null]> = [
    ['no proposals → null', [], null],
    ['open, filed today → proposal_open', [proposal(40, 'OPEN', daysAgo(0))], { kind: 'proposal_open', issueNumber: 40 }],
    ['open, filed 40 days ago → proposal_open', [proposal(40, 'OPEN', daysAgo(40))], { kind: 'proposal_open', issueNumber: 40 }],
    ['closed 3 days ago → proposed_recently', [proposal(41, 'CLOSED', daysAgo(3))], { kind: 'proposed_recently', issueNumber: 41, createdAt: new Date(daysAgo(3)) }],
    ['closed exactly 7 days ago → null', [proposal(41, 'CLOSED', daysAgo(7))], null],
    ['closed 8 days ago → null', [proposal(41, 'CLOSED', daysAgo(8))], null],
    [
      'the newest of two closed decides: 10 and 3 days ago → proposed_recently',
      [proposal(42, 'CLOSED', daysAgo(10)), proposal(43, 'CLOSED', daysAgo(3))],
      { kind: 'proposed_recently', issueNumber: 43, createdAt: new Date(daysAgo(3)) },
    ],
    ['the newest of two closed decides: 10 and 8 days ago → null', [proposal(43, 'CLOSED', daysAgo(8)), proposal(42, 'CLOSED', daysAgo(10))], null],
    ['closed with a missing createdAt → null', [proposal(44, 'CLOSED', undefined)], null],
    ['closed with an unparseable createdAt → null', [proposal(44, 'CLOSED', 'last Tuesday')], null],
    ['state "open" in lower case → proposal_open', [proposal(45, 'open', daysAgo(20))], { kind: 'proposal_open', issueNumber: 45 }],
    ['no state → proposal_open', [proposal(46, undefined, undefined)], { kind: 'proposal_open', issueNumber: 46 }],
    ['two open → the lowest number is reported', [proposal(48, 'OPEN', daysAgo(1)), proposal(47, 'OPEN', daysAgo(9))], { kind: 'proposal_open', issueNumber: 47 }],
  ];

  it.each(cases)('%s', (_name, proposals, expected) => {
    expect(proposalPassBlocker(proposals, NOW, INTERVAL_DAYS)).toEqual(expected);
  });
});

describe('selectProposalCandidates', () => {
  it('keeps only Nominations awaiting a proposal: declined ones are left out', () => {
    const nominations = [nomination(1201, REFUND.scenarioName, NominationState.Declined), nomination(1207, INVOICE.scenarioName)];

    expect(selectProposalCandidates(nominations, [])).toEqual({ selected: [nominations[1]], deferred: 0 });
  });

  it('leaves out a Nomination that a listed proposal, open or closed, already named', () => {
    const nominations = [nomination(1201, REFUND.scenarioName), nomination(1207, INVOICE.scenarioName), nomination(1210, PARCEL.scenarioName)];
    const proposals = [proposal(50, 'CLOSED', daysAgo(30), [REFUND]), proposal(51, 'OPEN', daysAgo(2), [PARCEL])];

    expect(selectProposalCandidates(nominations, proposedCandidates(proposals)).selected).toEqual([nominations[1]]);
  });

  it("keeps the collector's order and takes at most MAX_PROPOSAL_CANDIDATES, counting the rest as deferred", () => {
    const nominations = Array.from({ length: MAX_PROPOSAL_CANDIDATES + 3 }, (_, index) => nomination(1300 + index, `scenario ${index}`));

    const selection = selectProposalCandidates(nominations, []);

    expect(selection.selected).toEqual(nominations.slice(0, MAX_PROPOSAL_CANDIDATES));
    expect(selection.deferred).toBe(3);
  });
});

describe('openProposalCandidates', () => {
  it('reads the candidates of open proposals only, across several', () => {
    const proposals = [proposal(60, 'OPEN', daysAgo(1), [REFUND]), proposal(61, 'CLOSED', daysAgo(9), [INVOICE]), proposal(62, undefined, undefined, [PARCEL])];

    expect(openProposalCandidates(proposals)).toEqual([REFUND, PARCEL]);
  });
});

describe('proposedCandidates', () => {
  it('reads the candidates of every listed proposal once', () => {
    const proposals = [proposal(70, 'CLOSED', daysAgo(20), [REFUND, INVOICE]), proposal(71, 'OPEN', daysAgo(1), [INVOICE, PARCEL])];

    expect(proposedCandidates(proposals)).toEqual([REFUND, INVOICE, PARCEL]);
  });
});
