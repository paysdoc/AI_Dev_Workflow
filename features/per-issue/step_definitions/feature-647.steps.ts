/**
 * BDD step definitions for feature-647.feature
 * HITL Review→Slack delivery reliability.
 *
 * §1: Drive postSlack directly; assert delivery-log output (Fix #2 — the success log).
 * §2: Drive notifyReviewTransition with injected NotifierDeps; assert delivery + log (AC1+AC2).
 * §3: Assert callee-side await-safety of notifyReviewTransition (deferred sink).
 * §4: Spawn a node (non-bun) subprocess; assert .env load + delivery to a real local sink (Fix #3).
 * §5: ADW TypeScript type-check (already defined in feature-504.steps.ts — not redefined here).
 *
 * Steps NOT defined here (already registered):
 *   Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts
 *   Then  'the ADW TypeScript type-check passes'  → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { postSlack } from '../../../adws/core/slackNotifier.ts';
import {
  notifyReviewTransition,
  type NotifierDeps,
} from '../../../adws/github/hitlBoardNotifier.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// features/per-issue/step_definitions → repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// World state — reset in Before, restored in After
// ---------------------------------------------------------------------------

const world: {
  slackPayloads: string[];
  logLines: string[];
  origFetch: typeof globalThis.fetch;
  origConsoleLog: typeof console.log;
  // §2-3
  issues: Map<number, { title: string; labels: string[] }>;
  pullRequests: Array<{ number: number; url: string; body: string }>;
  currentIssueNumber: number;
  notifierThrew: boolean;
  deliveryRecorded: boolean;
  // §4
  tmpDir: string;
  sinkServer: http.Server | null;
  sinkPort: number;
  sinkRequests: string[];
  subprocessStdout: string;
  subprocessStderr: string;
} = {
  slackPayloads: [],
  logLines: [],
  origFetch: globalThis.fetch,
  origConsoleLog: console.log,
  issues: new Map(),
  pullRequests: [],
  currentIssueNumber: 0,
  notifierThrew: false,
  deliveryRecorded: false,
  tmpDir: '',
  sinkServer: null,
  sinkPort: 0,
  sinkRequests: [],
  subprocessStdout: '',
  subprocessStderr: '',
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

Before({ tags: '@adw-647' }, function () {
  world.slackPayloads = [];
  world.logLines = [];
  world.issues = new Map();
  world.pullRequests = [];
  world.currentIssueNumber = 0;
  world.notifierThrew = false;
  world.deliveryRecorded = false;
  world.sinkRequests = [];
  world.subprocessStdout = '';
  world.subprocessStderr = '';
  world.tmpDir = '';

  world.origFetch = globalThis.fetch;
  world.origConsoleLog = console.log;

  // Capture console.log so logger output is assertable (§1 delivery-log assertions)
  console.log = (...args: unknown[]) => {
    world.logLines.push(args.map(String).join(' '));
  };
});

After({ tags: '@adw-647' }, async function () {
  globalThis.fetch = world.origFetch;
  console.log = world.origConsoleLog;
  delete process.env.SLACK_WEBHOOK_URL;

  if (world.sinkServer) {
    await new Promise<void>((resolve) => world.sinkServer!.close(() => resolve()));
    world.sinkServer = null;
  }

  if (world.tmpDir) {
    try { fs.rmSync(world.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    world.tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// §1-2 Slack sink configuration
// ---------------------------------------------------------------------------

Given('a Slack webhook endpoint is configured that accepts deliveries', function () {
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test-647';
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string'
      ? (JSON.parse(init.body) as { text: string }).text
      : '';
    world.slackPayloads.push(body);
    return Promise.resolve(new Response('ok', { status: 200 }));
  }) as typeof globalThis.fetch;
});

Given(
  'a Slack webhook endpoint is configured that rejects deliveries with HTTP {int}',
  function (status: number) {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test-647';
    globalThis.fetch = ((_url: string | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('', { status }))
    ) as typeof globalThis.fetch;
  },
);

Given('a Slack webhook endpoint is configured that drops every connection', function () {
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test-647';
  globalThis.fetch = ((_url: string | URL, _init?: RequestInit) =>
    Promise.reject(new Error('connection dropped'))
  ) as typeof globalThis.fetch;
});

Given('no Slack webhook endpoint is configured', function () {
  delete process.env.SLACK_WEBHOOK_URL;
});

// §3 — deferred delivery sink: records AFTER a yielded turn (catches fire-and-forget regression)
Given('the Slack webhook endpoint settles deliveries on a deferred turn', function () {
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string'
      ? (JSON.parse(init.body) as { text: string }).text
      : '';
    return new Promise<Response>((resolve) => {
      setImmediate(() => {
        world.slackPayloads.push(body);
        world.deliveryRecorded = true;
        resolve(new Response('ok', { status: 200 }));
      });
    });
  }) as typeof globalThis.fetch;
});

// ---------------------------------------------------------------------------
// §1 When — drive postSlack directly
// ---------------------------------------------------------------------------

When('a Slack notification with text {string} is posted', async function (text: string) {
  await postSlack(text);
});

// ---------------------------------------------------------------------------
// §1 Then — delivery-signal assertions
// ---------------------------------------------------------------------------

Then('the Slack endpoint receives the notification', function () {
  assert.ok(
    world.slackPayloads.length > 0,
    `Expected a Slack delivery to be recorded, but none was. Log lines: ${JSON.stringify(world.logLines)}`,
  );
});

Then('the Slack endpoint receives no notification', function () {
  assert.strictEqual(
    world.slackPayloads.length,
    0,
    `Expected no Slack delivery, but received: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then('the Slack delivery is recorded as successful in the log', function () {
  const match = world.logLines.some((line) => line.includes('delivered'));
  assert.ok(
    match,
    `Expected a "delivered" log line, but none found. Log lines: ${JSON.stringify(world.logLines)}`,
  );
});

Then('the Slack delivery is recorded as failed in the log', function () {
  const match = world.logLines.some(
    (line) => line.includes('failed') || line.includes('HTTP 4') || line.includes('HTTP 5'),
  );
  assert.ok(
    match,
    `Expected a failure log line, but none found. Log lines: ${JSON.stringify(world.logLines)}`,
  );
});

Then('the Slack skip is recorded in the log', function () {
  const match = world.logLines.some((line) => line.includes('skipping'));
  assert.ok(
    match,
    `Expected a "skipping" log line, but none found. Log lines: ${JSON.stringify(world.logLines)}`,
  );
});

// ---------------------------------------------------------------------------
// §2 Given — hitl/non-hitl issue and PR fixtures
// ---------------------------------------------------------------------------

Given(
  'a hitl issue {int} titled {string} is entering Review',
  function (issueNumber: number, title: string) {
    world.currentIssueNumber = issueNumber;
    world.issues.set(issueNumber, { title, labels: ['hitl'] });
  },
);

Given(
  'a non-hitl issue {int} titled {string} is entering Review',
  function (issueNumber: number, title: string) {
    world.currentIssueNumber = issueNumber;
    world.issues.set(issueNumber, { title, labels: [] });
  },
);

Given(
  'the issue has an open pull request {int} that implements it',
  function (prNumber: number) {
    world.pullRequests.push({
      number: prNumber,
      url: `https://github.com/test-owner/test-repo/pull/${prNumber}`,
      body: `Implements #${world.currentIssueNumber}`,
    });
  },
);

// ---------------------------------------------------------------------------
// §2-3 When — drive notifyReviewTransition
// ---------------------------------------------------------------------------

function makeNotifierDeps(): NotifierDeps {
  return {
    readIssue: (issueNumber: number) => {
      const rec = world.issues.get(issueNumber);
      if (!rec) return null;
      return { title: rec.title, labels: rec.labels.map((name) => ({ name })) };
    },
    listOpenPRs: (_repoInfo) =>
      world.pullRequests.map((pr) => ({
        number: pr.number,
        url: pr.url,
        body: pr.body,
        state: 'OPEN',
        headRefName: `feature-issue-${pr.number}-x`,
        baseRefName: 'main',
        updatedAt: new Date().toISOString(),
      })),
  };
}

When(
  'the HITL review notification is sent for issue {int}',
  async function (issueNumber: number) {
    const repoInfo = { owner: 'test-owner', repo: 'test-repo' };
    try {
      await notifyReviewTransition({ issueNumber, repoInfo }, makeNotifierDeps());
    } catch {
      world.notifierThrew = true;
    }
  },
);

// ---------------------------------------------------------------------------
// §2 Then — notification content assertions
// ---------------------------------------------------------------------------

Then('the delivered notification text contains {string}', function (expected: string) {
  const all = world.slackPayloads.join('\n');
  assert.ok(
    all.includes(expected),
    `Expected delivered notification to contain "${expected}", but got: ${JSON.stringify(world.slackPayloads)}`,
  );
});

Then(
  'the delivered notification links to pull request {int}',
  function (prNumber: number) {
    const prUrl = `https://github.com/test-owner/test-repo/pull/${prNumber}`;
    const all = world.slackPayloads.join('\n');
    assert.ok(
      all.includes(prUrl),
      `Expected notification to link to PR ${prNumber} (${prUrl}), but got: ${JSON.stringify(world.slackPayloads)}`,
    );
  },
);

Then(
  'the delivered notification does not link to issue {int}',
  function (issueNumber: number) {
    const issueUrl = `https://github.com/test-owner/test-repo/issues/${issueNumber}`;
    const all = world.slackPayloads.join('\n');
    assert.ok(
      !all.includes(issueUrl),
      `Expected notification NOT to link to issue ${issueNumber} (${issueUrl}), but got: ${JSON.stringify(world.slackPayloads)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// §3 Then — await-safety assertions
// ---------------------------------------------------------------------------

Then(
  'the HITL review notification resolves only after its Slack delivery has been recorded',
  function () {
    assert.ok(
      world.deliveryRecorded,
      'Expected the Slack delivery to be recorded before notifyReviewTransition resolved, but it was not',
    );
  },
);

Then('sending the HITL review notification does not throw', function () {
  assert.strictEqual(
    world.notifierThrew,
    false,
    'Expected notifyReviewTransition to not throw, but it did',
  );
});

// ---------------------------------------------------------------------------
// §4 Given — start real HTTP sink + create temp dir with .env
// ---------------------------------------------------------------------------

Given(
  'a node webhook process whose SLACK_WEBHOOK_URL is set only in its .env file',
  async function () {
    world.sinkRequests = [];

    // Start a real local HTTP server to receive the Slack POST
    world.sinkServer = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          world.sinkRequests.push(body);
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
        });
      },
    );
    await new Promise<void>((resolve) =>
      world.sinkServer!.listen(0, '127.0.0.1', () => resolve()),
    );
    world.sinkPort = (world.sinkServer.address() as net.AddressInfo).port;

    // Create temp dir and write .env with SLACK_WEBHOOK_URL pointing at the sink
    world.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-bdd-647-'));
    fs.writeFileSync(
      path.join(world.tmpDir, '.env'),
      `SLACK_WEBHOOK_URL=http://127.0.0.1:${world.sinkPort}/slack\n`,
    );
  },
);

// ---------------------------------------------------------------------------
// §4 When — spawn node (non-bun) subprocess
// ---------------------------------------------------------------------------

When(
  'the webhook process loads its environment and posts a HITL Slack notification',
  async function () {
    // Use the tsx CLI from the repo's node_modules (runs under node, non-bun).
    // The probe MUST run from REPO_ROOT so tsx/dotenv/etc are found via node_modules.
    // Inside the probe, process.chdir(tmpDir) ensures dotenv.config() reads .env from
    // the temp dir (not the repo root), correctly modelling a "different cwd" process.
    const tsxBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
    const probeFile = path.join(REPO_ROOT, `__647probe_${process.pid}.ts`);

    const probeScript = [
      `// chdir first — dotenv.config() (called by environment.ts) reads from process.cwd()`,
      `process.chdir(${JSON.stringify(world.tmpDir)});`,
      `await import('file://${REPO_ROOT}/adws/core/environment.ts');`,
      `const { postSlack } = await import('file://${REPO_ROOT}/adws/core/slackNotifier.ts');`,
      `await postSlack(':eyes: HITL notification from node probe');`,
    ].join('\n');
    fs.writeFileSync(probeFile, probeScript);

    // Spawn WITHOUT SLACK_WEBHOOK_URL in env; dotenv loads it from tmpDir/.env
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
    delete spawnEnv['SLACK_WEBHOOK_URL'];

    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          const proc = spawn(tsxBin, [probeFile], {
            cwd: REPO_ROOT,
            env: spawnEnv,
          });
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
          proc.on('close', () => resolve({ stdout, stderr }));
          proc.on('error', reject);
        },
      );
      world.subprocessStdout = stdout;
      world.subprocessStderr = stderr;
    } finally {
      try { fs.unlinkSync(probeFile); } catch { /* ignore */ }
    }
  },
);

// ---------------------------------------------------------------------------
// §4 Then — subprocess delivery assertions
// ---------------------------------------------------------------------------

Then('the configured webhook endpoint records the delivery', function () {
  assert.ok(
    world.sinkRequests.length > 0,
    [
      'Expected the local sink server to receive at least one request, but got none.',
      `Subprocess stdout: ${world.subprocessStdout}`,
      `Subprocess stderr: ${world.subprocessStderr}`,
    ].join('\n'),
  );
});

Then('the webhook process does not log a skipped Slack notification', function () {
  const combined = world.subprocessStdout + world.subprocessStderr;
  assert.ok(
    !combined.includes('not set; skipping'),
    [
      'Expected the subprocess NOT to log "not set; skipping", but it did.',
      `Stdout: ${world.subprocessStdout}`,
      `Stderr: ${world.subprocessStderr}`,
    ].join('\n'),
  );
});
