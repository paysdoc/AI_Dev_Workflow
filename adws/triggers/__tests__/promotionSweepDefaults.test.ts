import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    loadProjectConfig: vi.fn(),
  };
});

import { PROMOTION_SWEEP_SPEC } from '../promotionSweepDefaults';
import { DOCS_INDEX_SWEEP_SPEC } from '../docsIndexSweepDefaults';
import { PER_ISSUE_SWEEP_SPEC } from '../perIssueSweepPersist';
import { loadProjectConfig } from '../../core';
import { readFileSync } from 'fs';
import {
  defaultsFor, makeFakeGitContext, NOW, PER_ISSUE_DIR, STEP_DEF_DIR, HOST_CHECKOUT, SWEEP_WORKTREE,
} from './fixtures/promotionSweepDefaultsHarness';

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PROMOTION_SWEEP_SPEC', () => {
  it('uses a dedicated branch distinct from the per-issue and docs-index sweeps', () => {
    expect(PROMOTION_SWEEP_SPEC.branch).toBe('chore/promotion-sweep');
    expect(PROMOTION_SWEEP_SPEC.branch).not.toBe(PER_ISSUE_SWEEP_SPEC.branch);
    expect(PROMOTION_SWEEP_SPEC.branch).not.toBe(DOCS_INDEX_SWEEP_SPEC.branch);
  });

  it('describes the marker change in its pull request copy without a closing keyword', () => {
    expect(PROMOTION_SWEEP_SPEC.prTitle).toContain('promotion');
    expect(PROMOTION_SWEEP_SPEC.prBody).toContain('@promotion-suggested-');
    expect(PROMOTION_SWEEP_SPEC.prBody).toContain('@promotion-declined');
    expect(PROMOTION_SWEEP_SPEC.prBody).not.toMatch(/(Closes|Implements) /);
  });
});

describe('listPerIssueFeatures', () => {
  it('lists feature-{N}.feature files from the sweep worktree, never the host checkout', () => {
    const ctx = makeFakeGitContext({
      lsFiles: vi.fn(() => ['features/per-issue/feature-611.feature', 'features/per-issue/README.md']),
    });

    const result = defaultsFor(ctx).listPerIssueFeatures();

    expect(result).toEqual(['features/per-issue/feature-611.feature']);
    expect(ctx.lsFiles).toHaveBeenCalledWith(SWEEP_WORKTREE, PER_ISSUE_DIR);
    expect(ctx.lsFiles).not.toHaveBeenCalledWith(HOST_CHECKOUT, expect.anything());
  });

  it('degrades to [] when ctx.lsFiles throws', () => {
    const ctx = makeFakeGitContext({ lsFiles: vi.fn(() => { throw new Error('git ls-files failed'); }) });

    expect(defaultsFor(ctx).listPerIssueFeatures()).toEqual([]);
  });

  it('degrades to [] without a sweep base and lists nothing', () => {
    const ctx = makeFakeGitContext();

    expect(defaultsFor(ctx, { withBase: false }).listPerIssueFeatures()).toEqual([]);
    expect(ctx.lsFiles).not.toHaveBeenCalled();
  });
});

describe('readFeatureContent', () => {
  it('reads the file from the sweep worktree, never the host checkout', () => {
    vi.mocked(readFileSync).mockReturnValue('Feature: fixture\n');

    const content = defaultsFor(makeFakeGitContext()).readFeatureContent('features/per-issue/feature-611.feature');

    expect(content).toBe('Feature: fixture\n');
    expect(readFileSync).toHaveBeenCalledWith(`${SWEEP_WORKTREE}/features/per-issue/feature-611.feature`, 'utf-8');
  });

  it('degrades to null when readFileSync throws', () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

    expect(defaultsFor(makeFakeGitContext()).readFeatureContent('features/per-issue/feature-611.feature')).toBeNull();
  });

  it('degrades to null without a sweep base and reads nothing', () => {
    expect(defaultsFor(makeFakeGitContext(), { withBase: false }).readFeatureContent('features/per-issue/feature-611.feature')).toBeNull();
    expect(readFileSync).not.toHaveBeenCalled();
  });
});

describe('listStepDefSiblings', () => {
  it('lists step-def siblings for the given feature number from the sweep worktree', () => {
    const ctx = makeFakeGitContext({
      lsFiles: vi.fn(() => ['features/per-issue/step_definitions/feature-611.steps.ts', 'features/per-issue/step_definitions/feature-612.steps.ts']),
    });

    expect(defaultsFor(ctx).listStepDefSiblings(611)).toEqual(['features/per-issue/step_definitions/feature-611.steps.ts']);
    expect(ctx.lsFiles).toHaveBeenCalledWith(SWEEP_WORKTREE, STEP_DEF_DIR);
  });

  it('degrades to [] when ctx.lsFiles throws', () => {
    const ctx = makeFakeGitContext({ lsFiles: vi.fn(() => { throw new Error('boom'); }) });

    expect(defaultsFor(ctx).listStepDefSiblings(611)).toEqual([]);
  });

  it('degrades to [] without a sweep base', () => {
    expect(defaultsFor(makeFakeGitContext(), { withBase: false }).listStepDefSiblings(611)).toEqual([]);
  });
});

describe('scenariosConfig', () => {
  it('reads scenario paths via loadProjectConfig(<sweep worktree>), falling back to defaults for unset fields', () => {
    vi.mocked(loadProjectConfig).mockReturnValue({
      scenarios: { perIssueScenarioDirectory: 'custom/per-issue' },
    } as unknown as ReturnType<typeof loadProjectConfig>);

    const result = defaultsFor(makeFakeGitContext()).scenariosConfig();

    expect(loadProjectConfig).toHaveBeenCalledWith(SWEEP_WORKTREE);
    expect(result).toEqual({
      perIssueDir: 'custom/per-issue',
      regressionDir: 'features/regression/',
      vocabPath: 'features/regression/vocabulary.md',
    });
  });

  it('degrades to hardcoded defaults when loadProjectConfig throws', () => {
    vi.mocked(loadProjectConfig).mockImplementation(() => { throw new Error('boom'); });

    expect(defaultsFor(makeFakeGitContext()).scenariosConfig()).toEqual({
      perIssueDir: 'features/per-issue',
      regressionDir: 'features/regression/',
      vocabPath: 'features/regression/vocabulary.md',
    });
  });

  it('degrades to hardcoded defaults without a sweep base and loads no config', () => {
    expect(defaultsFor(makeFakeGitContext(), { withBase: false }).scenariosConfig()).toEqual({
      perIssueDir: 'features/per-issue',
      regressionDir: 'features/regression/',
      vocabPath: 'features/regression/vocabulary.md',
    });
    expect(loadProjectConfig).not.toHaveBeenCalled();
  });
});

describe('loadVocabulary', () => {
  it('reads the vocabulary file from the sweep worktree', () => {
    vi.mocked(readFileSync).mockReturnValue('## Given\n');

    const vocab = defaultsFor(makeFakeGitContext()).loadVocabulary('features/regression/vocabulary.md');

    expect(vocab).toBe('## Given\n');
    expect(readFileSync).toHaveBeenCalledWith(`${SWEEP_WORKTREE}/features/regression/vocabulary.md`, 'utf-8');
  });

  it('degrades to "" when readFileSync throws', () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

    expect(defaultsFor(makeFakeGitContext()).loadVocabulary('features/regression/vocabulary.md')).toBe('');
  });

  it('degrades to "" without a sweep base', () => {
    expect(defaultsFor(makeFakeGitContext(), { withBase: false }).loadVocabulary('features/regression/vocabulary.md')).toBe('');
  });
});
