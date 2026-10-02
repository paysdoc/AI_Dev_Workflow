/**
 * The model-literal check. Each scenario runs the real guard script
 * (`bunx tsx adws/checkModelLiterals.ts`) as a process, over the checkout or over a throwaway
 * fixture tree, and reads only its verdict: an in-process call would bypass the CLI entry
 * point that operators and CI run. The guard reads source; the scenarios never do.
 */

import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './feature-928-harness.ts';

const REPO_ROOT = process.cwd();
const GUARD_SCRIPT = path.join(REPO_ROOT, 'adws', 'checkModelLiterals.ts');

const FIXTURE_SOURCES: Readonly<Record<string, (model: string) => string>> = {
  'as an argument to the agent spawn function': (model) =>
    `runClaudeAgentWithCommand('/commit', [], 'fixture', outputFile, '${model}');\n`,
  'after a --model flag in a Claude CLI argument list': (model) =>
    `export const ARGS = ['--print', '--model', '${model}', 'ping'];\n`,
  "as the default of a spawn function's model parameter": (model) =>
    `export function spawnFixture(model: string = '${model}'): string { return model; }\n`,
};

const guard: { fixtureRoot: string | null; status: number | null; output: string } = { fixtureRoot: null, status: null, output: '' };

Before({ tags: '@adw-928' }, function () {
  guard.fixtureRoot = null;
  guard.status = null;
  guard.output = '';
});

Given(
  /^a fixture source tree in which "([^"]*)" names the model "([^"]*)" (as an argument to the agent spawn function|after a --model flag in a Claude CLI argument list|as the default of a spawn function's model parameter)$/,
  function (file: string, model: string, form: string) {
    const root = makeTempDir('model-literals');
    const filePath = path.join(root, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, FIXTURE_SOURCES[form](model), 'utf-8');
    guard.fixtureRoot = root;
  },
);

function runGuard(cwd: string): void {
  const result = spawnSync('bunx', ['tsx', GUARD_SCRIPT], {
    cwd,
    encoding: 'utf-8',
    // Cucumber runs under NODE_OPTIONS=--import tsx, which the child would resolve from its own cwd.
    env: { ...process.env, NODE_OPTIONS: '' },
    timeout: 120_000,
  });
  guard.status = result.status;
  guard.output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

When('the model-literal check is run across the repository', function () {
  runGuard(REPO_ROOT);
});

When('the model-literal check is run over the fixture source tree', function () {
  assert.ok(guard.fixtureRoot, 'Expected a fixture source tree first');
  runGuard(guard.fixtureRoot);
});

Then('the model-literal check reports no violations', function () {
  assert.strictEqual(guard.status, 0, `Expected the model-literal check to exit 0. Output:\n${guard.output}`);
});

Then('the model-literal check fails naming {string}', function (file: string) {
  assert.ok(guard.status !== null && guard.status !== 0, `Expected the model-literal check to fail. Output:\n${guard.output}`);
  assert.ok(guard.output.includes(file), `Expected the output to name "${file}". Output:\n${guard.output}`);
});
