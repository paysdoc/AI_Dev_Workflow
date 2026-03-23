/**
 * Step definitions for mock infrastructure validation scenarios.
 *
 * Tests that the Claude CLI stub, GitHub API mock server, and git remote mock
 * work correctly in isolation before being used in full orchestrator BDD scenarios.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../test/mocks/test-harness.ts';
import type { MockContext } from '../../test/mocks/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const STUB_PATH = resolve(ROOT, 'test/mocks/claude-cli-stub.ts');
const FIXTURE_DIR = resolve(ROOT, 'test/fixtures');

// ---------------------------------------------------------------------------
// Per-scenario state (stored on `this` via World)
// ---------------------------------------------------------------------------

interface MockWorld {
  mockCtx?: MockContext;
  lastStdout?: string;
  lastExitCode?: number;
  lastResponseStatus?: number;
  lastResponseBody?: string;
  gitMockTempDir?: string;
}

// ---------------------------------------------------------------------------
// Before/After hooks scoped to @mock-infrastructure
// ---------------------------------------------------------------------------

Before({ tags: '@mock-infrastructure' }, async function (this: MockWorld) {
  // Always teardown first to clean up any orphaned setup from previous runs
  await teardownMockInfrastructure();
  this.mockCtx = await setupMockInfrastructure();
});

After({ tags: '@mock-infrastructure' }, async function (this: MockWorld) {
  if (this.gitMockTempDir && existsSync(this.gitMockTempDir)) {
    try {
      spawnSync('rm', ['-rf', this.gitMockTempDir]);
    } catch { /* best-effort */ }
  }
  await teardownMockInfrastructure();
  this.mockCtx = undefined;
});

// ---------------------------------------------------------------------------
// Given steps
// ---------------------------------------------------------------------------

Given('a JSONL payload fixture exists for the plan agent', function () {
  const fixturePath = join(FIXTURE_DIR, 'jsonl/payloads/plan-agent.json');
  assert.ok(existsSync(fixturePath), `Expected plan-agent.json fixture at ${fixturePath}`);
});

Given('a JSONL payload fixture exists for the build agent', function () {
  const fixturePath = join(FIXTURE_DIR, 'jsonl/payloads/build-agent.json');
  assert.ok(existsSync(fixturePath), `Expected build-agent.json fixture at ${fixturePath}`);
});

Given('the GitHub API mock server is running', function (this: MockWorld) {
  assert.ok(this.mockCtx, 'Expected mock context to be set up (Before hook should have run)');
  assert.ok(this.mockCtx.port > 0, `Expected server to be on a valid port, got ${this.mockCtx?.port}`);
});

Given('the git remote mock is on PATH', function (this: MockWorld) {
  const path = process.env['PATH'] ?? '';
  assert.ok(
    path.includes('.tmp-git-mock') || path.includes('mock'),
    `Expected PATH to contain git mock dir, got: ${path}`,
  );
});

// ---------------------------------------------------------------------------
// When steps — Claude CLI stub
// ---------------------------------------------------------------------------

When('the Claude CLI stub is invoked with standard CLI args', function (this: MockWorld) {
  const result = spawnSync(
    'bun',
    [STUB_PATH, '--print', '--verbose', '--dangerously-skip-permissions',
     '--output-format', 'stream-json', '--model', 'sonnet', '/feature test'],
    { encoding: 'utf-8', env: { ...process.env } },
  );
  this.lastStdout = result.stdout ?? '';
  this.lastExitCode = result.status ?? -1;
});

When('the Claude CLI stub is invoked with a {string} prompt', function (this: MockWorld, prompt: string) {
  const result = spawnSync(
    'bun',
    [STUB_PATH, '--print', '--output-format', 'stream-json', '--model', 'sonnet', prompt],
    { encoding: 'utf-8', env: { ...process.env } },
  );
  this.lastStdout = result.stdout ?? '';
  this.lastExitCode = result.status ?? -1;
});

// ---------------------------------------------------------------------------
// When steps — GitHub API mock server
// ---------------------------------------------------------------------------

When(
  'a GET request is made to the issue endpoint for issue {int}',
  async function (this: MockWorld, issueNum: number) {
    const url = `${this.mockCtx?.serverUrl}/repos/test-owner/test-repo/issues/${issueNum}`;
    const response = await fetch(url);
    this.lastResponseStatus = response.status;
    this.lastResponseBody = await response.text();
  },
);

When(
  'a POST comment request is made to the issue endpoint for issue {int}',
  async function (this: MockWorld, issueNum: number) {
    const url = `${this.mockCtx?.serverUrl}/repos/test-owner/test-repo/issues/${issueNum}/comments`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Test comment from step definition' }),
    });
    this.lastResponseStatus = response.status;
    this.lastResponseBody = await response.text();
  },
);

When(
  'custom issue state is configured with title {string}',
  async function (this: MockWorld, title: string) {
    const url = `${this.mockCtx?.serverUrl}/_mock/state`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issues: {
          '99': {
            number: 99,
            title,
            body: 'Custom body',
            state: 'OPEN',
            author: { login: 'test-user', name: 'Test User', is_bot: false },
            labels: [],
            comments: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            closedAt: null,
            url: 'https://github.com/test-owner/test-repo/issues/99',
          },
        },
      }),
    });
  },
);

When('the mock server state is reset', async function (this: MockWorld) {
  const url = `${this.mockCtx?.serverUrl}/_mock/reset`;
  await fetch(url, { method: 'POST' });
});

// ---------------------------------------------------------------------------
// When steps — git remote mock
// ---------------------------------------------------------------------------

When('the git mock runs {string}', function (this: MockWorld, command: string) {
  const [cmd, ...args] = command.split(' ');
  const result = spawnSync(cmd ?? 'git', args, {
    encoding: 'utf-8',
    env: { ...process.env },
    cwd: ROOT,
  });
  this.lastStdout = (result.stdout ?? '') + (result.stderr ?? '');
  this.lastExitCode = result.status ?? -1;
});

// ---------------------------------------------------------------------------
// Then steps — CLI stub assertions
// ---------------------------------------------------------------------------

Then('stdout contains valid JSONL lines', function (this: MockWorld) {
  assert.strictEqual(this.lastExitCode, 0, `Expected exit code 0, got ${this.lastExitCode}`);
  const lines = (this.lastStdout ?? '').trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'Expected at least one JSONL line in stdout');
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      assert.fail(`Expected valid JSON on line: ${line}`);
    }
    assert.ok(
      parsed !== null && typeof parsed === 'object',
      `Expected JSON object on line: ${line}`,
    );
  }
});

Then('the output includes an assistant message with content blocks', function (this: MockWorld) {
  const lines = (this.lastStdout ?? '').trim().split('\n').filter(Boolean);
  const assistantLine = lines.find((l) => {
    try {
      const parsed = JSON.parse(l) as Record<string, unknown>;
      return parsed['type'] === 'assistant';
    } catch {
      return false;
    }
  });
  assert.ok(assistantLine, 'Expected an assistant-type JSONL line in stdout');
  const msg = JSON.parse(assistantLine) as {
    message?: { content?: unknown[] };
  };
  assert.ok(
    Array.isArray(msg.message?.content) && (msg.message?.content?.length ?? 0) > 0,
    'Expected assistant message to have content blocks',
  );
});

Then('the output includes a result message with sessionId', function (this: MockWorld) {
  const lines = (this.lastStdout ?? '').trim().split('\n').filter(Boolean);
  const resultLine = lines.find((l) => {
    try {
      const parsed = JSON.parse(l) as Record<string, unknown>;
      return parsed['type'] === 'result';
    } catch {
      return false;
    }
  });
  assert.ok(resultLine, 'Expected a result-type JSONL line in stdout');
  const msg = JSON.parse(resultLine) as Record<string, unknown>;
  assert.ok(msg['sessionId'], 'Expected result message to have a sessionId field');
});

// ---------------------------------------------------------------------------
// Then steps — GitHub mock server assertions
// ---------------------------------------------------------------------------

Then('the response status is {int}', function (this: MockWorld, expectedStatus: number) {
  assert.strictEqual(
    this.lastResponseStatus,
    expectedStatus,
    `Expected response status ${expectedStatus}, got ${this.lastResponseStatus}`,
  );
});

Then('the response body contains the default issue fixture', function (this: MockWorld) {
  const body = this.lastResponseBody ?? '';
  assert.ok(body.includes('Test Issue'), `Expected "Test Issue" in response body: ${body}`);
  assert.ok(body.includes('"state"'), `Expected "state" field in response body: ${body}`);
});

Then('the response body contains {string}', function (this: MockWorld, expected: string) {
  assert.ok(
    (this.lastResponseBody ?? '').includes(expected),
    `Expected "${expected}" in response body: ${this.lastResponseBody}`,
  );
});

Then('the request appears in the recorded requests', async function (this: MockWorld) {
  const url = `${this.mockCtx?.serverUrl}/_mock/requests`;
  const response = await fetch(url);
  const requests = await response.json() as Array<{ method: string; url: string }>;
  assert.ok(requests.length > 0, 'Expected at least one recorded request');
});

Then('the recorded request has method {string}', async function (this: MockWorld, method: string) {
  const url = `${this.mockCtx?.serverUrl}/_mock/requests`;
  const response = await fetch(url);
  const requests = await response.json() as Array<{ method: string; url: string }>;
  const found = requests.some((r) => r.method === method);
  assert.ok(found, `Expected a recorded request with method ${method}`);
});

Then('the recorded requests list is empty', async function (this: MockWorld) {
  const url = `${this.mockCtx?.serverUrl}/_mock/requests`;
  const response = await fetch(url);
  const requests = await response.json() as unknown[];
  assert.strictEqual(requests.length, 0, `Expected empty recorded requests, got ${requests.length}`);
});

// ---------------------------------------------------------------------------
// Then steps — git mock assertions
// ---------------------------------------------------------------------------

Then('the mock git command exits with code {int}', function (this: MockWorld, expectedCode: number) {
  assert.strictEqual(
    this.lastExitCode,
    expectedCode,
    `Expected exit code ${expectedCode}, got ${this.lastExitCode}`,
  );
});

Then('the output contains {string}', function (this: MockWorld, expected: string) {
  assert.ok(
    (this.lastStdout ?? '').includes(expected),
    `Expected output to contain "${expected}", got: ${this.lastStdout}`,
  );
});
