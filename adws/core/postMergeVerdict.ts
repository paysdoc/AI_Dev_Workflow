/**
 * Pure. What a re-run of the scenarios on a branch merged with the base branch came to, and what a merge that brought the
 * base in leaves for the comment that explains a red re-run. Nothing here logs or touches the disk.
 */

import type { ScenarioProofResult, TagProofResult } from '../proof/types';
import { DevServerStartStatus, type DevServerStart } from './devServerFailure';
import { describeFailingScenario } from './regressionTriage';
import type { TestCaseResult } from './testReportParser';

export interface PostMergeFailure {
  /** One line. */
  readonly title: string;
  /** The error or the output behind the title. */
  readonly detail: string;
}

export type PostMergeVerdict =
  | { readonly kind: 'green' }
  | { readonly kind: 'red'; readonly failures: readonly PostMergeFailure[] };

export type PostMergeScenarioRerun = () => Promise<PostMergeVerdict>;

export interface MergedInBase {
  /** `git log --oneline` lines: `<abbreviated hash> <subject>`. */
  readonly mergedCommits: readonly string[];
  readonly conflictedFiles: readonly string[];
}

export type PostMergeRed = MergedInBase & { readonly failures: readonly PostMergeFailure[] };

const GREEN: PostMergeVerdict = { kind: 'green' };
const NO_ERROR_MESSAGE = 'no error message in the report';

function isBlockingFailure(tag: TagProofResult): boolean {
  return tag.severity === 'blocker' && !tag.passed && !tag.skipped;
}

function caseFailure(tag: TagProofResult, failed: TestCaseResult): PostMergeFailure {
  return {
    title: `${tag.resolvedTag} ${describeFailingScenario({ name: failed.name, feature: failed.classname })}`,
    detail: failed.failureMessage ?? NO_ERROR_MESSAGE,
  };
}

// A tag that failed on its exit code alone, or left no report, has no case to name.
function tagFailure(tag: TagProofResult): PostMergeFailure {
  const exit = tag.exitCode === null ? 'no exit code' : `exit ${tag.exitCode}`;
  const report = tag.reportMissing ? ', no JUnit report was left' : '';
  return { title: `${tag.resolvedTag} failed (${exit}${report})`, detail: tag.output };
}

function failuresOfTag(tag: TagProofResult): PostMergeFailure[] {
  const failedCases = (tag.cases ?? []).filter((each) => each.status === 'failed');
  return failedCases.length > 0 ? failedCases.map((each) => caseFailure(tag, each)) : [tagFailure(tag)];
}

export function failuresOfProof(proof: ScenarioProofResult): PostMergeFailure[] {
  return proof.tagResults.filter(isBlockingFailure).flatMap(failuresOfTag);
}

/** A dev server that did not start is red because no scenario ran on the merged code, which is no proof. */
export function postMergeVerdict(result: {
  readonly scenarioProof: ScenarioProofResult | undefined;
  readonly devServer: DevServerStart;
}): PostMergeVerdict {
  const { scenarioProof, devServer } = result;
  if (devServer.status === DevServerStartStatus.Failed) {
    return { kind: 'red', failures: [{ title: `dev server did not start: ${devServer.command}`, detail: devServer.output }] };
  }
  if (scenarioProof === undefined || !scenarioProof.hasBlockerFailures) return GREEN;
  return { kind: 'red', failures: failuresOfProof(scenarioProof) };
}

/**
 * A push that failed, or a base that moved, carries the commits of an earlier merge into the next attempt's re-run. Always a
 * new value of exactly this shape: whatever else a merge result carries is not part of what the comment is built from.
 */
export function combineMergedIn(previous: MergedInBase | null, next: MergedInBase): MergedInBase {
  return {
    mergedCommits: [...(previous?.mergedCommits ?? []), ...next.mergedCommits],
    conflictedFiles: [...new Set([...(previous?.conflictedFiles ?? []), ...next.conflictedFiles])],
  };
}
