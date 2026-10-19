/**
 * How the stand-in host of the feature-1050 scenarios looks, and the workflows whose devices it holds. The host is described of the
 * recording executor the device janitor is run over ("a recording executor that answers as a host with these devices"), and of the
 * stand-in device tools the cron's poll runs over ("the host's device tools are stand-ins that record each run and answer as a host
 * with these devices"). The workflows are described by what the janitor can know of them: whether the orchestrator is alive, and
 * how old the worktree that the state records is.
 */

import { Given, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';

import { standInDeviceHost } from '../../regression/support/standInDevices.ts';
import { s as executorWorld } from './feature-1047-world.ts';
import { INSIDE_GRACE_PERIOD_MS, OLDER_THAN_GRACE_PERIOD_MS, describeWorkflow, devicesOf } from './feature-1050-world.ts';

const ANDROID_PROGRAMS = ['avdmanager', 'emulator', 'adb'];
const DEVICE_PROGRAMS = [...ANDROID_PROGRAMS, 'xcrun'];

Given('a recording executor that answers as a host with these devices:', function (table: DataTable) {
  executorWorld.executorOptions = { ...executorWorld.executorOptions, devices: devicesOf(table) };
});

Given("the host's device tools are stand-ins that record each run and answer as a host with these devices:", function (table: DataTable) {
  standInDeviceHost({ devices: devicesOf(table) });
});

Given('the recording executor fails the deletion of the AVD {string}, printing {string}', function (avd: string, printed: string) {
  const failing = { ...executorWorld.executorOptions?.failing, [`avdmanager delete avd --name ${avd}`]: printed };
  executorWorld.executorOptions = { ...executorWorld.executorOptions, failing };
});

Given('on that host, {string}, {string} and {string} are not installed', function (first: string, second: string, third: string) {
  const programs = [first, second, third];
  programs.forEach(program => assert.ok(ANDROID_PROGRAMS.includes(program), `Expected one of ${ANDROID_PROGRAMS.join(', ')}, but the scenario names "${program}"`));
  executorWorld.executorOptions = { ...executorWorld.executorOptions, missingPrograms: [...(executorWorld.executorOptions?.missingPrograms ?? []), ...programs] };
});

Given('a recording executor that answers as a host on which no device tool is installed', function () {
  executorWorld.executorOptions = { ...executorWorld.executorOptions, missingPrograms: DEVICE_PROGRAMS };
});

Given("the workflow {string} has no live orchestrator process, and its worktree is older than the dev-server janitor's grace period", function (adwId: string) {
  describeWorkflow(adwId, { alive: false, worktreeAgeMs: OLDER_THAN_GRACE_PERIOD_MS });
});

Given("the orchestrator process of the workflow {string} is alive, and its worktree is older than the dev-server janitor's grace period", function (adwId: string) {
  describeWorkflow(adwId, { alive: true, worktreeAgeMs: OLDER_THAN_GRACE_PERIOD_MS });
});

Given("the workflow {string} has no live orchestrator process, and its worktree is still inside the dev-server janitor's grace period", function (adwId: string) {
  describeWorkflow(adwId, { alive: false, worktreeAgeMs: INSIDE_GRACE_PERIOD_MS });
});

// The cron's poll reads the real state of the working directory, so a leftover state of this ADW ID would change what it finds.
Given('no workflow state and no worktree are left for the ADW ID {string}', function (adwId: string) {
  assert.ok(!fs.existsSync(path.join(AGENTS_STATE_DIR, adwId)), `Expected no workflow state to be left for the ADW ID "${adwId}", but ${path.join(AGENTS_STATE_DIR, adwId)} exists`);
  describeWorkflow(adwId, { alive: false, worktreeAgeMs: null });
});
