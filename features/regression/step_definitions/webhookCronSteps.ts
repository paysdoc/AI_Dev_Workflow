/**
 * Steps for the webhook's cron-on-every-event scenarios. Each drives the real exported
 * `dispatchWebhookEvent` in-process, with a stand-in request and response and a fake per-event
 * boundary. Launches are caught by the shared launch recorder. Assertions read only the response the
 * dispatcher wrote, the recorder's launch records and the cron registry record; no step reads a
 * source file.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createHmac } from 'crypto';
import type * as http from 'http';

import { Platform } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import type { TargetRepoInfo } from '../../../adws/types/issueTypes.ts';
import { LOGS_DIR } from '../../../adws/core/config.ts';
import { AUTH_GATE_PATH } from '../../../adws/core/authGate.ts';
import { writeCronPid } from '../../../adws/triggers/cronProcessGuard.ts';
import { dispatchWebhookEvent } from '../../../adws/triggers/trigger_webhook.ts';
import { cronPidFilePath, readCronPid } from './realCronProcess.ts';
import {
  createLaunchRecorder, disposeLaunchRecorder, withLaunchRecorderOnPath, settleLaunches, waitForLaunch,
  recordedLaunches, describeLaunches, isCronLaunch, isCronLaunchFor, type LaunchRecorder,
} from '../support/launchRecorder.ts';

interface CronSnapshot {
  registry: string | null;
  logExisted: boolean;
}

const ctx: {
  recorder: LaunchRecorder | null;
  response: { statusCode?: number; body?: Record<string, unknown> };
  savedEnv: Map<string, string | undefined>;
  savedAuthGate: string | null;
  cronSnapshots: Map<string, CronSnapshot>;
} = {
  recorder: null,
  response: {},
  savedEnv: new Map(),
  savedAuthGate: null,
  cronSnapshots: new Map(),
};

// Per-issue rows reuse these phrases and carry no `@webhook` tag, so the scope names theirs too.
const HOOK_TAGS = '@webhook or @adw-961';
const WEBHOOK_ENV_KEYS = ['GITHUB_WEBHOOK_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY_PATH', 'SLACK_WEBHOOK_URL'] as const;
const LAUNCH_WAIT_MS = 10_000;

function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

function restoreFile(file: string, saved: string | null): void {
  if (saved === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, saved);
}

/** Restores by `delete`: assigning `undefined` would make Node store the string "undefined". */
function restoreEnv(key: string, saved: string | undefined): void {
  if (saved === undefined) delete process.env[key];
  else process.env[key] = saved;
}

/**
 * The dispatcher reads these at call time. A secret in the host's environment would answer every
 * unsigned delivery 401. Blank GitHub App variables keep the self-host boundary, which an event
 * naming no repository makes, from contacting the forge. An event that strayed onto a provider
 * branch would end in `reportWebhookEventFailure`, which posts to Slack. `PATH` is only saved here,
 * as a backstop for the restore that `withLaunchRecorderOnPath` already makes.
 */
function neutraliseEnvironment(): void {
  ctx.savedEnv.clear();
  for (const key of [...WEBHOOK_ENV_KEYS, 'PATH']) ctx.savedEnv.set(key, process.env[key]);
  delete process.env.GITHUB_WEBHOOK_SECRET;
  delete process.env.SLACK_WEBHOOK_URL;
  process.env.GITHUB_APP_ID = '';
  process.env.GITHUB_APP_SLUG = '';
  process.env.GITHUB_APP_PRIVATE_KEY_PATH = '';
}

function restoreEnvironment(): void {
  for (const [key, saved] of ctx.savedEnv) restoreEnv(key, saved);
  ctx.savedEnv.clear();
}

/** Mirrors the log path `ensureCronProcess` opens. */
function cronLogPath(repoFullName: string): string {
  return path.join(LOGS_DIR, 'agents', 'cron', `${repoFullName.replace('/', '_')}.log`);
}

function snapshotCronState(repoFullName: string): void {
  if (ctx.cronSnapshots.has(repoFullName)) return;
  ctx.cronSnapshots.set(repoFullName, {
    registry: readIfExists(cronPidFilePath(repoFullName)),
    logExisted: fs.existsSync(cronLogPath(repoFullName)),
  });
}

function restoreCronState(): void {
  for (const [repo, snapshot] of ctx.cronSnapshots) {
    restoreFile(cronPidFilePath(repo), snapshot.registry);
    if (!snapshot.logExisted) fs.rmSync(cronLogPath(repo), { force: true });
  }
  ctx.cronSnapshots.clear();
}

Before({ tags: HOOK_TAGS }, function () {
  ctx.recorder = createLaunchRecorder();
  ctx.response = {};
  ctx.cronSnapshots.clear();
  neutraliseEnvironment();
  // While a gate record exists, the review, review-comment and comment branches answer
  // `auth_gate_set` before they look at the event.
  ctx.savedAuthGate = readIfExists(AUTH_GATE_PATH);
  fs.rmSync(AUTH_GATE_PATH, { force: true });
});

After({ tags: HOOK_TAGS }, function () {
  try {
    restoreCronState();
    restoreFile(AUTH_GATE_PATH, ctx.savedAuthGate);
  } finally {
    // The environment leaks into every later scenario in the process, so it is restored even if a file restore throws.
    restoreEnvironment();
    if (ctx.recorder) disposeLaunchRecorder(ctx.recorder);
    ctx.recorder = null;
  }
});

function requireRecorder(): LaunchRecorder {
  assert.ok(ctx.recorder, 'Expected the webhook Before hook to have created the launch recorder');
  return ctx.recorder;
}

function repositoryFields(repoFullName: string): Record<string, unknown> {
  return { full_name: repoFullName, clone_url: `https://example.invalid/${repoFullName}.git` };
}

/** Only the fields each event's branch reads. The comment is plain: none of `## Continue`, `## Cancel` or `## Retry`. */
const EVENT_FIELDS: Readonly<Record<string, Record<string, unknown>>> = {
  pull_request_review: { pull_request: { number: 77 } },
  pull_request_review_comment: { pull_request: { number: 77 } },
  pull_request: { pull_request: { number: 77 } },
  issue_comment: { issue: { number: 42, body: '' }, comment: { body: 'Thanks, this looks good.' } },
  issues: { issue: { number: 42 } },
  check_run: { check_run: { id: 1, status: 'completed' } },
};

function approvedReviewPayload(repository?: Record<string, unknown>): Record<string, unknown> {
  return {
    action: 'submitted',
    pull_request: { number: 77 },
    review: { state: 'approved' },
    ...(repository ? { repository } : {}),
  };
}

function fakeRequest(event: string, signature?: string): http.IncomingMessage {
  const headers = { 'x-github-event': event, ...(signature ? { 'x-hub-signature-256': signature } : {}) };
  return { headers } as unknown as http.IncomingMessage;
}

function recordingResponse(): http.ServerResponse {
  const res = {
    writeHead(code: number) { ctx.response.statusCode = code; return res; },
    end(payload?: string) { if (payload) ctx.response.body = JSON.parse(payload); },
  };
  return res as unknown as http.ServerResponse;
}

/** Its providers throw, so an event that reaches a forge fails the step loudly instead of acting. */
function fakeEventBoundary(targetRepo: TargetRepoInfo | null): LaunchBoundary | undefined {
  if (!targetRepo) return undefined;
  return {
    gitContext: {},
    repoId: { owner: targetRepo.owner, repo: targetRepo.repo, platform: Platform.GitHub },
    get providers(): never {
      throw new Error('A webhook scenario event reached a forge provider; pick an event that ends in "ignored"');
    },
  } as unknown as LaunchBoundary;
}

function sign(rawBody: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

async function deliver(event: string, rawBody: Buffer, signature?: string): Promise<void> {
  const recorder = requireRecorder();
  ctx.response = {};
  withLaunchRecorderOnPath(recorder, () =>
    dispatchWebhookEvent(fakeRequest(event, signature), recordingResponse(), rawBody, fakeEventBoundary),
  );
  await settleLaunches(recorder);
}

/** Snapshots the repository's cron state first, so a log the dispatch creates can be told from one that was already there. */
async function deliverPayload(event: string, payload: Record<string, unknown>, repoFullName?: string, signingSecret?: string): Promise<void> {
  if (repoFullName) snapshotCronState(repoFullName);
  const rawBody = Buffer.from(JSON.stringify(payload));
  await deliver(event, rawBody, signingSecret === undefined ? undefined : sign(rawBody, signingSecret));
}

Given('no cron is running for the repository {string}', function (repo: string) {
  snapshotCronState(repo);
  fs.rmSync(cronPidFilePath(repo), { force: true });
});

/** The live test process stands in for the repository's cron. */
Given('a cron is already running for the repository {string}', function (repo: string) {
  snapshotCronState(repo);
  writeCronPid(repo, process.pid);
});

Given('the webhook secret is set to {string}', function (secret: string) {
  process.env.GITHUB_WEBHOOK_SECRET = secret;
});

When('the webhook receives an approved review from the repository {string}', async function (repo: string) {
  await deliverPayload('pull_request_review', approvedReviewPayload(repositoryFields(repo)), repo);
});

When(
  'the webhook receives an approved review from the repository {string}, signed with the secret {string}',
  async function (repo: string, secret: string) {
    await deliverPayload('pull_request_review', approvedReviewPayload(repositoryFields(repo)), repo, secret);
  },
);

When(
  'the webhook receives a {string} event with the action {string} from the repository {string}',
  async function (event: string, action: string, repo: string) {
    const payload = { action, repository: repositoryFields(repo), ...(EVENT_FIELDS[event] ?? {}) };
    await deliverPayload(event, payload, repo);
  },
);

When('the webhook receives an approved review that names no repository', async function () {
  await deliverPayload('pull_request_review', approvedReviewPayload());
});

When('the webhook receives a {string} delivery whose body is not valid JSON', async function (event: string) {
  await deliver(event, Buffer.from('{"action": "submitted",'));
});

/**
 * The exact body is deliberate: a reason such as `auth_gate_set` or `duplicate` fails the step, so
 * a leaked auth gate or cooldown cannot pass a row for the wrong reason.
 */
Then('the webhook answers {int} with the status {string}', function (code: number, status: string) {
  assert.strictEqual(ctx.response.statusCode, code);
  assert.deepStrictEqual(ctx.response.body, { status });
});

Then('the webhook answers {int} with the error {string}', function (code: number, error: string) {
  assert.strictEqual(ctx.response.statusCode, code);
  assert.deepStrictEqual(ctx.response.body, { error });
});

Then('exactly one cron is launched, for the repository {string}', async function (repo: string) {
  const recorder = requireRecorder();
  await waitForLaunch(recorder, (argv) => isCronLaunchFor(argv, repo), LAUNCH_WAIT_MS);
  const crons = recordedLaunches(recorder).filter(isCronLaunch);
  assert.strictEqual(crons.length, 1, `Expected exactly one cron launch, recorded: ${describeLaunches(recorder)}`);
  assert.ok(isCronLaunchFor(crons[0], repo), `Expected the cron launch to name --target-repo ${repo}, recorded: ${describeLaunches(recorder)}`);
});

Then('nothing other than that cron is launched', function () {
  const recorder = requireRecorder();
  const others = recordedLaunches(recorder).filter((argv) => !isCronLaunch(argv));
  assert.deepStrictEqual(others, [], `Expected no launch other than the cron, recorded: ${describeLaunches(recorder)}`);
});

Then('no cron is launched', function () {
  const recorder = requireRecorder();
  const crons = recordedLaunches(recorder).filter(isCronLaunch);
  assert.deepStrictEqual(crons, [], `Expected no cron launch, recorded: ${describeLaunches(recorder)}`);
});

Then('the cron that was already running is still the one registered for the repository {string}', function (repo: string) {
  assert.strictEqual(readCronPid(repo), process.pid, `Expected the registry to still name the running cron (pid ${process.pid}) for ${repo}`);
});
