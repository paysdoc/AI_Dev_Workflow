/**
 * Step definitions for claude_cli_stub.feature
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { spawnSync } from 'child_process';
import { existsSync, statSync, readFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const STUB_PATH = join(ROOT, 'test/mocks/claude-cli-stub.ts');
const FIXTURE_DIR = join(ROOT, 'test/fixtures/jsonl');
const ENVELOPE_DIR = join(FIXTURE_DIR, 'envelopes');
const PAYLOAD_DIR = join(FIXTURE_DIR, 'payloads');

interface StubWorld {
  stubLastStdout?: string;
  stubLastExitCode?: number;
  stubLastFixturePath?: string;
  stubEnvelopeFiles?: string[];
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

// 'the ADW codebase is checked out' is defined in commonSteps.ts

Given('the Claude CLI stub script exists', function () {
  assert.ok(existsSync(STUB_PATH), `Expected Claude CLI stub at ${STUB_PATH}`);
});

// ---------------------------------------------------------------------------
// Stub existence
// ---------------------------------------------------------------------------

Then('the stub script is an executable file', function () {
  assert.ok(existsSync(STUB_PATH), `Expected stub at ${STUB_PATH}`);
  const stat = statSync(STUB_PATH);
  // Check owner execute bit (0o100)
  assert.ok(stat.mode & 0o100, `Expected stub to have execute permission, mode: ${stat.mode.toString(8)}`);
});

Then('it can be invoked without errors when given a fixture path', function () {
  const result = spawnSync('bun', [STUB_PATH], {
    encoding: 'utf-8',
    env: { ...process.env, MOCK_FIXTURE_PATH: join(PAYLOAD_DIR, 'plan-agent.json') },
  });
  assert.strictEqual(result.status, 0, `Stub exited with ${result.status}: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// Fixture Given steps
// ---------------------------------------------------------------------------

Given('a JSONL fixture file for a plan agent response', function (this: StubWorld) {
  const path = join(PAYLOAD_DIR, 'plan-agent.json');
  assert.ok(existsSync(path), `Expected plan-agent payload at ${path}`);
  this.stubLastFixturePath = path;
});

Given('a JSONL fixture file for a build agent response', function (this: StubWorld) {
  const path = join(PAYLOAD_DIR, 'build-agent.json');
  assert.ok(existsSync(path), `Expected build-agent payload at ${path}`);
  this.stubLastFixturePath = path;
});

Given('a JSONL fixture file for a review agent response', function (this: StubWorld) {
  const path = join(PAYLOAD_DIR, 'review-agent.json');
  assert.ok(existsSync(path), `Expected review-agent payload at ${path}`);
  this.stubLastFixturePath = path;
});

Given('a JSONL fixture directory', function (this: StubWorld) {
  assert.ok(existsSync(FIXTURE_DIR), `Expected JSONL fixture dir at ${FIXTURE_DIR}`);
  assert.ok(existsSync(ENVELOPE_DIR), `Expected envelopes dir at ${ENVELOPE_DIR}`);
  assert.ok(existsSync(PAYLOAD_DIR), `Expected payloads dir at ${PAYLOAD_DIR}`);
});

Given('an envelope fixture file', function (this: StubWorld) {
  const files = readdirSync(ENVELOPE_DIR).map((f) => join(ENVELOPE_DIR, f));
  assert.ok(files.length > 0, `Expected at least one envelope file in ${ENVELOPE_DIR}`);
  this.stubEnvelopeFiles = files;
});

Given('a payload fixture file for the plan agent', function (this: StubWorld) {
  const path = join(PAYLOAD_DIR, 'plan-agent.json');
  assert.ok(existsSync(path), `Expected plan-agent payload at ${path}`);
  this.stubLastFixturePath = path;
});

// ---------------------------------------------------------------------------
// When steps — stub invocation
// ---------------------------------------------------------------------------

When('the stub is invoked with {string}', function (this: StubWorld, args: string) {
  const result = spawnSync('bun', [STUB_PATH, ...args.split(' ')], {
    encoding: 'utf-8',
    env: { ...process.env },
  });
  this.stubLastStdout = result.stdout ?? '';
  this.stubLastExitCode = result.status ?? -1;
});

When('the stub is invoked with the fixture path', function (this: StubWorld) {
  const fixturePath = this.stubLastFixturePath;
  assert.ok(fixturePath, 'Expected a fixture path to have been set in a prior Given step');
  const result = spawnSync('bun', [STUB_PATH], {
    encoding: 'utf-8',
    env: { ...process.env, MOCK_FIXTURE_PATH: fixturePath },
  });
  this.stubLastStdout = result.stdout ?? '';
  this.stubLastExitCode = result.status ?? -1;
});

// ---------------------------------------------------------------------------
// Then steps — CLI stub assertions
// ---------------------------------------------------------------------------

Then('the stub does not exit with an error', function (this: StubWorld) {
  assert.strictEqual(this.stubLastExitCode, 0, `Expected exit code 0, got ${this.stubLastExitCode}`);
});

Then('the stub writes the fixture content to stdout line by line', function (this: StubWorld) {
  const lines = (this.stubLastStdout ?? '').trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'Expected at least one output line from the stub');
});

Then('each line is valid JSON', function (this: StubWorld) {
  const lines = (this.stubLastStdout ?? '').trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'Expected at least one line of output');
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), `Expected valid JSON on line: ${line}`);
  }
});

Then('the output contains JSONL messages with a {string} field', function (this: StubWorld, fieldName: string) {
  const lines = (this.stubLastStdout ?? '').trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'Expected output lines');
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.ok(fieldName in parsed, `Expected field "${fieldName}" in line: ${line}`);
  }
});

Then('the output ends with a result message', function (this: StubWorld) {
  const lines = (this.stubLastStdout ?? '').trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'Expected output lines');
  const lastLine = lines[lines.length - 1] ?? '';
  const parsed = JSON.parse(lastLine) as Record<string, unknown>;
  assert.strictEqual(parsed['type'], 'result', `Expected last line to have type "result", got: ${lastLine}`);
});

Then('the stub exits with code 0', function (this: StubWorld) {
  assert.strictEqual(this.stubLastExitCode, 0, `Expected exit code 0, got ${this.stubLastExitCode}`);
});

// ---------------------------------------------------------------------------
// Then steps — fixture existence
// ---------------------------------------------------------------------------

Then('a JSONL fixture file exists for the plan agent', function (this: StubWorld) {
  const path = join(PAYLOAD_DIR, 'plan-agent.json');
  assert.ok(existsSync(path), `Expected plan-agent payload at ${path}`);
  this.stubLastFixturePath = path;
});

Then('a JSONL fixture file exists for the build agent', function (this: StubWorld) {
  const path = join(PAYLOAD_DIR, 'build-agent.json');
  assert.ok(existsSync(path), `Expected build-agent payload at ${path}`);
  this.stubLastFixturePath = path;
});

Then('a JSONL fixture file exists for the review agent', function (this: StubWorld) {
  const path = join(PAYLOAD_DIR, 'review-agent.json');
  assert.ok(existsSync(path), `Expected review-agent payload at ${path}`);
  this.stubLastFixturePath = path;
});

Then('the fixture contains at least one assistant message and a result message', function (this: StubWorld) {
  const fixturePath = this.stubLastFixturePath;
  assert.ok(fixturePath, 'Expected stubLastFixturePath to be set by a prior step');
  const result = spawnSync('bun', [STUB_PATH], {
    encoding: 'utf-8',
    env: { ...process.env, MOCK_FIXTURE_PATH: fixturePath },
  });
  const lines = (result.stdout ?? '').trim().split('\n').filter(Boolean);
  const hasAssistant = lines.some((l) => {
    try { return (JSON.parse(l) as Record<string, unknown>)['type'] === 'assistant'; } catch { return false; }
  });
  const hasResult = lines.some((l) => {
    try { return (JSON.parse(l) as Record<string, unknown>)['type'] === 'result'; } catch { return false; }
  });
  assert.ok(hasAssistant, 'Expected at least one assistant-type message in fixture output');
  assert.ok(hasResult, 'Expected a result-type message in fixture output');
});

// ---------------------------------------------------------------------------
// Then steps — envelope / payload split
// ---------------------------------------------------------------------------

Then('envelope files define the JSONL message structure with type and metadata fields', function () {
  const files = readdirSync(ENVELOPE_DIR).filter((f) => f.endsWith('.jsonl'));
  assert.ok(files.length > 0, `Expected envelope .jsonl files in ${ENVELOPE_DIR}`);
  for (const file of files) {
    const content = readFileSync(join(ENVELOPE_DIR, file), 'utf-8').trim();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.ok('type' in parsed, `Expected "type" field in envelope ${file}`);
  }
});

Then('payload files define the agent-specific content', function () {
  const files = readdirSync(PAYLOAD_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, `Expected payload .json files in ${PAYLOAD_DIR}`);
  for (const file of files) {
    const content = readFileSync(join(PAYLOAD_DIR, file), 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    assert.ok(Array.isArray(parsed), `Expected payload ${file} to be a JSON array of content blocks`);
  }
});

Then('the stub combines envelope and payload when streaming', function () {
  const result = spawnSync('bun', [STUB_PATH], {
    encoding: 'utf-8',
    env: { ...process.env, MOCK_FIXTURE_PATH: join(PAYLOAD_DIR, 'plan-agent.json') },
  });
  assert.strictEqual(result.status, 0, `Stub exited with ${result.status}`);
  const lines = (result.stdout ?? '').trim().split('\n').filter(Boolean);
  const assistantLine = lines.find((l) => {
    try { return (JSON.parse(l) as Record<string, unknown>)['type'] === 'assistant'; } catch { return false; }
  });
  assert.ok(assistantLine, 'Expected an assistant-type line in stub output');
  const msg = JSON.parse(assistantLine) as { message?: { content?: unknown[] } };
  assert.ok(
    Array.isArray(msg.message?.content) && (msg.message?.content?.length ?? 0) > 0,
    'Expected combined envelope+payload to have non-empty content array',
  );
});

Then('each message has a {string} field', function (this: StubWorld, fieldName: string) {
  const files = this.stubEnvelopeFiles ?? readdirSync(ENVELOPE_DIR).map((f) => join(ENVELOPE_DIR, f));
  for (const file of files) {
    const content = readFileSync(file, 'utf-8').trim();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.ok(fieldName in parsed, `Expected field "${fieldName}" in envelope ${file}`);
  }
});

Then('messages include types {string}, {string}, and {string}', function (_t1: string, _t2: string, _t3: string) {
  const expectedTypes = new Set([_t1, _t2, _t3]);
  const foundTypes = new Set<string>();
  const files = readdirSync(ENVELOPE_DIR).filter((f) => f.endsWith('.jsonl'));
  for (const file of files) {
    const content = readFileSync(join(ENVELOPE_DIR, file), 'utf-8').trim();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed['type'] === 'string') foundTypes.add(parsed['type']);
  }
  for (const t of expectedTypes) {
    assert.ok(foundTypes.has(t), `Expected envelope type "${t}" but found types: ${[...foundTypes].join(', ')}`);
  }
});

Then('the result message includes a {string} field', function (fieldName: string) {
  const resultPath = join(ENVELOPE_DIR, 'result-message.jsonl');
  assert.ok(existsSync(resultPath), `Expected result-message.jsonl at ${resultPath}`);
  const parsed = JSON.parse(readFileSync(resultPath, 'utf-8').trim()) as Record<string, unknown>;
  assert.ok(fieldName in parsed, `Expected field "${fieldName}" in result-message.jsonl`);
});

Then('it contains plan-specific content such as implementation steps or file paths', function (this: StubWorld) {
  const fixturePath = this.stubLastFixturePath ?? join(PAYLOAD_DIR, 'plan-agent.json');
  const content = readFileSync(fixturePath, 'utf-8');
  const hasSteps = content.includes('Steps') || content.includes('steps') || content.includes('Implementation');
  const hasFilePaths = content.includes('.ts') || content.includes('.js') || content.includes('src/');
  assert.ok(
    hasSteps || hasFilePaths,
    `Expected plan-specific content (steps or file paths) in ${fixturePath}`,
  );
});

Then('the content is valid JSON', function (this: StubWorld) {
  const fixturePath = this.stubLastFixturePath ?? join(PAYLOAD_DIR, 'plan-agent.json');
  const content = readFileSync(fixturePath, 'utf-8');
  assert.doesNotThrow(() => JSON.parse(content), `Expected ${fixturePath} to contain valid JSON`);
});
