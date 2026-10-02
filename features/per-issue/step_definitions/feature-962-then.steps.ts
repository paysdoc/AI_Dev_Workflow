/**
 * Scenarios of feature-962.feature, the Then steps about what a run produced: each job's
 * conclusion, the artifact the host job uploaded, and what the suite left in its checkout. The job
 * phrases are defined for `host` and `docker` only, so that no other feature's job phrase collides
 * with them. A job the workflow does not define fails every one of them, naming the jobs the run
 * had. On failure the message shows every job's and step's conclusion and output.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { describeRun } from './feature-939-report.ts';
import type { Conclusion } from './feature-939-runner.ts';
import { reportedStepStatuses } from './feature-962-artifacts.ts';
import { jobOf } from './feature-962-jobs.ts';
import './feature-962-parameters.ts';
import type { JobId, ReportedStatus } from './feature-962-parameters.ts';
import { finishedRun, finishedSuiteRun } from './feature-962-world.ts';

function assertConclusion(id: JobId, expected: Conclusion, wanted: string): void {
  const job = jobOf(id);
  assert.strictEqual(job.conclusion, expected, `Expected the ${id} job to ${wanted}, but it concluded with ${job.conclusion}.\n${describeRun(finishedRun().result)}`);
}

Then('the {regressionJob} job fails', function (id: JobId) {
  assertConclusion(id, 'failure', 'fail');
});

Then('the {regressionJob} job succeeds', function (id: JobId) {
  assertConclusion(id, 'success', 'succeed');
});

Then('the {regressionJob} job runs', function (id: JobId) {
  const job = jobOf(id);
  assert.notStrictEqual(job.conclusion, 'skipped', `Expected the ${id} job to run, but it was skipped.\n${describeRun(finishedRun().result)}`);
});

Then('the {regressionJob} job does not run', function (id: JobId) {
  assertConclusion(id, 'skipped', 'be skipped');
});

Then(
  "the host job uploads the artifact {string}, which records the scenario's step as {reportedStepStatus}",
  function (name: string, recorded: ReportedStatus) {
    const run = finishedRun();
    const stored = run.artifacts.filter(artifact => artifact.jobId === 'host' && artifact.name === name);
    const stores = run.artifacts.map(artifact => `"${artifact.name}" by the ${artifact.jobId} job`).join(', ') || 'none';
    assert.ok(stored.length > 0, `Expected a step of the host job to store the artifact "${name}". Stored: ${stores}.\n${describeRun(run.result)}`);

    const reports = stored.flatMap(artifact => artifact.files).flatMap(file => reportedStepStatuses(file.content) ?? []);
    assert.deepStrictEqual(reports, [recorded], `Expected the artifact "${name}" to record the scenario's one step as ${recorded}.\n${describeRun(run.result)}`);
  },
);

Then('the @regression suite run passes', function () {
  const suiteRun = finishedSuiteRun();
  const ended = suiteRun.timedOut ? 'It was killed for running too long.' : `It exited ${suiteRun.exitCode}.`;
  assert.ok(!suiteRun.timedOut && suiteRun.exitCode === 0, `Expected the @regression suite run to pass. ${ended} Its output:\n${suiteRun.output}`);
});

Then('the checkout holds no file that was not there before the suite ran', function () {
  const { pathsBefore, pathsAfter } = finishedSuiteRun();
  const before = new Set(pathsBefore);
  const added = pathsAfter.filter(entry => !before.has(entry));
  assert.deepStrictEqual(added, [], `Expected the suite to leave the checkout as it found it, but it added: ${added.join(', ')}`);
});
