import { describe, it, expect, vi } from 'vitest';
import type { IssueListEntry, IssueListQuery } from '@paysdoc/devplatform';
import type { NominationKey } from '../../promotion/nominationCollector';
import { DeclineReason } from '../../promotion/promotionDecider';
import { buildPromotionImplementationIssue } from '../../promotion/promotionImplementationIssue';
import { buildPromotionProposal } from '../../promotion/proposalBody';
import { buildDecisionComment } from '../../promotion/proposalDecisionRecord';
import {
  PROMOTION_IMPLEMENTATION_SEARCH,
  PROMOTION_PROPOSAL_SEARCH,
  PROPOSAL_COMPLETED_SEARCH,
  PROPOSAL_NOT_PLANNED_SEARCH,
  closeReasonOf,
  listDecisionProposals,
  listImplementationIssues,
  listPromotionProposals,
  readSweepExemptCandidates,
  readSweepExemptIssues,
} from '../promotionProposalIssues';

const REFUND: NominationKey = { issueNumber: 1201, scenarioName: 'An order is refunded' };
const INVOICE: NominationKey = { issueNumber: 1207, scenarioName: 'An invoice is sent' };
const PARCEL: NominationKey = { issueNumber: 1210, scenarioName: 'A parcel is shipped' };
const PROPOSAL_LABELS = [{ name: 'adw:none' }, { name: 'promotion-proposal' }];
const IMPLEMENTATION_LABELS = [{ name: 'adw:chore' }, { name: 'regression-promotion' }];
const DECLINED_RECORD = buildDecisionComment({ outcome: 'declined', reason: DeclineReason.NotPlanned, approved: [], declined: [PARCEL], missing: [], implementationIssue: null });

function bodyOffering(...keys: NominationKey[]): string {
  const candidates = keys.map((key) => ({ ...key, featurePath: `features/per-issue/feature-${key.issueNumber}.feature`, qualification: 'q', fit: 'f', overlaps: [] }));
  return buildPromotionProposal(candidates, new Date('2026-11-28T00:00:00Z')).body;
}

function trackerListing(entries: readonly IssueListEntry[]) {
  return { listIssues: vi.fn((_query: IssueListQuery): readonly IssueListEntry[] => entries) };
}

/** A forge whose search answers each query string with its own listing, open issues only when asked for open ones. */
function trackerSearching(listings: Readonly<Record<string, readonly IssueListEntry[]>>) {
  const answer = (query: IssueListQuery): readonly IssueListEntry[] =>
    (listings[query.search ?? ''] ?? []).filter((entry) => query.state !== 'open' || entry.state === 'OPEN');
  return { listIssues: vi.fn(answer) };
}

function implementationBody(proposalNumber: number, ...keys: NominationKey[]): string {
  const approved = keys.map((key) => ({ ...key, featurePath: `features/per-issue/feature-${key.issueNumber}.feature` }));
  return buildPromotionImplementationIssue({ proposalNumber, approved }).body;
}

describe('listPromotionProposals', () => {
  it('lists number, body, state, labels and createdAt with the Promotion Proposal label search, in the requested state', () => {
    const tracker = trackerListing([]);

    listPromotionProposals(tracker, 'all');
    listPromotionProposals(tracker, 'open');

    const fields = ['number', 'body', 'state', 'labels', 'createdAt'];
    expect(tracker.listIssues).toHaveBeenNthCalledWith(1, { fields, state: 'all', search: 'label:"promotion-proposal"', limit: 100 });
    expect(tracker.listIssues).toHaveBeenNthCalledWith(2, { fields, state: 'open', search: 'label:"promotion-proposal"', limit: 100 });
  });

  it('keeps only issues that carry the Promotion Proposal label, whatever the search matched', () => {
    const tracker = trackerListing([
      { number: 40, body: bodyOffering(REFUND), state: 'CLOSED', labels: PROPOSAL_LABELS, createdAt: '2026-11-01T00:00:00Z' },
      { number: 41, body: 'mentions promotion-proposal', state: 'OPEN', labels: [{ name: 'adw:none' }], createdAt: '2026-11-02T00:00:00Z' },
      { number: 42, state: 'OPEN', createdAt: '2026-11-03T00:00:00Z' },
      { number: 43, state: 'OPEN', labels: PROPOSAL_LABELS, createdAt: '2026-11-20T00:00:00Z' },
    ]);

    expect(listPromotionProposals(tracker, 'all')).toEqual([
      { number: 40, body: bodyOffering(REFUND), state: 'CLOSED', createdAt: '2026-11-01T00:00:00Z' },
      { number: 43, body: '', state: 'OPEN', createdAt: '2026-11-20T00:00:00Z' },
    ]);
  });

  it('lets a listing failure through', () => {
    const tracker = { listIssues: vi.fn(() => { throw new Error('gh: HTTP 502'); }) };

    expect(() => listPromotionProposals(tracker, 'open')).toThrow('HTTP 502');
  });
});

describe('closeReasonOf', () => {
  it.each([
    ['listed as not planned and as completed → not_planned, the safe side', [40], [40], 'not_planned'],
    ['listed as completed only → completed', [], [40], 'completed'],
    ['listed under neither reason → unread', [41], [42], 'unread'],
  ] as const)('%s', (_case, notPlanned, completed, expected) => {
    expect(closeReasonOf(40, new Set(notPlanned), new Set(completed))).toBe(expected);
  });
});

describe('listDecisionProposals', () => {
  it("lists every proposal with its comments and the closed proposals of each close reason, and maps each proposal's close reason", () => {
    const tracker = trackerSearching({
      [PROMOTION_PROPOSAL_SEARCH]: [
        { number: 40, body: bodyOffering(REFUND), state: 'CLOSED', labels: PROPOSAL_LABELS, createdAt: '2026-11-01T00:00:00Z', comments: [{ body: 'Ticked one.' }] },
        { number: 41, body: bodyOffering(INVOICE), state: 'CLOSED', labels: PROPOSAL_LABELS, createdAt: '2026-11-08T00:00:00Z' },
        { number: 42, body: bodyOffering(PARCEL), state: 'CLOSED', labels: PROPOSAL_LABELS, createdAt: '2026-11-15T00:00:00Z' },
        { number: 43, body: 'mentions promotion-proposal', state: 'OPEN', labels: [{ name: 'adw:none' }] },
      ],
      [PROPOSAL_NOT_PLANNED_SEARCH]: [{ number: 41, state: 'CLOSED', labels: PROPOSAL_LABELS }],
      [PROPOSAL_COMPLETED_SEARCH]: [{ number: 40, state: 'CLOSED', labels: PROPOSAL_LABELS }],
    });

    expect(listDecisionProposals(tracker)).toEqual([
      { number: 40, body: bodyOffering(REFUND), state: 'CLOSED', createdAt: '2026-11-01T00:00:00Z', closeReason: 'completed', comments: ['Ticked one.'] },
      { number: 41, body: bodyOffering(INVOICE), state: 'CLOSED', createdAt: '2026-11-08T00:00:00Z', closeReason: 'not_planned', comments: [] },
      { number: 42, body: bodyOffering(PARCEL), state: 'CLOSED', createdAt: '2026-11-15T00:00:00Z', closeReason: 'unread', comments: [] },
    ]);
    expect(tracker.listIssues).toHaveBeenCalledWith({ fields: ['number', 'body', 'state', 'labels', 'createdAt', 'comments'], state: 'all', search: 'label:"promotion-proposal"', limit: 100 });
    expect(tracker.listIssues).toHaveBeenCalledWith({ fields: ['number', 'labels'], state: 'closed', search: 'label:"promotion-proposal" reason:"not planned"', limit: 100 });
    expect(tracker.listIssues).toHaveBeenCalledWith({ fields: ['number', 'labels'], state: 'closed', search: 'label:"promotion-proposal" reason:completed', limit: 100 });
  });

  it('lets a listing failure through', () => {
    const tracker = { listIssues: vi.fn(() => { throw new Error('gh: HTTP 502'); }) };

    expect(() => listDecisionProposals(tracker)).toThrow('HTTP 502');
  });
});

describe('listImplementationIssues', () => {
  it('keeps only the issues that carry regression-promotion, listed in the requested state', () => {
    const tracker = trackerSearching({
      [PROMOTION_IMPLEMENTATION_SEARCH]: [
        { number: 900, body: implementationBody(40, REFUND), state: 'OPEN', labels: IMPLEMENTATION_LABELS },
        { number: 901, body: 'mentions regression-promotion', state: 'OPEN', labels: [{ name: 'adw:chore' }] },
        { number: 902, state: 'CLOSED', labels: IMPLEMENTATION_LABELS },
      ],
    });

    expect(listImplementationIssues(tracker, 'all')).toEqual([
      { number: 900, body: implementationBody(40, REFUND), state: 'OPEN' },
      { number: 902, body: '', state: 'CLOSED' },
    ]);
    expect(tracker.listIssues).toHaveBeenCalledWith({ fields: ['number', 'body', 'state', 'labels'], state: 'all', search: 'label:"regression-promotion"', limit: 100 });
  });
});

describe('readSweepExemptCandidates', () => {
  it('combines the candidates of the undecided proposals with the scenarios of the open implementation issues', () => {
    const tracker = trackerSearching({
      [PROMOTION_PROPOSAL_SEARCH]: [
        { number: 50, body: bodyOffering(REFUND), state: 'OPEN', labels: PROPOSAL_LABELS, comments: [] },
        { number: 51, body: bodyOffering(INVOICE, PARCEL), state: 'CLOSED', labels: PROPOSAL_LABELS, comments: [{ body: DECLINED_RECORD }] },
      ],
      [PROMOTION_IMPLEMENTATION_SEARCH]: [
        { number: 900, body: implementationBody(51, INVOICE), state: 'OPEN', labels: IMPLEMENTATION_LABELS },
        { number: 901, body: implementationBody(49, PARCEL), state: 'CLOSED', labels: IMPLEMENTATION_LABELS },
      ],
    });

    expect(readSweepExemptCandidates(tracker)).toEqual([REFUND, INVOICE]);
    expect(tracker.listIssues).toHaveBeenCalledWith(expect.objectContaining({ state: 'open', search: PROMOTION_IMPLEMENTATION_SEARCH }));
  });
});

describe('readSweepExemptIssues', () => {
  it("returns the candidates' issue numbers, and null with a warning when the read throws", () => {
    const log = vi.fn();

    expect(readSweepExemptIssues(() => [REFUND, INVOICE, { issueNumber: 1201, scenarioName: 'Another' }], log)).toEqual(new Set([1201, 1207]));
    expect(log).not.toHaveBeenCalled();

    expect(readSweepExemptIssues(() => { throw new Error('gh: HTTP 502'); }, log)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not read the open Promotion Proposal'), 'warn');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('nothing removed this cycle'), 'warn');
  });
});
