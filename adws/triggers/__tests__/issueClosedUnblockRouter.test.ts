import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  selectDependents,
  handleIssueClosedDependencyUnblock,
  buildDefaultDependencyUnblockDeps,
  type DependencyUnblockDeps,
  type IssueWithDeps,
} from '../issueClosedUnblockRouter';
import { parseDependencies, parseKeywordProximityDependencies } from '../issueDependencies';
import { Platform } from '../../providers/types';
import type { IssueListEntry } from '../../providers/types';
import type { LaunchBoundary } from '../../core';

vi.mock('../../core', () => ({
  log: vi.fn(),
  LOGS_DIR: '/logs',
}));

const REPO_INFO = { owner: 'acme', repo: 'target', platform: Platform.GitHub };
const TARGET_ARGS = ['--target-repo', 'acme/target'];

function makeBoundary(listIssuesImpl: () => IssueListEntry[]): LaunchBoundary {
  return {
    repoId: REPO_INFO,
    providers: { issueTracker: { listIssues: vi.fn(listIssuesImpl) } },
  } as unknown as LaunchBoundary;
}

const FAKE_BOUNDARY = makeBoundary(() => []);

function makeDeps(overrides: Partial<DependencyUnblockDeps> = {}): DependencyUnblockDeps {
  return {
    listOpenIssues: () => [],
    extractDependents: vi.fn().mockResolvedValue([]),
    checkEligibility: vi.fn().mockResolvedValue({ eligible: true }),
    spawn: vi.fn().mockResolvedValue(undefined),
    logger: vi.fn(),
    ...overrides,
  };
}

// ── selectDependents (pure) ───────────────────────────────────────────────────

describe('selectDependents', () => {
  it('returns issues whose deps include the closed issue number', () => {
    const issues: IssueWithDeps[] = [
      { number: 29, body: '', deps: [28] },
      { number: 30, body: '', deps: [99] },
    ];
    expect(selectDependents(issues, 28)).toEqual([{ number: 29, body: '', deps: [28] }]);
  });

  it('returns an empty array when nothing depends on the closed issue', () => {
    const issues: IssueWithDeps[] = [{ number: 30, body: '', deps: [99] }];
    expect(selectDependents(issues, 28)).toEqual([]);
  });
});

// ── handleIssueClosedDependencyUnblock — prose parity (AC1, the headline fix) ──

describe('handleIssueClosedDependencyUnblock — prose parity (AC1)', () => {
  it('selects and spawns a prose "- blocked by #N" dependent (RED→green: no DI seam existed pre-fix)', async () => {
    const deps = makeDeps({
      listOpenIssues: () => [{ number: 29, body: '- blocked by #28' }],
      extractDependents: vi.fn().mockResolvedValue([28]),
    });

    await handleIssueClosedDependencyUnblock(28, FAKE_BOUNDARY, TARGET_ARGS, deps);

    expect(deps.spawn).toHaveBeenCalledWith(29, TARGET_ARGS);
  });

  it('real-parser parity: the detection core (parseKeywordProximityDependencies) selects the prose dependent', async () => {
    const deps = makeDeps({
      listOpenIssues: () => [{ number: 29, body: '- blocked by #28' }],
      extractDependents: (body) => Promise.resolve(parseKeywordProximityDependencies(body)),
    });

    await handleIssueClosedDependencyUnblock(28, FAKE_BOUNDARY, TARGET_ARGS, deps);

    expect(deps.spawn).toHaveBeenCalledWith(29, TARGET_ARGS);
  });

  it('pins why the swap matters: the narrow parseDependencies selects nothing for the same prose body', async () => {
    const deps = makeDeps({
      listOpenIssues: () => [{ number: 29, body: '- blocked by #28' }],
      extractDependents: (body) => Promise.resolve(parseDependencies(body)),
    });

    await handleIssueClosedDependencyUnblock(28, FAKE_BOUNDARY, TARGET_ARGS, deps);

    expect(deps.spawn).not.toHaveBeenCalled();
  });
});

// ── heading no-regression (AC2) ────────────────────────────────────────────────

describe('handleIssueClosedDependencyUnblock — heading no-regression (AC2)', () => {
  it('still spawns a dependent declared under a "## Blocked by" heading', async () => {
    const deps = makeDeps({
      listOpenIssues: () => [{ number: 2911, body: '## Blocked by\n- #2810' }],
      extractDependents: vi.fn().mockResolvedValue([2810]),
    });

    await handleIssueClosedDependencyUnblock(2810, FAKE_BOUNDARY, TARGET_ARGS, deps);

    expect(deps.spawn).toHaveBeenCalledWith(2911, TARGET_ARGS);
  });
});

// ── still-blocked gating (AC1's "re-evaluated / spawned" clause) ───────────────

describe('handleIssueClosedDependencyUnblock — still-blocked gating', () => {
  it('re-evaluates eligibility but does not spawn when the dependent is still ineligible', async () => {
    const deps = makeDeps({
      listOpenIssues: () => [{ number: 2931, body: '- blocked by #2830' }],
      extractDependents: vi.fn().mockResolvedValue([2830]),
      checkEligibility: vi.fn().mockResolvedValue({ eligible: false, reason: 'open_dependencies', blockingIssues: [30] }),
    });

    await handleIssueClosedDependencyUnblock(2830, FAKE_BOUNDARY, TARGET_ARGS, deps);

    expect(deps.checkEligibility).toHaveBeenCalledWith(2931, '- blocked by #2830');
    expect(deps.spawn).not.toHaveBeenCalled();
  });
});

// ── no dependents ───────────────────────────────────────────────────────────────

describe('handleIssueClosedDependencyUnblock — no dependents', () => {
  it('does not spawn anything when no open issue depends on the closed issue', async () => {
    const deps = makeDeps({
      listOpenIssues: () => [{ number: 40, body: 'unrelated' }],
      extractDependents: vi.fn().mockResolvedValue([]),
    });

    await handleIssueClosedDependencyUnblock(28, FAKE_BOUNDARY, TARGET_ARGS, deps);

    expect(deps.spawn).not.toHaveBeenCalled();
    expect(deps.checkEligibility).not.toHaveBeenCalled();
  });
});

// ── buildDefaultDependencyUnblockDeps — routes through the boundary's tracker ──

describe('buildDefaultDependencyUnblockDeps — issue tracker routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listOpenIssues routes through the boundary\'s issue tracker', () => {
    const boundary = makeBoundary(() => [{ number: 10, body: 'Blocked by #5' }]);

    const deps = buildDefaultDependencyUnblockDeps(boundary);
    const result = deps.listOpenIssues();

    expect(boundary.providers.issueTracker.listIssues).toHaveBeenCalledWith({ fields: ['number', 'body'], limit: 100 });
    expect(result).toEqual([{ number: 10, body: 'Blocked by #5' }]);
  });
});

// ── no-throw on lister error ────────────────────────────────────────────────────

describe('handleIssueClosedDependencyUnblock — no-throw on lister error', () => {
  it('does not throw when listOpenIssues throws; logs the error instead', async () => {
    const logger = vi.fn();
    const deps = makeDeps({
      listOpenIssues: () => {
        throw new Error('gh failed');
      },
      logger,
    });

    await expect(handleIssueClosedDependencyUnblock(28, FAKE_BOUNDARY, TARGET_ARGS, deps)).resolves.not.toThrow();
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Error checking dependents of closed issue #28'), 'error');
  });
});
