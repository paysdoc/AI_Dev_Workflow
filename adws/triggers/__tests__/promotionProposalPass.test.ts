import { describe, it, expect, vi } from 'vitest';
import type { LaunchBoundary } from '../../core';
import type { FeatureFileSource } from '../../proof/featureScenarioIndex';
import { NOMINATION_DECLINED_TAG, NOMINATION_TAG, type Nomination, type NominationKey } from '../../promotion/nominationCollector';
import { buildPromotionProposal, readProposalCandidates, type CandidateAnalysis, type ProposalIssueSpec } from '../../promotion/proposalBody';
import { MAX_PROPOSAL_CANDIDATES, type ProposalIssueRef } from '../../promotion/proposalPassDecision';
import type { ProposalCheckout } from '../promotionProposalDefaults';
import { runPromotionProposalPass, type PromotionProposalPassDeps } from '../promotionProposalPass';

const NOW = new Date('2026-11-28T12:00:00Z');
const DAY_MS = 86_400_000;
const INTERVAL_DAYS = 7;
const FILED_NUMBER = 1500;
const CHECKOUT: ProposalCheckout = { worktreePath: '/repo/.worktrees/chore-promotion-proposal', defaultBranch: 'trunk' };

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/** A Per-Issue Scenario file of `issue`, one scenario per entry, each with the tag given on its own tag line. */
function perIssueFile(issue: number, ...scenarios: ReadonlyArray<readonly [name: string, tag: string]>): FeatureFileSource {
  const blocks = scenarios.flatMap(([name, tag]) => [`  @adw-${issue} @boundary-subprocess ${tag}`.trimEnd(), `  Scenario: ${name}`, '    Given a precondition', '']);
  return { path: `features/per-issue/feature-${issue}.feature`, content: [`Feature: issue ${issue}`, '', ...blocks].join('\n') };
}

function analysisOf({ issueNumber, scenarioName }: NominationKey): CandidateAnalysis {
  return { issueNumber, scenarioName, qualification: `Issue ${issueNumber} guards a costly path.`, fit: 'It sits beside the order scenarios.', overlaps: [] };
}

function proposal(number: number, state: string, createdAt: Date, ...keys: NominationKey[]): ProposalIssueRef {
  const candidates = keys.map((key) => ({ ...analysisOf(key), featurePath: `features/per-issue/feature-${key.issueNumber}.feature` }));
  return { number, state, createdAt: createdAt.toISOString(), body: buildPromotionProposal(candidates, createdAt).body };
}

interface PassFixture {
  readonly features?: readonly FeatureFileSource[];
  readonly merged?: readonly number[];
  readonly proposals?: readonly ProposalIssueRef[];
}

function passDeps({ features = [], merged = [], proposals = [] }: PassFixture, overrides: Partial<Omit<PromotionProposalPassDeps, 'log'>> = {}) {
  const filed: ProposalIssueSpec[] = [];
  const log = vi.fn();
  const deps = {
    boundary: {} as LaunchBoundary,
    now: NOW,
    intervalDays: INTERVAL_DAYS,
    log,
    listProposals: vi.fn((): readonly ProposalIssueRef[] => proposals),
    prepareCheckout: vi.fn((): ProposalCheckout | null => CHECKOUT),
    readPerIssueFeatures: vi.fn((): readonly FeatureFileSource[] => features),
    getMergedAt: vi.fn(async (issue: number): Promise<Date | null> => (merged.includes(issue) ? daysAgo(3) : null)),
    analyse: vi.fn(async (candidates: readonly Nomination[]): Promise<readonly CandidateAnalysis[]> => candidates.map(analysisOf)),
    fileProposal: vi.fn(async (spec: ProposalIssueSpec): Promise<number> => {
      filed.push(spec);
      return FILED_NUMBER;
    }),
    cleanupCheckout: vi.fn(),
    ...overrides,
  };
  return { deps, filed, log };
}

function loggedLines(log: ReturnType<typeof vi.fn>): string[] {
  return log.mock.calls.map((call: unknown[]) => String(call[0]));
}

function offered(spec: ProposalIssueSpec): NominationKey[] {
  return readProposalCandidates(spec.body).map(({ issueNumber, scenarioName }) => ({ issueNumber, scenarioName }));
}

describe('runPromotionProposalPass', () => {
  it('files one Promotion Proposal for the eligible Nominations when no proposal is open and none was filed within the interval', async () => {
    const features = [perIssueFile(1201, ['An order is refunded', NOMINATION_TAG], ['An order is placed', '']), perIssueFile(1207, ['An invoice is sent', NOMINATION_TAG])];
    const { deps, filed, log } = passDeps({ features, merged: [1201, 1207], proposals: [proposal(40, 'CLOSED', daysAgo(8))] });

    const outcome = await runPromotionProposalPass(deps);

    const candidates = [{ issueNumber: 1201, scenarioName: 'An order is refunded' }, { issueNumber: 1207, scenarioName: 'An invoice is sent' }];
    expect(outcome).toEqual({ kind: 'filed', issueNumber: FILED_NUMBER, candidates });
    expect(filed).toHaveLength(1);
    expect(filed[0].title).toBe('Promotion Proposal 2026-11-28: 2 candidates');
    expect(filed[0].labels).toEqual(['adw:none', 'promotion-proposal']);
    expect(offered(filed[0])).toEqual(candidates);
    expect(filed[0].body).toContain('Issue 1207 guards a costly path.');
    expect(deps.analyse).toHaveBeenCalledWith([expect.objectContaining(candidates[0]), expect.objectContaining(candidates[1])], CHECKOUT);
    expect(loggedLines(log)).toContain(`promotionProposalPass: filed Promotion Proposal #${FILED_NUMBER} with 2 candidate(s)`);
  });

  it('files nothing while a proposal is open, and prepares no checkout and runs no analysis', async () => {
    const features = [perIssueFile(1207, ['An invoice is sent', NOMINATION_TAG])];
    const { deps, filed, log } = passDeps({ features, merged: [1207], proposals: [proposal(41, 'OPEN', daysAgo(20), { issueNumber: 1201, scenarioName: 'An order is refunded' })] });

    expect(await runPromotionProposalPass(deps)).toEqual({ kind: 'skipped', reason: 'proposal_open' });
    expect(filed).toEqual([]);
    expect(deps.prepareCheckout).not.toHaveBeenCalled();
    expect(deps.analyse).not.toHaveBeenCalled();
    expect(loggedLines(log)).toContain('promotionProposalPass: Promotion Proposal #41 is still open — not filing another');
  });

  it('files nothing when the newest proposal, even a closed one, is younger than the interval', async () => {
    const features = [perIssueFile(1207, ['An invoice is sent', NOMINATION_TAG])];
    const { deps, filed, log } = passDeps({ features, merged: [1207], proposals: [proposal(42, 'CLOSED', daysAgo(3))] });

    expect(await runPromotionProposalPass(deps)).toEqual({ kind: 'skipped', reason: 'proposed_recently' });
    expect(filed).toEqual([]);
    expect(deps.prepareCheckout).not.toHaveBeenCalled();
    expect(loggedLines(log)).toContain('promotionProposalPass: Promotion Proposal #42 was filed on 2026-11-25, less than 7 days ago — not filing another');
  });

  it.each([
    ['no scenario carries a Nomination', [perIssueFile(1201, ['An order is refunded', ''])], [1201]],
    ['the only Nomination was declined', [perIssueFile(1201, ['An order is refunded', NOMINATION_DECLINED_TAG])], [1201]],
    ['no nominated issue has merged', [perIssueFile(1201, ['An order is refunded', NOMINATION_TAG])], []],
  ])('files nothing when no merged issue holds a Nomination awaiting a proposal: %s', async (_case, features, merged) => {
    const { deps, filed } = passDeps({ features, merged });

    expect(await runPromotionProposalPass(deps)).toEqual({ kind: 'skipped', reason: 'no_nominations' });
    expect(filed).toEqual([]);
    expect(deps.analyse).not.toHaveBeenCalled();
    expect(deps.cleanupCheckout).toHaveBeenCalledWith(CHECKOUT);
  });

  it('leaves out the Nominations of issues whose pull request has not merged', async () => {
    const features = [perIssueFile(1201, ['An order is refunded', NOMINATION_TAG]), perIssueFile(1207, ['An invoice is sent', NOMINATION_TAG])];
    const { deps, filed } = passDeps({ features, merged: [1207] });

    await runPromotionProposalPass(deps);

    expect(offered(filed[0])).toEqual([{ issueNumber: 1207, scenarioName: 'An invoice is sent' }]);
  });

  it('leaves out a candidate that an earlier, closed proposal listed', async () => {
    const refund = { issueNumber: 1201, scenarioName: 'An order is refunded' };
    const features = [perIssueFile(1201, [refund.scenarioName, NOMINATION_TAG]), perIssueFile(1207, ['An invoice is sent', NOMINATION_TAG])];
    const { deps, filed } = passDeps({ features, merged: [1201, 1207], proposals: [proposal(43, 'CLOSED', daysAgo(9), refund)] });

    await runPromotionProposalPass(deps);

    expect(offered(filed[0])).toEqual([{ issueNumber: 1207, scenarioName: 'An invoice is sent' }]);
  });

  it('proposes at most MAX_PROPOSAL_CANDIDATES candidates, oldest issues first, and logs how many wait', async () => {
    const issues = Array.from({ length: MAX_PROPOSAL_CANDIDATES + 2 }, (_, index) => 1300 + index);
    const features = [...issues].reverse().map((issue) => perIssueFile(issue, [`scenario of ${issue}`, NOMINATION_TAG]));
    const { deps, filed, log } = passDeps({ features, merged: issues });

    await runPromotionProposalPass(deps);

    expect(offered(filed[0]).map((candidate) => candidate.issueNumber)).toEqual(issues.slice(0, MAX_PROPOSAL_CANDIDATES));
    expect(loggedLines(log)).toContain('promotionProposalPass: 2 more Nomination(s) wait for a later Promotion Proposal');
  });

  it('files nothing and logs a warning when the proposals cannot be listed', async () => {
    const { deps, filed, log } = passDeps({}, { listProposals: vi.fn(() => { throw new Error('gh: HTTP 502'); }) });

    expect(await runPromotionProposalPass(deps)).toEqual({ kind: 'skipped', reason: 'listing_failed' });
    expect(filed).toEqual([]);
    expect(deps.prepareCheckout).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not list the Promotion Proposals'), 'warn');
  });

  it('files nothing when no checkout can be prepared', async () => {
    const features = [perIssueFile(1207, ['An invoice is sent', NOMINATION_TAG])];
    const { deps, filed } = passDeps({ features, merged: [1207] }, { prepareCheckout: vi.fn(() => null) });

    expect(await runPromotionProposalPass(deps)).toEqual({ kind: 'skipped', reason: 'no_checkout' });
    expect(filed).toEqual([]);
    expect(deps.readPerIssueFeatures).not.toHaveBeenCalled();
    expect(deps.cleanupCheckout).not.toHaveBeenCalled();
  });

  it('files nothing and logs an error when the analysis fails, and still removes the checkout', async () => {
    const features = [perIssueFile(1207, ['An invoice is sent', NOMINATION_TAG])];
    const analyse = vi.fn(async (): Promise<readonly CandidateAnalysis[]> => { throw new Error('the analysis agent failed'); });
    const { deps, filed, log } = passDeps({ features, merged: [1207] }, { analyse });

    expect(await runPromotionProposalPass(deps)).toEqual({ kind: 'failed', detail: 'Error: the analysis agent failed' });
    expect(filed).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('the analysis agent failed'), 'error');
    expect(deps.cleanupCheckout).toHaveBeenCalledWith(CHECKOUT);
  });

  it('removes the checkout after filing, and after a filing failure', async () => {
    const features = [perIssueFile(1207, ['An invoice is sent', NOMINATION_TAG])];
    const filing = passDeps({ features, merged: [1207] });
    const failing = passDeps({ features, merged: [1207] }, { fileProposal: vi.fn(async (): Promise<number> => { throw new Error('gh: label not applied'); }) });

    expect((await runPromotionProposalPass(filing.deps)).kind).toBe('filed');
    expect((await runPromotionProposalPass(failing.deps)).kind).toBe('failed');
    expect(filing.deps.cleanupCheckout).toHaveBeenCalledWith(CHECKOUT);
    expect(failing.deps.cleanupCheckout).toHaveBeenCalledWith(CHECKOUT);
  });
});
