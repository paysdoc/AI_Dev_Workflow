import { describe, it, expect, vi } from 'vitest';
import { runPromotionMover } from '../promotionMover.ts';
import type { PromotionMoverDeps } from '../promotionMover.ts';

const SINGLE_APPROVED_FEATURE = `Feature: Test

  @adw-511 @promotion
  Scenario: Move me to regression
    Given something important
    When the action runs
    Then regression value is confirmed
`;

const SUGGESTED_ONLY_FEATURE = `Feature: Test

  @adw-511 @promotion-suggested-2026-05-21
  Scenario: Only suggested, no bare promotion
    Given something
`;

const TWO_APPROVED_FEATURE = `Feature: Test

  @promotion
  Scenario: First scenario to promote
    Given step one

  @promotion
  Scenario: Second scenario to promote
    Given step two
`;

const MIXED_FEATURE = `Feature: Test

  @promotion
  Scenario: Approved for promotion
    Given step a

  @promotion-suggested-2026-05-21
  Scenario: Only suggested here
    Given step b
`;

const NO_TAGS_FEATURE = `Feature: Test

  @adw-511
  Scenario: No promotion tags at all
    Given something
`;

function makeDeps(overrides: Partial<PromotionMoverDeps> = {}): PromotionMoverDeps {
  return {
    fetchChangedFiles: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockReturnValue(''),
    writeFile: vi.fn(),
    getDefaultBranch: vi.fn().mockReturnValue('dev'),
    createWorktree: vi.fn().mockReturnValue('/tmp/worktree'),
    commitChanges: vi.fn().mockReturnValue(true),
    pushBranch: vi.fn(),
    findExistingPR: vi.fn().mockReturnValue(null),
    createPR: vi.fn().mockReturnValue({ number: 42, url: 'https://github.com/org/repo/pull/42' }),
    loadScenariosConfig: vi.fn().mockReturnValue({ regressionScenarioDirectory: 'features/regression/' }),
    today: vi.fn().mockReturnValue('2026-05-21'),
    log: vi.fn(),
    ...overrides,
  };
}

describe('runPromotionMover', () => {
  it('(a) single approved scenario: side-effect deps called once', async () => {
    const createWorktree = vi.fn().mockReturnValue('/tmp/worktree');
    const writeFile = vi.fn();
    const commitChanges = vi.fn().mockReturnValue(true);
    const pushBranch = vi.fn();
    const createPR = vi.fn().mockReturnValue({ number: 42, url: 'https://github.com/pull/42' });
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockImplementation((p: string) => {
        if (p.includes('feature-511.feature')) return SINGLE_APPROVED_FEATURE;
        throw new Error('file not found');
      }),
      writeFile,
      createWorktree,
      commitChanges,
      pushBranch,
      createPR,
    });

    const result = await runPromotionMover(1, deps);

    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].skipped).toBe(false);
    expect(createWorktree).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledTimes(2); // per-issue + regression
    expect(commitChanges).toHaveBeenCalledOnce();
    expect(pushBranch).toHaveBeenCalledOnce();
    expect(createPR).toHaveBeenCalledOnce();
  });

  it('(b) no approved scenarios: no side-effect deps called', async () => {
    const writeFile = vi.fn();
    const createWorktree = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockReturnValue(NO_TAGS_FEATURE),
      writeFile,
      createWorktree,
    });

    const result = await runPromotionMover(1, deps);

    expect(result.moved).toHaveLength(0);
    expect(createWorktree).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('(c) only @promotion-suggested-<date>: no move', async () => {
    const createWorktree = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockReturnValue(SUGGESTED_ONLY_FEATURE),
      createWorktree,
    });

    const result = await runPromotionMover(1, deps);

    expect(result.moved).toHaveLength(0);
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('(d) multiple approved scenarios: one call chain per scenario', async () => {
    const createWorktree = vi.fn()
      .mockReturnValueOnce('/tmp/wt1')
      .mockReturnValueOnce('/tmp/wt2');
    const createPR = vi.fn()
      .mockReturnValueOnce({ number: 10, url: 'https://github.com/pull/10' })
      .mockReturnValueOnce({ number: 11, url: 'https://github.com/pull/11' });
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockImplementation((p: string) => {
        if (p.includes('feature-511.feature')) return TWO_APPROVED_FEATURE;
        throw new Error('file not found');
      }),
      createWorktree,
      createPR,
    });

    const result = await runPromotionMover(1, deps);

    expect(result.moved).toHaveLength(2);
    expect(createWorktree).toHaveBeenCalledTimes(2);
    expect(createPR).toHaveBeenCalledTimes(2);
    // Branch names should be distinct
    expect(result.moved[0].branchName).not.toBe(result.moved[1].branchName);
  });

  it('(e) findExistingPR returns a hit: skips silently', async () => {
    const createWorktree = vi.fn();
    const createPR = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockReturnValue(SINGLE_APPROVED_FEATURE),
      findExistingPR: vi.fn().mockReturnValue({ number: 99, url: 'https://github.com/pull/99' }),
      createWorktree,
      createPR,
    });

    const result = await runPromotionMover(1, deps);

    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].skipped).toBe(true);
    expect(result.moved[0].prNumber).toBe(99);
    expect(createWorktree).not.toHaveBeenCalled();
    expect(createPR).not.toHaveBeenCalled();
  });

  it('(f) writeFile called for both per-issue removal and regression insertion', async () => {
    const writeFile = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockImplementation((p: string) => {
        if (p.includes('feature-511.feature')) return SINGLE_APPROVED_FEATURE;
        throw new Error('file not found');
      }),
      writeFile,
    });

    await runPromotionMover(1, deps);

    expect(writeFile).toHaveBeenCalledTimes(2);
    const paths = writeFile.mock.calls.map((c: unknown[]) => c[0] as string);
    const hasPerIssue = paths.some(p => p.includes('feature-511.feature'));
    const hasRegression = paths.some(p => p.includes('regression'));
    expect(hasPerIssue).toBe(true);
    expect(hasRegression).toBe(true);
  });

  it('(g) destination directory falls back to features/regression/ when not configured', async () => {
    const writeFile = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockImplementation((p: string) => {
        if (p.includes('feature-511.feature')) return SINGLE_APPROVED_FEATURE;
        throw new Error('file not found');
      }),
      loadScenariosConfig: vi.fn().mockReturnValue({ regressionScenarioDirectory: undefined }),
      writeFile,
    });

    await runPromotionMover(1, deps);

    const paths = writeFile.mock.calls.map((c: unknown[]) => c[0] as string);
    const regressionWrite = paths.find(p => p.includes('regression'));
    expect(regressionWrite).toBeDefined();
    expect(regressionWrite).toContain('features/regression/');
  });

  it('(h) moved scenario in destination has @promotion stripped', async () => {
    const writeFile = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockImplementation((p: string) => {
        if (p.includes('feature-511.feature')) return SINGLE_APPROVED_FEATURE;
        throw new Error('file not found');
      }),
      writeFile,
    });

    await runPromotionMover(1, deps);

    const regressionCalls = writeFile.mock.calls.filter((c: unknown[]) =>
      (c[0] as string).includes('regression')
    );
    expect(regressionCalls).toHaveLength(1);
    const writtenContent = regressionCalls[0][1] as string;
    expect(writtenContent).not.toMatch(/@promotion(?!-suggested)/);
  });

  it('(i) moved scenario has @promotion-suggested-<date> also stripped', async () => {
    const featureWithBoth = `Feature: Test

  @promotion-suggested-2026-05-15 @promotion
  Scenario: Strip both tags
    Given step
`;
    const writeFile = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockImplementation((p: string) => {
        if (p.includes('feature-511.feature')) return featureWithBoth;
        throw new Error('file not found');
      }),
      writeFile,
    });

    await runPromotionMover(1, deps);

    const regressionCalls = writeFile.mock.calls.filter((c: unknown[]) =>
      (c[0] as string).includes('regression')
    );
    const writtenContent = regressionCalls[0][1] as string;
    expect(writtenContent).not.toContain('@promotion-suggested-');
    expect(writtenContent).not.toMatch(/@promotion(?!-)/);
  });

  it('(j) non-per-issue files in PR diff are skipped', async () => {
    const readFile = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'adws/promotion/promotionMover.ts', status: 'modified' },
        { path: 'features/regression/smoke/something.feature', status: 'modified' },
      ]),
      readFile,
    });

    await runPromotionMover(1, deps);

    expect(readFile).not.toHaveBeenCalled();
  });

  it('(k) deleted per-issue file is skipped', async () => {
    const readFile = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'removed' },
      ]),
      readFile,
    });

    await runPromotionMover(1, deps);

    expect(readFile).not.toHaveBeenCalled();
  });

  it('mixed-tag file: only @promotion scenario is moved', async () => {
    const createWorktree = vi.fn().mockReturnValue('/tmp/wt');
    const createPR = vi.fn().mockReturnValue({ number: 50, url: 'https://github.com/pull/50' });
    const deps = makeDeps({
      fetchChangedFiles: vi.fn().mockResolvedValue([
        { path: 'features/per-issue/feature-511.feature', status: 'modified' },
      ]),
      readFile: vi.fn().mockImplementation((p: string) => {
        if (p.includes('feature-511.feature')) return MIXED_FEATURE;
        throw new Error('file not found');
      }),
      createWorktree,
      createPR,
    });

    const result = await runPromotionMover(1, deps);

    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].scenarioName).toBe('Approved for promotion');
    expect(createPR).toHaveBeenCalledOnce();
  });
});
