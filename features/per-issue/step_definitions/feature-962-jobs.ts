/**
 * A job of the finished workflow run, by id. A job the workflow does not define fails the
 * assertion that asked for it, and the message names the jobs the run had.
 */

import assert from 'assert';

import { describeRun } from './feature-939-report.ts';
import type { JobResult } from './feature-939-runner.ts';
import type { JobId } from './feature-962-parameters.ts';
import { finishedRun } from './feature-962-world.ts';

export function jobOf(id: JobId): JobResult {
  const { result } = finishedRun();
  const job = result.jobs.find(candidate => candidate.id === id);
  if (job !== undefined) return job;

  const had = result.jobs.length === 0 ? 'no jobs' : `the jobs ${result.jobs.map(candidate => `"${candidate.id}"`).join(', ')}`;
  return assert.fail(`Expected the workflow to define the job "${id}", but the run had ${had}.\n${describeRun(result)}`);
}
