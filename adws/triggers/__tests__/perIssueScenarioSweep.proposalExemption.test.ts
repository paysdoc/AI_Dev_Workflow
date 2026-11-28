import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import type { IssueListEntry, IssueListQuery } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../core';
import type { NominationKey } from '../../promotion/nominationCollector';
import { DeclineReason } from '../../promotion/promotionDecider';
import { buildPromotionImplementationIssue } from '../../promotion/promotionImplementationIssue';
import { buildPromotionProposal } from '../../promotion/proposalBody';
import { buildDecisionComment } from '../../promotion/proposalDecisionRecord';
import { runPerIssueScenarioSweep } from '../perIssueScenarioSweep';
import { PROMOTION_IMPLEMENTATION_SEARCH, PROMOTION_PROPOSAL_SEARCH, PROPOSAL_COMPLETED_SEARCH, PROPOSAL_NOT_PLANNED_SEARCH } from '../promotionProposalIssues';
import { NOW, committedPaths, daysAgo, fakeTarget, loggedLines, sweepDeps, usage, usageReport, type FakeTarget, type FakeTargetOptions } from './fixtures/perIssueSweepDeps';

const CANDIDATE = 'features/per-issue/feature-80.feature';
const CANDIDATE_STEPS = 'features/per-issue/step_definitions/feature-80.steps.ts';
const OTHER = 'features/per-issue/feature-81.feature';
const OTHER_STEPS = 'features/per-issue/step_definitions/feature-81.steps.ts';
const SHIPPING = 'features/step_definitions/parcels.steps.ts';
const RETURNS = 'features/step_definitions/returns.steps.ts';
const SHIPPED: NominationKey = { issueNumber: 80, scenarioName: 'A parcel is shipped' };
const RETURNED: NominationKey = { issueNumber: 81, scenarioName: 'A parcel is returned' };
const PROPOSAL_LABELS = [{ name: 'adw:none' }, { name: 'promotion-proposal' }];
const APPROVED_RECORD = buildDecisionComment({ outcome: 'approved', approved: [SHIPPED], declined: [RETURNED], missing: [], implementationIssue: 900 });
const DECLINED_RECORD = buildDecisionComment({ outcome: 'declined', reason: DeclineReason.NotPlanned, approved: [], declined: [SHIPPED], missing: [], implementationIssue: null });

const targets: FakeTarget[] = [];

function target(options: Partial<FakeTargetOptions> = {}): FakeTarget {
  const created = fakeTarget({ tracked: [CANDIDATE, CANDIDATE_STEPS, OTHER, OTHER_STEPS], mergedAt: { 80: daysAgo(20), 81: daysAgo(20) }, ...options });
  targets.push(created);
  return created;
}

afterEach(() => {
  targets.splice(0).forEach((created) => created.cleanup());
});

function proposalEntry(number: number, state: 'OPEN' | 'CLOSED', keys: readonly NominationKey[], comments: readonly string[] = []): IssueListEntry {
  const candidates = keys.map((key) => ({ ...key, featurePath: `features/per-issue/feature-${key.issueNumber}.feature`, qualification: 'q', fit: 'f', overlaps: [] }));
  const { body } = buildPromotionProposal(candidates, NOW);
  return { number, body, state, labels: PROPOSAL_LABELS, createdAt: daysAgo(2).toISOString(), comments: comments.map((comment) => ({ body: comment })) };
}

function implementationEntry(number: number, state: 'OPEN' | 'CLOSED', proposalNumber: number, keys: readonly NominationKey[]): IssueListEntry {
  const approved = keys.map((key) => ({ ...key, featurePath: `features/per-issue/feature-${key.issueNumber}.feature` }));
  const { body } = buildPromotionImplementationIssue({ proposalNumber, approved });
  return { number, body, state, labels: [{ name: 'adw:chore' }, { name: 'regression-promotion' }] };
}

interface ForgeListings {
  readonly proposals?: readonly IssueListEntry[];
  readonly completed?: readonly number[];
  readonly implementationIssues?: readonly IssueListEntry[];
}

/** The target's forge, answering the promotion searches with these listings, open issues only when asked for open ones, and every other listing as before. */
function forgeListing(repo: FakeTarget, { proposals = [], completed = [], implementationIssues = [] }: ForgeListings) {
  const listings: Readonly<Record<string, readonly IssueListEntry[]>> = {
    [PROMOTION_PROPOSAL_SEARCH]: proposals,
    [PROPOSAL_NOT_PLANNED_SEARCH]: [],
    [PROPOSAL_COMPLETED_SEARCH]: proposals.filter((proposal) => completed.includes(proposal.number)),
    [PROMOTION_IMPLEMENTATION_SEARCH]: implementationIssues,
  };
  const listIssues = vi.fn((query: IssueListQuery): readonly IssueListEntry[] => {
    const listing = listings[query.search ?? ''];
    if (!listing) return repo.tracker.listIssues(query);
    return listing.filter((entry) => query.state !== 'open' || entry.state === 'OPEN');
  });
  const issueTracker = { ...repo.tracker, listIssues };
  const boundary = { ...repo.boundary, providers: { ...repo.boundary.providers, issueTracker } } as unknown as LaunchBoundary;
  return { boundary, listIssues };
}

function sweepReadingTheForge(repo: FakeTarget, listings: ForgeListings): Promise<string[]> {
  const { boundary } = forgeListing(repo, listings);
  return runPerIssueScenarioSweep(sweepDeps(repo, { boundary, readExemptCandidates: undefined, readStepUsage: usageReport() }));
}

describe('runPerIssueScenarioSweep — the candidates of an undecided Promotion Proposal and the scenarios of an open implementation issue', () => {
  it('keeps a stale Per-Issue Scenario that an exempt candidate holds, with its step-definition files, and removes the other stale ones', async () => {
    const repo = target();
    const log = vi.fn();

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readExemptCandidates: () => [SHIPPED], readStepUsage: usageReport(), log }));

    expect(removed).toEqual([OTHER, OTHER_STEPS]);
    expect(committedPaths(repo)).toEqual([OTHER, OTHER_STEPS]);
    expect(loggedLines(log)).toContain(
      `perIssueScenarioSweep: keeping stale scenario ${CANDIDATE} (issue #80): a candidate of an undecided Promotion Proposal or of an open promotion implementation issue`,
    );
  });

  it('does not list a step definition that only an exempt candidate uses, and lists the other unused ones', async () => {
    const repo = target({ tracked: [CANDIDATE, OTHER, SHIPPING, RETURNS] });
    const readStepUsage = usageReport(usage(SHIPPING, 3, 'a parcel is shipped', [CANDIDATE]), usage(RETURNS, 3, 'a parcel is returned', [OTHER]));

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readExemptCandidates: () => [SHIPPED], readStepUsage }));

    expect(removed).toEqual([OTHER]);
    expect(repo.tracker.issues).toHaveLength(1);
    expect(repo.tracker.issues[0].body).toContain('`features/step_definitions/returns.steps.ts:3` — `a parcel is returned`');
    expect(repo.tracker.issues[0].body).not.toContain('a parcel is shipped');
  });

  it('exempts the candidates of every open proposal', async () => {
    const repo = target();

    const removed = await sweepReadingTheForge(repo, { proposals: [proposalEntry(300, 'OPEN', [SHIPPED]), proposalEntry(301, 'OPEN', [RETURNED])] });

    expect(removed).toEqual([]);
    expect(committedPaths(repo)).toEqual([]);
  });

  it('keeps a stale scenario of a closed proposal not yet decided', async () => {
    const repo = target();

    const removed = await sweepReadingTheForge(repo, { proposals: [proposalEntry(310, 'CLOSED', [SHIPPED])], completed: [310] });

    expect(removed).toEqual([OTHER, OTHER_STEPS]);
  });

  it('sweeps the declined candidate of a decided proposal on the normal rule', async () => {
    const repo = target();

    const removed = await sweepReadingTheForge(repo, { proposals: [proposalEntry(311, 'CLOSED', [SHIPPED], [DECLINED_RECORD])] });

    expect(removed).toEqual([CANDIDATE, CANDIDATE_STEPS, OTHER, OTHER_STEPS]);
  });

  it('keeps an approved candidate while its implementation issue is open, and sweeps it once that issue is closed', async () => {
    const repo = target();
    const decided = proposalEntry(312, 'CLOSED', [SHIPPED, RETURNED], [APPROVED_RECORD]);

    const whileOpen = await sweepReadingTheForge(repo, { proposals: [decided], completed: [312], implementationIssues: [implementationEntry(900, 'OPEN', 312, [SHIPPED])] });
    const onceClosed = await sweepReadingTheForge(repo, { proposals: [decided], completed: [312], implementationIssues: [implementationEntry(900, 'CLOSED', 312, [SHIPPED])] });

    expect(whileOpen).toEqual([OTHER, OTHER_STEPS]);
    expect(onceClosed).toEqual([CANDIDATE, CANDIDATE_STEPS, OTHER, OTHER_STEPS]);
  });

  it('sweeps a stale former candidate on the normal rule once it is no longer exempt', async () => {
    const repo = target();

    const whileExempt = await runPerIssueScenarioSweep(sweepDeps(repo, { readExemptCandidates: () => [SHIPPED], readStepUsage: usageReport() }));
    const onceNot = await runPerIssueScenarioSweep(sweepDeps(repo, { readExemptCandidates: () => [], readStepUsage: usageReport() }));

    expect(whileExempt).not.toContain(CANDIDATE);
    expect(onceNot).toEqual([CANDIDATE, CANDIDATE_STEPS, OTHER, OTHER_STEPS]);
  });

  it('removes nothing, runs no dry run and files no issue when the exemption cannot be read, and logs why', async () => {
    const repo = target();
    const log = vi.fn();
    const readStepUsage = vi.fn(usageReport(usage(RETURNS, 3, 'a parcel is returned')));
    const unreadable = (): readonly NominationKey[] => {
      throw new Error('gh: HTTP 502');
    };

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readExemptCandidates: unreadable, readStepUsage, log }));

    expect(removed).toEqual([]);
    expect(readStepUsage).not.toHaveBeenCalled();
    expect(repo.ctx.createWorktreeForNewBranch).not.toHaveBeenCalled();
    expect(committedPaths(repo)).toEqual([]);
    expect(repo.tracker.issues).toEqual([]);
    expect(log).toHaveBeenCalledWith('perIssueScenarioSweep: could not read the open Promotion Proposal (Error: gh: HTTP 502) — nothing removed this cycle', 'warn');
  });

  it("reads the Promotion Proposals and the open implementation issues through the boundary's issue tracker by default", async () => {
    const repo = target();
    const { boundary, listIssues } = forgeListing(repo, { proposals: [proposalEntry(300, 'OPEN', [SHIPPED])] });

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { boundary, readExemptCandidates: undefined, readStepUsage: usageReport() }));

    expect(removed).toEqual([OTHER, OTHER_STEPS]);
    expect(listIssues).toHaveBeenCalledWith(expect.objectContaining({ state: 'all', search: PROMOTION_PROPOSAL_SEARCH, fields: expect.arrayContaining(['comments']) }));
    expect(listIssues).toHaveBeenCalledWith(expect.objectContaining({ state: 'open', search: PROMOTION_IMPLEMENTATION_SEARCH }));
  });
});
