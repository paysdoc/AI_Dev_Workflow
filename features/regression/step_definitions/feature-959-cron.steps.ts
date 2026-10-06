/**
 * One poll is the exported `checkAndTrigger(boundary)` of feature-932's cron rows, run after the
 * hung-orchestrator sweep over this scenario's adwIds only. `bunx` is shadowed for the poll so no
 * orchestrator ever starts: a recorder writes each launch's argv and exits.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';

import { defaultHungDetectorDeps } from '../../../adws/core/hungOrchestratorDetector.ts';
import { readSpawnLockRecord } from '../../../adws/triggers/spawnGate.ts';
import {
  LAUNCH_WAIT_MS,
  bunxBinDir,
  describeLaunches,
  launchesFor,
  requireBoundary,
  restoreEnv,
  waitFor,
} from './feature-932-world.ts';
import { spawnLockIdentities, useBenignGitContext } from './feature-959-boundary.ts';
import { isOrchestratorProcessAlive } from './feature-959-processes.ts';
import { requireWorkflow, s } from './feature-959-world.ts';

/** A launch the recorder has not yet written, or one more than the cron means to make, lands within this. */
const QUIET_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Imported here, not at load: importing the cron module resolves the checkout's own repository. */
async function pollOnce(): Promise<void> {
  const boundary = useBenignGitContext();
  const cron = await import('../../../adws/triggers/trigger_cron.ts');
  cron.runHungDetectorSweep(Date.now(), { ...defaultHungDetectorDeps, listAdwIds: () => [...s.workflows.keys()] });

  const savedPath = process.env['PATH'];
  process.env['PATH'] = `${bunxBinDir()}${path.delimiter}${savedPath ?? ''}`;
  try {
    await cron.checkAndTrigger(boundary);
  } finally {
    restoreEnv('PATH', savedPath);
  }
  if (s.triggerArmed) assert.ok(s.triggerFired, 'Expected the orchestrator to record "starting" while the cron was deciding');
}

When('the cron polls from that boundary, with its hung-orchestrator sweep due', pollOnce);

When('the same cron polls again from that boundary, with its hung-orchestrator sweep due', pollOnce);

Then('the cron has launched {int} orchestrator(s) for issue {int}', async function (count: number, issueNumber: number) {
  await waitFor(() => launchesFor(issueNumber).length >= count, LAUNCH_WAIT_MS, `${count} launch(es) for issue ${issueNumber}`);
  await sleep(QUIET_MS);
  assert.strictEqual(
    launchesFor(issueNumber).length,
    count,
    `Expected ${count} orchestrator launch(es) for issue ${issueNumber}, recorded: ${describeLaunches()}`,
  );
});

Then('the cron launched no orchestrator for issue {int}', async function (issueNumber: number) {
  await sleep(QUIET_MS);
  assert.deepStrictEqual(launchesFor(issueNumber), [], `Expected no orchestrator for issue ${issueNumber}, recorded: ${describeLaunches()}`);
});

Then(
  'every orchestrator the cron launched for issue {int} runs {string} under adwId {string}',
  function (issueNumber: number, script: string, adwId: string) {
    const launches = launchesFor(issueNumber);
    assert.ok(launches.length > 0, `Expected the cron to have launched an orchestrator for issue ${issueNumber}`);
    for (const launch of launches) {
      assert.strictEqual(launch.script, script, `Expected issue ${issueNumber} to run ${script}, ran: ${launch.argv.join(' ')}`);
      assert.strictEqual(launch.argv[3], adwId, `Expected issue ${issueNumber} to run under adwId ${adwId}, ran: ${launch.argv.join(' ')}`);
    }
  },
);

Then('the orchestrator process of workflow {string} is still alive', function (adwId: string) {
  const { process: owner } = requireWorkflow(adwId);
  assert.ok(owner, `Expected the orchestrator of workflow ${adwId} to have been started`);
  assert.ok(isOrchestratorProcessAlive(owner), `Expected the orchestrator of workflow ${adwId} (pid ${owner.pid}) to be alive`);
});

Then('the worktree of workflow {string} was not reset', function (adwId: string) {
  const { branchName } = requireWorkflow(adwId);
  const worktreePath = requireBoundary().gitContext.worktreePathFor(branchName);
  const resets = s.resets.filter((reset) => reset.branch === branchName || reset.worktreePath === worktreePath);
  assert.deepStrictEqual(resets, [], `Expected no reset of ${branchName}, recorded: ${JSON.stringify(s.resets)}`);
});

Then('nothing but the orchestrator of workflow {string} holds the issue\'s spawn lock', function (adwId: string) {
  const { issueNumber, process: owner } = requireWorkflow(adwId);
  for (const identity of spawnLockIdentities()) {
    const holder = readSpawnLockRecord(identity, issueNumber);
    assert.ok(
      holder === null || holder.pid === owner?.pid,
      `Expected only the orchestrator (pid ${owner?.pid}) to hold the lock for ${identity.owner}/${identity.repo}#${issueNumber}, pid ${holder?.pid} holds it`,
    );
  }
});
