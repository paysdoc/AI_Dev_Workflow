import { describe, it, expect, vi } from 'vitest';
import type { IssueListEntry, IssueListQuery } from '@paysdoc/devplatform';
import { buildPromotionProposal } from '../../promotion/proposalBody';
import type { NominationKey } from '../../promotion/nominationCollector';
import { listPromotionProposals, readOpenProposalCandidates, readSweepExemptIssues } from '../promotionProposalIssues';

const REFUND: NominationKey = { issueNumber: 1201, scenarioName: 'An order is refunded' };
const INVOICE: NominationKey = { issueNumber: 1207, scenarioName: 'An invoice is sent' };
const PARCEL: NominationKey = { issueNumber: 1210, scenarioName: 'A parcel is shipped' };
const PROPOSAL_LABELS = [{ name: 'adw:none' }, { name: 'promotion-proposal' }];

function bodyOffering(...keys: NominationKey[]): string {
  const candidates = keys.map((key) => ({ ...key, featurePath: `features/per-issue/feature-${key.issueNumber}.feature`, qualification: 'q', fit: 'f', overlaps: [] }));
  return buildPromotionProposal(candidates, new Date('2026-11-28T00:00:00Z')).body;
}

function trackerListing(entries: readonly IssueListEntry[]) {
  return { listIssues: vi.fn((_query: IssueListQuery): readonly IssueListEntry[] => entries) };
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

describe('readOpenProposalCandidates', () => {
  it('reads the candidates of every open proposal', () => {
    const tracker = trackerListing([
      { number: 50, body: bodyOffering(REFUND, INVOICE), state: 'OPEN', labels: PROPOSAL_LABELS },
      { number: 51, body: bodyOffering(PARCEL), state: 'OPEN', labels: PROPOSAL_LABELS },
    ]);

    expect(readOpenProposalCandidates(tracker)).toEqual([REFUND, INVOICE, PARCEL]);
    expect(tracker.listIssues).toHaveBeenCalledWith(expect.objectContaining({ state: 'open' }));
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
