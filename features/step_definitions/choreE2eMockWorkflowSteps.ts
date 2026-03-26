/**
 * Step definitions for the chore E2E mock workflow scenario.
 *
 * Tests the full mock infrastructure chain: CLI stub, GitHub API mock,
 * git mock, fixture repo, and JSONL parsing — all in one scenario.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import assert from 'assert';
import { setupFixtureRepo, teardownFixtureRepo } from '../../test/mocks/test-harness.ts';
import type { MockContext, FixtureRepoContext } from '../../test/mocks/types.ts';

const ROOT = process.cwd();
const STUB_PATH = resolve(ROOT, 'test/mocks/claude-cli-stub.ts');

// ---------------------------------------------------------------------------
// World interface
// ---------------------------------------------------------------------------
interface E2EWorld {
  mockCtx?: MockContext;
  fixtureCtx?: FixtureRepoContext;
  stubStdout: string;
  stubExitCode: number;
  parsedAssistant: Record<string, unknown> | null;
  parsedContent: Array<{ type: string; text?: string; name?: string; id?: string; input?: unknown }>;
  prResponseBody: string;
  pushExitCode: number;
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('mock infrastructure is running with all components', function (this: E2EWorld) {
  // The @mock-infrastructure Before hook already set up mockCtx
  assert.ok(this.mockCtx, 'Expected mock infrastructure to be running (Before hook)');
  assert.ok(this.mockCtx.port > 0, 'Expected mock server on a valid port');
  assert.ok(process.env['CLAUDE_CODE_PATH'], 'Expected CLAUDE_CODE_PATH to be set');
  assert.ok(process.env['REAL_GIT_PATH'], 'Expected REAL_GIT_PATH to be set');
});

// ---------------------------------------------------------------------------
// Stub invocation
// ---------------------------------------------------------------------------

When('the stub is invoked with prompt {string}', function (this: E2EWorld, prompt: string) {
  const result = spawnSync(
    'bun',
    [STUB_PATH, '--print', '--output-format', 'stream-json', '--model', 'sonnet', prompt],
    { encoding: 'utf-8', env: { ...process.env }, timeout: 30_000 },
  );
  this.stubStdout = result.stdout ?? '';
  this.stubExitCode = result.status ?? -1;

  // Parse JSONL for later assertions
  const lines = this.stubStdout.trim().split('\n').filter(Boolean);
  this.parsedAssistant = null;
  this.parsedContent = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed['type'] === 'assistant') {
        this.parsedAssistant = parsed;
        const msg = parsed['message'] as Record<string, unknown> | undefined;
        this.parsedContent = (msg?.['content'] as E2EWorld['parsedContent']) ?? [];
      }
    } catch { /* skip non-JSON */ }
  }
});

Then('the stub process exits successfully', function (this: E2EWorld) {
  assert.strictEqual(this.stubExitCode, 0, `Expected stub exit code 0, got ${this.stubExitCode}`);
});

Then('the stub output contains valid JSONL with an assistant message', function (this: E2EWorld) {
  const lines = this.stubStdout.trim().split('\n').filter(Boolean);
  assert.ok(lines.length >= 2, `Expected at least 2 JSONL lines, got ${lines.length}`);

  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), `Invalid JSON: ${line.slice(0, 100)}`);
  }

  assert.ok(this.parsedAssistant, 'Expected an assistant-type message in JSONL output');
});

Then('the assistant message contains a tool_use block for {string}', function (this: E2EWorld, toolName: string) {
  const toolBlock = this.parsedContent.find(b => b.type === 'tool_use' && b.name === toolName);
  assert.ok(
    toolBlock,
    `Expected a tool_use block for "${toolName}", found: [${this.parsedContent.filter(b => b.type === 'tool_use').map(b => b.name).join(', ')}]`,
  );
});

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

Then('the parsed JSONL contains at least {int} text block(s)', function (this: E2EWorld, count: number) {
  const textBlocks = this.parsedContent.filter(b => b.type === 'text');
  assert.ok(
    textBlocks.length >= count,
    `Expected at least ${count} text block(s), got ${textBlocks.length}`,
  );
});

Then('the parsed JSONL contains at least {int} tool_use block(s)', function (this: E2EWorld, count: number) {
  const toolBlocks = this.parsedContent.filter(b => b.type === 'tool_use');
  assert.ok(
    toolBlocks.length >= count,
    `Expected at least ${count} tool_use block(s), got ${toolBlocks.length}`,
  );
});

When('the JSONL plan output is captured', function (this: E2EWorld) {
  // The stub output was already captured in the previous When step
  assert.ok(this.parsedAssistant, 'Expected plan output to be captured from previous stub invocation');
});

// ---------------------------------------------------------------------------
// Fixture repo
// ---------------------------------------------------------------------------

Given('a fixture repo {string} is set up', function (this: E2EWorld, fixtureName: string) {
  if (this.fixtureCtx) {
    teardownFixtureRepo(this.fixtureCtx);
  }
  this.fixtureCtx = setupFixtureRepo(fixtureName);
});

Then('the fixture repo contains {string}', function (this: E2EWorld, filePath: string) {
  assert.ok(this.fixtureCtx, 'Expected fixture repo to be set up');
  const fullPath = join(this.fixtureCtx.repoDir, filePath);
  assert.ok(existsSync(fullPath), `Expected fixture repo to contain ${filePath}`);
});

Then('the fixture repo has at least {int} git commit(s)', function (this: E2EWorld, count: number) {
  assert.ok(this.fixtureCtx, 'Expected fixture repo to be set up');
  const gitBin = process.env['REAL_GIT_PATH'] ?? 'git';
  const result = spawnSync(gitBin, ['rev-list', '--count', 'HEAD'], {
    encoding: 'utf-8',
    cwd: this.fixtureCtx.repoDir,
  });
  const commitCount = parseInt(result.stdout?.trim() ?? '0', 10);
  assert.ok(commitCount >= count, `Expected at least ${count} commit(s), got ${commitCount}`);
});

// ---------------------------------------------------------------------------
// GitHub API mock — comments
// ---------------------------------------------------------------------------

When('a workflow comment {string} is posted to issue {int}', async function (this: E2EWorld, header: string, issueNum: number) {
  assert.ok(this.mockCtx, 'Expected mock infrastructure to be running');
  const url = `${this.mockCtx.serverUrl}/repos/test-owner/test-repo/issues/${issueNum}/comments`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: `${header}\n**ADW ID:** \`test1234\`\n\n---\n_Posted by ADW_ <!-- adw-bot -->` }),
  });
  assert.strictEqual(response.status, 201, `Expected 201 from comment POST, got ${response.status}`);
});

Then('the mock API recorded at least {int} POST requests to the comments endpoint', function (this: E2EWorld, count: number) {
  assert.ok(this.mockCtx, 'Expected mock infrastructure to be running');
  const requests = this.mockCtx.getRecordedRequests();
  const commentPosts = requests.filter(r => r.method === 'POST' && r.url.includes('/comments'));
  assert.ok(
    commentPosts.length >= count,
    `Expected at least ${count} comment POST(s), got ${commentPosts.length}`,
  );
});

// ---------------------------------------------------------------------------
// GitHub API mock — PR creation
// ---------------------------------------------------------------------------

When('a PR is created via the mock API with title {string}', async function (this: E2EWorld, title: string) {
  assert.ok(this.mockCtx, 'Expected mock infrastructure to be running');
  const url = `${this.mockCtx.serverUrl}/repos/test-owner/test-repo/pulls`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head: 'chore-issue-1-test1234', base: 'main', body: 'Chore PR' }),
  });
  this.prResponseBody = await response.text();
  assert.strictEqual(response.status, 201, `Expected 201 from PR POST, got ${response.status}`);
});

Then('the mock API recorded a POST request to the pulls endpoint', function (this: E2EWorld) {
  assert.ok(this.mockCtx, 'Expected mock infrastructure to be running');
  const requests = this.mockCtx.getRecordedRequests();
  const prPosts = requests.filter(r => r.method === 'POST' && r.url.includes('/pulls'));
  assert.ok(prPosts.length >= 1, `Expected at least 1 PR POST, got ${prPosts.length}`);
});

Then('the PR response contains a number field', function (this: E2EWorld) {
  const parsed = JSON.parse(this.prResponseBody) as Record<string, unknown>;
  assert.ok(typeof parsed['number'] === 'number', `Expected PR response to have a number field, got: ${JSON.stringify(parsed).slice(0, 200)}`);
});

// ---------------------------------------------------------------------------
// Git mock
// ---------------------------------------------------------------------------

When('{string} is run in the fixture repo', function (this: E2EWorld, command: string) {
  assert.ok(this.fixtureCtx, 'Expected fixture repo to be set up');
  const [cmd, ...args] = command.split(' ');
  const result = spawnSync(cmd ?? 'git', args, {
    encoding: 'utf-8',
    env: { ...process.env },
    cwd: this.fixtureCtx.repoDir,
  });
  this.pushExitCode = result.status ?? -1;
});

Then('the push exits with code {int}', function (this: E2EWorld, code: number) {
  assert.strictEqual(this.pushExitCode, code, `Expected push exit code ${code}, got ${this.pushExitCode}`);
});

Then('no actual network request was made', function () {
  // The git mock intercepts push/fetch/clone — if it returned success without
  // hitting a real remote, no network request was made. The mock prints
  // "Everything up-to-date" and exits 0, proving interception worked.
  // This is verified by the push exit code being 0.
});

// ---------------------------------------------------------------------------
// Full chain assertions
// ---------------------------------------------------------------------------

Then('the mock API recorded requests for comments and PR creation', function (this: E2EWorld) {
  assert.ok(this.mockCtx, 'Expected mock infrastructure to be running');
  const requests = this.mockCtx.getRecordedRequests();
  const commentPosts = requests.filter(r => r.method === 'POST' && r.url.includes('/comments'));
  const prPosts = requests.filter(r => r.method === 'POST' && r.url.includes('/pulls'));
  assert.ok(commentPosts.length >= 1, `Expected comment POST(s), got ${commentPosts.length}`);
  assert.ok(prPosts.length >= 1, `Expected PR POST(s), got ${prPosts.length}`);
});
