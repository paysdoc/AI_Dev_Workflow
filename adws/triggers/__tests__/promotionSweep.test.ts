import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../perIssueSweepPersist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../perIssueSweepPersist')>();
  return { ...actual, prepareSweepBase: vi.fn(), cleanupSweepBase: vi.fn() };
});

import { runPromotionSweep } from '../promotionSweep';
import type { PromotionSweepDeps } from '../promotionSweep';
import { PROMOTION_SWEEP_SPEC } from '../promotionSweepDefaults';
import type { MarkerWrite } from '../promotionSweepDefaults';
import { prepareSweepBase, cleanupSweepBase } from '../perIssueSweepPersist';
import type { SweepBase } from '../perIssueSweepPersist';
import type { PromotionIssueSpec } from '../../core/promotionIssueBody';
import type { PromotionIssueRef } from '../../core/promotionReconcileLink';
import type { LaunchBoundary } from '../../core';

const TODAY = '2026-10-02';
const NOW = new Date(`${TODAY}T09:00:00Z`);
const PATH_612 = 'features/per-issue/feature-612.feature';
const PATH_613 = 'features/per-issue/feature-613.feature';

const VOCABULARY = [
  '## When',
  '',
  '| # | Phrase | Semantics | Pattern | Assertion target |',
  '|---|--------|-----------|---------|------------------|',
  '| W1 | `the sweep runs` | runs the sweep once | subprocess | the sweep report |',
].join('\n');

/** One matched subprocess When scores 3; each extra When / And-after-When step adds 1. */
function whenSteps(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${i === 0 ? 'When' : 'And'} the sweep runs`);
}

function featureFile(whenCount: number, tagLine?: string): string {
  return [
    ...(tagLine ? [tagLine] : []),
    'Feature: Fixture',
    '',
    '  Scenario: best',
    '    Given a target',
    ...whenSteps(whenCount).map(step => `    ${step}`),
    '    Then the report holds the result',
    '',
  ].join('\n');
}

const QUALIFYING_SCORE_6 = featureFile(4);
const SCORE_4 = featureFile(2);
const BELOW_THRESHOLD = featureFile(0);

function promotionIssue(featureNumber: number, state: string, number = 801): PromotionIssueRef {
  return { number, body: `Promotes: feature-${featureNumber}`, state, labels: [] };
}

interface Harness {
  deps: PromotionSweepDeps;
  calls: string[];
  persistMarkers: ReturnType<typeof vi.fn>;
  fileIssue: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

function harness(
  files: Record<string, string>,
  overrides: Partial<PromotionSweepDeps> & { landed?: boolean | Error } = {},
): Harness {
  const { landed = true, ...depOverrides } = overrides;
  const calls: string[] = [];
  const persistMarkers = vi.fn(async (_writes: readonly MarkerWrite[]) => {
    calls.push('persistMarkers');
    if (landed instanceof Error) throw landed;
    return landed;
  });
  const fileIssue = vi.fn((_spec: PromotionIssueSpec) => { calls.push('fileIssue'); });
  const log = vi.fn();
  const deps: PromotionSweepDeps = {
    boundary: { gitContext: {}, providers: { issueTracker: {}, codeHost: {} } } as unknown as LaunchBoundary,
    now: () => NOW,
    listPerIssueFeatures: () => Object.keys(files),
    readFeatureContent: (filePath) => files[filePath] ?? null,
    listStepDefSiblings: (featureNumber) => [`features/per-issue/step_definitions/feature-${featureNumber}.steps.ts`],
    loadVocabulary: () => VOCABULARY,
    loadStats: () => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 }),
    listPromotionIssues: () => [],
    scenariosConfig: { perIssueDir: 'features/per-issue', regressionDir: 'features/regression/', vocabPath: 'features/regression/vocabulary.md' },
    persistMarkers,
    fileIssue,
    log,
    ...depOverrides,
  };
  return { deps, calls, persistMarkers, fileIssue, log };
}

function writesOf(h: Harness): readonly MarkerWrite[] {
  return h.persistMarkers.mock.calls[0][0] as readonly MarkerWrite[];
}

function filedSpecs(h: Harness): PromotionIssueSpec[] {
  return h.fileIssue.mock.calls.map(([spec]) => spec as PromotionIssueSpec);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runPromotionSweep — originate', () => {
  it('lands the suggested marker through one persistMarkers call, then files the issue', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 });

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).toHaveBeenCalledTimes(1);
    expect(writesOf(h)).toHaveLength(1);
    expect(writesOf(h)[0].filePath).toBe(PATH_612);
    expect(writesOf(h)[0].content).toContain(`@promotion-suggested-${TODAY}`);
    expect(writesOf(h)[0].message).toBe('chore: mark feature-612 promotion-suggested');
    expect(h.calls).toEqual(['persistMarkers', 'fileIssue']);
    expect(filedSpecs(h)[0].body.startsWith('Promotes: feature-612')).toBe(true);
    expect(report.originated).toEqual([612]);
  });

  it('files the issue only after persistMarkers has resolved, not while it is pending', async () => {
    let release: (landed: boolean) => void = () => {};
    const persistMarkers = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 }, { persistMarkers });

    const sweep = runPromotionSweep(h.deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.fileIssue).not.toHaveBeenCalled();

    release(true);
    await sweep;
    expect(h.fileIssue).toHaveBeenCalledTimes(1);
  });

  it('files no issue and reports nothing originated when the marker did not land', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 }, { landed: false });

    const report = await runPromotionSweep(h.deps);

    expect(h.fileIssue).not.toHaveBeenCalled();
    expect(report.originated).toEqual([]);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('did not reach the default branch'), 'warn');
  });

  it('files no issue and still resolves when persistMarkers rejects', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 }, { landed: new Error('git push failed') });

    const report = await runPromotionSweep(h.deps);

    expect(h.fileIssue).not.toHaveBeenCalled();
    expect(report.originated).toEqual([]);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('git push failed'), 'warn');
  });

  it('lands two candidates in one batch, then files both issues', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6, [PATH_613]: QUALIFYING_SCORE_6 });

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).toHaveBeenCalledTimes(1);
    expect(writesOf(h).map(write => write.filePath)).toEqual([PATH_612, PATH_613]);
    expect(h.calls).toEqual(['persistMarkers', 'fileIssue', 'fileIssue']);
    expect(report.originated).toEqual([612, 613]);
  });

  it('keeps the landed marker and reports nothing originated when filing the issue throws', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 }, {
      fileIssue: vi.fn(() => { throw new Error('gh: issue create failed'); }),
    });

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).toHaveBeenCalledTimes(1);
    expect(report.originated).toEqual([]);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('gh: issue create failed'), 'warn');
  });

  it('builds the issue from the sweep worktree facts: step-def siblings, destination directory, vocabulary path and score', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 }, {
      scenariosConfig: { perIssueDir: 'features/per-issue', regressionDir: 'features/regression-suite/', vocabPath: 'features/regression-suite/vocabulary.md' },
    });

    await runPromotionSweep(h.deps);

    const { body, labels } = filedSpecs(h)[0];
    expect(body).toContain('git mv features/per-issue/step_definitions/feature-612.steps.ts features/regression-suite/step_definitions/feature-612.steps.ts');
    expect(body).toContain('features/regression-suite/vocabulary.md');
    expect(body).toContain('(score: 6)');
    expect(labels).toEqual(['adw:feature', 'regression-promotion', 'hitl']);
  });

  it('describes per-issue scenarios as run by their own workflow, not as input-only or never executed', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 });

    await runPromotionSweep(h.deps);

    const { body } = filedSpecs(h)[0];
    expect(body).not.toContain('never executed');
    expect(body).not.toContain('input-only');
    expect(body).toContain('@adw-612');
    expect(body).toContain("workflow's test phase");
  });

  it('tells the agent to remove the @adw- tags and re-scope their hooks, instead of keeping the existing tags', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 });

    await runPromotionSweep(h.deps);

    const { body } = filedSpecs(h)[0];
    expect(body).toMatch(/Remove the `@adw-` tags from the moved feature file, at feature and scenario level/);
    expect(body).toMatch(/`Before`\/`After` hook[^\n]*@adw-[^\n]*re-scope it to a descriptive tag/);
    expect(body).not.toContain('keep its existing tags');
    expect(body).toContain('Add a feature-level `@regression` tag to the moved feature file.');
  });

  it('carries no HTML comment', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 });

    await runPromotionSweep(h.deps);

    expect(filedSpecs(h)[0].body).not.toContain('<!--');
  });
});

describe('runPromotionSweep — decline, withdraw and redrive', () => {
  const suggested = (whenCount: number) => featureFile(whenCount, '@promotion-suggested-2026-09-22');

  it('declines a suggestion whose tracker closed unmerged, writing @promotion-declined and filing nothing', async () => {
    const h = harness({ [PATH_612]: suggested(4) }, { listPromotionIssues: () => [promotionIssue(612, 'CLOSED')] });

    const report = await runPromotionSweep(h.deps);

    expect(writesOf(h)).toHaveLength(1);
    expect(writesOf(h)[0].content).toContain('@promotion-declined');
    expect(writesOf(h)[0].content).not.toContain('@promotion-suggested-');
    expect(writesOf(h)[0].message).toBe('chore: mark feature-612 promotion-declined');
    expect(h.fileIssue).not.toHaveBeenCalled();
    expect(report.declined).toEqual([PATH_612]);
  });

  it('reports a decline only when it landed', async () => {
    const h = harness({ [PATH_612]: suggested(4) }, { landed: false, listPromotionIssues: () => [promotionIssue(612, 'CLOSED')] });

    const report = await runPromotionSweep(h.deps);

    expect(report.declined).toEqual([]);
  });

  it('withdraws a suggestion that no longer qualifies and has no tracker, removing every promotion marker', async () => {
    const h = harness({ [PATH_612]: suggested(0) });

    const report = await runPromotionSweep(h.deps);

    expect(writesOf(h)).toHaveLength(1);
    expect(writesOf(h)[0].content).not.toContain('@promotion-suggested-');
    expect(writesOf(h)[0].content).not.toContain('@promotion-declined');
    expect(writesOf(h)[0].message).toBe('chore: withdraw feature-612 promotion suggestion');
    expect(h.fileIssue).not.toHaveBeenCalled();
    expect(report.withdrawn).toEqual([PATH_612]);
  });

  it('reports a withdrawal only when it landed', async () => {
    const h = harness({ [PATH_612]: suggested(0) }, { landed: false });

    const report = await runPromotionSweep(h.deps);

    expect(report.withdrawn).toEqual([]);
  });

  it('redrives a stranded qualifying suggestion by filing its issue, without persisting any marker', async () => {
    const h = harness({ [PATH_612]: suggested(4) });

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).not.toHaveBeenCalled();
    expect(h.fileIssue).toHaveBeenCalledTimes(1);
    expect(filedSpecs(h)[0].body.startsWith('Promotes: feature-612')).toBe(true);
    expect(report.redriven).toEqual([612]);
  });

  it('files a redrive even when a marker batch in the same sweep did not land', async () => {
    const h = harness({ [PATH_612]: suggested(4), [PATH_613]: QUALIFYING_SCORE_6 }, { landed: false });

    const report = await runPromotionSweep(h.deps);

    expect(report.redriven).toEqual([612]);
    expect(report.originated).toEqual([]);
    expect(filedSpecs(h)).toHaveLength(1);
  });

  it('lands an originate and a decline in the same single batch', async () => {
    const h = harness(
      { [PATH_612]: suggested(4), [PATH_613]: QUALIFYING_SCORE_6 },
      { listPromotionIssues: () => [promotionIssue(612, 'CLOSED')] },
    );

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).toHaveBeenCalledTimes(1);
    expect(writesOf(h).map(write => write.filePath)).toEqual([PATH_612, PATH_613]);
    expect(report.declined).toEqual([PATH_612]);
    expect(report.originated).toEqual([613]);
  });

  it('reports a redrive as failed when filing its issue throws', async () => {
    const h = harness({ [PATH_612]: suggested(4) }, { fileIssue: vi.fn(() => { throw new Error('gh down'); }) });

    const report = await runPromotionSweep(h.deps);

    expect(report.redriven).toEqual([]);
  });
});

describe('runPromotionSweep — leaving and skipping', () => {
  it('does not call persistMarkers when no candidate needs a marker change', async () => {
    const h = harness({ [PATH_612]: BELOW_THRESHOLD });

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).not.toHaveBeenCalled();
    expect(h.fileIssue).not.toHaveBeenCalled();
    expect(report.left).toEqual([PATH_612]);
  });

  it('leaves a declined file alone however well it scores', async () => {
    const h = harness({ [PATH_612]: featureFile(4, '@promotion-declined') });

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).not.toHaveBeenCalled();
    expect(report.left).toEqual([PATH_612]);
  });

  it('leaves a candidate whose promotion issue is already open', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 }, { listPromotionIssues: () => [promotionIssue(612, 'OPEN')] });

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).not.toHaveBeenCalled();
    expect(report.left).toEqual([PATH_612]);
  });

  it('skips an unrecognised filename with a warning', async () => {
    const h = harness({ 'features/per-issue/notes.feature': QUALIFYING_SCORE_6 });

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).not.toHaveBeenCalled();
    expect(report).toMatchObject({ originated: [], left: [] });
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('unrecognised filename'), 'warn');
  });

  it('skips a file that cannot be read', async () => {
    const h = harness({ [PATH_612]: QUALIFYING_SCORE_6 }, { readFeatureContent: () => null });

    await runPromotionSweep(h.deps);

    expect(h.persistMarkers).not.toHaveBeenCalled();
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('could not read'), 'warn');
  });

  it('skips a file that is not valid Gherkin', async () => {
    const h = harness({ [PATH_612]: 'this is not gherkin at all <<<BROKEN>>>' });

    await runPromotionSweep(h.deps);

    expect(h.persistMarkers).not.toHaveBeenCalled();
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('failed to parse'), 'warn');
  });

  it('reports an empty sweep when there are no candidates', async () => {
    const h = harness({});

    const report = await runPromotionSweep(h.deps);

    expect(h.persistMarkers).not.toHaveBeenCalled();
    expect(report).toEqual({ originated: [], redriven: [], declined: [], withdrawn: [], left: [], threshold: 3 });
  });
});

describe('runPromotionSweep — threshold', () => {
  it('reports the threshold the sweep scored against', async () => {
    const h = harness({}, { loadStats: () => ({ promotedCount90d: 2, totalPerIssueCount90d: 8 }) });

    expect((await runPromotionSweep(h.deps)).threshold).toBe(5);
  });

  it('suggests a score-4 candidate at the bootstrap threshold of 3', async () => {
    const h = harness({ [PATH_612]: SCORE_4 });

    const report = await runPromotionSweep(h.deps);

    expect(report.threshold).toBe(3);
    expect(report.originated).toEqual([612]);
  });

  it('leaves the same score-4 candidate alone once two merged promotions raised the threshold to 5', async () => {
    const h = harness({ [PATH_612]: SCORE_4 }, { loadStats: () => ({ promotedCount90d: 2, totalPerIssueCount90d: 8 }) });

    const report = await runPromotionSweep(h.deps);

    expect(report.threshold).toBe(5);
    expect(report.left).toEqual([PATH_612]);
    expect(h.persistMarkers).not.toHaveBeenCalled();
    expect(h.fileIssue).not.toHaveBeenCalled();
  });
});

describe('runPromotionSweep — sweep worktree lifecycle', () => {
  const fakeBase = (): SweepBase => ({
    ctx: { lsFiles: vi.fn(() => []) },
    worktreePath: '/sweep-worktree',
  }) as unknown as SweepBase;

  it('never creates a sweep worktree for a fully injected caller', async () => {
    await runPromotionSweep(harness({ [PATH_612]: QUALIFYING_SCORE_6 }).deps);

    expect(prepareSweepBase).not.toHaveBeenCalled();
    expect(cleanupSweepBase).not.toHaveBeenCalled();
  });

  it('creates the worktree once, on the promotion sweep branch, when a default needs it, and tears it down', async () => {
    const base = fakeBase();
    vi.mocked(prepareSweepBase).mockReturnValue(base);
    const h = harness({}, { listPerIssueFeatures: undefined, scenariosConfig: undefined });

    await runPromotionSweep(h.deps);

    expect(prepareSweepBase).toHaveBeenCalledTimes(1);
    expect(prepareSweepBase).toHaveBeenCalledWith(h.deps.boundary, PROMOTION_SWEEP_SPEC);
    expect(cleanupSweepBase).toHaveBeenCalledTimes(1);
    expect(cleanupSweepBase).toHaveBeenCalledWith(base);
  });

  it('tears the worktree down when a collaborator throws', async () => {
    const base = fakeBase();
    vi.mocked(prepareSweepBase).mockReturnValue(base);
    const h = harness({}, {
      scenariosConfig: undefined,
      loadStats: () => { throw new Error('boom'); },
    });

    await expect(runPromotionSweep(h.deps)).rejects.toThrow('boom');

    expect(cleanupSweepBase).toHaveBeenCalledWith(base);
  });

  it('degrades to an empty sweep when the worktree cannot be prepared', async () => {
    vi.mocked(prepareSweepBase).mockReturnValue(null);
    const h = harness({}, { listPerIssueFeatures: undefined, scenariosConfig: undefined });

    const report = await runPromotionSweep(h.deps);

    expect(report).toMatchObject({ originated: [], redriven: [], declined: [], withdrawn: [], left: [] });
    expect(cleanupSweepBase).not.toHaveBeenCalled();
  });
});
