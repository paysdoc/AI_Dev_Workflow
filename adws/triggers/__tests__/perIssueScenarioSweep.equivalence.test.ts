import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { LaunchBoundary } from '../../core';
import { runPerIssueScenarioSweep, type PerIssueSweepDeps } from '../perIssueScenarioSweep';
import type { StepUsageOutcome } from '../perIssueSweepStepUsage';
import { runPerIssueScenarioSweep as runBaseSweep } from './fixtures/perIssueScenarioSweep.base';
import { listUnder } from './fixtures/perIssueSweepDeps';

const SEED = 1142;
const CASES = 300;
const NOW = new Date('2026-06-30T12:00:00Z');
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WORKTREE = '<worktree>';
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Not merged, 13 days, exactly 14 days, 30 days, and an hour in the future. */
const MERGE_AGES: readonly (number | null)[] = [null, 13 * DAY_MS, 14 * DAY_MS, 30 * DAY_MS, -HOUR_MS];
const ISSUE_POOL = [1, 3, 4, 7, 12, 30, 40];

type Gate = { readonly kind: 'all' } | { readonly kind: 'none' } | { readonly kind: 'first'; readonly count: number };

interface SweepCase {
  readonly tracked: readonly string[];
  /** Issue → how long ago its pull request merged; absent or null ⇒ not merged. */
  readonly mergeAge: ReadonlyMap<number, number | null>;
  /** Injected `getMergedAt` that throws for these issues; null ⇒ the default, through `listMergedPullRequests`. */
  readonly throwingIssues: ReadonlySet<number> | null;
  readonly gate: Gate;
  readonly openSweepPr: boolean;
  readonly commits: boolean;
  readonly mergeSucceeds: boolean;
  readonly pushThrows: boolean;
  readonly voidPersist: boolean;
  /** Only the boundary, the gate and the usage stub: every other dep, `now` and `log` included, takes its default. */
  readonly defaults: boolean;
}

interface Observed {
  readonly outcome: { readonly returned: readonly string[] } | { readonly threw: string };
  readonly gateCalls: readonly (readonly string[])[];
  readonly calls: readonly unknown[][];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function filesOfIssue(issue: number, chance: (p: number) => boolean): string[] {
  const candidates: readonly [number, string][] = [
    [0.7, `features/per-issue/feature-${issue}.feature`],
    [0.5, `features/per-issue/step_definitions/feature-${issue}.steps.ts`],
    [0.3, `features/per-issue/step_definitions/feature-${issue}-world.ts`],
    [0.2, `features/per-issue/step_definitions/feature-${issue}0.steps.ts`],
    [0.2, `features/regression/x/feature-${issue}.feature`],
    [0.2, `features/regression/step_definitions/feature-${issue}.steps.ts`],
    [0.3, `features/step_definitions/feature-${issue}.steps.ts`],
  ];
  return candidates.filter(([probability]) => chance(probability)).map(([, file]) => file);
}

/** As `git ls-files` lists them: each path once, in order. `feature-30.steps.ts` is both issue 3's `feature-<n>0` file and issue 30's own. */
function trackedList(files: readonly string[]): string[] {
  return [...new Set(files)].sort();
}

function generateCase(random: () => number): SweepCase {
  const chance = (probability: number): boolean => random() < probability;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const issues = ISSUE_POOL.filter(() => chance(0.5));
  const noise = [
    ...(chance(0.3) ? ['features/per-issue/README.md'] : []),
    ...(chance(0.3) ? ['features/per-issue/feature-x.feature'] : []),
    ...(chance(0.5) ? ['features/per-issue/step_definitions/gitContextSharedWorld.ts'] : []),
  ];
  const tracked = trackedList([...issues.flatMap((issue) => filesOfIssue(issue, chance)), ...noise]);
  const mergeAge = new Map(ISSUE_POOL.flatMap((issue) => [issue, issue * 10]).map((issue) => [issue, pick(MERGE_AGES)]));
  const throwingIssues = chance(0.25) ? new Set(ISSUE_POOL.filter(() => chance(0.2))) : null;
  const gate = pick<Gate>([{ kind: 'all' }, { kind: 'none' }, { kind: 'first', count: Math.floor(random() * 4) }]);
  return {
    tracked,
    mergeAge,
    throwingIssues,
    gate,
    openSweepPr: chance(0.15),
    commits: chance(0.85),
    mergeSucceeds: chance(0.8),
    pushThrows: chance(0.1),
    voidPersist: chance(0.05),
    defaults: chance(0.05),
  };
}

function oddCases(random: () => number): readonly [string, SweepCase][] {
  const base = generateCase(random);
  const everyIssue = (age: number | null) => new Map(ISSUE_POOL.flatMap((issue) => [issue, issue * 10]).map((issue) => [issue, age]));
  const full = { ...base, tracked: trackedList(ISSUE_POOL.flatMap((issue) => filesOfIssue(issue, () => true))), gate: { kind: 'all' } as const, throwingIssues: null };
  return [
    ['an empty tracked list', { ...base, tracked: [] }],
    ['every issue unmerged', { ...full, mergeAge: everyIssue(null) }],
    ['every issue stale', { ...full, mergeAge: everyIssue(30 * DAY_MS), openSweepPr: false, commits: true, mergeSucceeds: true, pushThrows: false }],
    ['deps omitted, every default taken', { ...full, mergeAge: everyIssue(30 * DAY_MS), defaults: true, voidPersist: false }],
    ['persistRemoval injected, resolving void', { ...full, mergeAge: everyIssue(30 * DAY_MS), voidPersist: true, defaults: false }],
  ];
}

function mergedAtOf(sweepCase: SweepCase, issue: number): Date | null {
  const age = sweepCase.mergeAge.get(issue);
  return age === undefined || age === null ? null : new Date(NOW.getTime() - age);
}

function gateFor(gate: Gate, gateCalls: string[][]): (paths: readonly string[]) => Promise<readonly string[] | null> {
  return async (paths) => {
    gateCalls.push([...paths]);
    if (gate.kind === 'none') return null;
    return gate.kind === 'all' ? paths : paths.slice(0, gate.count);
  };
}

/** A boundary whose GitContext and CodeHost record, in one ordered list, every call the comparison covers. */
function recordingBoundary(sweepCase: SweepCase, worktreePath: string, calls: unknown[][]): LaunchBoundary {
  const record = (name: string, ...args: unknown[]): void => {
    calls.push([name, ...args.map((arg) => (arg === worktreePath ? WORKTREE : arg))]);
  };
  const merged = [...sweepCase.mergeAge.keys()].flatMap((issue) => {
    const mergedAt = mergedAtOf(sweepCase, issue);
    return mergedAt ? [{ body: `Closes #${issue}`, mergedAt: mergedAt.toISOString() }] : [];
  });
  const gitContext = {
    owner: 'acme',
    repo: 'widgets',
    lsFiles: (cwd: string, prefix?: string) => (cwd === worktreePath ? listUnder(sweepCase.tracked, prefix) : []),
    createWorktreeForNewBranch: (branch: string, base: string) => (record('createWorktreeForNewBranch', branch, base), worktreePath),
    removeWorktree: (branch: string) => (record('removeWorktree', branch), true),
    removeAndCommitPaths: (paths: readonly string[], message: string, cwd: string) => (record('removeAndCommitPaths', [...paths], message, cwd), sweepCase.commits),
    pushBranch: (branch: string, cwd: string) => {
      record('pushBranch', branch, cwd);
      if (sweepCase.pushThrows) throw new Error('push rejected');
    },
    deleteRemoteBranch: (branch: string) => (record('deleteRemoteBranch', branch), true),
  };
  const codeHost = {
    getDefaultBranch: () => 'dev',
    listMergedPullRequests: () => merged,
    findPullRequestByBranch: (branch: string) => (record('findPullRequestByBranch', branch), sweepCase.openSweepPr ? { number: 55, state: 'OPEN' } : null),
    createPullRequest: (spec: unknown) => (record('createPullRequest', spec), { number: 77, url: 'https://github.com/acme/widgets/pull/77' }),
    mergePullRequest: (prNumber: number) => (record('mergePullRequest', prNumber), sweepCase.mergeSucceeds ? { success: true } : { success: false, error: 'not mergeable' }),
  };
  return { gitContext, repoId: { owner: 'acme', repo: 'widgets' }, providers: { issueTracker: {}, codeHost } } as unknown as LaunchBoundary;
}

function depsFor(sweepCase: SweepCase, boundary: LaunchBoundary, gateCalls: string[][]): PerIssueSweepDeps {
  const gateRemoval = gateFor(sweepCase.gate, gateCalls);
  if (sweepCase.defaults) return { boundary, gateRemoval };

  const throwing = sweepCase.throwingIssues;
  const getMergedAt = throwing
    ? async (issue: number): Promise<Date | null> => {
      if (throwing.has(issue)) throw new Error(`lookup failed for #${issue}`);
      return mergedAtOf(sweepCase, issue);
    }
    : undefined;
  return {
    boundary,
    now: NOW,
    gateRemoval,
    log: () => undefined,
    ...(getMergedAt ? { getMergedAt } : {}),
    ...(sweepCase.voidPersist ? { persistRemoval: async () => undefined } : {}),
  };
}

type Sweep = (deps: PerIssueSweepDeps) => Promise<string[]>;

async function observe(sweep: Sweep, sweepCase: SweepCase, worktreePath: string, extra: Partial<PerIssueSweepDeps> = {}): Promise<Observed> {
  const calls: unknown[][] = [];
  const gateCalls: string[][] = [];
  const deps = { ...depsFor(sweepCase, recordingBoundary(sweepCase, worktreePath, calls), gateCalls), ...extra };
  try {
    return { outcome: { returned: await sweep(deps) }, gateCalls, calls };
  } catch (error) {
    return { outcome: { threw: String(error) }, gateCalls, calls };
  }
}

const notSupported = async (): Promise<StepUsageOutcome> => ({ kind: 'not_supported', framework: 'cucumber-js' });

function describeCase(sweepCase: SweepCase): string {
  return JSON.stringify({ ...sweepCase, mergeAge: [...sweepCase.mergeAge], throwingIssues: sweepCase.throwingIssues && [...sweepCase.throwingIssues] });
}

let worktreeWithoutAdw: string;
let worktreeWithAdw: string;

beforeAll(() => {
  worktreeWithoutAdw = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-sweep-equivalence-'));
  worktreeWithAdw = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-sweep-equivalence-adw-'));
  fs.mkdirSync(path.join(worktreeWithAdw, '.adw'));
  fs.copyFileSync(path.join(REPO_ROOT, '.adw/scenarios.md'), path.join(worktreeWithAdw, '.adw/scenarios.md'));
});

afterAll(() => {
  fs.rmSync(worktreeWithoutAdw, { recursive: true, force: true });
  fs.rmSync(worktreeWithAdw, { recursive: true, force: true });
});

describe('runPerIssueScenarioSweep — behavioural equivalence with the base branch whole-file deletion', () => {
  it(`agrees with the base branch's sweep on ${CASES} seeded cases and the odd inputs, with no usage report`, async () => {
    const random = mulberry32(SEED);
    const seeded = Array.from({ length: CASES }, (_, index): [string, SweepCase] => [`case ${index}`, generateCase(random)]);
    const cases = [...seeded, ...oddCases(random)];

    for (const [name, sweepCase] of cases) {
      const expected = await observe(runBaseSweep as Sweep, sweepCase, worktreeWithoutAdw);
      const withoutAdw = await observe(runPerIssueScenarioSweep, sweepCase, worktreeWithoutAdw, { readStepUsage: notSupported });
      const withAdw = await observe(runPerIssueScenarioSweep, sweepCase, worktreeWithAdw, { readStepUsage: notSupported });

      expect(withoutAdw, `seed ${SEED}, ${name}, worktree without .adw/: ${describeCase(sweepCase)}`).toEqual(expected);
      expect(withAdw, `seed ${SEED}, ${name}, worktree with ADW's .adw/scenarios.md: ${describeCase(sweepCase)}`).toEqual(expected);
    }
  });
});
