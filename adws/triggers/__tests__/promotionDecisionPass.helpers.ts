import { vi } from 'vitest';
import type { LaunchBoundary } from '../../core';
import type { FeatureFileSource } from '../../proof/featureScenarioIndex';
import type { NominationKey } from '../../promotion/nominationCollector';
import type { DecisionProposalRef, ProposalCloseReason } from '../../promotion/promotionDecider';
import { buildPromotionImplementationIssue, type ImplementationIssueRef } from '../../promotion/promotionImplementationIssue';
import { buildPromotionProposal, readProposalCandidates, type ProposalIssueSpec } from '../../promotion/proposalBody';
import { readDecisionRecord } from '../../promotion/proposalDecisionRecord';
import type { SweepBase } from '../perIssueSweepPersist';
import type { DeclineLanding, NominationDeclineEdit } from '../promotionDecisionDefaults';
import type { PromotionDecisionPassDeps } from '../promotionDecisionPass';

const NOW = new Date('2026-11-28T12:00:00Z');
const DAY_MS = 86_400_000;
export const PROPOSAL = 1400;
export const FIRST_FILED = 1500;
export const BASE = { worktreePath: '/repo/.worktrees/chore-nomination-decline' } as unknown as SweepBase;

export const REFUND: NominationKey = { issueNumber: 1201, scenarioName: 'An order is refunded' };
export const INVOICE: NominationKey = { issueNumber: 1207, scenarioName: 'An invoice is sent' };
export const PARCEL: NominationKey = { issueNumber: 1210, scenarioName: 'A parcel is shipped' };

export function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

export function featurePathOf({ issueNumber }: NominationKey): string {
  return `features/per-issue/feature-${issueNumber}.feature`;
}

/** The Per-Issue Scenario of the candidate's issue on the default branch, its one scenario carrying `tag` on its own tag line. */
export function perIssueFile(key: NominationKey, tag = '@nominated'): FeatureFileSource {
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

export function proposal({ number = PROPOSAL, state, closeReason, offered, ticked = [], createdAt = daysAgo(5), comments = [] }: ProposalFixture): DecisionProposalRef {
  return { number, state, closeReason, body: bodyOffering(offered, ticked), createdAt: createdAt.toISOString(), comments };
}

export function implementationIssue(number: number, proposalNumber: number, approved: readonly NominationKey[]): ImplementationIssueRef {
  const scenarios = approved.map((key) => ({ ...key, featurePath: featurePathOf(key) }));
  return { number, state: 'OPEN', body: buildPromotionImplementationIssue({ proposalNumber, approved: scenarios }).body };
}

interface PassFixture {
  readonly proposals: readonly DecisionProposalRef[];
  readonly features?: readonly FeatureFileSource[];
  readonly implementationIssues?: readonly ImplementationIssueRef[];
}

/** A forge and a default branch in memory: what the pass files, commits, comments and closes is kept, in the order it happened. */
export function passDeps({ proposals, features = FEATURES, implementationIssues = [] }: PassFixture, overrides: Partial<Omit<PromotionDecisionPassDeps, 'log'>> = {}) {
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

export function loggedLines(log: ReturnType<typeof vi.fn>): string[] {
  return log.mock.calls.map((call: unknown[]) => String(call[0]));
}

export function recordedOutcomes(records: readonly { readonly comment: string }[]): (string | null)[] {
  return records.map(({ comment }) => readDecisionRecord([comment]));
}

export function declinedPaths(declines: readonly { readonly edits: readonly NominationDeclineEdit[] }[]): string[] {
  return declines.flatMap(({ edits }) => edits.map((edit) => edit.path));
}
