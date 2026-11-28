import { vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Platform, type IssueListQuery, type RepoIdentifier } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../../core';
import type { StepDefinitionUsage } from '../../../core/unusedStepReport';
import type { PerIssueSweepDeps } from '../../perIssueScenarioSweep';
import type { StepUsageOutcome } from '../../perIssueSweepStepUsage';

export const NOW = new Date('2026-06-30T12:00:00Z');
const DAY_MS = 86_400_000;
const FIRST_ISSUE_NUMBER = 900;

export function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/** What `git ls-files -- <prefix>` lists: the path itself and everything under it, never a sibling sharing its prefix. */
export function listUnder(tracked: readonly string[], prefix?: string): string[] {
  if (prefix === undefined) return [...tracked];
  return tracked.filter((file) => file === prefix || file.startsWith(`${prefix}/`));
}

export interface TrackedIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  state: 'OPEN' | 'CLOSED';
  readonly labels: string[];
}

function matchesSearch(issue: TrackedIssue, search: string | undefined): boolean {
  const phrase = (search ?? '').replace(/"/g, '').toLowerCase();
  return `${issue.title} ${issue.body}`.toLowerCase().includes(phrase);
}

/** Holds the issues it is asked to create, and lists them back as the forge's open-issue search does. */
export function inMemoryIssueTracker() {
  const issues: TrackedIssue[] = [];
  return {
    issues,
    listIssues: vi.fn((query: IssueListQuery) =>
      issues
        .filter((issue) => query.state !== 'open' || issue.state === 'OPEN')
        .filter((issue) => matchesSearch(issue, query.search))
        .map(({ number, body, state }) => ({ number, body, state })),
    ),
    createIssue: vi.fn((title: string, body: string): number => {
      const number = FIRST_ISSUE_NUMBER + issues.length;
      issues.push({ number, title, body, state: 'OPEN', labels: [] });
      return number;
    }),
    applyLabel: vi.fn((issueNumber: number, label: string): void => {
      issues.find((issue) => issue.number === issueNumber)?.labels.push(label);
    }),
  };
}

export interface FakeTargetOptions {
  readonly tracked: readonly string[];
  /** Written to `.adw/scenarios.md` in the sweep worktree; absent ⇒ the worktree holds no `.adw/`. */
  readonly scenariosMd?: string;
  /** Issue number → when its pull request merged. */
  readonly mergedAt?: Readonly<Record<number, Date>>;
  readonly openSweepPr?: boolean;
  readonly worktreeFails?: boolean;
}

/** A target repository the sweep's defaults run against: a GitContext over one tracked-file list, a real sweep worktree directory, and a forge. */
export function fakeTarget(options: FakeTargetOptions) {
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-sweep-worktree-'));
  if (options.scenariosMd !== undefined) {
    fs.mkdirSync(path.join(worktreePath, '.adw'));
    fs.writeFileSync(path.join(worktreePath, '.adw/scenarios.md'), options.scenariosMd);
  }

  const ctx = {
    owner: 'acme',
    repo: 'widgets',
    lsFiles: vi.fn((cwd: string, prefix?: string) => (cwd === worktreePath ? listUnder(options.tracked, prefix) : [])),
    createWorktreeForNewBranch: vi.fn((): string => {
      if (options.worktreeFails) throw new Error('git worktree add failed');
      return worktreePath;
    }),
    removeWorktree: vi.fn(() => true),
    removeAndCommitPaths: vi.fn(() => true),
    pushBranch: vi.fn(),
    deleteRemoteBranch: vi.fn(() => true),
  };
  const merged = Object.entries(options.mergedAt ?? {}).map(([issue, date]) => ({ body: `Closes #${issue}`, mergedAt: date.toISOString() }));
  const codeHost = {
    getDefaultBranch: vi.fn(() => 'main'),
    listMergedPullRequests: vi.fn(() => merged),
    findPullRequestByBranch: vi.fn(() => (options.openSweepPr ? { number: 55, state: 'OPEN' } : null)),
    createPullRequest: vi.fn(() => ({ url: 'https://github.com/acme/widgets/pull/123', number: 123 })),
    mergePullRequest: vi.fn(() => ({ success: true })),
  };
  const tracker = inMemoryIssueTracker();
  const repoId: RepoIdentifier = { owner: ctx.owner, repo: ctx.repo, platform: Platform.GitHub };
  const boundary = { gitContext: ctx, repoId, providers: { issueTracker: tracker, codeHost } } as unknown as LaunchBoundary;

  return { worktreePath, ctx, codeHost, tracker, boundary, cleanup: () => fs.rmSync(worktreePath, { recursive: true, force: true }) };
}

export type FakeTarget = ReturnType<typeof fakeTarget>;

export function scenariosMd(sections: Readonly<Record<string, string>>): string {
  return Object.entries(sections).map(([heading, value]) => `## ${heading}\n${value}\n`).join('\n');
}

export function usage(file: string, line: number, pattern: string, usedBy: readonly string[] = []): StepDefinitionUsage {
  return { file, line, pattern, usedBy: [...usedBy].sort() };
}

export function usageReport(...usages: StepDefinitionUsage[]): () => Promise<StepUsageOutcome> {
  return async () => ({ kind: 'usage', framework: 'cucumber-js', usages });
}

/** Clears every candidate: these tests pin what the sweep offers the gate, which has its own tests. */
export const passThroughGate = async (paths: readonly string[]): Promise<readonly string[]> => paths;

export function sweepDeps(target: FakeTarget, overrides: Partial<PerIssueSweepDeps> = {}): PerIssueSweepDeps {
  return { boundary: target.boundary, now: NOW, gateRemoval: passThroughGate, log: vi.fn(), ...overrides };
}

/** The paths the default persist path committed, in the order it was asked to. */
export function committedPaths(target: FakeTarget): string[] {
  return target.ctx.removeAndCommitPaths.mock.calls.flatMap((call: unknown[]) => [...(call[0] as readonly string[])]);
}

export function loggedLines(log: ReturnType<typeof vi.fn>): string[] {
  return log.mock.calls.map((call: unknown[]) => String(call[0]));
}
