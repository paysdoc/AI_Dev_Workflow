/**
 * Scenario-test-phase scenarios of feature-1045: the device sources a worktree's ".adw/project.md" names, and what the real
 * `executeScenarioTestPhase` does with them. The workflow, the stand-in scenario command and the phase run with feature-992's
 * steps; here the phase may fail, and the scenario reads how. The review scenarios of feature-1043 run feature-994's workflow,
 * which writes its own ".adw/", so the device sources it should name are put where it writes them over its own.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { DeviceSourceConfigError } from '../../../adws/core/deviceSourceConfig.ts';

import { PROJECT_MD, assertProjectMdFile } from '../../regression/step_definitions/feature-991-project-md.ts';
import {
  ADW_DIRECTORY,
  freshAdwFiles,
  removeProjectSection,
  renderProjectMd,
  setEveryDeviceSource,
  setNoDeviceSource,
  setProjectSection,
  type AdwFiles,
} from '../../regression/step_definitions/feature-992-adw-files.ts';
import { commandMatches, describeCalls } from '../../regression/step_definitions/feature-992-calls.ts';
import { requireAdwFiles, runScenarioTestPhase } from '../../regression/step_definitions/feature-992-phase.steps.ts';
import { commandLine, recordedCalls } from '../../regression/step_definitions/feature-992-standins.ts';
import { requireWorkflow } from '../../regression/step_definitions/feature-992-world.ts';
import { requireType, s as reviewWorkflow } from './feature-994-world.ts';
import { requireAttempt, s } from './feature-1045-world.ts';
import { titleOf } from './feature-1045-sections.ts';

const ATTEMPT_TIMEOUT_MS = 60_000;

Given("the worktree's {string} names every device source", function (file: string) {
  assertProjectMdFile(file);
  setEveryDeviceSource(requireAdwFiles());
});

Given("the worktree's {string} names no device source", function (file: string) {
  assertProjectMdFile(file);
  setNoDeviceSource(requireAdwFiles());
});

Given("the worktree's {string} names every device source but {string}", function (file: string, section: string) {
  assertProjectMdFile(file);
  const files = requireAdwFiles();
  setEveryDeviceSource(files);
  removeProjectSection(files, titleOf(section));
});

Given("the worktree's {string} names every device source, but its {string} section is empty", function (file: string, section: string) {
  assertProjectMdFile(file);
  const files = requireAdwFiles();
  setEveryDeviceSource(files);
  setProjectSection(files, titleOf(section), '');
});

/** The review workflow writes ".adw/" as `adw_init` would for its type, and then the files a step said it holds over them. */
function putProjectMd(name: (files: AdwFiles) => void): void {
  const files = freshAdwFiles(requireType());
  name(files);
  reviewWorkflow.adwFiles.set(PROJECT_MD, renderProjectMd(files));
}

Given("the workflow's {string} names every device source", function (file: string) {
  assertProjectMdFile(file);
  putProjectMd(setEveryDeviceSource);
});

Given("the workflow's {string} names no device source", function (file: string) {
  assertProjectMdFile(file);
  putProjectMd(setNoDeviceSource);
});

When("the workflow's scenario test phase is attempted", { timeout: ATTEMPT_TIMEOUT_MS }, async function () {
  try {
    await runScenarioTestPhase(requireWorkflow());
    s.attempt = { completed: true, error: undefined };
  } catch (error) {
    s.attempt = { completed: false, error };
  }
});

Then('the scenario test phase failed with an error that names {string}', function (section: string) {
  const attempt = requireAttempt();
  assert.ok(!attempt.completed, 'Expected the scenario test phase to fail, but it completed');
  const { error } = attempt;
  assert.ok(error instanceof DeviceSourceConfigError, `Expected the scenario test phase to fail with a DeviceSourceConfigError, but it failed with: ${String(error)}`);
  assert.strictEqual(error.section, section, `Expected the error to name the section "${section}"`);
  assert.ok(error.message.includes(section), `Expected the message of the error to name "${section}", but it says: ${error.message}`);
});

Then('the scenario command {string} configures was not run', function (directory: string) {
  assert.strictEqual(directory, ADW_DIRECTORY, `The scenarios describe the repository's "${ADW_DIRECTORY}"`);
  const runs = recordedCalls().filter(call => commandMatches(call, 'scenario-command'));
  assert.deepStrictEqual(runs.map(commandLine), [], `Expected the scenario command not to have run, but the stand-ins recorded: ${describeCalls()}`);
});
