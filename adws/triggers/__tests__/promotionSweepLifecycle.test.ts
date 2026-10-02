import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPromotionSweep } from '../promotionSweep';
import {
  harness, writesOf, filedSpecs, featureFile, promotionIssue,
  PATH_612, PATH_613, QUALIFYING_SCORE_6, BELOW_THRESHOLD,
} from './fixtures/promotionSweepHarness';

beforeEach(() => {
  vi.clearAllMocks();
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
