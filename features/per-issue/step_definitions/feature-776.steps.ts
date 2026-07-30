/**
 * BDD step definitions for feature-776.feature
 * Webhook server survives a failing event handler (issue #776).
 *
 * Spawns the REAL entrypoint (`bunx tsx adws/triggers/trigger_webhook.ts`) as a
 * subprocess and drives it over real HTTP, exactly as GitHub's webhook delivery
 * would. "No usable GitHub credentials" is engineered hermetically (empty PAT/App
 * env + a failing `gh` stub on PATH) so the real production code path
 * (fetchIssueCommentsRest → gitContextForRepo → resolveContextToken) throws the
 * same shape of error the incident produced, with no fault-injection hook added
 * to production code.
 *
 * Steps NOT defined here (already registered elsewhere):
 *   Given 'the ADW codebase is checked out'      → features/step_definitions/ensureCronOnEveryEventSteps.ts (G18)
 *   Then  'the ADW TypeScript type-check passes' → features/per-issue/step_definitions/feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// features/per-issue/step_definitions → repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');

const CRON_REPO_KEY = 'paysdoc/paysdoc.nl';
const CRON_PID_FILE = path.join(REPO_ROOT, 'agents', 'cron', 'paysdoc_paysdoc.nl.json');
const AUTH_GATE_FILE = path.join(REPO_ROOT, 'agents', '.auth_gate');
const FAKE_WORKING_PAT = 'adw-776-test-pat-never-used-for-a-real-call';

// Spawning tsx + waiting for the listen line, plus multi-delivery retry-storm
// scenarios, comfortably exceed cucumber's 5s default step timeout.
setDefaultTimeout(45_000);

interface DeliveryResult {
  status: number;
  bodyText: string;
}

const world: {
  pendingEnv: { SLACK_WEBHOOK_URL?: string; GITHUB_WEBHOOK_SECRET?: string };
  slackSinkServer: http.Server | null;
  slackSinkRequests: string[];
  slackDropServer: net.Server | null;
  cronSleeper: ChildProcess | null;
  serverProcess: ChildProcess | null;
  serverPort: number;
  serverStdout: string;
  serverStderr: string;
  serverExited: boolean;
  serverExitInfo: { code: number | null; signal: NodeJS.Signals | null } | null;
  ghStubDir: string;
  responses: DeliveryResult[];
  lastResponse: DeliveryResult | null;
  lastRequestHeaders: Record<string, string>;
  lastRequestBody: Buffer;
} = {
  pendingEnv: {},
  slackSinkServer: null,
  slackSinkRequests: [],
  slackDropServer: null,
  cronSleeper: null,
  serverProcess: null,
  serverPort: 0,
  serverStdout: '',
  serverStderr: '',
  serverExited: false,
  serverExitInfo: null,
  ghStubDir: '',
  responses: [],
  lastResponse: null,
  lastRequestHeaders: {},
  lastRequestBody: Buffer.alloc(0),
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

Before({ tags: '@adw-776' }, function () {
  world.pendingEnv = {};
  world.slackSinkServer = null;
  world.slackSinkRequests = [];
  world.slackDropServer = null;
  world.cronSleeper = null;
  world.serverProcess = null;
  world.serverPort = 0;
  world.serverStdout = '';
  world.serverStderr = '';
  world.serverExited = false;
  world.serverExitInfo = null;
  world.ghStubDir = '';
  world.responses = [];
  world.lastResponse = null;
  world.lastRequestHeaders = {};
  world.lastRequestBody = Buffer.alloc(0);
});

After({ tags: '@adw-776' }, async function () {
  if (world.serverProcess?.pid && !world.serverExited) {
    // Negative PID: kill the whole detached process group (proc.kill() alone only
    // reaches the direct tsx-wrapper child, orphaning the real server grandchild).
    try { process.kill(-world.serverProcess.pid, 'SIGKILL'); } catch { /* already dead */ }
  }
  if (world.cronSleeper?.pid) {
    try { process.kill(world.cronSleeper.pid, 'SIGKILL'); } catch { /* already dead */ }
  }
  try { fs.unlinkSync(CRON_PID_FILE); } catch { /* never created */ }

  if (world.slackSinkServer) {
    const server = world.slackSinkServer;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (world.slackDropServer) {
    const server = world.slackDropServer;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (world.ghStubDir) {
    try { fs.rmSync(world.ghStubDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Harness internals
// ---------------------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** A `gh` on PATH that always fails, so `gh auth token` yields nothing (ghAuthToken() → ''). */
function writeFailingGhStub(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-776-gh-'));
  const ghPath = path.join(dir, 'gh');
  fs.writeFileSync(ghPath, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(ghPath, 0o755);
  return dir;
}

/**
 * Suppresses ensureCronProcess's real detach-spawn for the incident repo by
 * pre-seeding a PID record it will treat as live (isCronAliveForRepo →
 * isProcessAlive). The scenarios assert on the real repo name paysdoc/paysdoc.nl
 * (feature notes §2/§3), so it cannot be swapped for a throwaway.
 */
function seedLiveCronRecord(): void {
  const sleeper = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
  sleeper.unref();
  world.cronSleeper = sleeper;
  fs.mkdirSync(path.dirname(CRON_PID_FILE), { recursive: true });
  fs.writeFileSync(
    CRON_PID_FILE,
    JSON.stringify({ pid: sleeper.pid, repoKey: CRON_REPO_KEY, startedAt: new Date().toISOString() }, null, 2),
  );
}

function waitForListening(deadlineMs: number): Promise<number> {
  const pattern = /Webhook server listening on 0\.0\.0\.0:(\d+)/;
  const deadline = Date.now() + deadlineMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      const match = world.serverStdout.match(pattern);
      if (match) { resolve(parseInt(match[1], 10)); return; }
      if (world.serverExited) {
        reject(new Error(`Webhook server exited before listening.\nstdout:\n${world.serverStdout}\nstderr:\n${world.serverStderr}`));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for webhook server to listen.\nstdout:\n${world.serverStdout}\nstderr:\n${world.serverStderr}`));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function spawnWebhookServer(credMode: 'none' | 'working'): Promise<void> {
  assert.ok(
    !fs.existsSync(AUTH_GATE_FILE),
    `Refusing to spawn @adw-776 server: ${AUTH_GATE_FILE} exists and may belong to a live run. Investigate before deleting.`,
  );

  world.ghStubDir = writeFailingGhStub();
  seedLiveCronRecord();
  const port = await findFreePort();

  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    GITHUB_WEBHOOK_SECRET: world.pendingEnv.GITHUB_WEBHOOK_SECRET ?? '',
    SLACK_WEBHOOK_URL: world.pendingEnv.SLACK_WEBHOOK_URL ?? '',
    GITHUB_PAT: credMode === 'working' ? FAKE_WORKING_PAT : '',
    GITHUB_APP_ID: '',
    GITHUB_APP_SLUG: '',
    GITHUB_APP_PRIVATE_KEY_PATH: '',
    GH_TOKEN: '',
    PATH: `${world.ghStubDir}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  // detached: true so the tsx wrapper's grandchild (the real "node --require
  // preflight.cjs …" process that actually binds the port) lands in the same
  // process group as `proc` — killing the group (see killServerProcess) is the
  // only way to reach it, since `proc.kill()` alone only reaches the direct child.
  const proc = spawn('bunx', ['tsx', 'adws/triggers/trigger_webhook.ts'], {
    cwd: REPO_ROOT,
    env: spawnEnv,
    detached: true,
  });
  world.serverProcess = proc;
  proc.stdout?.on('data', (chunk: Buffer) => { world.serverStdout += chunk.toString(); });
  proc.stderr?.on('data', (chunk: Buffer) => { world.serverStderr += chunk.toString(); });
  proc.on('exit', (code, signal) => {
    world.serverExited = true;
    world.serverExitInfo = { code, signal };
  });

  world.serverPort = await waitForListening(30_000);
}

function postToWebhook(headers: Record<string, string>, bodyBuffer: Buffer): Promise<DeliveryResult> {
  world.lastRequestHeaders = headers;
  world.lastRequestBody = bodyBuffer;
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: world.serverPort,
        path: '/webhook',
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers, 'content-length': String(bodyBuffer.length) },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, bodyText: responseBody }));
      },
    );
    req.setTimeout(8_000, () => req.destroy(new Error('request timed out waiting for a response')));
    // A dropped connection (the pre-fix bug) surfaces as a socket error, not an
    // HTTP response — resolve a legible sentinel instead of letting the step hang.
    req.on('error', (err) => resolve({ status: 0, bodyText: `<connection error: ${err.message}>` }));
    req.end(bodyBuffer);
  });
}

async function deliver(headers: Record<string, string>, bodyInput: unknown): Promise<DeliveryResult> {
  const bodyBuffer = Buffer.isBuffer(bodyInput) ? bodyInput : Buffer.from(JSON.stringify(bodyInput));
  const result = await postToWebhook(headers, bodyBuffer);
  world.responses.push(result);
  world.lastResponse = result;
  return result;
}

function repoPayload(repoFullName: string): { full_name: string; clone_url: string } {
  return { full_name: repoFullName, clone_url: `https://github.com/${repoFullName}.git` };
}

async function waitForSlackRequests(minCount: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (world.slackSinkRequests.length < minCount && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// ---------------------------------------------------------------------------
// Given — environment shaping (must run BEFORE "a webhook server is running …":
// the spawned server reads these from its own env at spawn time and cannot
// have them changed afterwards)
// ---------------------------------------------------------------------------

Given('a Slack alert endpoint is configured that accepts deliveries', async function () {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      let text = body;
      try { text = (JSON.parse(body) as { text: string }).text; } catch { /* keep raw */ }
      world.slackSinkRequests.push(text);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  world.slackSinkServer = server;
  const port = (server.address() as net.AddressInfo).port;
  world.pendingEnv.SLACK_WEBHOOK_URL = `http://127.0.0.1:${port}/slack`;
});

Given('a Slack alert endpoint is configured that drops every connection', async function () {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  world.slackDropServer = server;
  const port = (server.address() as net.AddressInfo).port;
  world.pendingEnv.SLACK_WEBHOOK_URL = `http://127.0.0.1:${port}/slack`;
});

Given('no Slack alert endpoint is configured', function () {
  // Present-but-empty: dotenv does not overwrite a key already in process.env.
  world.pendingEnv.SLACK_WEBHOOK_URL = '';
});

Given('a webhook signing secret is shared with GitHub', function () {
  world.pendingEnv.GITHUB_WEBHOOK_SECRET = 'adw-776-test-secret';
});

// ---------------------------------------------------------------------------
// Given — spawn the real webhook server
// ---------------------------------------------------------------------------

Given('a webhook server is running with no usable GitHub credentials', async function () {
  await spawnWebhookServer('none');
});

Given('a webhook server is running with working GitHub credentials', async function () {
  await spawnWebhookServer('working');
});

// ---------------------------------------------------------------------------
// When — deliveries
// ---------------------------------------------------------------------------

When(
  'an {string} delivery for issue {int} on {string} carrying the comment {string} is sent',
  async function (eventType: string, issueNumber: number, repoFullName: string, commentBody: string) {
    await deliver(
      { 'x-github-event': eventType },
      {
        action: 'created',
        issue: { number: issueNumber, body: 'adw-776 scenario issue' },
        comment: { body: commentBody },
        repository: repoPayload(repoFullName),
      },
    );
  },
);

When(
  'an {string} delivery for issue {int} on {string} with action {string} is sent',
  async function (eventType: string, issueNumber: number, repoFullName: string, action: string) {
    await deliver(
      { 'x-github-event': eventType },
      { action, issue: { number: issueNumber }, repository: repoPayload(repoFullName) },
    );
  },
);

When('the same failing delivery is sent {int} more times', async function (times: number) {
  for (let i = 0; i < times; i++) {
    await deliver(world.lastRequestHeaders, world.lastRequestBody);
  }
});

When('a delivery carrying an unparseable body is sent', async function () {
  await deliver({ 'x-github-event': 'issue_comment' }, Buffer.from('{not valid json'));
});

When('a delivery carrying an invalid signature is sent', async function () {
  await deliver(
    { 'x-github-event': 'ping', 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
    { zen: 'this signature does not match' },
  );
});

When('a delivery that requires no work is sent', async function () {
  // Deliberately omits `repository` — resolveWebhookRepo returns null, so
  // ensureCronProcess never fires and this scenario spawns nothing.
  await deliver({ 'x-github-event': 'ping' }, {});
});

// ---------------------------------------------------------------------------
// Then — HTTP response assertions
// ---------------------------------------------------------------------------

Then('the delivery is answered with HTTP {int}', function (expected: number) {
  assert.strictEqual(
    world.lastResponse?.status,
    expected,
    `Expected HTTP ${expected}, got ${JSON.stringify(world.lastResponse)}`,
  );
});

Then('every failing delivery is answered with HTTP {int}', function (expected: number) {
  assert.ok(world.responses.length > 0, 'Expected at least one delivery to have been sent');
  world.responses.forEach((result, index) => {
    assert.strictEqual(
      result.status,
      expected,
      `Delivery #${index + 1} expected HTTP ${expected}, got ${JSON.stringify(result)}`,
    );
  });
});

Then('the following delivery is answered with HTTP {int}', async function (expected: number) {
  const result = await deliver({ 'x-github-event': 'ping' }, {});
  assert.strictEqual(
    result.status,
    expected,
    `Expected the following delivery to be answered HTTP ${expected}, got ${JSON.stringify(result)}`,
  );
});

// ---------------------------------------------------------------------------
// Then — process liveness assertions
// ---------------------------------------------------------------------------

async function assertServerAlive(): Promise<void> {
  // Let any in-flight 'exit' event (racing the HTTP response/socket error) settle.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(world.serverProcess, 'Expected a webhook server process to have been spawned');
  assert.strictEqual(
    world.serverExited,
    false,
    `Expected the webhook server process to still be running, but it exited (${JSON.stringify(world.serverExitInfo)}).\nstdout:\n${world.serverStdout}\nstderr:\n${world.serverStderr}`,
  );
}

Then('the webhook server process is still running', async function () {
  await assertServerAlive();
});

Then('the webhook server process has not exited', async function () {
  await assertServerAlive();
});

// ---------------------------------------------------------------------------
// Then — error log assertions (Surface #5: subprocess captured stdout)
// ---------------------------------------------------------------------------

Then('the error log names the event type {string}', function (eventType: string) {
  assert.ok(
    world.serverStdout.includes(`event=${eventType}`),
    `Expected error log to name event type "${eventType}". stdout:\n${world.serverStdout}`,
  );
});

Then('the error log names the repository {string}', function (repo: string) {
  assert.ok(
    world.serverStdout.includes(`repo=${repo}`),
    `Expected error log to name repository "${repo}". stdout:\n${world.serverStdout}`,
  );
});

Then('the error log names issue {int}', function (issueNumber: number) {
  assert.ok(
    world.serverStdout.includes(`issue=#${issueNumber}`),
    `Expected error log to name issue #${issueNumber}. stdout:\n${world.serverStdout}`,
  );
});

// ---------------------------------------------------------------------------
// Then — Slack alert assertions (Surface #2: recorded requests against a real
// local HTTP sink the subprocess POSTs to)
// ---------------------------------------------------------------------------

Then('a Slack alert is delivered', async function () {
  await waitForSlackRequests(1);
  assert.ok(
    world.slackSinkRequests.length > 0,
    `Expected at least one Slack alert to be delivered. stdout:\n${world.serverStdout}`,
  );
});

Then('no Slack alert is delivered', async function () {
  // Grace period: the alert is fire-and-forget, so a wrongly-fired one may not
  // have arrived at the sink the instant the HTTP response came back.
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.strictEqual(
    world.slackSinkRequests.length,
    0,
    `Expected no Slack alert, got: ${JSON.stringify(world.slackSinkRequests)}`,
  );
});

Then('the Slack alert names the event type {string}', async function (eventType: string) {
  await waitForSlackRequests(1);
  assert.ok(
    world.slackSinkRequests.some((body) => body.includes(`event: ${eventType}`)),
    `Expected a Slack alert naming event type "${eventType}". Got: ${JSON.stringify(world.slackSinkRequests)}`,
  );
});

Then('the Slack alert names the repository {string}', async function (repo: string) {
  await waitForSlackRequests(1);
  assert.ok(
    world.slackSinkRequests.some((body) => body.includes(`repo: ${repo}`)),
    `Expected a Slack alert naming repository "${repo}". Got: ${JSON.stringify(world.slackSinkRequests)}`,
  );
});

Then('the Slack alert names issue {int}', async function (issueNumber: number) {
  await waitForSlackRequests(1);
  assert.ok(
    world.slackSinkRequests.some((body) => body.includes(`issue: #${issueNumber}`)),
    `Expected a Slack alert naming issue #${issueNumber}. Got: ${JSON.stringify(world.slackSinkRequests)}`,
  );
});
