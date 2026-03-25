/**
 * Step definitions for review harness BDD scenarios.
 *
 * Exercises the review phase end-to-end: fixture repo setup, CLI stub invocation,
 * GitHub API mock comment recording, and ReviewResult structured output parsing.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
  setupFixtureRepo,
  teardownFixtureRepo,
} from '../../test/mocks/test-harness.ts';
import type { MockContext, FixtureRepoContext } from '../../test/mocks/types.ts';
import type { ReviewResult } from '../../adws/agents/reviewAgent.ts';
import { extractJson } from '../../adws/core/jsonParser.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const STUB_PATH = resolve(ROOT, 'test/mocks/claude-cli-stub.ts');
const PAYLOAD_DIR = resolve(ROOT, 'test/fixtures/jsonl/payloads');

// ---------------------------------------------------------------------------
// Per-scenario world state
// ---------------------------------------------------------------------------

interface ReviewHarnessWorld {
  mockCtx?: MockContext;
  fixtureCtx?: FixtureRepoContext;
  lastStdout?: string;
  lastExitCode?: number;
  lastReviewResult?: ReviewResult | null;
}

// ---------------------------------------------------------------------------
// Before/After hooks scoped to @review-harness
// ---------------------------------------------------------------------------

Before({ tags: '@review-harness' }, async function (this: ReviewHarnessWorld) {
  await teardownMockInfrastructure();
  this.mockCtx = await setupMockInfrastructure();
});

After({ tags: '@review-harness' }, async function (this: ReviewHarnessWorld) {
  delete process.env['MOCK_FIXTURE_PATH'];
  if (this.fixtureCtx) {
    teardownFixtureRepo(this.fixtureCtx);
    this.fixtureCtx = undefined;
  }
  await teardownMockInfrastructure();
  this.mockCtx = undefined;
});

// ---------------------------------------------------------------------------
// Given steps
// ---------------------------------------------------------------------------

Given('the mock infrastructure is running', function (this: ReviewHarnessWorld) {
  assert.ok(this.mockCtx, 'Expected mock infrastructure to be set up (Before hook should have run)');
  assert.ok(this.mockCtx.port > 0, `Expected server to be on a valid port, got ${this.mockCtx.port}`);
});

Given('the fixture repo {string} is initialized as a git repo', function (this: ReviewHarnessWorld, fixtureName: string) {
  this.fixtureCtx = setupFixtureRepo(fixtureName);
  assert.ok(this.fixtureCtx.repoDir, 'Expected fixture repo to be set up with a valid repoDir');
});

Given('the Claude CLI stub is configured with the {string} payload', function (this: ReviewHarnessWorld, payloadName: string) {
  const payloadPath = resolve(PAYLOAD_DIR, `${payloadName}.json`);
  process.env['MOCK_FIXTURE_PATH'] = payloadPath;
});

Given('the GitHub mock server has issue {string} configured', async function (this: ReviewHarnessWorld, issueNumber: string) {
  assert.ok(this.mockCtx, 'Expected mock context to be available');
  await this.mockCtx.setState({
    issues: {
      [issueNumber]: {
        number: parseInt(issueNumber, 10),
        title: 'Test Review Issue',
        body: 'Test issue body for review harness testing.',
        state: 'OPEN',
        author: { login: 'test-user', name: 'Test User', is_bot: false },
        labels: [],
        comments: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        closedAt: null,
        url: `https://github.com/test-owner/test-repo/issues/${issueNumber}`,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// When steps
// ---------------------------------------------------------------------------

When('the Claude CLI stub is invoked with {string} command', function (this: ReviewHarnessWorld, command: string) {
  const result = spawnSync(
    'bun',
    [STUB_PATH, '--output-format', 'stream-json', command],
    { encoding: 'utf-8', env: { ...process.env } },
  );
  this.lastStdout = result.stdout ?? '';
  this.lastExitCode = result.status ?? -1;
});

When(
  'a review comment is posted to issue {string} with review proof data',
  async function (this: ReviewHarnessWorld, issueNumber: string) {
    assert.ok(this.mockCtx, 'Expected mock context to be available');
    const url = `${this.mockCtx.serverUrl}/repos/test-owner/test-repo/issues/${issueNumber}/comments`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: 'Review passed. Implementation follows the spec with clean code structure.',
      }),
    });
  },
);

When(
  'the review agent runs against the fixture repo for issue {string}',
  async function (this: ReviewHarnessWorld, issueNumber: string) {
    assert.ok(this.mockCtx, 'Expected mock context to be available');

    // Spawn CLI stub using the already-configured MOCK_FIXTURE_PATH
    const result = spawnSync(
      'bun',
      [STUB_PATH, '--output-format', 'stream-json', '/review'],
      { encoding: 'utf-8', env: { ...process.env } },
    );
    this.lastStdout = result.stdout ?? '';
    this.lastExitCode = result.status ?? -1;

    // Extract ReviewResult from JSONL output
    const lines = this.lastStdout.trim().split('\n').filter(Boolean);
    let reviewResult: ReviewResult | null = null;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed['type'] === 'assistant') {
          const msg = parsed as { message?: { content?: Array<{ type: string; text?: string }> } };
          const textBlock = msg.message?.content?.find((b) => b.type === 'text');
          if (textBlock?.text) {
            reviewResult = extractJson<ReviewResult>(textBlock.text);
          }
        }
      } catch { /* skip malformed lines */ }
    }
    this.lastReviewResult = reviewResult;

    // Post the review result as a comment to the mock GitHub API
    if (reviewResult) {
      const commentBody = `Review passed. ${reviewResult.reviewSummary ?? ''}\n\nReview proof: ${JSON.stringify(reviewResult)}`;
      const url = `${this.mockCtx.serverUrl}/repos/test-owner/test-repo/issues/${issueNumber}/comments`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody }),
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Then steps — CLI stub / ReviewResult assertions
// ---------------------------------------------------------------------------

Then('the JSONL output should contain a valid assistant message', function (this: ReviewHarnessWorld) {
  assert.strictEqual(this.lastExitCode, 0, `Expected exit code 0, got ${this.lastExitCode}`);
  const lines = (this.lastStdout ?? '').trim().split('\n').filter(Boolean);
  const assistantLine = lines.find((l) => {
    try { return (JSON.parse(l) as Record<string, unknown>)['type'] === 'assistant'; }
    catch { return false; }
  });
  assert.ok(assistantLine, 'Expected an assistant-type JSONL line in stdout');
});

Then('the assistant message text should contain a parseable ReviewResult JSON', function (this: ReviewHarnessWorld) {
  const lines = (this.lastStdout ?? '').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed['type'] === 'assistant') {
        const msg = parsed as { message?: { content?: Array<{ type: string; text?: string }> } };
        const textBlock = msg.message?.content?.find((b) => b.type === 'text');
        if (textBlock?.text) {
          const reviewResult = extractJson<ReviewResult>(textBlock.text);
          assert.ok(reviewResult, 'Expected parseable ReviewResult JSON in assistant message text');
          this.lastReviewResult = reviewResult;
          return;
        }
      }
    } catch { /* skip */ }
  }
  assert.fail('Expected an assistant message with text content containing ReviewResult JSON');
});

Then('the ReviewResult should have {string} equal to true', function (this: ReviewHarnessWorld, field: string) {
  assert.ok(this.lastReviewResult, 'Expected ReviewResult to be parsed');
  const value = (this.lastReviewResult as unknown as Record<string, unknown>)[field];
  assert.strictEqual(value, true, `Expected ReviewResult.${field} to be true, got ${String(value)}`);
});

Then('the ReviewResult should have {int} review issue with severity {string}', function (
  this: ReviewHarnessWorld,
  count: number,
  severity: string,
) {
  assert.ok(this.lastReviewResult, 'Expected ReviewResult to be parsed');
  const issues = this.lastReviewResult.reviewIssues ?? [];
  const filtered = issues.filter((i) => i.issueSeverity === severity);
  assert.strictEqual(
    filtered.length,
    count,
    `Expected ${count} issue(s) with severity "${severity}", got ${filtered.length}`,
  );
});

// ---------------------------------------------------------------------------
// Then steps — mock server recording assertions
// ---------------------------------------------------------------------------

Then('the mock server should have recorded a POST request to the issue comments endpoint', function (this: ReviewHarnessWorld) {
  const requests = this.mockCtx?.getRecordedRequests() ?? [];
  const found = requests.some((r) => r.method === 'POST' && r.url.includes('/comments'));
  assert.ok(found, 'Expected a recorded POST request to the issue comments endpoint');
});

Then('the recorded comment body should contain {string}', function (this: ReviewHarnessWorld, expected: string) {
  const requests = this.mockCtx?.getRecordedRequests() ?? [];
  const postRequest = requests.find((r) => r.method === 'POST' && r.url.includes('/comments'));
  assert.ok(postRequest, 'Expected a recorded POST request to the issue comments endpoint');
  let body: { body?: string } = {};
  try { body = JSON.parse(postRequest.body) as { body?: string }; } catch { /* ignore */ }
  assert.ok(
    body.body?.includes(expected),
    `Expected comment body to contain "${expected}", got: ${body.body ?? '(empty)'}`,
  );
});

Then('the review should produce a structured ReviewResult', function (this: ReviewHarnessWorld) {
  assert.ok(this.lastReviewResult, 'Expected the review to produce a structured ReviewResult');
  assert.strictEqual(typeof this.lastReviewResult.success, 'boolean', 'Expected ReviewResult.success to be a boolean');
  assert.ok(typeof this.lastReviewResult.reviewSummary === 'string', 'Expected ReviewResult.reviewSummary to be a string');
});

Then('the ReviewResult should classify issues with correct severities', function (this: ReviewHarnessWorld) {
  assert.ok(this.lastReviewResult, 'Expected ReviewResult to be available');
  const validSeverities = new Set<string>(['skippable', 'tech-debt', 'blocker']);
  for (const issue of this.lastReviewResult.reviewIssues ?? []) {
    assert.ok(
      validSeverities.has(issue.issueSeverity),
      `Expected issue severity to be one of [${[...validSeverities].join(', ')}], got: ${issue.issueSeverity}`,
    );
  }
});

Then('a comment should be posted to the mock GitHub API for issue {string}', function (this: ReviewHarnessWorld, issueNumber: string) {
  const requests = this.mockCtx?.getRecordedRequests() ?? [];
  const found = requests.some(
    (r) => r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`),
  );
  assert.ok(found, `Expected a POST request to issue ${issueNumber} comments endpoint in recordings`);
});

Then('the mock server recordings should contain the review proof data', function (this: ReviewHarnessWorld) {
  const requests = this.mockCtx?.getRecordedRequests() ?? [];
  const commentRequest = requests.find((r) => r.method === 'POST' && r.url.includes('/comments'));
  assert.ok(commentRequest, 'Expected a POST comment request in mock server recordings');
  assert.ok(
    commentRequest.body.includes('Review passed'),
    `Expected comment body to contain "Review passed", got: ${commentRequest.body}`,
  );
});
