import { describe, it, expect, vi } from 'vitest';
import type { LaunchBoundary } from '../../core';
import type { FeatureFileSource } from '../../proof/featureScenarioIndex';
import type { NominationKey } from '../../promotion/nominationCollector';
import { DeclineReason, type DecisionProposalRef, type ProposalCloseReason } from '../../promotion/promotionDecider';
import { buildPromotionImplementationIssue, implementationIssueCandidates, type ImplementationIssueRef } from '../../promotion/promotionImplementationIssue';
import { buildPromotionProposal, readProposalCandidates, type ProposalIssueSpec } from '../../promotion/proposalBody';
import { buildDecisionComment, readDecisionRecord } from '../../promotion/proposalDecisionRecord';
import type { SweepBase } from '../perIssueSweepPersist';
import type { DeclineLanding, NominationDeclineEdit } from '../promotionDecisionDefaults';
import { runPromotionDecisionPass, type PromotionDecisionPassDeps } from '../promotionDecisionPass';

const NOW = new Date('2026-11-28T12:00:00Z');
const DAY_MS = 86_400_000;
const PROPOSAL = 1400;
const FIRST_FILED = 1500;
const BASE = { worktreePath: '/repo/.worktrees/chore-nomination-decline' } as unknown as SweepBase;

const REFUND: NominationKey = { issueNumber: 1201, scenarioName: 'An order is refunded' };
const INVOICE: NominationKey = { issueNumber: 1207, scenarioName: 'An invoice is sent' };
const PARCEL: NominationKey = { issueNumber: 1210, scenarioName: 'A parcel is shipped' };

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function featurePathOf({ issueNumber }: NominationKey): string {
  return `features/per-issue/feature-${issueNumber}.feature`;
}

/** The Per-Issue Scenario of the candidate's issue on the default branch, its one scenario carrying `tag` on its own tag line. */
function perIssueFile(key: NominationKey, tag = '@nominated'): FeatureFileSource {
  const content = [`Feature: issue ${key.issueNumber}`, '', `  @adw-${key.issueNumber} ${tag}`, `  Scenario: ${key.scenarioName}`, '    Given a precondition', ''].join('\n');
  return { path: featurePathOf(key), content };
}

const FEATURES: readonly FeatureFileSource[] = [REFUND, INVOICE, PARCEL].map((key) => perIssueFile(key));

function isLineOf(line: string, ticked: readonly NominationKey[]): boolean {
  return readProposalCandidates(line).some((reading) => ticked.some((key) => key.issueNumber === reading.issueNumber && key.scenarioName === reading.scenarioName));
}

function bodyOffering(offered: readonly NominationKey[], ticked: readonly NominationKey[]): string {
  const candidates = offered.map((key) => ({ ...key, featurePath: featurePathOf(key), qualification: 'q', fit: 'f', overlaps: [] }));
  const { body } = buildPromotionProposal(candidates, NOW);
  return body.split('\n').map((line) => (isLineOf(line, ticked) ? line.replace('[ ]', '[x]') : line)).join('\n');
}

interface ProposalFixture {
  readonly number?: number;
  readonly state: string;
  readonly closeReason: ProposalCloseReason;
  readonly offered: readonly NominationKey[];
  readonly ticked?: readonly NominationKey[];
  readonly createdAt?: Date;
  readonly comments?: readonly string[];
}

function proposal({ number = PROPOSAL, state, closeReason, offered, ticked = [], createdAt = daysAgo(5), comments = [] }: ProposalFixture): DecisionProposalRef {
  return { number, state, closeReason, body: bodyOffering(offered, ticked), createdAt: createdAt.toISOString(), comments };
}

function implementationIssue(number: number, proposalNumber: number, approved: readonly NominationKey[]): ImplementationIssueRef {
  const scenarios = approved.map((key) => ({ ...key, featurePath: featurePathOf(key) }));
  return { number, state: 'OPEN', body: buildPromotionImplementationIssue({ proposalNumber, approved: scenarios }).body };
}

interface PassFixture {
  readonly proposals: readonly DecisionProposalRef[];
  readonly features?: readonly FeatureFileSource[];
  readonly implementationIssues?: readonly ImplementationIssueRef[];
}

/** A forge and a default branch in memory: what the pass files, commits, comments and closes is kept, in the order it happened. */
function passDeps({ proposals, features = FEATURES, implementationIssues = [] }: PassFixture, overrides: Partial<Omit<PromotionDecisionPassDeps, 'log'>> = {}) {
  const issues = [...implementationIssues];
  const filed: ProposalIssueSpec[] = [];
  const declines: { readonly proposalNumber: number; readonly edits: readonly NominationDeclineEdit[] }[] = [];
  const records: { readonly proposalNumber: number; readonly comment: string }[] = [];
  const events: string[] = [];
  const log = vi.fn();
  const deps = {
    boundary: {} as LaunchBoundary,
    now: NOW,
    log,
    listProposals: vi.fn((): readonly DecisionProposalRef[] => proposals),
    listImplementationIssues: vi.fn((): readonly ImplementationIssueRef[] => issues),
    prepareBase: vi.fn((_proposalNumber: number): SweepBase | null => BASE),
    readPerIssueFeatures: vi.fn((): readonly FeatureFileSource[] => features),
    persistDeclines: vi.fn(async (proposalNumber: number, edits: readonly NominationDeclineEdit[]): Promise<DeclineLanding> => {
      if (edits.length === 0) return 'nothing_to_change';
      declines.push({ proposalNumber, edits });
      events.push(`decline #${proposalNumber}`);
      return 'landed';
    }),
    fileImplementationIssue: vi.fn(async (spec: ProposalIssueSpec): Promise<number> => {
      const number = FIRST_FILED + filed.length;
      filed.push(spec);
      issues.push({ number, body: spec.body, state: 'OPEN' });
      events.push(`file #${number}`);
      return number;
    }),
    recordDecision: vi.fn((proposalNumber: number, comment: string): boolean => {
      records.push({ proposalNumber, comment });
      events.push(`record #${proposalNumber}`);
      return true;
    }),
    closeProposal: vi.fn(async (proposalNumber: number): Promise<boolean> => {
      events.push(`close #${proposalNumber}`);
      return true;
    }),
    cleanupBase: vi.fn(),
    ...overrides,
  };
  return { deps, filed, declines, records, events, log };
}

function loggedLines(log: ReturnType<typeof vi.fn>): string[] {
  return log.mock.calls.map((call: unknown[]) => String(call[0]));
}

function recordedOutcomes(records: readonly { readonly comment: string }[]): (string | null)[] {
  return records.map(({ comment }) => readDecisionRecord([comment]));
}

function declinedPaths(declines: readonly { readonly edits: readonly NominationDeclineEdit[] }[]): string[] {
  return declines.flatMap(({ edits }) => edits.map((edit) => edit.path));
}

describe('runPromotionDecisionPass — a proposal closed as completed with two of three candidates ticked', () => {
  const decided = proposal({ state: 'CLOSED', closeReason: 'completed', offered: [REFUND, INVOICE, PARCEL], ticked: [REFUND, INVOICE] });

  it('files one implementation issue naming the two, commits one decline edit for the third and records the approval', async () => {
    const { deps, filed, declines, records, log } = passDeps({ proposals: [decided] });

    const outcome = await runPromotionDecisionPass(deps);

    expect(outcome).toEqual({ kind: 'acted', outcomes: [{ kind: 'approved', proposal: PROPOSAL, implementationIssue: FIRST_FILED, approved: [REFUND, INVOICE], declined: [PARCEL], missing: [] }] });
    expect(filed).toHaveLength(1);
    expect(implementationIssueCandidates({ number: FIRST_FILED, body: filed[0].body })).toEqual([REFUND, INVOICE]);
    expect(declines).toHaveLength(1);
    expect(declinedPaths(declines)).toEqual([featurePathOf(PARCEL)]);
    expect(declines[0].edits[0].content).toContain('@adw-1210 @nomination-declined');
    expect(recordedOutcomes(records)).toEqual(['approved']);
    expect(records[0].comment).toContain(`#${FIRST_FILED}`);
    expect(loggedLines(log)).toContain(`promotionDecisionPass: filed implementation issue #${FIRST_FILED} for Promotion Proposal #${PROPOSAL} with 2 scenario(s)`);
  });

  it('does nothing on a second run against the proposal it recorded', async () => {
    const first = passDeps({ proposals: [decided] });
    await runPromotionDecisionPass(first.deps);
    const second = passDeps({ proposals: [{ ...decided, comments: first.records.map(({ comment }) => comment) }], implementationIssues: [implementationIssue(FIRST_FILED, PROPOSAL, [REFUND, INVOICE])] });

    expect(await runPromotionDecisionPass(second.deps)).toEqual({ kind: 'skipped', reason: 'nothing_to_decide' });
    expect(second.events).toEqual([]);
    expect(second.deps.prepareBase).not.toHaveBeenCalled();
  });
});

describe('runPromotionDecisionPass — a declined proposal', () => {
  it('files no issue for a proposal closed as not planned with ticks, declines every candidate and records the decline', async () => {
    const { deps, filed, declines, records } = passDeps({ proposals: [proposal({ state: 'CLOSED', closeReason: 'not_planned', offered: [REFUND, INVOICE], ticked: [REFUND] })] });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'declined', proposal: PROPOSAL, reason: DeclineReason.NotPlanned, declined: [REFUND, INVOICE] }] });
    expect(filed).toEqual([]);
    expect(declinedPaths(declines)).toEqual([featurePathOf(REFUND), featurePathOf(INVOICE)]);
    expect(recordedOutcomes(records)).toEqual(['declined']);
    expect(records[0].comment).toContain('closed as not planned');
  });

  it('files no issue for a proposal closed as completed with nothing ticked, declines every candidate and records the decline', async () => {
    const { deps, filed, declines, records, log } = passDeps({ proposals: [proposal({ state: 'CLOSED', closeReason: 'completed', offered: [REFUND, INVOICE] })] });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'declined', proposal: PROPOSAL, reason: DeclineReason.NothingTicked, declined: [REFUND, INVOICE] }] });
    expect(filed).toEqual([]);
    expect(declinedPaths(declines)).toEqual([featurePathOf(REFUND), featurePathOf(INVOICE)]);
    expect(recordedOutcomes(records)).toEqual(['declined']);
    expect(loggedLines(log)).toContain(`promotionDecisionPass: declined 2 candidate(s) of Promotion Proposal #${PROPOSAL} (nothing_ticked)`);
  });

  it('records the decision without a pull request when nothing is left to decline: one already declined, the other gone', async () => {
    const features = [perIssueFile(REFUND, '@nomination-declined')];
    const { deps, declines, records } = passDeps({ proposals: [proposal({ state: 'CLOSED', closeReason: 'not_planned', offered: [REFUND, INVOICE] })], features });

    expect((await runPromotionDecisionPass(deps)).kind).toBe('acted');
    expect(deps.persistDeclines).toHaveBeenCalledWith(PROPOSAL, [], BASE);
    expect(declines).toEqual([]);
    expect(recordedOutcomes(records)).toEqual(['declined']);
  });
});

describe('runPromotionDecisionPass — a proposal left open for 30 days', () => {
  it('declines every candidate, records the expiry and only then closes the proposal, with no second comment', async () => {
    const { deps, declines, records, events, log } = passDeps({ proposals: [proposal({ state: 'OPEN', closeReason: 'unread', offered: [REFUND], ticked: [REFUND], createdAt: daysAgo(30) })] });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'declined', proposal: PROPOSAL, reason: DeclineReason.Expired, declined: [REFUND] }] });
    expect(declinedPaths(declines)).toEqual([featurePathOf(REFUND)]);
    expect(recordedOutcomes(records)).toEqual(['expired']);
    expect(events).toEqual([`decline #${PROPOSAL}`, `record #${PROPOSAL}`, `close #${PROPOSAL}`]);
    expect(deps.closeProposal).toHaveBeenCalledWith(PROPOSAL);
    expect(deps.recordDecision).toHaveBeenCalledTimes(1);
    expect(loggedLines(log)).toContain(`promotionDecisionPass: closed Promotion Proposal #${PROPOSAL}: open for 30 days without a decision`);
  });

  it('does nothing with a proposal open for 29 days', async () => {
    const { deps, events } = passDeps({ proposals: [proposal({ state: 'OPEN', closeReason: 'unread', offered: [REFUND], createdAt: daysAgo(29) })] });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'skipped', reason: 'nothing_to_decide' });
    expect(events).toEqual([]);
  });

  it('does not close the proposal and reports failed when its record cannot be confirmed', async () => {
    const { deps } = passDeps({ proposals: [proposal({ state: 'OPEN', closeReason: 'unread', offered: [REFUND], createdAt: daysAgo(31) })] }, { recordDecision: vi.fn(() => false) });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'failed', proposal: PROPOSAL, detail: expect.stringContaining('record') }] });
    expect(deps.closeProposal).not.toHaveBeenCalled();
  });

  it('closes again, without a comment, a still-open proposal recorded as expired', async () => {
    const expired = buildDecisionComment({ outcome: 'expired', reason: DeclineReason.Expired, approved: [], declined: [REFUND], missing: [], implementationIssue: null });
    const { deps, events } = passDeps({ proposals: [proposal({ state: 'OPEN', closeReason: 'unread', offered: [REFUND], createdAt: daysAgo(31), comments: [expired] })] });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'closed_again', proposal: PROPOSAL }] });
    expect(events).toEqual([`close #${PROPOSAL}`]);
    expect(deps.closeProposal).toHaveBeenCalledWith(PROPOSAL);
    expect(deps.prepareBase).not.toHaveBeenCalled();
  });
});

describe('runPromotionDecisionPass — acting once, also after a partial failure', () => {
  const decided = proposal({ state: 'CLOSED', closeReason: 'completed', offered: [REFUND, INVOICE], ticked: [REFUND] });

  it('files no second issue when a re-run finds the implementation issue filed before the record was written', async () => {
    const { deps, filed, records } = passDeps({ proposals: [decided], implementationIssues: [implementationIssue(1499, PROPOSAL, [REFUND])] });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'approved', proposal: PROPOSAL, implementationIssue: 1499, approved: [REFUND], declined: [INVOICE], missing: [] }] });
    expect(filed).toEqual([]);
    expect(records[0].comment).toContain('#1499');
  });

  it('writes no record and reports failed when the decline pull request fails, and the next run declines again and files no second issue', async () => {
    const first = passDeps({ proposals: [decided] }, { persistDeclines: vi.fn(async (): Promise<DeclineLanding> => 'failed') });

    expect(await runPromotionDecisionPass(first.deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'failed', proposal: PROPOSAL, detail: expect.stringContaining('decline') }] });
    expect(first.records).toEqual([]);

    const second = passDeps({ proposals: [decided], implementationIssues: [implementationIssue(FIRST_FILED, PROPOSAL, [REFUND])] });
    expect((await runPromotionDecisionPass(second.deps)).kind).toBe('acted');
    expect(second.filed).toEqual([]);
    expect(declinedPaths(second.declines)).toEqual([featurePathOf(INVOICE)]);
    expect(recordedOutcomes(second.records)).toEqual(['approved']);
  });

  it('closes an issue it could not label, writes no record and reports failed', async () => {
    const issueTracker = {
      createIssue: vi.fn(() => 1501),
      applyLabel: vi.fn((_issue: number, label: string) => {
        if (label === 'regression-promotion') throw new Error('gh: label not applied');
      }),
      closeIssue: vi.fn(async () => true),
    };
    const boundary = { providers: { issueTracker } } as unknown as LaunchBoundary;
    const { deps, records } = passDeps({ proposals: [decided] }, { boundary, fileImplementationIssue: undefined });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'failed', proposal: PROPOSAL, detail: expect.stringContaining('label not applied') }] });
    expect(issueTracker.closeIssue).toHaveBeenCalledWith(1501, expect.stringContaining('could not label'));
    expect(records).toEqual([]);
  });
});

describe('runPromotionDecisionPass — approved candidates no longer on the default branch', () => {
  it('leaves an approved candidate that is gone out of the issue and names it as missing in the record', async () => {
    const decided = proposal({ state: 'CLOSED', closeReason: 'completed', offered: [REFUND, INVOICE], ticked: [REFUND, INVOICE] });
    const { deps, filed, records } = passDeps({ proposals: [decided], features: [perIssueFile(INVOICE)] });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'approved', proposal: PROPOSAL, implementationIssue: FIRST_FILED, approved: [INVOICE], declined: [], missing: [REFUND] }] });
    expect(implementationIssueCandidates({ number: FIRST_FILED, body: filed[0].body })).toEqual([INVOICE]);
    expect(records[0].comment).toContain('no longer on the default branch');
    expect(records[0].comment).toContain('#1201 · `An order is refunded`');
  });

  it('files no issue when none of the approved candidates is left', async () => {
    const decided = proposal({ state: 'CLOSED', closeReason: 'completed', offered: [REFUND], ticked: [REFUND] });
    const { deps, filed, records } = passDeps({ proposals: [decided], features: [] });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'acted', outcomes: [{ kind: 'approved', proposal: PROPOSAL, implementationIssue: null, approved: [], declined: [], missing: [REFUND] }] });
    expect(filed).toEqual([]);
    expect(recordedOutcomes(records)).toEqual(['approved']);
  });
});

describe('runPromotionDecisionPass — the pass as a whole', () => {
  it('writes nothing and skips when the proposals cannot be listed', async () => {
    const { deps, events, log } = passDeps({ proposals: [] }, { listProposals: vi.fn(() => { throw new Error('gh: HTTP 502'); }) });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'skipped', reason: 'listing_failed' });
    expect(events).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not list the Promotion Proposals'), 'warn');
  });

  it('skips when no proposal can be decided', async () => {
    const { deps } = passDeps({ proposals: [proposal({ state: 'CLOSED', closeReason: 'unread', offered: [REFUND], ticked: [REFUND] })] });

    expect(await runPromotionDecisionPass(deps)).toEqual({ kind: 'skipped', reason: 'nothing_to_decide' });
  });

  it('acts on two decidable proposals in number order, and a failure on the first does not stop the second', async () => {
    const declined = proposal({ number: 1401, state: 'CLOSED', closeReason: 'not_planned', offered: [REFUND] });
    const approved = proposal({ number: 1402, state: 'CLOSED', closeReason: 'completed', offered: [INVOICE], ticked: [INVOICE] });
    const persistDeclines = vi.fn(async (proposalNumber: number): Promise<DeclineLanding> => {
      if (proposalNumber === 1401) throw new Error('git push rejected');
      return 'nothing_to_change';
    });
    const { deps, records } = passDeps({ proposals: [approved, declined] }, { persistDeclines });

    expect(await runPromotionDecisionPass(deps)).toEqual({
      kind: 'acted',
      outcomes: [
        { kind: 'failed', proposal: 1401, detail: 'Error: git push rejected' },
        { kind: 'approved', proposal: 1402, implementationIssue: FIRST_FILED, approved: [INVOICE], declined: [], missing: [] },
      ],
    });
    expect(records.map(({ proposalNumber }) => proposalNumber)).toEqual([1402]);
  });

  it('cleans the base up after acting, after a failure and after a throw', async () => {
    const decided = proposal({ state: 'CLOSED', closeReason: 'completed', offered: [REFUND, INVOICE], ticked: [REFUND] });
    const runs = [
      passDeps({ proposals: [decided] }),
      passDeps({ proposals: [decided] }, { persistDeclines: vi.fn(async (): Promise<DeclineLanding> => 'failed') }),
      passDeps({ proposals: [decided] }, { readPerIssueFeatures: vi.fn(() => { throw new Error('the checkout is unreadable'); }) }),
    ];

    for (const { deps } of runs) await runPromotionDecisionPass(deps);

    runs.forEach(({ deps }) => expect(deps.cleanupBase).toHaveBeenCalledWith(BASE));
  });
});
