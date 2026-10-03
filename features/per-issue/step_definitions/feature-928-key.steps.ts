/**
 * §5 THE API KEY IS OPTIONAL. The health check's environment check runs in process under the
 * environment the Givens set up. The usage rows run each orchestrator's `--help` as a process
 * and read the entry that names the key: the line naming it plus the lines right after it that
 * are indented deeper. The next variable's line is never part of the entry.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { checkEnvironmentVariables, type CheckResult } from '../../../adws/healthCheckChecks.ts';

const REPO_ROOT = process.cwd();

let environmentCheck: CheckResult | null = null;
let usageText = '';

function currentCheck(): CheckResult {
  assert.ok(environmentCheck, 'Expected the health check to have checked the environment variables first');
  return environmentCheck;
}

function namesIn(detail: unknown): string[] {
  return Array.isArray(detail) ? detail.map(String) : [];
}

When("the health check checks ADW's environment variables", function () {
  environmentCheck = checkEnvironmentVariables();
});

Then('the environment variable check passes', function () {
  const check = currentCheck();
  assert.strictEqual(check.success, true, `Expected the environment variable check to pass. Result: ${JSON.stringify(check)}`);
});

Then('the environment variable check does not report {string} missing', function (name: string) {
  const check = currentCheck();
  assert.ok(!namesIn(check.details['missing']).includes(name), `Expected ${name} not to be reported missing. Result: ${JSON.stringify(check)}`);
  assert.ok(!(check.error ?? '').includes(name), `Expected the error not to name ${name}. Error: ${check.error}`);
});

Then('the environment variable check does not list {string} among the required variables', function (name: string) {
  const check = currentCheck();
  assert.ok(!namesIn(check.details['required']).includes(name), `Expected ${name} not to be listed as required. Result: ${JSON.stringify(check)}`);
});

When('the {string} orchestrator is asked for its usage', function (orchestrator: string) {
  const result = spawnSync('bunx', ['tsx', path.join(REPO_ROOT, 'adws', orchestrator), '--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    // Cucumber runs under NODE_OPTIONS=--import tsx, which the child would resolve from its own cwd.
    env: { ...process.env, NODE_OPTIONS: '' },
    timeout: 60_000,
  });
  usageText = `${result.stdout ?? ''}${result.stderr ?? ''}`;
});

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function entryNaming(usage: string, name: string): string {
  const lines = usage.split('\n');
  const start = lines.findIndex((line) => line.includes(name));
  assert.ok(start !== -1, `Expected the usage text to name ${name}. Usage text:\n${usage}`);
  const following = lines.slice(start + 1);
  const deeper = following.findIndex((line) => line.trim() === '' || indentOf(line) <= indentOf(lines[start]));
  return lines.slice(start, deeper === -1 ? lines.length : start + 1 + deeper).join('\n');
}

Then('the usage text presents {string} as optional', function (name: string) {
  const entry = entryNaming(usageText, name);
  assert.match(entry, /optional/i, `Expected the ${name} entry to present it as optional. Entry:\n${entry}`);
});

Then('the usage text says that setting {string} moves billing from the Claude subscription to the API', function (name: string) {
  const entry = entryNaming(usageText, name);
  for (const pattern of [/subscription/i, /\bAPI\b/, /bill/i]) {
    assert.match(entry, pattern, `Expected the ${name} entry to say that setting it moves billing from the Claude subscription to the API. Entry:\n${entry}`);
  }
});
