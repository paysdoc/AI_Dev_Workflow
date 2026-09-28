/**
 * Drives `checkConformance` in-process against throwaway copies of the committed
 * fixtures (never the fixtures themselves) — the gate itself (run exactly as CI
 * runs it, through `bun run jsonl:check`) and single-field drift in those copies.
 * The fixture-updater/schema-probe/stub steps that share `copyState` with these
 * live in `feature-909-tooling.steps.ts`.
 *
 * NEVER SPAWNS THE REAL CLAUDE CLI — schema-probe scenarios in the sibling file
 * point `CLAUDE_CODE_PATH` at a throwaway script instead.
 */

import { Given, When, Then, After, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { execFileSync } from 'child_process';
import {
  mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync,
} from 'fs';
import { join, resolve, basename } from 'path';
import { tmpdir } from 'os';

import { checkConformance, DEFAULT_SCHEMA_PATH } from '../../../adws/jsonl/conformanceCheck.ts';
import type { ConformanceResult, UpdateResult } from '../../../adws/jsonl/types.ts';

const REPO_ROOT = process.cwd();
const COMMITTED_SCHEMA_PATH = DEFAULT_SCHEMA_PATH;
const RATE_LIMITED_FIXTURE_PATH = resolve(REPO_ROOT, 'adws/jsonl/fixtures/session-rate-limited.jsonl');
const ERROR_RESULT_FIXTURE_PATH = resolve(REPO_ROOT, 'adws/jsonl/fixtures/result-error.jsonl');

const gate: { exitCode: number; stdout: string } = { exitCode: -1, stdout: '' };

export const copyState: {
  dir: string | null;
  file: string | null;
  results: ConformanceResult[] | null;
  updateResults: UpdateResult[] | null;
  originalValue: unknown;
} = { dir: null, file: null, results: null, updateResults: null, originalValue: undefined };

After({ tags: '@adw-909' }, function () {
  if (copyState.dir) {
    try { rmSync(copyState.dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  copyState.dir = null;
  copyState.file = null;
  copyState.results = null;
  copyState.updateResults = null;
  copyState.originalValue = undefined;
});

function copyFixtureToTempDir(sourcePath: string): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'adw-909-fixture-'));
  const filePath = join(dir, basename(sourcePath));
  copyFileSync(sourcePath, filePath);
  return { dir, filePath };
}

export function readFixtureLines(filePath: string): Record<string, unknown>[] {
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
    const next = current[segments[i]];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return;
    current = next as Record<string, unknown>;
  }
  delete current[segments[segments.length - 1]];
}

function extraFieldsForMessage(results: ConformanceResult[], message: string): string[] {
  return results.flatMap(r => r.extraFields).filter(entry => entry.includes(`(${message}`));
}

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
  const filePath = copyState.file;
  assert.ok(filePath, 'Expected a fixture copy to exist first');
  const lines = readFixtureLines(filePath);
  for (const line of lines) {
    if (line['type'] === message) deleteDotPath(line, field);
  }
  writeFixtureLines(filePath, lines);
});

Given('in that copy the {string} message carries {string} under its stale name {string}', function (message: string, field: string, stale: string) {
  const filePath = copyState.file;
  assert.ok(filePath, 'Expected a fixture copy to exist first');
  const lines = readFixtureLines(filePath);
  for (const line of lines) {
    if (line['type'] === message && field in line) {
      line[stale] = line[field];
      delete line[field];
    }
  }
  writeFixtureLines(filePath, lines);
});

Given('a copy of the api_retry system message the Claude CLI documents:', function (docString: string) {
  const dir = mkdtempSync(join(tmpdir(), 'adw-909-api-retry-'));
  const filePath = join(dir, 'system-api-retry.jsonl');
  writeFileSync(filePath, docString.trim() + '\n', 'utf-8');
  copyState.dir = dir;
  copyState.file = filePath;
});

When('the envelope conformance gate checks that copy', function () {
  const dir = copyState.dir;
  assert.ok(dir, 'Expected a fixture copy directory to exist first');
  copyState.results = checkConformance(COMMITTED_SCHEMA_PATH, dir);
});

Then('the envelope conformance gate fails', function () {
  const results = copyState.results;
  assert.ok(results, 'Expected the gate to have checked a copy first');
  assert.ok(results.some(r => !r.passed), `Expected at least one failing result. Got: ${JSON.stringify(results)}`);
});

Then('the envelope conformance gate passes', function () {
  const results = copyState.results;
  assert.ok(results, 'Expected the gate to have checked a copy first');
  assert.ok(results.every(r => r.passed), `Expected every result to pass. Got: ${JSON.stringify(results, null, 2)}`);
});

Then('the envelope conformance gate reports {string} missing from the {string} message', function (field: string, message: string) {
  const results = copyState.results;
  assert.ok(results, 'Expected the gate to have checked a copy first');
  const allMissing = results.flatMap(r => r.missingFields);
  const found = allMissing.some(m => m.includes(field) && (m.includes(`(${message}`) || !m.includes('(')));
  assert.ok(found, `Expected a missing-field report naming "${field}" for the "${message}" message. Got: ${JSON.stringify(allMissing)}`);
});

Then('the envelope conformance gate flags no field of the {string} message as unknown', function (message: string) {
  const results = copyState.results;
  assert.ok(results, 'Expected the gate to have checked a copy first');
  const matches = extraFieldsForMessage(results, message);
  assert.deepStrictEqual(matches, [], `Expected no unknown fields for "${message}". Got: ${JSON.stringify(matches)}`);
});

Then('the envelope conformance gate flags none of these fields of the {string} message as unknown:', function (message: string, dataTable: DataTable) {
  const results = copyState.results;
  assert.ok(results, 'Expected the gate to have checked a copy first');
  const matches = extraFieldsForMessage(results, message);
  for (const row of dataTable.hashes()) {
    const field = row['field'];
    const found = matches.some(m => m.includes(field));
    assert.ok(!found, `Expected "${field}" not to be flagged unknown for "${message}". Got: ${JSON.stringify(matches)}`);
  }
});
