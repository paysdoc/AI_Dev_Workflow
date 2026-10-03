/**
 * Scenarios of feature-939.feature. The envelope-conformance workflow is RUN, the way a GitHub
 * runner runs it for a pull request, in a throwaway copy of the checkout, against a stand-in
 * `claude` on PATH. NEVER THE REAL CLAUDE CLI, and nothing is ever installed. No step reads the
 * workflow for an assertion: they check only what the run produced (its conclusion, annotations
 * and step output) and what the stand-in recorded. The workflow file is read only to run it, and a
 * shape the runner does not understand throws, which is a scenario error and never a failed run.
 */

import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { describeRun, errorTexts, warningTexts } from './feature-939-report.ts';
import { runWorkflow, type RunResult } from './feature-939-runner.ts';
import { createSandbox, removeSandbox, type Sandbox } from './feature-939-sandbox.ts';
import { conformingSession, isProbeRequest, readCalls, withoutField, type ClaudeCall } from './feature-939-standIns.ts';

const REPO_ROOT = process.cwd();
const WORKFLOW_FILE = '.github/workflows/envelope-conformance.yml';
/** The runner kills a step after 60 seconds, so a hung step fails the run long before this. */
const RUN_TIMEOUT_MS = 5 * 60_000;

interface ScenarioState {
  readonly secrets: ReadonlyMap<string, string>;
  /** The scripted answer to the live probe; the committed conforming session when the scenario names none. */
  readonly answer: readonly string[] | undefined;
  readonly sandbox: Sandbox | undefined;
  readonly run: RunResult | undefined;
}

const INITIAL_STATE: ScenarioState = { secrets: new Map(), answer: undefined, sandbox: undefined, run: undefined };

let state: ScenarioState = INITIAL_STATE;

After({ tags: '@adw-939' }, function () {
  if (state.sandbox !== undefined) removeSandbox(state.sandbox);
  state = INITIAL_STATE;
});

function withSecret(secrets: ReadonlyMap<string, string>, name: string, value: string): ReadonlyMap<string, string> {
  return new Map(secrets).set(name, value);
}

function withoutSecret(secrets: ReadonlyMap<string, string>, name: string): ReadonlyMap<string, string> {
  const remaining = new Map(secrets);
  remaining.delete(name);
  return remaining;
}

function finishedRun(): RunResult {
  assert.ok(state.run, 'Expected the envelope-conformance workflow to have run first');
  return state.run;
}

function probeRequests(): ClaudeCall[] {
  assert.ok(state.sandbox, 'Expected the envelope-conformance workflow to have run first');
  return readCalls(state.sandbox.recordPath).filter(isProbeRequest);
}

function assertConclusion(expected: RunResult['conclusion']): void {
  const run = finishedRun();
  const wanted = expected === 'success' ? 'succeed' : 'fail';
  assert.strictEqual(run.conclusion, expected, `Expected the workflow run to ${wanted}.\n${describeRun(run)}`);
}

async function runEnvelopeConformanceWorkflow(): Promise<void> {
  const sandbox = createSandbox(REPO_ROOT, state.answer ?? conformingSession(REPO_ROOT));
  state = { ...state, sandbox };
  const workflow = fs.readFileSync(path.join(sandbox.checkoutDir, WORKFLOW_FILE), 'utf-8');
  state = { ...state, run: await runWorkflow(workflow, sandbox, state.secrets) };
}

Given('the repository has no {string} secret', function (name: string) {
  state = { ...state, secrets: withoutSecret(state.secrets, name) };
});

Given("the repository's {string} secret holds {string}", function (name: string, value: string) {
  state = { ...state, secrets: withSecret(state.secrets, name, value) };
});

Given(
  'the pinned Claude CLI answers the live probe with a one-turn session that conforms to the committed schema and carries no rate-limit event',
  function () {
    state = { ...state, answer: conformingSession(REPO_ROOT) };
  },
);

Given(
  'the pinned Claude CLI answers the live probe with a one-turn session that conforms to the committed schema, except that its {string} message no longer carries the field {string}',
  function (messageType: string, field: string) {
    state = { ...state, answer: withoutField(conformingSession(REPO_ROOT), messageType, field) };
  },
);

When('the envelope-conformance workflow runs for a pull request', { timeout: RUN_TIMEOUT_MS }, runEnvelopeConformanceWorkflow);

Then('the workflow run succeeds', function () {
  assertConclusion('success');
});

Then('the workflow run fails', function () {
  assertConclusion('failure');
});

Then('the workflow run reports an error naming {string}', function (name: string) {
  const run = finishedRun();
  assert.ok(errorTexts(run).some(text => text.includes(name)), `Expected the workflow run to report an error naming "${name}".\n${describeRun(run)}`);
});

Then('the workflow run raises no warning naming {string}', function (name: string) {
  const run = finishedRun();
  const naming = warningTexts(run).filter(text => text.includes(name));
  assert.deepStrictEqual(naming, [], `Expected the workflow run to raise no warning naming "${name}".\n${describeRun(run)}`);
});

Then('the pinned Claude CLI was asked for the live probe', function () {
  assert.ok(probeRequests().length > 0, `Expected the pinned Claude CLI to be asked for the live probe.\n${describeRun(finishedRun())}`);
});

Then('the pinned Claude CLI received {string} as its ANTHROPIC_API_KEY for the live probe', function (expected: string) {
  const requests = probeRequests();
  assert.ok(requests.length > 0, `Expected the pinned Claude CLI to be asked for the live probe.\n${describeRun(finishedRun())}`);
  assert.ok(
    requests.every(call => call.apiKey === expected),
    `Expected the live probe to receive ${JSON.stringify(expected)} as its ANTHROPIC_API_KEY. Calls: ${JSON.stringify(requests)}`,
  );
});
