import { describe, it, expect } from 'vitest';
import type { NominationKey } from '../nominationCollector';
import { buildPromotionImplementationIssue, type ImplementationIssueRef } from '../promotionImplementationIssue';
import { buildPromotionProposal, readProposalCandidates, type ProposalCandidateReading } from '../proposalBody';
import { buildDecisionComment } from '../proposalDecisionRecord';
import {
  DeclineReason,
  ProposalState,
  decidePromotion,
  proposalActions,
  proposalStateOf,
  sweepExemptCandidates,
  type DecisionProposalRef,
  type PromotionDecision,
  type ProposalCloseReason,
} from '../promotionDecider';

const NOW = new Date('2026-11-28T12:00:00Z');
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

const REFUND: NominationKey = { issueNumber: 1201, scenarioName: 'An order is refunded' };
const INVOICE: NominationKey = { issueNumber: 1207, scenarioName: 'An invoice is sent' };
const PARCEL: NominationKey = { issueNumber: 1210, scenarioName: 'A parcel is shipped' };
const OFFERED: readonly NominationKey[] = [REFUND, INVOICE, PARCEL];

function isLineOf(line: string, ticked: readonly NominationKey[]): boolean {
  return readProposalCandidates(line).some((reading) => ticked.some((key) => key.issueNumber === reading.issueNumber && key.scenarioName === reading.scenarioName));
}

/** The proposal the weekly pass files for `offered`, with the owner's ticks on the lines of `ticked`. */
function bodyOffering(offered: readonly NominationKey[], ticked: readonly NominationKey[] = []): string {
  const candidates = offered.map((key) => ({ ...key, featurePath: `features/per-issue/feature-${key.issueNumber}.feature`, qualification: 'q', fit: 'f', overlaps: [] }));
  const { body } = buildPromotionProposal(candidates, NOW);
  return body.split('\n').map((line) => (isLineOf(line, ticked) ? line.replace('[ ]', '[x]') : line)).join('\n');
}

function candidatesOf(offered: readonly NominationKey[], ticked: readonly NominationKey[] = []): readonly ProposalCandidateReading[] {
  return readProposalCandidates(bodyOffering(offered, ticked));
}

function proposal(number: number, state: string, closeReason: ProposalCloseReason, body: string, createdAt: Date = daysAgo(5), comments: readonly string[] = []): DecisionProposalRef {
  return { number, state, closeReason, body, createdAt: createdAt.toISOString(), comments };
}

function implementationIssue(number: number, state: string, proposalNumber: number, approved: readonly NominationKey[]): ImplementationIssueRef {
  const scenarios = approved.map((key) => ({ ...key, featurePath: `features/per-issue/feature-${key.issueNumber}.feature` }));
  return { number, state, body: buildPromotionImplementationIssue({ proposalNumber, approved: scenarios }).body };
}

const APPROVED_RECORD = buildDecisionComment({ outcome: 'approved', approved: [REFUND], declined: [INVOICE], missing: [], implementationIssue: 900 });
const DECLINED_RECORD = buildDecisionComment({ outcome: 'declined', reason: DeclineReason.NotPlanned, approved: [], declined: [REFUND], missing: [], implementationIssue: null });
const EXPIRED_RECORD = buildDecisionComment({ outcome: 'expired', reason: DeclineReason.Expired, approved: [], declined: [REFUND], missing: [], implementationIssue: null });

function declineAll(reason: DeclineReason, declined: readonly NominationKey[]): PromotionDecision {
  return { kind: 'decline', reason, declined };
}

describe('decidePromotion — the decision table over state, ticked set and age', () => {
  const WAIT: PromotionDecision = { kind: 'wait' };
  const cases: ReadonlyArray<readonly [string, ProposalState, readonly NominationKey[], readonly NominationKey[], Date | null, PromotionDecision]> = [
    ['open, nothing ticked, 1 day old → wait', ProposalState.Open, OFFERED, [], daysAgo(1), WAIT],
    ['open, two of three ticked, 10 days old → wait: ticks on an open proposal do nothing', ProposalState.Open, OFFERED, [REFUND, INVOICE], daysAgo(10), WAIT],
    ['open, 29 days 23 hours old → wait', ProposalState.Open, OFFERED, [], new Date(daysAgo(30).getTime() + HOUR_MS), WAIT],
    ['open, exactly 30 days old → decline all, expired', ProposalState.Open, OFFERED, [], daysAgo(30), declineAll(DeclineReason.Expired, OFFERED)],
    ['open, 45 days old, two ticked → decline all, expired', ProposalState.Open, OFFERED, [REFUND, INVOICE], daysAgo(45), declineAll(DeclineReason.Expired, OFFERED)],
    ['open, no createdAt → wait', ProposalState.Open, OFFERED, [], null, WAIT],
    ['open, unparseable createdAt → wait', ProposalState.Open, OFFERED, [], new Date('last Tuesday'), WAIT],
    [
      'closed as completed, two of three ticked → approve those two in body order, decline the third',
      ProposalState.ClosedAsCompleted,
      OFFERED,
      [INVOICE, REFUND],
      daysAgo(5),
      { kind: 'approve', approved: [REFUND, INVOICE], declined: [PARCEL] },
    ],
    ['closed as completed, all ticked → approve all, decline none', ProposalState.ClosedAsCompleted, OFFERED, OFFERED, daysAgo(5), { kind: 'approve', approved: OFFERED, declined: [] }],
    ['closed as completed, nothing ticked → decline all, nothing_ticked', ProposalState.ClosedAsCompleted, OFFERED, [], daysAgo(5), declineAll(DeclineReason.NothingTicked, OFFERED)],
    [
      "closed as completed, 40 days old, one ticked → approve that one: age never overrides the owner's close",
      ProposalState.ClosedAsCompleted,
      OFFERED,
      [PARCEL],
      daysAgo(40),
      { kind: 'approve', approved: [PARCEL], declined: [REFUND, INVOICE] },
    ],
    ['closed as not planned, two ticked → decline all, not_planned', ProposalState.ClosedAsNotPlanned, OFFERED, [REFUND, INVOICE], daysAgo(5), declineAll(DeclineReason.NotPlanned, OFFERED)],
    ['closed as not planned, nothing ticked → decline all, not_planned', ProposalState.ClosedAsNotPlanned, OFFERED, [], daysAgo(5), declineAll(DeclineReason.NotPlanned, OFFERED)],
    ['closed for an unread reason, 5 days old, two ticked → wait', ProposalState.ClosedForUnreadReason, OFFERED, [REFUND, INVOICE], daysAgo(5), WAIT],
    ['closed for an unread reason, 30 days old → decline all, expired', ProposalState.ClosedForUnreadReason, OFFERED, [], daysAgo(30), declineAll(DeclineReason.Expired, OFFERED)],
    ['closed as completed, no candidate lines at all → decline an empty set, nothing_ticked', ProposalState.ClosedAsCompleted, [], [], daysAgo(5), declineAll(DeclineReason.NothingTicked, [])],
  ];

  it.each(cases)('%s', (_name, state, offered, ticked, createdAt, expected) => {
    expect(decidePromotion({ state, candidates: candidatesOf(offered, ticked), createdAt, now: NOW })).toEqual(expected);
  });
});

describe('proposalStateOf', () => {
  const cases: ReadonlyArray<readonly [string | undefined, ProposalCloseReason, ProposalState]> = [
    ['OPEN', 'completed', ProposalState.Open],
    ['OPEN', 'not_planned', ProposalState.Open],
    ['open', 'unread', ProposalState.Open],
    [undefined, 'not_planned', ProposalState.Open],
    ['CLOSED', 'completed', ProposalState.ClosedAsCompleted],
    ['CLOSED', 'not_planned', ProposalState.ClosedAsNotPlanned],
    ['CLOSED', 'unread', ProposalState.ClosedForUnreadReason],
  ];

  it.each(cases)('state %s with the close reason %s → %s', (state, closeReason, expected) => {
    expect(proposalStateOf(state, closeReason)).toBe(expected);
  });
});

describe('proposalActions', () => {
  it('never acts on a proposal whose record says approved, even when it is closed as completed with ticks', () => {
    const decided = proposal(40, 'CLOSED', 'completed', bodyOffering([REFUND, INVOICE], [REFUND]), daysAgo(5), ['Thanks, merging these.', APPROVED_RECORD]);

    expect(proposalActions([decided], NOW)).toEqual([]);
  });

  it('leaves a reopened proposal whose record says declined alone', () => {
    const reopened = proposal(41, 'OPEN', 'unread', bodyOffering([REFUND], [REFUND]), daysAgo(45), [DECLINED_RECORD]);

    expect(proposalActions([reopened], NOW)).toEqual([]);
  });

  it('closes again a still-open proposal whose record says expired, and does nothing for a closed one', () => {
    const stillOpen = proposal(42, 'OPEN', 'unread', bodyOffering([REFUND]), daysAgo(31), [EXPIRED_RECORD]);
    const closed = proposal(43, 'CLOSED', 'completed', bodyOffering([INVOICE]), daysAgo(31), [EXPIRED_RECORD]);

    expect(proposalActions([stillOpen, closed], NOW)).toEqual([{ kind: 'close_again', proposal: stillOpen }]);
  });

  it('leaves out the proposals the decider waits on', () => {
    const open = proposal(44, 'OPEN', 'unread', bodyOffering([REFUND], [REFUND]), daysAgo(3));
    const unread = proposal(45, 'CLOSED', 'unread', bodyOffering([INVOICE], [INVOICE]), daysAgo(3));

    expect(proposalActions([open, unread], NOW)).toEqual([]);
  });

  it('orders the actions by ascending proposal number', () => {
    const later = proposal(52, 'CLOSED', 'not_planned', bodyOffering([PARCEL]));
    const earlier = proposal(51, 'CLOSED', 'completed', bodyOffering([REFUND, INVOICE], [REFUND]));

    expect(proposalActions([later, earlier], NOW)).toEqual([
      { kind: 'decide', proposal: earlier, decision: { kind: 'approve', approved: [REFUND], declined: [INVOICE] } },
      { kind: 'decide', proposal: later, decision: declineAll(DeclineReason.NotPlanned, [PARCEL]) },
    ]);
  });
});

describe('sweepExemptCandidates', () => {
  it('keeps every candidate of an open proposal without a record', () => {
    const open = proposal(60, 'OPEN', 'unread', bodyOffering([REFUND, INVOICE]), daysAgo(2));

    expect(sweepExemptCandidates([open], [])).toEqual([REFUND, INVOICE]);
  });

  it('keeps every candidate of a closed proposal without a record', () => {
    const closed = proposal(61, 'CLOSED', 'completed', bodyOffering([REFUND, INVOICE], [REFUND]));

    expect(sweepExemptCandidates([closed], [])).toEqual([REFUND, INVOICE]);
  });

  it('drops the candidates of a proposal with a record, open or closed', () => {
    const open = proposal(62, 'OPEN', 'unread', bodyOffering([REFUND]), daysAgo(31), [EXPIRED_RECORD]);
    const closed = proposal(63, 'CLOSED', 'not_planned', bodyOffering([INVOICE]), daysAgo(5), [DECLINED_RECORD]);

    expect(sweepExemptCandidates([open, closed], [])).toEqual([]);
  });

  it('keeps the scenarios an open implementation issue lists and drops those of a closed one', () => {
    const issues = [implementationIssue(900, 'OPEN', 64, [REFUND]), implementationIssue(901, 'CLOSED', 65, [INVOICE])];

    expect(sweepExemptCandidates([], issues)).toEqual([REFUND]);
  });

  it('keeps nothing for an implementation issue with no candidate lines', () => {
    expect(sweepExemptCandidates([], [{ number: 902, body: 'Promote the order scenarios.', state: 'OPEN' }])).toEqual([]);
  });

  it('lists a candidate named twice once', () => {
    const open = proposal(66, 'OPEN', 'unread', bodyOffering([REFUND, INVOICE]), daysAgo(2));

    expect(sweepExemptCandidates([open], [implementationIssue(903, 'OPEN', 60, [REFUND])])).toEqual([REFUND, INVOICE]);
  });
});
