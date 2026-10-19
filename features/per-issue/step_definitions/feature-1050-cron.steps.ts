/**
 * One poll of the cron's janitors, as the feature-1050 scenarios run it: the exported `runJanitorTick` of the cron module, in this
 * process, with the cron's own janitor passes, at a cycle that is the janitors' cadence or the cycle after it. Only the host's device
 * tools are replaced, by stand-in programs that lead `PATH` for the poll, so the device janitor reaches them through the lifecycle's
 * own executor and never the host's real tools. Its own liveness and state checks find an ADW ID that left no state dead. The
 * dev-server janitor sweeps the suite's empty directory of target repositories. A real cron child is never used: it would run the
 * host's real device tools unless a cadence pin kept it from the janitors.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';

import { JANITOR_INTERVAL_CYCLES } from '../../../adws/core/config.ts';

import { lineOf } from './feature-1047-commands.ts';
import { assertNoneHeldUnderName, nameFor } from './feature-1050-devices.ts';
import type { StandInDeviceTools } from './feature-1050-tools.ts';
import { s } from './feature-1050-world.ts';

function requireDeviceTools(): StandInDeviceTools {
  assert.ok(s.deviceTools, "Expected the scenario to have replaced the host's device tools with stand-ins first");
  return s.deviceTools;
}

/** Imported here, not at load: importing the cron module resolves the checkout's own repository. */
async function pollAtCycle(cycle: number): Promise<void> {
  const cron = await import('../../../adws/triggers/trigger_cron.ts');
  const tools = requireDeviceTools();
  await tools.onPath(() => cron.runJanitorTick(cycle));
  assert.ok(!(process.env.PATH ?? '').split(path.delimiter).includes(tools.binDir), 'Expected the stand-in device tools to have left PATH once the poll was over');
}

When('the cron polls once, on a poll that runs its dev-server janitor', async function () {
  await pollAtCycle(JANITOR_INTERVAL_CYCLES);
});

When('the cron polls once, on a poll that does not run its dev-server janitor', async function () {
  await pollAtCycle(JANITOR_INTERVAL_CYCLES + 1);
});

Then("the cron's poll left no emulator, AVD or simulator of the ADW ID {string} on the host", function (adwId: string) {
  const { leftovers, held } = requireDeviceTools();
  const name = nameFor(adwId);
  assert.ok(leftovers.avds.includes(name) || leftovers.simulators.some(simulator => simulator.name === name), `Expected the host to have held a device of the ADW ID "${adwId}" before the poll`);
  assertNoneHeldUnderName(held(), name, `the ADW ID "${adwId}"`);
});

Then('the cron ran no device tool on that poll', function () {
  const { runs, leftovers, held } = requireDeviceTools();
  assert.deepStrictEqual(runs.map(lineOf), [], 'Expected the cron to have run no device tool on a poll that does not run its janitors');
  assert.deepStrictEqual(held(), leftovers, 'Expected the host to hold every device it held before the poll');
});
