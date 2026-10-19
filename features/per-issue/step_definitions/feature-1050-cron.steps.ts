/**
 * One poll of the cron's janitors, as the feature-1050 scenarios run it: the exported `runJanitorTick` of the cron module, in this
 * process, at a cycle that is the janitors' cadence or the cycle after it. The device janitor sweeps the stand-in device tools with
 * its own liveness and state checks, which find an ADW ID that left no state dead. The dev-server janitor sweeps an empty directory
 * of target repositories, so it reaches no real worktree and no real process. A real cron child is never used: it would run the
 * host's real device tools unless a cadence pin kept it from the janitors.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { JANITOR_INTERVAL_CYCLES } from '../../../adws/core/config.ts';
import { DEFAULT_DEPS as DEV_SERVER_JANITOR_DEPS, runJanitorPass } from '../../../adws/triggers/devServerJanitor.ts';
import { DEFAULT_DEPS, runDeviceJanitorPass } from '../../../adws/triggers/deviceJanitor.ts';

import { lineOf } from './feature-1047-commands.ts';
import { requireStandInHost } from './feature-1048-devices.ts';
import { assertNoneHeldUnderName, nameFor } from './feature-1050-devices.ts';
import { s } from './feature-1050-world.ts';

/** Imported here, not at load: importing the cron module resolves the checkout's own repository. */
async function pollAtCycle(cycle: number): Promise<void> {
  const cron = await import('../../../adws/triggers/trigger_cron.ts');
  const { executor, clock } = requireStandInHost();
  const emptyTargetRepos = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-1050-target-repos-'));
  s.directories.push(emptyTargetRepos);

  await cron.runJanitorTick(cycle, {
    devServers: () => runJanitorPass(DEV_SERVER_JANITOR_DEPS, emptyTargetRepos),
    devices: () => runDeviceJanitorPass({ ...DEFAULT_DEPS, devices: { executor, clock }, log: (message, level = 'info') => { s.lines.push({ level, message }); } }),
  });
}

When('the cron polls once, on a poll that runs its dev-server janitor', async function () {
  await pollAtCycle(JANITOR_INTERVAL_CYCLES);
});

When('the cron polls once, on a poll that does not run its dev-server janitor', async function () {
  await pollAtCycle(JANITOR_INTERVAL_CYCLES + 1);
});

Then("the cron's poll left no emulator, AVD or simulator of the ADW ID {string} on the host", function (adwId: string) {
  assertNoneHeldUnderName(requireStandInHost().held(), nameFor(adwId), `the ADW ID "${adwId}"`);
});

Then('the cron ran no device tool on that poll', function () {
  assert.deepStrictEqual(requireStandInHost().commands.map(lineOf), [], 'Expected the cron to have run no device tool on a poll that does not run its janitors');
});
