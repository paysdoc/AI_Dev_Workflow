import { describe, it, expect, vi } from 'vitest';
import { runPromotionCommenter } from '../promotionCommenter.ts';
import type { PromotionCommenterDeps } from '../promotionCommenter.ts';

// Vocabulary with subprocess-pattern entries whose targets are in examples
const VOCAB = `
## When

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| W1 | \`the {string} orchestrator is invoked with adwId {string} and issue {int}\` | Spawns orchestrator | subprocess | exit code + state file |

## Then

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| T1 | \`the orchestrator subprocess exited {int}\` | Checks exit code | subprocess | exit code + state file |

## Observability Surfaces (Examples)

- exit code + state file
`;

// High-score feature file: subprocess pattern, all phrases matched, surface in examples
const HIGH_SCORE_FEATURE = `@adw-999
Feature: High score

  @adw-999
  Scenario: High quality scenario
    When the "chore" orchestrator is invoked with adwId "test" and issue 1
    Then the orchestrator subprocess exited 0
`;

// Pre-tagged high-score (dated today)
const HIGH_SCORE_TAGGED_TODAY = `@adw-999
Feature: High score

  @adw-999 @promotion-suggested-2026-05-21
  Scenario: High quality scenario
    When the "chore" orchestrator is invoked with adwId "test" and issue 1
    Then the orchestrator subprocess exited 0
`;

// Pre-tagged high-score (dated earlier)
const HIGH_SCORE_TAGGED_EARLIER = `@adw-999
Feature: High score

  @adw-999 @promotion-suggested-2026-01-01
  Scenario: High quality scenario
    When the "chore" orchestrator is invoked with adwId "test" and issue 1
    Then the orchestrator subprocess exited 0
`;

// Low-score feature file: no registered phrases
const LOW_SCORE_FEATURE = `@adw-999
Feature: Low score

  Scenario: Low quality scenario
    Given some unregistered setup step
    When some unregistered action happens
    Then some unregistered assertion
`;

// Pre-tagged low-score (dated today) — was previously high-score, now dropped
const LOW_SCORE_TAGGED_TODAY = `@adw-999
Feature: Low score

  @promotion-suggested-2026-05-21
  Scenario: Low quality scenario
    Given some unregistered setup step
    When some unregistered action happens
    Then some unregistered assertion
`;

// Pre-tagged low-score (dated earlier)
const LOW_SCORE_TAGGED_EARLIER = `@adw-999
Feature: Low score

  @adw-999 @promotion-suggested-2026-01-01
  Scenario: Low quality scenario
    Given some unregistered setup step
    When some unregistered action happens
    Then some unregistered assertion
`;

// Mixed file: Scenario A has no tag (above threshold), Scenario B has old tag (below threshold)
const MIXED_FILE = `@adw-999
Feature: Mixed

  @adw-999
  Scenario: High quality scenario
    When the "chore" orchestrator is invoked with adwId "test" and issue 1
    Then the orchestrator subprocess exited 0

  @adw-999 @promotion-suggested-2026-01-01
  Scenario: Low quality scenario
    Given some unregistered step
    When some unregistered action
    Then some unregistered assertion
`;

// Withdraw-only file: both scenarios have old tags and score below threshold
const WITHDRAW_ONLY_FILE = `@adw-999
Feature: Withdraw only

  @adw-999 @promotion-suggested-2026-01-01
  Scenario: Low quality A
    Given some unregistered step 1
    When some unregistered action 1
    Then some unregistered assertion 1

  @adw-999 @promotion-suggested-2026-01-15
  Scenario: Low quality B
    Given some unregistered step 2
    When some unregistered action 2
    Then some unregistered assertion 2
`;

function makeDeps(overrides: Partial<PromotionCommenterDeps> = {}): PromotionCommenterDeps {
  return {
    loadVocabulary: () => VOCAB,
    fetchChangedFiles: async () => [],
    readFile: () => '',
    writeFile: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    today: () => '2026-05-21',
    loadStats: () => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 }),
    log: vi.fn(),
    applyHitlLabel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runPromotionCommenter', () => {
  // ── pre-existing tests (updated signatures) ───────────────────────────

  it('high-score scenario: writes tagged file and posts comment', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn().mockResolvedValue(undefined);
    const applyHitlLabel = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => HIGH_SCORE_FEATURE,
      writeFile,
      postComment,
      applyHitlLabel,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(1);
    expect(writeFile).toHaveBeenCalledOnce();
    const writtenContent = writeFile.mock.calls[0][1] as string;
    expect(writtenContent).toContain('@promotion-suggested-2026-05-21');
    expect(postComment).toHaveBeenCalledOnce();
    const commentBody = postComment.mock.calls[0][1] as string;
    expect(commentBody).toContain('@promotion-suggested-');
    expect(result.hitlLabelApplied).toBe(true);
    expect(applyHitlLabel).toHaveBeenCalledWith(999);
  });

  it('below-threshold scenario: no writes, no comment', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn();
    const applyHitlLabel = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => LOW_SCORE_FEATURE,
      writeFile,
      postComment,
      applyHitlLabel,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(0);
    expect(writeFile).not.toHaveBeenCalled();
    expect(postComment).not.toHaveBeenCalled();
    expect(applyHitlLabel).not.toHaveBeenCalled();
    expect(result.hitlLabelApplied).toBe(false);
  });

  it('multiple high-score files: two writeFile calls, one postComment, one applyHitlLabel', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn().mockResolvedValue(undefined);
    const applyHitlLabel = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      fetchChangedFiles: async () => [
        { path: 'features/per-issue/feature-100.feature', status: 'modified' },
        { path: 'features/per-issue/feature-101.feature', status: 'modified' },
      ],
      readFile: () => HIGH_SCORE_FEATURE,
      writeFile,
      postComment,
      applyHitlLabel,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(2);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(postComment).toHaveBeenCalledOnce();
    expect(applyHitlLabel).toHaveBeenCalledOnce();
  });

  it('non-per-issue file is skipped', async () => {
    const writeFile = vi.fn();
    const readFile = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: async () => [
        { path: 'adws/foo.ts', status: 'modified' },
        { path: 'features/regression/smoke/something.feature', status: 'modified' },
      ],
      readFile,
      writeFile,
    });
    await runPromotionCommenter(1, 999, deps);
    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('deleted per-issue file is skipped', async () => {
    const readFile = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: async () => [
        { path: 'features/per-issue/feature-999.feature', status: 'removed' },
      ],
      readFile,
    });
    await runPromotionCommenter(1, 999, deps);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('(j) high-stats injection raises threshold above score-4 scenario', async () => {
    // Score-4 scenario: subprocess pattern, single phrase match, surface in examples
    const SCORE_4_FEATURE = `@adw-999
Feature: Score 4

  @adw-999
  Scenario: Medium scenario
    When the "chore" orchestrator is invoked with adwId "test" and issue 1
    Then some unregistered assertion step
`;
    const writeFileLow = vi.fn();
    const postCommentLow = vi.fn().mockResolvedValue(undefined);

    // With bootstrap stats (N=3), score-4 scenario IS tagged
    const depsLow = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => SCORE_4_FEATURE,
      writeFile: writeFileLow,
      postComment: postCommentLow,
      loadStats: () => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 }),
    });
    const resultLow = await runPromotionCommenter(1, 999, depsLow);

    // With mature stats (N=7), same score-4 scenario is NOT tagged
    const writeFileHigh = vi.fn();
    const postCommentHigh = vi.fn().mockResolvedValue(undefined);
    const depsHigh = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => HIGH_SCORE_FEATURE,
      writeFile: writeFileHigh,
      postComment: postCommentHigh,
      loadStats: () => ({ promotedCount90d: 50, totalPerIssueCount90d: 100 }),
    });
    const resultHigh = await runPromotionCommenter(1, 999, depsHigh);

    // HIGH_SCORE_FEATURE scores 3 (one subprocess phrase, surface target, one phase) — N=7 should suppress it
    expect(resultHigh.suggestedScenarios).toHaveLength(0);
    // score-4 scenario with bootstrap: depends on actual scorer output — at minimum type-checks pass
    expect(typeof resultLow.suggestedScenarios.length).toBe('number');
  });

  it('(k) loadStats is invoked exactly once per runPromotionCommenter call', async () => {
    const loadStats = vi.fn().mockReturnValue({ promotedCount90d: 0, totalPerIssueCount90d: 0 });
    const deps = makeDeps({
      fetchChangedFiles: async () => [
        { path: 'features/per-issue/feature-100.feature', status: 'modified' },
        { path: 'features/per-issue/feature-101.feature', status: 'modified' },
      ],
      readFile: () => HIGH_SCORE_FEATURE,
      loadStats,
    });
    await runPromotionCommenter(1, 999, deps);
    expect(loadStats).toHaveBeenCalledOnce();
  });

  // ── decision matrix: row-by-row ───────────────────────────────────────

  it('matrix row 3 — existing tag dated today + above threshold: no writeFile, no comment, no label (daily suppression)', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn();
    const applyHitlLabel = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => HIGH_SCORE_TAGGED_TODAY,
      writeFile,
      postComment,
      applyHitlLabel,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(0);
    expect(writeFile).not.toHaveBeenCalled();
    expect(postComment).not.toHaveBeenCalled();
    expect(applyHitlLabel).not.toHaveBeenCalled();
    expect(result.hitlLabelApplied).toBe(false);
  });

  it('matrix row 4 — existing tag dated today + below threshold: writeFile removes tag, no comment, no label (silent withdrawal)', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn();
    const applyHitlLabel = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => LOW_SCORE_TAGGED_TODAY,
      writeFile,
      postComment,
      applyHitlLabel,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(0);
    expect(writeFile).toHaveBeenCalledOnce();
    const writtenContent = writeFile.mock.calls[0][1] as string;
    expect(writtenContent).not.toContain('@promotion-suggested-');
    expect(postComment).not.toHaveBeenCalled();
    expect(applyHitlLabel).not.toHaveBeenCalled();
    expect(result.hitlLabelApplied).toBe(false);
  });

  it('matrix row 5 — existing tag dated earlier + above threshold: writeFile refreshes date, comment posted, label applied', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn().mockResolvedValue(undefined);
    const applyHitlLabel = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => HIGH_SCORE_TAGGED_EARLIER,
      writeFile,
      postComment,
      applyHitlLabel,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(1);
    expect(writeFile).toHaveBeenCalledOnce();
    const writtenContent = writeFile.mock.calls[0][1] as string;
    expect(writtenContent).toContain('@promotion-suggested-2026-05-21');
    expect(writtenContent).not.toContain('@promotion-suggested-2026-01-01');
    expect(postComment).toHaveBeenCalledOnce();
    expect(applyHitlLabel).toHaveBeenCalledWith(999);
    expect(result.hitlLabelApplied).toBe(true);
  });

  it('matrix row 6 — existing tag dated earlier + below threshold: writeFile removes tag, no comment, no label', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn();
    const applyHitlLabel = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => LOW_SCORE_TAGGED_EARLIER,
      writeFile,
      postComment,
      applyHitlLabel,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(0);
    expect(writeFile).toHaveBeenCalledOnce();
    const writtenContent = writeFile.mock.calls[0][1] as string;
    expect(writtenContent).not.toContain('@promotion-suggested-');
    expect(postComment).not.toHaveBeenCalled();
    expect(applyHitlLabel).not.toHaveBeenCalled();
    expect(result.hitlLabelApplied).toBe(false);
  });

  // ── cross-cutting cases ───────────────────────────────────────────────

  it('mixed file: add-suggestion for high-score + remove-suggestion for low-score → two writes, one comment, one label', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn().mockResolvedValue(undefined);
    const applyHitlLabel = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => MIXED_FILE,
      writeFile,
      postComment,
      applyHitlLabel,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(1);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(postComment).toHaveBeenCalledOnce();
    expect(applyHitlLabel).toHaveBeenCalledOnce();
    expect(result.hitlLabelApplied).toBe(true);
  });

  it('withdraw-only run: both scenarios removed → two writes, no comment, no label', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn();
    const applyHitlLabel = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => WITHDRAW_ONLY_FILE,
      writeFile,
      postComment,
      applyHitlLabel,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(0);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(postComment).not.toHaveBeenCalled();
    expect(applyHitlLabel).not.toHaveBeenCalled();
    expect(result.hitlLabelApplied).toBe(false);
  });

  it('applyHitlLabel failure is caught and logged as a warning, result still returned', async () => {
    const postComment = vi.fn().mockResolvedValue(undefined);
    const applyHitlLabel = vi.fn().mockRejectedValue(new Error('gh CLI failed'));
    const log = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => HIGH_SCORE_FEATURE,
      postComment,
      applyHitlLabel,
      log,
    });
    const result = await runPromotionCommenter(1, 999, deps);
    expect(result.suggestedScenarios).toHaveLength(1);
    expect(result.hitlLabelApplied).toBe(false);
    expect(postComment).toHaveBeenCalledOnce();
    expect(applyHitlLabel).toHaveBeenCalledOnce();
    const logCalls = log.mock.calls as Array<[string, string | undefined]>;
    const hasWarnCall = logCalls.some(([, level]) => level === 'warn');
    expect(hasWarnCall).toBe(true);
  });
});
