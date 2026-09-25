/**
 * Drives `updateFixtureEnvelopes`/`probeClaudeJsonlSchema` in-process against
 * throwaway copies and a throwaway schema path, and spawns the real Claude CLI
 * stub (`test/mocks/claude-cli-stub.ts`). Reuses `feature-902.steps.ts`'s
 * `probeStub`/rate-limit-probe/agent-run steps for the cross-detector parity
 * scenarios, and shares `copyState` with `feature-909.steps.ts` for scenarios
 * that mix a gate check into these steps.
 *
 * NEVER SPAWNS THE REAL CLAUDE CLI — schema-probe scenarios point
 * `CLAUDE_CODE_PATH` at a throwaway script instead.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import { spawnSync } from 'child_process';
import {
  mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync,
} from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

import { updateFixtureEnvelopes } from '../../../adws/jsonl/fixtureUpdater.ts';
import { probeClaudeJsonlSchema } from '../../../adws/jsonl/schemaProbe.ts';
import { DEFAULT_SCHEMA_PATH } from '../../../adws/jsonl/conformanceCheck.ts';
import { copyState, readFixtureLines } from './feature-909.steps.ts';
import { probeStub, resetFeature902ProbeState } from './feature-902.steps.ts';

const REPO_ROOT = process.cwd();
const COMMITTED_SCHEMA_PATH = DEFAULT_SCHEMA_PATH;
const STUB_PATH = resolve(REPO_ROOT, 'test/mocks/claude-cli-stub.ts');
const RATE_LIMITED_FIXTURE_PATH = resolve(REPO_ROOT, 'adws/jsonl/fixtures/session-rate-limited.jsonl');

const probeState: {
  scriptDir: string | null;
  recordPath: string | null;
  schemaPath: string | null;
  savedClaudeCodePath: string | undefined;
} = { scriptDir: null, recordPath: null, schemaPath: null, savedClaudeCodePath: undefined };

const stubState: { stdout: string; status: number | null; askedForRateLimited: boolean } = {
  stdout: '', status: null, askedForRateLimited: false,
};

Before({ tags: '@adw-909' }, function () {
  resetFeature902ProbeState();
});

After({ tags: '@adw-909' }, function () {
  if (probeState.scriptDir) {
    try { rmSync(probeState.scriptDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  if (probeState.scriptDir !== null) {
    if (probeState.savedClaudeCodePath === undefined) {
      delete process.env['CLAUDE_CODE_PATH'];
    } else {
      process.env['CLAUDE_CODE_PATH'] = probeState.savedClaudeCodePath;
    }
  }
  probeState.scriptDir = null;
  probeState.recordPath = null;
  probeState.schemaPath = null;
  probeState.savedClaudeCodePath = undefined;

  stubState.stdout = '';
  stubState.status = null;
  stubState.askedForRateLimited = false;
});

function runStub(env: Record<string, string>): { status: number | null; stdout: string } {
  const result = spawnSync('bun', [STUB_PATH, '--print', '--verbose', '--output-format', 'stream-json', 'ping'], {
    encoding: 'utf-8',
    env: { ...process.env, MOCK_STREAM_DELAY_MS: '0', ...env },
  });
  return { status: result.status, stdout: result.stdout ?? '' };
}

When('the fixture updater runs over that copy', function () {
  const dir = copyState.dir;
  assert.ok(dir, 'Expected a fixture copy directory to exist first');
  copyState.updateResults = updateFixtureEnvelopes(COMMITTED_SCHEMA_PATH, dir);
});

Then("that copy's {string} message keeps its original {string} value", function (message: string, field: string) {
  const filePath = copyState.file;
  assert.ok(filePath, 'Expected a fixture copy to exist first');
  const lines = readFixtureLines(filePath);
  const line = lines.find(l => l['type'] === message);
  assert.ok(line, `Expected a "${message}" message in the copy`);
  assert.strictEqual(line[field], copyState.originalValue);
});

Given('the Claude CLI answers the schema probe with:', function (docString: string) {
  const scriptDir = mkdtempSync(join(tmpdir(), 'adw-909-probe-'));
  const recordPath = join(scriptDir, 'argv.log');
  const scriptPath = join(scriptDir, 'fake-claude.ts');
  const scriptSource = [
    '#!/usr/bin/env bun',
    "import { appendFileSync } from 'fs';",
    `appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    `process.stdout.write(${JSON.stringify(`${docString.trim()}\n`)});`,
    'process.exit(0);',
  ].join('\n') + '\n';
  writeFileSync(scriptPath, scriptSource, { mode: 0o755 });

  const schemaPath = join(scriptDir, 'schema.json');
  copyFileSync(COMMITTED_SCHEMA_PATH, schemaPath);

  probeState.scriptDir = scriptDir;
  probeState.recordPath = recordPath;
  probeState.schemaPath = schemaPath;
  probeState.savedClaudeCodePath = process.env['CLAUDE_CODE_PATH'];
  process.env['CLAUDE_CODE_PATH'] = scriptPath;
});

When('the schema probe runs', async function () {
  const schemaPath = probeState.schemaPath;
  assert.ok(schemaPath, 'Expected a stubbed Claude CLI to be installed first');
  await probeClaudeJsonlSchema(schemaPath);
});

function lastProbeArgv(): string[] {
  const recordPath = probeState.recordPath;
  assert.ok(recordPath && existsSync(recordPath), 'Expected the schema probe to have invoked the stubbed Claude CLI');
  const lines = readFileSync(recordPath, 'utf-8').trim().split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]) as string[];
}

Then('the schema probe requested {string} output from the Claude CLI', function (format: string) {
  const argv = lastProbeArgv();
  const idx = argv.indexOf('--output-format');
  assert.ok(idx !== -1, `Expected --output-format among the probe's args: ${JSON.stringify(argv)}`);
  assert.strictEqual(argv[idx + 1], format);
});

Then('the schema probe requested verbose output from the Claude CLI', function () {
  const argv = lastProbeArgv();
  assert.ok(argv.includes('--verbose'), `Expected --verbose among the probe's args: ${JSON.stringify(argv)}`);
});

Given('the Claude CLI stub is asked for its rate-limited response', function () {
  stubState.askedForRateLimited = true;
});

When('the Claude CLI stub is run', function () {
  const { status, stdout } = runStub(stubState.askedForRateLimited ? { MOCK_RESPONSE: 'rate-limited' } : {});
  stubState.status = status;
  stubState.stdout = stdout;
});

function stubLines(): Record<string, unknown>[] {
  return stubState.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
}

Then("the stub's output carries a rate_limit_event that rejects the request", function () {
  const event = stubLines().find(l => l['type'] === 'rate_limit_event');
  assert.ok(event, `Expected a rate_limit_event line. Got:\n${stubState.stdout}`);
  const info = event['rate_limit_info'] as Record<string, unknown>;
  assert.strictEqual(info['status'], 'rejected');
});

Then("the stub's rate_limit_event names a reset time that has not yet passed", function () {
  const event = stubLines().find(l => l['type'] === 'rate_limit_event');
  assert.ok(event, `Expected a rate_limit_event line. Got:\n${stubState.stdout}`);
  const info = event['rate_limit_info'] as Record<string, unknown>;
  const resetsAt = info['resetsAt'] as number;
  assert.ok(resetsAt > Date.now() / 1000, `Expected resetsAt (${resetsAt}) to be in the future`);
});

Then(/^the stub's output ends with a result whose api_error_status is (\d+) and whose is_error is (true|false)$/, function (statusStr: string, isErrorStr: string) {
  const lines = stubLines();
  const last = lines[lines.length - 1];
  assert.ok(last, `Expected at least one output line. Got:\n${stubState.stdout}`);
  assert.strictEqual(last['type'], 'result');
  assert.strictEqual(last['api_error_status'], Number(statusStr));
  assert.strictEqual(last['is_error'], isErrorStr === 'true');
});

Given("a copy of the Claude CLI stub's rate-limited response", function () {
  const { stdout } = runStub({ MOCK_RESPONSE: 'rate-limited' });
  const dir = mkdtempSync(join(tmpdir(), 'adw-909-stub-response-'));
  const filePath = join(dir, 'stub-rate-limited.jsonl');
  writeFileSync(filePath, stdout, 'utf-8');
  copyState.dir = dir;
  copyState.file = filePath;
});

Given('the Claude CLI answers the rate-limit probe with the committed JSONL fixture captured from a real rate limit', function () {
  const stdout = readFileSync(RATE_LIMITED_FIXTURE_PATH, 'utf-8');
  probeStub.result = { status: 1, stdout, stderr: '' };
});

Given("the Claude CLI answers the rate-limit probe with the Claude CLI stub's rate-limited response", function () {
  const { status, stdout } = runStub({ MOCK_RESPONSE: 'rate-limited' });
  probeStub.result = { status: status ?? 1, stdout, stderr: '' };
});

Given("the Claude CLI answers the rate-limit probe with the Claude CLI stub's default response", function () {
  const { status, stdout } = runStub({});
  probeStub.result = { status: status ?? 0, stdout, stderr: '' };
});
