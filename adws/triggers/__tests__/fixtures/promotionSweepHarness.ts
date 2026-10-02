import { vi } from 'vitest';
import type { PromotionSweepDeps } from '../../promotionSweep';
import type { MarkerWrite } from '../../promotionSweepDefaults';
import type { PromotionIssueSpec } from '../../../core/promotionIssueBody';
import type { PromotionIssueRef } from '../../../core/promotionReconcileLink';
import type { LaunchBoundary } from '../../../core';

export const TODAY = '2026-10-02';
export const NOW = new Date(`${TODAY}T09:00:00Z`);
export const PATH_612 = 'features/per-issue/feature-612.feature';
export const PATH_613 = 'features/per-issue/feature-613.feature';

export const VOCABULARY = [
  '## When',
  '',
  '| # | Phrase | Semantics | Pattern | Assertion target |',
  '|---|--------|-----------|---------|------------------|',
  '| W1 | `the sweep runs` | runs the sweep once | subprocess | the sweep report |',
].join('\n');

/** One matched subprocess When scores 3; each extra When / And-after-When step adds 1. */
export function whenSteps(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${i === 0 ? 'When' : 'And'} the sweep runs`);
}

export function featureFile(whenCount: number, tagLine?: string): string {
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

export const QUALIFYING_SCORE_6 = featureFile(4);
export const SCORE_4 = featureFile(2);
export const BELOW_THRESHOLD = featureFile(0);

export function promotionIssue(featureNumber: number, state: string, number = 801): PromotionIssueRef {
  return { number, body: `Promotes: feature-${featureNumber}`, state, labels: [] };
}

export interface Harness {
  deps: PromotionSweepDeps;
  calls: string[];
  persistMarkers: ReturnType<typeof vi.fn>;
  fileIssue: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

export function harness(
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

export function writesOf(h: Harness): readonly MarkerWrite[] {
  return h.persistMarkers.mock.calls[0][0] as readonly MarkerWrite[];
}

export function filedSpecs(h: Harness): PromotionIssueSpec[] {
  return h.fileIssue.mock.calls.map(([spec]) => spec as PromotionIssueSpec);
}
