import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import type { IssueListEntry, IssueListQuery } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../core';
import type { NominationKey } from '../../promotion/nominationCollector';
import { buildPromotionProposal } from '../../promotion/proposalBody';
import { runPerIssueScenarioSweep } from '../perIssueScenarioSweep';
import { PROMOTION_PROPOSAL_SEARCH } from '../promotionProposalIssues';
import { NOW, committedPaths, daysAgo, fakeTarget, loggedLines, sweepDeps, usage, usageReport, type FakeTarget, type FakeTargetOptions } from './fixtures/perIssueSweepDeps';

const CANDIDATE = 'features/per-issue/feature-80.feature';
const CANDIDATE_STEPS = 'features/per-issue/step_definitions/feature-80.steps.ts';
const OTHER = 'features/per-issue/feature-81.feature';
const OTHER_STEPS = 'features/per-issue/step_definitions/feature-81.steps.ts';
const SHIPPING = 'features/step_definitions/parcels.steps.ts';
const RETURNS = 'features/step_definitions/returns.steps.ts';
const SHIPPED: NominationKey = { issueNumber: 80, scenarioName: 'A parcel is shipped' };
const RETURNED: NominationKey = { issueNumber: 81, scenarioName: 'A parcel is returned' };

const targets: FakeTarget[] = [];

function target(options: Partial<FakeTargetOptions> = {}): FakeTarget {
  const created = fakeTarget({ tracked: [CANDIDATE, CANDIDATE_STEPS, OTHER, OTHER_STEPS], mergedAt: { 80: daysAgo(20), 81: daysAgo(20) }, ...options });
  targets.push(created);
  return created;
}

afterEach(() => {
  targets.splice(0).forEach((created) => created.cleanup());
});

function openProposal(number: number, ...keys: NominationKey[]): IssueListEntry {
  const candidates = keys.map((key) => ({ ...key, featurePath: `features/per-issue/feature-${key.issueNumber}.feature`, qualification: 'q', fit: 'f', overlaps: [] }));
  const { body } = buildPromotionProposal(candidates, NOW);
  return { number, body, state: 'OPEN', labels: [{ name: 'adw:none' }, { name: 'promotion-proposal' }], createdAt: daysAgo(2).toISOString() };
}

/** The target's forge, answering the Promotion Proposal search with `proposals` and every other listing as before. */
function forgeListing(repo: FakeTarget, proposals: readonly IssueListEntry[]) {
  const listIssues = vi.fn((query: IssueListQuery): readonly IssueListEntry[] => (query.search === PROMOTION_PROPOSAL_SEARCH ? proposals : repo.tracker.listIssues(query)));
  const issueTracker = { ...repo.tracker, listIssues };
  const boundary = { ...repo.boundary, providers: { ...repo.boundary.providers, issueTracker } } as unknown as LaunchBoundary;
  return { boundary, listIssues };
}

describe('runPerIssueScenarioSweep — the candidates of an open Promotion Proposal', () => {
  it('keeps a stale Per-Issue Scenario that an open proposal lists, with its step-definition files, and removes the other stale ones', async () => {
    const repo = target();
    const log = vi.fn();

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readOpenProposalCandidates: () => [SHIPPED], readStepUsage: usageReport(), log }));

    expect(removed).toEqual([OTHER, OTHER_STEPS]);
    expect(committedPaths(repo)).toEqual([OTHER, OTHER_STEPS]);
    expect(loggedLines(log)).toContain(`perIssueScenarioSweep: keeping stale scenario ${CANDIDATE} (issue #80): a candidate of an open Promotion Proposal`);
  });

  it("does not list a step definition that only an open proposal's candidate uses, and lists the other unused ones", async () => {
    const repo = target({ tracked: [CANDIDATE, OTHER, SHIPPING, RETURNS] });
    const readStepUsage = usageReport(usage(SHIPPING, 3, 'a parcel is shipped', [CANDIDATE]), usage(RETURNS, 3, 'a parcel is returned', [OTHER]));

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readOpenProposalCandidates: () => [SHIPPED], readStepUsage }));

    expect(removed).toEqual([OTHER]);
    expect(repo.tracker.issues).toHaveLength(1);
    expect(repo.tracker.issues[0].body).toContain('`features/step_definitions/returns.steps.ts:3` — `a parcel is returned`');
    expect(repo.tracker.issues[0].body).not.toContain('a parcel is shipped');
  });

  it('exempts the candidates of every open proposal', async () => {
    const repo = target();
    const { boundary } = forgeListing(repo, [openProposal(300, SHIPPED), openProposal(301, RETURNED)]);

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { boundary, readOpenProposalCandidates: undefined, readStepUsage: usageReport() }));

    expect(removed).toEqual([]);
    expect(committedPaths(repo)).toEqual([]);
  });

  it('sweeps a stale former candidate on the normal rule once no open proposal lists it', async () => {
    const repo = target();

    const whileOpen = await runPerIssueScenarioSweep(sweepDeps(repo, { readOpenProposalCandidates: () => [SHIPPED], readStepUsage: usageReport() }));
    const onceClosed = await runPerIssueScenarioSweep(sweepDeps(repo, { readOpenProposalCandidates: () => [], readStepUsage: usageReport() }));

    expect(whileOpen).not.toContain(CANDIDATE);
    expect(onceClosed).toEqual([CANDIDATE, CANDIDATE_STEPS, OTHER, OTHER_STEPS]);
  });

  it('removes nothing, runs no dry run and files no issue when the open proposal cannot be read, and logs why', async () => {
    const repo = target();
    const log = vi.fn();
    const readStepUsage = vi.fn(usageReport(usage(RETURNS, 3, 'a parcel is returned')));
    const unreadable = (): readonly NominationKey[] => {
      throw new Error('gh: HTTP 502');
    };

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { readOpenProposalCandidates: unreadable, readStepUsage, log }));

    expect(removed).toEqual([]);
    expect(readStepUsage).not.toHaveBeenCalled();
    expect(repo.ctx.createWorktreeForNewBranch).not.toHaveBeenCalled();
    expect(committedPaths(repo)).toEqual([]);
    expect(repo.tracker.issues).toEqual([]);
    expect(log).toHaveBeenCalledWith('perIssueScenarioSweep: could not read the open Promotion Proposal (Error: gh: HTTP 502) — nothing removed this cycle', 'warn');
  });

  it("reads the open proposals through the boundary's issue tracker by default", async () => {
    const repo = target();
    const { boundary, listIssues } = forgeListing(repo, [openProposal(300, SHIPPED)]);

    const removed = await runPerIssueScenarioSweep(sweepDeps(repo, { boundary, readOpenProposalCandidates: undefined, readStepUsage: usageReport() }));

    expect(removed).toEqual([OTHER, OTHER_STEPS]);
    expect(listIssues).toHaveBeenCalledWith(expect.objectContaining({ state: 'open', search: PROMOTION_PROPOSAL_SEARCH }));
  });
});
