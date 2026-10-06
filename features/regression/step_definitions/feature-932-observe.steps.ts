import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { spawnRealCron, waitForRealCron } from '../../regression/step_definitions/realCronProcess.ts';
import {
  CRON_STARTUP_WAIT_MS,
  CRON_TICK_WAIT_MS,
  LABEL_WAIT_MS,
  LAUNCH_WAIT_MS,
  bunxBinDir,
  classifierConsulted,
  describeLaunches,
  ghBinDir,
  installGhShadow,
  launchesFor,
  readArgvRecords,
  s,
  waitFor,
} from './feature-932-world.ts';

Then('no ADW run was started for issue {int}', function (issueNumber: number) {
  assert.deepStrictEqual(launchesFor(issueNumber), [], `Expected no ADW run for issue ${issueNumber}, recorded: ${describeLaunches()}`);
});

Then('exactly one ADW run was started for issue {int}', async function (issueNumber: number) {
  await waitFor(() => launchesFor(issueNumber).length > 0, LAUNCH_WAIT_MS, `an ADW run for issue ${issueNumber}`);
  assert.strictEqual(launchesFor(issueNumber).length, 1, `Expected exactly one ADW run for issue ${issueNumber}, recorded: ${describeLaunches()}`);
});

Then('the ADW run started for issue {int} runs the orchestrator {string}', function (issueNumber: number, script: string) {
  const [launch] = launchesFor(issueNumber);
  assert.ok(launch, `Expected an ADW run for issue ${issueNumber}, recorded: ${describeLaunches()}`);
  assert.strictEqual(launch.script, script, `Expected issue ${issueNumber} to run ${script}, ran: ${launch.argv.join(' ')}`);
});

Then('the issue classifier was not consulted for issue {int}', function (issueNumber: number) {
  assert.ok(!classifierConsulted(issueNumber), `Expected the issue classifier not to be consulted for issue ${issueNumber}`);
});

Then('the issue classifier was consulted for issue {int}', async function (issueNumber: number) {
  await waitFor(() => classifierConsulted(issueNumber), LAUNCH_WAIT_MS, `the issue classifier to be consulted for issue ${issueNumber}`);
});

Given('the forge refuses to create labels', function () {
  s.forgeRefusesLabels = true;
});

/** The bunx shadow must stay off the PATH here: it would swallow the launch of the cron itself. */
When('a cron trigger process is launched with --target-repo {string}', function (repoKey: string) {
  assert.ok(
    !(process.env['PATH'] ?? '').split(path.delimiter).includes(bunxBinDir()),
    'Expected the bunx shadow to be off the PATH while a real cron process is launched',
  );
  installGhShadow(s.forgeRefusesLabels);
  s.cronTargetReposDir = fs.mkdtempSync(path.join(tmpdir(), 'adw-932-cron-targets-'));
  spawnRealCron(s.cron, repoKey, {
    PATH: `${ghBinDir()}${path.delimiter}${process.env['PATH'] ?? ''}`,
    TARGET_REPOS_DIR: s.cronTargetReposDir,
  });
});

function labelsAskedOn(repoKey: string): string[] {
  return readArgvRecords('gh-label')
    .filter((args) => args[args.indexOf('--repo') + 1] === repoKey && args.includes('--force'))
    .map((args) => args[2] ?? '');
}

async function waitForLabelCreations(repoKey: string, table: DataTable): Promise<void> {
  const wanted = table.hashes().map((row) => row['label'] ?? '');
  const missing = () => wanted.filter((label) => !labelsAskedOn(repoKey).includes(label));
  await waitFor(() => missing().length === 0, LABEL_WAIT_MS, `the forge to be asked for ${wanted.join(', ')} on ${repoKey}`);
}

Then('the repository {string} has each of these labels:', function (repoKey: string, table: DataTable) {
  return waitForLabelCreations(repoKey, table);
});

Then(
  'the forge was asked to create each of these labels on the repository {string}:',
  function (repoKey: string, table: DataTable) {
    return waitForLabelCreations(repoKey, table);
  },
);

Then(
  'the cron trigger process launched with --target-repo {string} completes its first poll tick',
  async function (repoKey: string) {
    assert.strictEqual(s.cron.repoKey, repoKey, `Expected the cron launched for ${repoKey}`);
    await waitForRealCron(s.cron, () => s.cron.stdout.includes('CRON trigger (backlog sweeper) started'), CRON_STARTUP_WAIT_MS, 'the cron startup line');
    await waitForRealCron(
      s.cron,
      () => s.cron.stdout.includes('POLL:') || s.cron.stdout.includes('checkAndTrigger: tick failed'),
      CRON_TICK_WAIT_MS,
      'the first poll tick',
    );
  },
);
