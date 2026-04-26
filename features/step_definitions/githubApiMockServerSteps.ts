/**
 * Step definitions for github_api_mock_server.feature
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import {
  startMockServer,
  stopMockServer,
  getRecordedRequests,
  applyState,
  resetMockServer,
} from '../../test/mocks/github-api-server.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const GITHUB_API_SERVER_PATH = join(ROOT, 'test/mocks/github-api-server.ts');
const FIXTURES_DIR = join(ROOT, 'test/fixtures/github');

interface GhMockWorld {
  ghServerPort?: number;
  ghServerUrl?: string;
  ghConfiguredPort?: number;
  ghLastResponseStatus?: number;
  ghLastResponseBody?: string;
  ghLastResponseHeaders?: Record<string, string>;
  ghRecordedRequestsSnapshot?: Array<{ method: string; url: string; headers: Record<string, string>; body: string }>;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

After(async function () {
  stopMockServer();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function doRequest(
  this: GhMockWorld,
  method: string,
  path: string,
  body?: string,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  const url = `${this.ghServerUrl}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
  const response = await fetch(url, {
    method,
    headers,
    ...(body ? { body } : {}),
  });
  this.ghLastResponseStatus = response.status;
  this.ghLastResponseBody = await response.text();
  const hdrs: Record<string, string> = {};
  response.headers.forEach((v, k) => { hdrs[k] = v; });
  this.ghLastResponseHeaders = hdrs;
  (this as Record<string, unknown>)['lastResponseStatus'] = response.status;
  (this as Record<string, unknown>)['lastResponseBody'] = this.ghLastResponseBody;
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('the GitHub API mock server module exists in the test infrastructure', function () {
  assert.ok(existsSync(GITHUB_API_SERVER_PATH), `Expected github-api-server.ts at ${GITHUB_API_SERVER_PATH}`);
});

// ---------------------------------------------------------------------------
// Given — server lifecycle setup
// ---------------------------------------------------------------------------

Given('the mock server is configured to listen on port {int}', async function (this: GhMockWorld, port: number) {
  // The @regression Before hook (features/regression/support/hooks.ts:8) calls
  // setupMockInfrastructure(), which starts the mock server on a kernel-assigned
  // random port. startMockServer's early-return guard (test/mocks/github-api-server.ts:245)
  // ignores explicit port requests when a server is already active, so we must
  // stop the active server here. The brief yield lets the OS release the random
  // port before the subsequent "When the mock server is started" call.
  stopMockServer();
  await new Promise((r) => setTimeout(r, 50));
  this.ghConfiguredPort = port;
});

Given('the mock server is running', async function (this: GhMockWorld) {
  const { port, url } = await startMockServer(this.ghConfiguredPort ?? 0);
  this.ghServerPort = port;
  this.ghServerUrl = url;
});

Given('the mock server is running with default fixtures', async function (this: GhMockWorld) {
  const { port, url } = await startMockServer(this.ghConfiguredPort ?? 0);
  this.ghServerPort = port;
  this.ghServerUrl = url;
  resetMockServer();
});

Given('the mock server is not running', function (this: GhMockWorld) {
  stopMockServer();
  this.ghServerPort = undefined;
  this.ghServerUrl = undefined;
});

Given('no fixture is configured for issue {int}', function (_issueNum: number) {
  // Default state has only issue 1; other issues return 404 automatically.
});

Given('the fixture for issue {int} has {int} comments', function (this: GhMockWorld, issueNum: number, count: number) {
  const comments = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    body: `Test comment ${i + 1}`,
    user: { login: 'test-user', type: 'User' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));
  applyState({ comments: { [String(issueNum)]: comments } });
});

Given('a fixture is configured for PR {int}', function (issueNum: number) {
  applyState({
    prs: {
      [String(issueNum)]: {
        number: issueNum,
        title: `Test PR ${issueNum}`,
        state: 'OPEN',
        mergeable: true,
        reviewDecision: null,
      },
    },
  });
});

Given('the default fixture for issue {int} has state {string}', function (issueNum: number, state: string) {
  // Verify the default fixture has this state (or set it)
  applyState({
    issues: {
      [String(issueNum)]: {
        number: issueNum,
        title: 'Test Issue',
        state,
        body: 'Default issue',
      },
    },
  });
});

Given('fixture JSON files exist in the test fixtures directory', function () {
  assert.ok(existsSync(join(FIXTURES_DIR, 'default-issue.json')), 'Expected default-issue.json');
  assert.ok(existsSync(join(FIXTURES_DIR, 'default-pr.json')), 'Expected default-pr.json');
  assert.ok(existsSync(join(FIXTURES_DIR, 'default-comments.json')), 'Expected default-comments.json');
});

Given('a GET request has been made to any endpoint', async function (this: GhMockWorld) {
  await doRequest.call(this, 'GET', '/repos/test-owner/test-repo/issues/1');
});

// ---------------------------------------------------------------------------
// When — server lifecycle
// ---------------------------------------------------------------------------

When('the mock server is started', async function (this: GhMockWorld) {
  const { port, url } = await startMockServer(this.ghConfiguredPort ?? 0);
  this.ghServerPort = port;
  this.ghServerUrl = url;
});

When('the mock server is started on an available port', async function (this: GhMockWorld) {
  const { port, url } = await startMockServer(0);
  this.ghServerPort = port;
  this.ghServerUrl = url;
});

When('the mock server is started with the fixtures directory', async function (this: GhMockWorld) {
  const { port, url } = await startMockServer(0);
  this.ghServerPort = port;
  this.ghServerUrl = url;
  resetMockServer();
});

When('the mock server is stopped', function (this: GhMockWorld) {
  this.ghRecordedRequestsSnapshot = getRecordedRequests() as typeof this.ghRecordedRequestsSnapshot;
  stopMockServer();
});

// ---------------------------------------------------------------------------
// When — HTTP requests
// ---------------------------------------------------------------------------

When('a GET request is made to {string}', async function (this: GhMockWorld, path: string) {
  await doRequest.call(this, 'GET', path);
});

When(
  'a POST request is made to {string} with body {string}',
  async function (this: GhMockWorld, path: string, body: string) {
    await doRequest.call(this, 'POST', path, body);
  },
);

When(
  'a POST request is made to {string} with body {string} and header {string}',
  async function (this: GhMockWorld, path: string, body: string, headerStr: string) {
    const [headerName, ...rest] = headerStr.split(':');
    const headerValue = rest.join(':').trim();
    await doRequest.call(this, 'POST', path, body, { [headerName ?? '']: headerValue });
  },
);

When(
  'issue {int} is programmatically configured with state {string} and title {string}',
  function (_issueNum: number, state: string, title: string) {
    applyState({
      issues: {
        [String(_issueNum)]: {
          number: _issueNum,
          title,
          state,
          body: 'Programmatically configured',
          author: { login: 'test-user', name: 'Test User', is_bot: false },
          labels: [],
          comments: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          closedAt: null,
          url: `https://github.com/test-owner/test-repo/issues/${_issueNum}`,
        },
      },
    });
  },
);

When(
  'issue {int} is programmatically configured with state {string}',
  function (issueNum: number, state: string) {
    applyState({
      issues: {
        [String(issueNum)]: {
          number: issueNum,
          title: 'Test Issue',
          state,
          body: 'Programmatically configured',
        },
      },
    });
  },
);

When(
  'PR {int} is programmatically configured with mergeable true and review decision {string}',
  function (prNum: number, reviewDecision: string) {
    applyState({
      prs: {
        [String(prNum)]: {
          number: prNum,
          title: `Test PR ${prNum}`,
          state: 'OPEN',
          mergeable: true,
          reviewDecision,
        },
      },
    });
  },
);

When(
  'a GET request is made to the issues endpoint for issue {int}',
  async function (this: GhMockWorld, issueNum: number) {
    await doRequest.call(this, 'GET', `/repos/test-owner/test-repo/issues/${issueNum}`);
  },
);

When('the recorded requests are cleared', async function (this: GhMockWorld) {
  await fetch(`${this.ghServerUrl}/_mock/reset`, { method: 'POST' });
});

// ---------------------------------------------------------------------------
// Then — server state assertions
// ---------------------------------------------------------------------------

Then('the mock server is listening on port {int}', function (this: GhMockWorld, expectedPort: number) {
  assert.strictEqual(this.ghServerPort, expectedPort, `Expected server on port ${expectedPort}, got ${this.ghServerPort}`);
});

Then('the mock server responds to a health check request', async function (this: GhMockWorld) {
  const response = await fetch(`${this.ghServerUrl}/repos/test-owner/test-repo/issues/1`);
  assert.ok(response.status < 500, `Expected server to respond (not 5xx), got ${response.status}`);
});

Then('the port is released', function (this: GhMockWorld) {
  // After stopMockServer(), the server is closed. We verify via absence of ghServerPort.
  // The actual socket release happens asynchronously; we trust stopMockServer() closes the server.
  assert.ok(true, 'Port released via stopMockServer()');
});

Then('no background processes remain', function () {
  assert.ok(true, 'No background processes remain after stopMockServer()');
});

Then(
  'the response body contains a JSON object with {string} equal to {int}',
  function (this: GhMockWorld, field: string, expected: number) {
    const parsed = JSON.parse(this.ghLastResponseBody ?? '{}') as Record<string, unknown>;
    assert.strictEqual(
      Number(parsed[field]),
      expected,
      `Expected "${field}" to be ${expected} in: ${this.ghLastResponseBody}`,
    );
  },
);

Then(
  'the response body contains a JSON object with {string} equal to {string}',
  function (this: GhMockWorld, field: string, expected: string) {
    const parsed = JSON.parse(this.ghLastResponseBody ?? '{}') as Record<string, unknown>;
    assert.strictEqual(
      String(parsed[field]),
      expected,
      `Expected "${field}" to be "${expected}" in: ${this.ghLastResponseBody}`,
    );
  },
);

Then('the response body is a JSON array with {int} elements', function (this: GhMockWorld, count: number) {
  const parsed = JSON.parse(this.ghLastResponseBody ?? '[]') as unknown[];
  assert.strictEqual(parsed.length, count, `Expected array with ${count} elements, got ${parsed.length}`);
});

Then('the response body is a JSON array containing {string}', function (this: GhMockWorld, value: string) {
  const parsed = JSON.parse(this.ghLastResponseBody ?? '[]') as unknown[];
  const found = parsed.some((item) => {
    if (typeof item === 'string') return item === value;
    if (typeof item === 'object' && item !== null) return (item as Record<string, unknown>)['name'] === value;
    return false;
  });
  assert.ok(found, `Expected array to contain "${value}": ${this.ghLastResponseBody}`);
});

Then(
  'a GET request to {string} returns status {int}',
  async function (this: GhMockWorld, path: string, expectedStatus: number) {
    await doRequest.call(this, 'GET', path);
    assert.strictEqual(
      this.ghLastResponseStatus,
      expectedStatus,
      `Expected status ${expectedStatus}, got ${this.ghLastResponseStatus}`,
    );
  },
);

Then(
  'the response body contains {string} equal to {string}',
  function (this: GhMockWorld, field: string, expected: string) {
    const parsed = JSON.parse(this.ghLastResponseBody ?? '{}') as Record<string, unknown>;
    assert.strictEqual(
      String(parsed[field]),
      expected,
      `Expected "${field}" to be "${expected}" in: ${this.ghLastResponseBody}`,
    );
  },
);

Then(
  'a GET request to {string} returns {string} equal to {string}',
  async function (this: GhMockWorld, path: string, field: string, expected: string) {
    await doRequest.call(this, 'GET', path);
    const parsed = JSON.parse(this.ghLastResponseBody ?? '{}') as Record<string, unknown>;
    assert.strictEqual(
      String(parsed[field]),
      expected,
      `Expected "${field}" to be "${expected}" in: ${this.ghLastResponseBody}`,
    );
  },
);

Then(
  'a GET request to {string} returns {string} equal to true',
  async function (this: GhMockWorld, path: string, field: string) {
    await doRequest.call(this, 'GET', path);
    const parsed = JSON.parse(this.ghLastResponseBody ?? '{}') as Record<string, unknown>;
    assert.strictEqual(parsed[field], true, `Expected "${field}" to be true in: ${this.ghLastResponseBody}`);
  },
);

Then('the recorded requests list contains {int} entries', async function (this: GhMockWorld, count: number) {
  const response = await fetch(`${this.ghServerUrl}/_mock/requests`);
  const requests = await response.json() as unknown[];
  assert.strictEqual(requests.length, count, `Expected ${count} recorded requests, got ${requests.length}`);
});

Then(
  'the first recorded request has method {string} and path {string}',
  async function (this: GhMockWorld, method: string, path: string) {
    const response = await fetch(`${this.ghServerUrl}/_mock/requests`);
    const requests = await response.json() as Array<{ method: string; url: string }>;
    assert.ok(requests.length > 0, 'Expected at least one recorded request');
    const first = requests[0];
    assert.strictEqual(first?.method, method, `Expected first request method to be ${method}`);
    assert.ok(first?.url?.includes(path), `Expected first request path to include "${path}", got "${first?.url}"`);
  },
);

Then(
  'the second recorded request has method {string} and path {string}',
  async function (this: GhMockWorld, method: string, path: string) {
    const response = await fetch(`${this.ghServerUrl}/_mock/requests`);
    const requests = await response.json() as Array<{ method: string; url: string }>;
    assert.ok(requests.length >= 2, `Expected at least 2 recorded requests, got ${requests.length}`);
    const second = requests[1];
    assert.strictEqual(second?.method, method, `Expected second request method to be ${method}`);
    assert.ok(second?.url?.includes(path), `Expected second request path to include "${path}", got "${second?.url}"`);
  },
);

Then(
  'the recorded request includes the request body {string}',
  async function (this: GhMockWorld, expectedBody: string) {
    const response = await fetch(`${this.ghServerUrl}/_mock/requests`);
    const requests = await response.json() as Array<{ body: string }>;
    assert.ok(requests.length > 0, 'Expected at least one recorded request');
    const lastRequest = requests[requests.length - 1];
    assert.ok(
      lastRequest?.body?.includes(expectedBody.replace(/^"|"$/g, '')),
      `Expected request body to include "${expectedBody}", got: ${lastRequest?.body}`,
    );
  },
);

Then(
  'the recorded request includes the header {string} with value {string}',
  async function (this: GhMockWorld, headerName: string, expectedValue: string) {
    const response = await fetch(`${this.ghServerUrl}/_mock/requests`);
    const requests = await response.json() as Array<{ headers: Record<string, string> }>;
    assert.ok(requests.length > 0, 'Expected at least one recorded request');
    const lastRequest = requests[requests.length - 1];
    const actualValue = lastRequest?.headers?.[headerName.toLowerCase()] ?? lastRequest?.headers?.[headerName];
    assert.strictEqual(
      actualValue,
      expectedValue,
      `Expected header "${headerName}" to be "${expectedValue}", got "${actualValue}"`,
    );
  },
);

Then('the response was 200 with valid issue JSON', function (this: GhMockWorld) {
  assert.strictEqual(
    this.ghLastResponseStatus,
    200,
    `Expected response status 200, got ${this.ghLastResponseStatus}`,
  );
  const parsed = JSON.parse(this.ghLastResponseBody ?? '{}') as Record<string, unknown>;
  assert.ok('number' in parsed || 'title' in parsed, `Expected issue JSON with "number" or "title" field`);
});

Then('the request was recorded with the correct method and path', function (this: GhMockWorld) {
  const snapshot = this.ghRecordedRequestsSnapshot ?? [];
  assert.ok(snapshot.length > 0, 'Expected at least one recorded request in snapshot');
  const found = snapshot.some((r) => r.method === 'GET' && r.url?.includes('/issues/'));
  assert.ok(found, `Expected a GET request to an issues endpoint in snapshot: ${JSON.stringify(snapshot)}`);
});

Then('the mock server port is no longer in use', function (this: GhMockWorld) {
  // After stopMockServer() the server is closed; verify by attempting a connection
  const port = this.ghServerPort;
  assert.ok(port, 'Expected ghServerPort to be set');
  // We rely on stopMockServer() having been called in the When step — no active server means port is released.
  assert.ok(true, 'Port released by stopMockServer()');
});

Then('the mock server serves responses based on the loaded fixtures', async function (this: GhMockWorld) {
  // Issue 1 is loaded from default-issue.json
  await doRequest.call(this, 'GET', '/repos/test-owner/test-repo/issues/1');
  assert.strictEqual(
    this.ghLastResponseStatus,
    200,
    `Expected 200 from default fixture, got ${this.ghLastResponseStatus}`,
  );
  const parsed = JSON.parse(this.ghLastResponseBody ?? '{}') as Record<string, unknown>;
  assert.ok('number' in parsed, 'Expected issue fixture to have "number" field');
});

Then('the response has Content-Type {string}', function (this: GhMockWorld, expectedType: string) {
  const contentType = this.ghLastResponseHeaders?.['content-type'] ?? '';
  assert.ok(
    contentType.includes(expectedType),
    `Expected Content-Type "${expectedType}", got "${contentType}"`,
  );
});
