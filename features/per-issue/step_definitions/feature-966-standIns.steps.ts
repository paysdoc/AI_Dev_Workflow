/**
 * Step definitions for the throwaway scenarios of feature-966.feature that exercise the subprocess
 * harness itself. A throwaway `@regression @subprocess` scenario is written and run through Cucumber
 * in a child process by feature-963's steps, and judged by its step results. The steps that run
 * inside that scenario are defined here as well: they set a variable for the process running the
 * scenario, and run a stand-in process through the harness the way W1 runs an orchestrator.
 */

import { Given, Then, When, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { CLAUDE_CLI_STUB } from '../../regression/support/claudeCliStub.ts';
import { requireHarness } from '../../regression/support/subprocessHarness.ts';
import { runThroughHarness } from '../../regression/support/subprocessRun.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { failureMessage, writeThrowawayFeature } from '../../support/cucumberChildRun.ts';
import { stateOf as runStateOf } from './feature-963-state.ts';
import { throwawayDirectory, throwawayScenario } from './feature-963.steps.ts';
import { setProcessEnv, stateOf } from './feature-966-state.ts';

const STAND_IN_TIMEOUT_MS = 30_000;
/** `ghp_` and 36 letters or digits: the shape of a classic personal access token. */
const CLASSIC_TOKEN = /^ghp_[A-Za-z0-9]{36}$/;

Given('a throwaway @subprocess regression scenario with the steps:', function (this: RegressionWorld, steps: string) {
  runStateOf(this).throwawayFeature = writeThrowawayFeature(throwawayDirectory(this), true, steps, ['@subprocess']);
});

Given('the process running the scenario has {string} set to {string}', function (this: RegressionWorld, name: string, value: string) {
  setProcessEnv(this, name, value);
});

async function runStandIn(world: RegressionWorld, script: string, timeoutMs: number, label: string): Promise<void> {
  await runThroughHarness(world, { command: '/bin/sh', args: ['-c', script], timeoutMs, label }, { recordsExitCode: false });
}

function parseEnvironment(text: string): Map<string, string> {
  const entries = text.split('\n').flatMap((line): [string, string][] => {
    const at = line.indexOf('=');
    return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
  });
  return new Map(entries);
}

When('a stand-in process that records its environment is run through the subprocess harness', async function (this: RegressionWorld) {
  const file = join(requireHarness(this).root, 'stand-in-environment.txt');
  await runStandIn(this, `env > '${file}'`, STAND_IN_TIMEOUT_MS, 'The stand-in process');
  stateOf(this).standInEnvironment = parseEnvironment(readFileSync(file, 'utf-8'));
});

When(
  'a stand-in process that runs the command {string} and then exits 0 is run through the subprocess harness',
  async function (this: RegressionWorld, command: string) {
    await runStandIn(this, `${command}; exit 0`, STAND_IN_TIMEOUT_MS, `The stand-in process "${command}"`);
  },
);

When(
  'a stand-in process that runs the command {string} is run through the subprocess harness with a timeout of {int} seconds',
  async function (this: RegressionWorld, command: string, seconds: number) {
    await runStandIn(this, command, seconds * 1000, `The stand-in process "${command}"`);
  },
);

/** `undefined` when the process saw no such variable, which is not the same as an empty one. */
function seenValue(world: RegressionWorld, name: string): string | undefined {
  const { standInEnvironment } = stateOf(world);
  assert.ok(standInEnvironment, 'Expected a stand-in process to have recorded its environment first');
  return standInEnvironment.get(name);
}

Then('the stand-in process saw {string} set to an empty string', function (this: RegressionWorld, name: string) {
  assert.strictEqual(seenValue(this, name), '', `Expected the stand-in process to see ${name} present and empty, not unset and not holding a value`);
});

Then('the stand-in process saw {string} set to the Claude CLI stub', function (this: RegressionWorld, name: string) {
  assert.strictEqual(seenValue(this, name), CLAUDE_CLI_STUB);
});

Then('the stand-in process saw {string} set to a token other than {string}', function (this: RegressionWorld, name: string, hostToken: string) {
  const seen = seenValue(this, name);
  assert.match(seen ?? '', CLASSIC_TOKEN, `Expected the stand-in process to see ${name} set to a token shaped like a classic personal access token`);
  assert.notStrictEqual(seen, hostToken, `Expected the stand-in process not to see the host's ${name}`);
});

/** ADW's own rule: an empty or absent value falls back to EUR, which a completed workflow then fetches a rate for. */
Then('the stand-in process saw a COST_REPORT_CURRENCIES that gives ADW no currency to convert costs into', function (this: RegressionWorld) {
  const currencies = (seenValue(this, 'COST_REPORT_CURRENCIES') || 'EUR').split(',').map((currency) => currency.trim()).filter(Boolean);
  assert.deepStrictEqual(currencies, [], 'Expected the stand-in process to see a COST_REPORT_CURRENCIES that names no currency');
});

Then('the error message of that failed step contains {string}', function (this: RegressionWorld, text: string) {
  const message = failureMessage(throwawayScenario(this));
  assert.ok(message.includes(text), `Expected the error message of the failed step to contain "${text}", but it reads:\n${message}`);
});

function names(message: string, orchestrator: string): boolean {
  const escaped = orchestrator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s,:])${escaped}(?=$|[\\s,.])`).test(message);
}

Then('the error message of that failed step names each of these orchestrators:', function (this: RegressionWorld, table: DataTable) {
  const message = failureMessage(throwawayScenario(this));
  const missing = table.hashes().map(({ orchestrator }) => orchestrator).filter((orchestrator) => !names(message, orchestrator));
  assert.deepStrictEqual(missing, [], `Expected the error message of the failed step to name every orchestrator, but it reads:\n${message}`);
});

/** A process counts when its command line ends with the command: one that merely mentions it, in a prompt for instance, does not. */
Then('no process running the command {string} is left', function (command: string) {
  const lines = execSync('ps -eo pid=,command=', { encoding: 'utf-8' }).split('\n').map((line) => line.trim());
  const left = lines.filter((line) => line.endsWith(command));
  assert.deepStrictEqual(left, [], `Expected no process to be left running "${command}"`);
});
