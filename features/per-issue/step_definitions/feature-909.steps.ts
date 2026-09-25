/**
 * §1/§2/§3 drive `checkConformance`/`updateFixtureEnvelopes`/`probeClaudeJsonlSchema`
 * in-process against throwaway copies (never the committed fixtures) and a throwaway
 * schema path. §4 spawns the real stub (`test/mocks/claude-cli-stub.ts`) and reuses
 * #902's `probeStub`/rate-limit-probe/agent-run steps for the cross-detector parity
 * scenarios. NEVER SPAWNS THE REAL CLAUDE CLI — schema-probe scenarios point
 * `CLAUDE_CODE_PATH` at a throwaway script instead.
 */

import { Given, When, Then, Before, After, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { spawnSync, execFileSync } from 'child_process';
import {
  mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync,
} from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

import { checkConformance, DEFAULT_SCHEMA_PATH } from '../../../adws/jsonl/conformanceCheck.ts';
import { updateFixtureEnvelopes } from '../../../adws/jsonl/fixtureUpdater.ts';
import { probeClaudeJsonlSchema } from '../../../adws/jsonl/schemaProbe.ts';
import type { ConformanceResult, UpdateResult } from '../../../adws/jsonl/types.ts';
import { probeStub, resetFeature902ProbeState } from './feature-902.steps.ts';

const REPO_ROOT = process.cwd();
const COMMITTED_SCHEMA_PATH = DEFAULT_SCHEMA_PATH;
const STUB_PATH = resolve(REPO_ROOT, 'test/mocks/claude-cli-stub.ts');
const RATE_LIMITED_FIXTURE_PATH = resolve(REPO_ROOT, 'adws/jsonl/fixtures/session-rate-limited.jsonl');
const ERROR_RESULT_FIXTURE_PATH = resolve(REPO_ROOT, 'adws/jsonl/fixtures/result-error.jsonl');

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const gate: { exitCode: number; stdout: string } = { exitCode: -1, stdout: '' };

const copyState: {
  dir: string | null;
  file: string | null;
  results: ConformanceResult[] | null;
  updateResults: UpdateResult[] | null;
  originalValue: unknown;
} = { dir: null, file: null, results: null, updateResults: null, originalValue: undefined };

const probeState: {
  scriptDir: string | null;
  recordPath: string | null;
  schemaPath: string | null;
  savedClaudeCodePath: string | undefined;
} = { scriptDir: null, recordPath: null, schemaPath: null, savedClaudeCodePath: undefined };

const stubState: { stdout: string; status: number | null; askedForRateLimited: boolean } = {
  stdout: '', status: null, askedForRateLimited: false,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

Before({ tags: '@adw-909' }, function () {
  resetFeature902ProbeState();
});

After({ tags: '@adw-909' }, function () {
  if (copyState.dir) {
    try { rmSync(copyState.dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  copyState.dir = null;
  copyState.file = null;
  copyState.results = null;
  copyState.updateResults = null;
  copyState.originalValue = undefined;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyFixtureToTempDir(sourcePath: string): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'adw-909-fixture-'));
  const filePath = join(dir, sourcePath.split('/').pop()!);
  copyFileSync(sourcePath, filePath);
  return { dir, filePath };
}

function readFixtureLines(filePath: string): Record<string, unknown>[] {
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => JSON.parse(l) as Record<string, unknown>);
}

function writeFixtureLines(filePath: string, lines: Record<string, unknown>[]): void {
  writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
}

function deleteDotPath(obj: Record<string, unknown>, dotPath: string): void {
  const segments = dotPath.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = current[segments[i]!];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return;
    current = next as Record<string, unknown>;
  }
  delete current[segments[segments.length - 1]!];
}

function runStub(env: Record<string, string>): { status: number | null; stdout: string } {
  const result = spawnSync('bun', [STUB_PATH, '--print', '--verbose', '--output-format', 'stream-json', 'ping'], {
    encoding: 'utf-8',
    env: { ...process.env, MOCK_STREAM_DELAY_MS: '0', ...env },
  });
  return { status: result.status, stdout: result.stdout ?? '' };
}

function extraFieldsForMessage(results: ConformanceResult[], message: string): string[] {
  return results.flatMap(r => r.extraFields).filter(entry => entry.includes(`(${message}`));
}

// ---------------------------------------------------------------------------
// §1 — the gate over what is committed
// ---------------------------------------------------------------------------

When('the envelope conformance gate is run through its package script entry point', function () {
  try {
    const stdout = execFileSync('bun', ['run', 'jsonl:check'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    gate.exitCode = 0;
    gate.stdout = stdout;
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    gate.exitCode = e.status ?? 1;
    gate.stdout = e.stdout ?? '';
  }
});

Then('the envelope conformance gate exits 0', function () {
  assert.strictEqual(gate.exitCode, 0, `Expected exit 0. Got stdout:\n${gate.stdout}`);
});

Then('the envelope conformance gate reports no failing fixture', function () {
  assert.ok(!gate.stdout.includes('✗'), `Expected no failing fixture marker. Got:\n${gate.stdout}`);
});

// ---------------------------------------------------------------------------
// §2 — drift in a field the pause path reads fails the gate
// ---------------------------------------------------------------------------

Given('a copy of the committed JSONL fixture captured from a real rate limit', function () {
  const { dir, filePath } = copyFixtureToTempDir(RATE_LIMITED_FIXTURE_PATH);
  copyState.dir = dir;
  copyState.file = filePath;
});

Given('a copy of the committed JSONL error-result fixture', function () {
  const { dir, filePath } = copyFixtureToTempDir(ERROR_RESULT_FIXTURE_PATH);
  copyState.dir = dir;
  copyState.file = filePath;
  const [msg] = readFixtureLines(filePath);
  copyState.originalValue = msg?.['result'];
});

Given('in that copy the {string} message no longer carries the field {string}', function (message: string, field: string) {
  assert.ok(copyState.file, 'Expected a fixture copy to exist first');
  const lines = readFixtureLines(copyState.file!);
  for (const line of lines) {
    if (line['type'] === message) deleteDotPath(line, field);
  }
  writeFixtureLines(copyState.file!, lines);
});

Given('in that copy the {string} message carries {string} under its stale name {string}', function (message: string, field: string, stale: string) {
  assert.ok(copyState.file, 'Expected a fixture copy to exist first');
  const lines = readFixtureLines(copyState.file!);
  for (const line of lines) {
    if (line['type'] === message && field in line) {
      line[stale] = line[field];
      delete line[field];
    }
  }
  writeFixtureLines(copyState.file!, lines);
});

Given('a copy of the api_retry system message the Claude CLI documents:', function (docString: string) {
  const dir = mkdtempSync(join(tmpdir(), 'adw-909-api-retry-'));
  const filePath = join(dir, 'system-api-retry.jsonl');
  writeFileSync(filePath, docString.trim() + '\n', 'utf-8');
  copyState.dir = dir;
  copyState.file = filePath;
});

When('the envelope conformance gate checks that copy', function () {
  assert.ok(copyState.dir, 'Expected a fixture copy directory to exist first');
  copyState.results = checkConformance(COMMITTED_SCHEMA_PATH, copyState.dir!);
});

Then('the envelope conformance gate fails', function () {
  assert.ok(copyState.results, 'Expected the gate to have checked a copy first');
  assert.ok(copyState.results!.some(r => !r.passed), `Expected at least one failing result. Got: ${JSON.stringify(copyState.results)}`);
});

Then('the envelope conformance gate passes', function () {
  assert.ok(copyState.results, 'Expected the gate to have checked a copy first');
  assert.ok(copyState.results!.every(r => r.passed), `Expected every result to pass. Got: ${JSON.stringify(copyState.results, null, 2)}`);
});

Then('the envelope conformance gate reports {string} missing from the {string} message', function (field: string, message: string) {
  assert.ok(copyState.results, 'Expected the gate to have checked a copy first');
  const allMissing = copyState.results!.flatMap(r => r.missingFields);
  const found = allMissing.some(m => m.includes(field) && (m.includes(`(${message}`) || !m.includes('(')));
  assert.ok(found, `Expected a missing-field report naming "${field}" for the "${message}" message. Got: ${JSON.stringify(allMissing)}`);
});

Then('the envelope conformance gate flags no field of the {string} message as unknown', function (message: string) {
  assert.ok(copyState.results, 'Expected the gate to have checked a copy first');
  const matches = extraFieldsForMessage(copyState.results!, message);
  assert.deepStrictEqual(matches, [], `Expected no unknown fields for "${message}". Got: ${JSON.stringify(matches)}`);
});

Then('the envelope conformance gate flags none of these fields of the {string} message as unknown:', function (message: string, dataTable: DataTable) {
  assert.ok(copyState.results, 'Expected the gate to have checked a copy first');
  const matches = extraFieldsForMessage(copyState.results!, message);
  for (const row of dataTable.hashes()) {
    const field = row['field']!;
    const found = matches.some(m => m.includes(field));
    assert.ok(!found, `Expected "${field}" not to be flagged unknown for "${message}". Got: ${JSON.stringify(matches)}`);
  }
});

// ---------------------------------------------------------------------------
// §3 — the tools around the gate speak the real names
// ---------------------------------------------------------------------------

When('the fixture updater runs over that copy', function () {
  assert.ok(copyState.dir, 'Expected a fixture copy directory to exist first');
  copyState.updateResults = updateFixtureEnvelopes(COMMITTED_SCHEMA_PATH, copyState.dir!);
});

Then("that copy's {string} message keeps its original {string} value", function (message: string, field: string) {
  assert.ok(copyState.file, 'Expected a fixture copy to exist first');
  const lines = readFixtureLines(copyState.file!);
  const line = lines.find(l => l['type'] === message);
  assert.ok(line, `Expected a "${message}" message in the copy`);
  assert.strictEqual(line![field], copyState.originalValue);
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
  assert.ok(probeState.schemaPath, 'Expected a stubbed Claude CLI to be installed first');
  await probeClaudeJsonlSchema(probeState.schemaPath!);
});

function lastProbeArgv(): string[] {
  assert.ok(probeState.recordPath && existsSync(probeState.recordPath), 'Expected the schema probe to have invoked the stubbed Claude CLI');
  const lines = readFileSync(probeState.recordPath!, 'utf-8').trim().split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]!) as string[];
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

// ---------------------------------------------------------------------------
// §4 — the Claude CLI stub answers rate-limited on demand
// ---------------------------------------------------------------------------

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
  const info = event!['rate_limit_info'] as Record<string, unknown>;
  assert.strictEqual(info['status'], 'rejected');
});

Then("the stub's rate_limit_event names a reset time that has not yet passed", function () {
  const event = stubLines().find(l => l['type'] === 'rate_limit_event')!;
  const info = event['rate_limit_info'] as Record<string, unknown>;
  const resetsAt = info['resetsAt'] as number;
  assert.ok(resetsAt > Date.now() / 1000, `Expected resetsAt (${resetsAt}) to be in the future`);
});

Then(/^the stub's output ends with a result whose api_error_status is (\d+) and whose is_error is (true|false)$/, function (statusStr: string, isErrorStr: string) {
  const lines = stubLines();
  const last = lines[lines.length - 1];
  assert.ok(last, `Expected at least one output line. Got:\n${stubState.stdout}`);
  assert.strictEqual(last!['type'], 'result');
  assert.strictEqual(last!['api_error_status'], Number(statusStr));
  assert.strictEqual(last!['is_error'], isErrorStr === 'true');
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
