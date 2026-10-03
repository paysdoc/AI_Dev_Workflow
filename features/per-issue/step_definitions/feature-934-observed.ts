/**
 * What the Then steps of feature-934 read back from a run: the promotion issues the sweep filed
 * for a feature and the pull requests it got merged, both derived from the forge's ordered event
 * log, plus the sweep's report.
 */

import assert from 'assert';

import type { PromotionSweepReport } from '../../../adws/triggers/promotionSweep.ts';
import type { FakeForge } from './feature-934-forge.ts';
import { world } from './feature-934-world.ts';

export interface FiledIssue {
  readonly number: number;
  readonly body: string;
  readonly labels: readonly string[];
  /** Position in the forge's event log. */
  readonly at: number;
}

export interface MergedPullRequest {
  readonly number: number;
  readonly sourceBranch: string;
  readonly files: readonly string[];
  readonly at: number;
}

export function requireReport(): PromotionSweepReport {
  assert.ok(world.report, 'Expected the promotion sweep to have run first');
  return world.report;
}

/** The issues the sweep filed with a `Promotes: feature-<n>` back-link, in filing order. */
export function filedIssues(forge: FakeForge, featureNumber: number): FiledIssue[] {
  const backLink = new RegExp(`^Promotes: feature-${featureNumber}$`, 'm');
  return forge.events.flatMap((event, at) => {
    if (event.kind !== 'issue-created' || !backLink.test(event.body)) return [];
    const labels = forge.events.flatMap(other => (other.kind === 'label-applied' && other.issue === event.number ? [other.label] : []));
    return [{ number: event.number, body: event.body, labels, at }];
  });
}

export function mergedPullRequests(forge: FakeForge): MergedPullRequest[] {
  return forge.events.flatMap((event, at) =>
    event.kind === 'pr-merged' ? [{ number: event.number, sourceBranch: event.sourceBranch, files: event.files, at }] : []);
}

export function onlyFiledIssue(forge: FakeForge, featureNumber: number): FiledIssue {
  const filed = filedIssues(forge, featureNumber);
  assert.strictEqual(filed.length, 1, `Expected exactly one promotion issue for feature-${featureNumber}, found ${filed.length}`);
  return filed[0];
}
