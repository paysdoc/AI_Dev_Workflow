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

// Low-score feature file: no registered phrases
const LOW_SCORE_FEATURE = `@adw-999
Feature: Low score

  Scenario: Low quality scenario
    Given some unregistered setup step
    When some unregistered action happens
    Then some unregistered assertion
`;

function makeDeps(overrides: Partial<PromotionCommenterDeps> = {}): PromotionCommenterDeps {
  return {
    loadVocabulary: () => VOCAB,
    fetchChangedFiles: async () => [],
    readFile: () => '',
    writeFile: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    today: () => '2026-05-21',
    log: vi.fn(),
    ...overrides,
  };
}

describe('runPromotionCommenter', () => {
  it('high-score scenario: writes tagged file and posts comment', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => HIGH_SCORE_FEATURE,
      writeFile,
      postComment,
    });
    const result = await runPromotionCommenter(1, deps);
    expect(result.suggestedScenarios).toHaveLength(1);
    expect(writeFile).toHaveBeenCalledOnce();
    const writtenContent = writeFile.mock.calls[0][1] as string;
    expect(writtenContent).toContain('@promotion-suggested-2026-05-21');
    expect(postComment).toHaveBeenCalledOnce();
    const commentBody = postComment.mock.calls[0][1] as string;
    expect(commentBody).toContain('@promotion-suggested-');
  });

  it('below-threshold scenario: no writes, no comment', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn();
    const deps = makeDeps({
      fetchChangedFiles: async () => [{ path: 'features/per-issue/feature-999.feature', status: 'modified' }],
      readFile: () => LOW_SCORE_FEATURE,
      writeFile,
      postComment,
    });
    const result = await runPromotionCommenter(1, deps);
    expect(result.suggestedScenarios).toHaveLength(0);
    expect(writeFile).not.toHaveBeenCalled();
    expect(postComment).not.toHaveBeenCalled();
  });

  it('multiple high-score files: two writeFile calls, one postComment', async () => {
    const writeFile = vi.fn();
    const postComment = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      fetchChangedFiles: async () => [
        { path: 'features/per-issue/feature-100.feature', status: 'modified' },
        { path: 'features/per-issue/feature-101.feature', status: 'modified' },
      ],
      readFile: () => HIGH_SCORE_FEATURE,
      writeFile,
      postComment,
    });
    const result = await runPromotionCommenter(1, deps);
    expect(result.suggestedScenarios).toHaveLength(2);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(postComment).toHaveBeenCalledOnce();
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
    await runPromotionCommenter(1, deps);
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
    await runPromotionCommenter(1, deps);
    expect(readFile).not.toHaveBeenCalled();
  });
});
