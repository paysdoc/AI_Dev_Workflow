import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPromotionSweep } from '../promotionSweep';
import { harness, writesOf, filedSpecs, TODAY, PATH_612, PATH_613, QUALIFYING_SCORE_6, SCORE_4 } from './fixtures/promotionSweepHarness';

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
