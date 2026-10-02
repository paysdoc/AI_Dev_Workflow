/**
 * The fake code host and issue tracker of the promotion-sweep scenarios. Every issue, label, pull
 * request and merge the code under test causes is appended to one ordered `events` log, so a Then
 * step can tell what happened before what. Things the fixture seeds (earlier promotion issues,
 * earlier merged pull requests) are never logged: they existed before the sweep ran.
 *
 * `mergePullRequest` does a real merge inside the target's bare repository, or refuses when the
 * scenario said so. Like GitHub, a pull request whose head branch has been deleted counts as closed.
 */

import type {
  CodeHost,
  CreatePROptions,
  ForgeActionResult,
  IssueListEntry,
  IssueListField,
  IssueListQuery,
  IssueTracker,
  MergedPullRequestRecord,
  PullRequestSummary,
} from '@paysdoc/devplatform';
import { branchExistsOnRemote, mergeBranchIntoDefault, type Target } from './feature-934-target.ts';

export type ForgeEvent =
  | { kind: 'issue-created'; number: number; title: string; body: string }
  | { kind: 'label-applied'; issue: number; label: string }
  | { kind: 'pr-opened'; number: number; sourceBranch: string; targetBranch: string }
  | { kind: 'pr-merged'; number: number; sourceBranch: string; files: readonly string[] }
  | { kind: 'pr-merge-refused'; number: number };

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  labels: string[];
}

interface FakePullRequest {
  number: number;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  mergedAt: Date | null;
}

export interface FakeForge {
  readonly events: ForgeEvent[];
  readonly codeHost: CodeHost;
  readonly issueTracker: IssueTracker;
  mergesRefused: boolean;
  /** Adds a promotion issue (`Promotes: feature-<n>`) the sweep did not file; returns its number. */
  seedPromotionIssue(spec: { feature: number; state: 'OPEN' | 'CLOSED'; number?: number }): number;
  seedPullRequest(spec: { body: string; state: 'MERGED' | 'CLOSED'; mergedAt?: Date }): void;
}

export const PROMOTION_LABEL = 'regression-promotion';

// Seeded numbers stay below the numbers handed to what the sweep creates, so the two never collide.
const FIRST_SEEDED_NUMBER = 100;
const FIRST_CREATED_NUMBER = 5000;

function projectIssue(issue: FakeIssue, fields: readonly IssueListField[]): IssueListEntry {
  const entry: IssueListEntry = { number: issue.number };
  if (fields.includes('title')) entry.title = issue.title;
  if (fields.includes('body')) entry.body = issue.body;
  if (fields.includes('state')) entry.state = issue.state;
  if (fields.includes('labels')) entry.labels = issue.labels.map(name => ({ name }));
  return entry;
}

function matchesState(issue: FakeIssue, state: 'open' | 'closed' | 'all'): boolean {
  return state === 'all' || issue.state === state.toUpperCase();
}

export function createFakeForge(target: Target): FakeForge {
  const events: ForgeEvent[] = [];
  const issues = new Map<number, FakeIssue>();
  const pullRequests: FakePullRequest[] = [];
  const control = { mergesRefused: false };
  let nextSeeded = FIRST_SEEDED_NUMBER;
  let nextCreated = FIRST_CREATED_NUMBER;

  const effectiveState = (pr: FakePullRequest): FakePullRequest['state'] =>
    pr.state === 'OPEN' && !branchExistsOnRemote(target, pr.sourceBranch) ? 'CLOSED' : pr.state;

  const codeHost = {
    getDefaultBranch: () => target.defaultBranch,

    findPullRequestByBranch: (branch: string): PullRequestSummary | null => {
      const pr = [...pullRequests].reverse().find(candidate => candidate.sourceBranch === branch);
      if (!pr) return null;
      return { number: pr.number, state: effectiveState(pr), sourceBranch: pr.sourceBranch, targetBranch: pr.targetBranch, labels: [] };
    },

    createPullRequest: (options: CreatePROptions) => {
      const number = nextCreated++;
      pullRequests.push({
        number,
        body: options.body,
        sourceBranch: options.sourceBranch,
        targetBranch: options.targetBranch,
        state: 'OPEN',
        mergedAt: null,
      });
      events.push({ kind: 'pr-opened', number, sourceBranch: options.sourceBranch, targetBranch: options.targetBranch });
      return { url: `https://example.test/${target.owner}/${target.repo}/pull/${number}`, number };
    },

    mergePullRequest: (number: number): ForgeActionResult => {
      const pr = pullRequests.find(candidate => candidate.number === number);
      if (!pr || effectiveState(pr) !== 'OPEN') return { success: false, error: `pull request #${number} is not open` };
      if (control.mergesRefused) {
        events.push({ kind: 'pr-merge-refused', number });
        return { success: false, error: 'the code host refuses to merge pull requests' };
      }
      const merge = mergeBranchIntoDefault(target, pr.sourceBranch, `Merge pull request #${number} from ${pr.sourceBranch}`);
      if (!merge.ok) return { success: false, error: merge.error };
      pr.state = 'MERGED';
      pr.mergedAt = new Date();
      events.push({ kind: 'pr-merged', number, sourceBranch: pr.sourceBranch, files: merge.files });
      return { success: true };
    },

    listMergedPullRequests: (limit: number): readonly MergedPullRequestRecord[] =>
      pullRequests
        .flatMap(pr => (pr.state === 'MERGED' && pr.mergedAt ? [{ body: pr.body, mergedAt: pr.mergedAt }] : []))
        .sort((a, b) => b.mergedAt.getTime() - a.mergedAt.getTime())
        .slice(0, limit)
        .map(pr => ({ body: pr.body, mergedAt: pr.mergedAt.toISOString() })),
  };

  const issueTracker = {
    listIssues: (query: IssueListQuery): readonly IssueListEntry[] => {
      const label = /label:"([^"]+)"/.exec(query.search ?? '')?.[1];
      return [...issues.values()]
        .filter(issue => matchesState(issue, query.state ?? 'open') && (label === undefined || issue.labels.includes(label)))
        .slice(0, query.limit ?? 30)
        .map(issue => projectIssue(issue, query.fields));
    },

    createIssue: (title: string, body: string): number => {
      const number = nextCreated++;
      issues.set(number, { number, title, body, state: 'OPEN', labels: [] });
      events.push({ kind: 'issue-created', number, title, body });
      return number;
    },

    applyLabel: (issueNumber: number, label: string): void => {
      const issue = issues.get(issueNumber);
      if (!issue) throw new Error(`the fake issue tracker has no issue #${issueNumber}`);
      issue.labels.push(label);
      events.push({ kind: 'label-applied', issue: issueNumber, label });
    },
  };

  return {
    events,
    codeHost: codeHost as unknown as CodeHost,
    issueTracker: issueTracker as unknown as IssueTracker,
    get mergesRefused() { return control.mergesRefused; },
    set mergesRefused(value: boolean) { control.mergesRefused = value; },

    seedPromotionIssue: ({ feature, state, number }) => {
      const issueNumber = number ?? nextSeeded++;
      issues.set(issueNumber, {
        number: issueNumber,
        title: `feat: promote #${feature} scenario into the @regression suite`,
        body: `Promotes: feature-${feature}\n\nSeeded by the scenario fixture.`,
        state,
        labels: [PROMOTION_LABEL],
      });
      return issueNumber;
    },

    seedPullRequest: ({ body, state, mergedAt }) => {
      pullRequests.push({
        number: nextSeeded++,
        body,
        sourceBranch: `seeded-${nextSeeded}`,
        targetBranch: target.defaultBranch,
        state,
        mergedAt: state === 'MERGED' ? (mergedAt ?? new Date()) : null,
      });
    },
  };
}
