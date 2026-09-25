/**
 * §1-§3 (cron path) drive `handleRetryDirective` the way `trigger_cron.ts` does, with its
 * `spawnDetached` seam replaced by a recorder — no real orchestrator is ever launched from
 * that path. §4 (webhook) drives the real `dispatchWebhookEvent`, so its seeded top-level
 * state names a recording FIXTURE script (an absolute path) as its orchestrator, since that
 * path uses the real `spawnDetached` unchanged.
 *
 * Comment posts reach `gh issue comment` (GraphQL, not the REST mock's HTTP surface), so this
 * file shadows `gh` on PATH exactly as feature-902-queue.steps.ts does, then replays the
 * recorded `gh issue comment` invocations as real HTTP POSTs against the mock GitHub API so the
 * registered T14/T25/T27 assertions can observe them.
 */

import { Given, When, Then, Before, After, BeforeAll, AfterAll } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type * as http from 'http';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';

import { Platform, type RepoIdentifier, type BoundProviders } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import { buildLaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import type { TargetRepoInfo } from '../../../adws/types/issueTypes.ts';
import { buildCronTargetRepoArgs } from '../../../adws/triggers/cronRepoResolver.ts';
import { AGENTS_STATE_DIR, PROBE_INTERVAL_CYCLES } from '../../../adws/core/config.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { readPauseQueue, appendToPauseQueue, removeFromPauseQueue, PAUSE_QUEUE_PATH, type PausedWorkflow } from '../../../adws/core/pauseQueue.ts';
import { scanPauseQueue } from '../../../adws/triggers/pauseQueueScanner.ts';
import { handleRetryDirective, buildRetryHandlerDeps } from '../../../adws/triggers/retryHandler.ts';
import { dispatchWebhookEvent } from '../../../adws/triggers/trigger_webhook.ts';
import { writeCronPid } from '../../../adws/triggers/cronProcessGuard.ts';
import { getSpawnLockFilePath } from '../../../adws/triggers/spawnGate.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_GATE_PATH = path.join('agents', '.auth_gate');

interface SeededQueueEntry {
  adwId: string;
  worktreePath: string;
  scriptPath: string;
  invocationLogPath: string;
}

interface RecordedLaunch {
  command: string;
  args: string[];
}

const s: {
  boundary: LaunchBoundary | null;
  targetRepoArgs: string[];
  seededComments: Map<number, { body: string }[]>;
  seededQueueEntries: Map<number, SeededQueueEntry>;
  webhookFixtures: Map<number, SeededQueueEntry>;
  recordedLaunches: RecordedLaunch[];
  cronLogs: string[];
  usedAdwIds: Set<string>;
  usedIssueNumbers: Set<number>;
  savedQueueRaw: string | null;
  savedAppEnv: { id: string | undefined; slug: string | undefined; key: string | undefined };
  savedWebhookSecret: string | undefined;
  savedAuthGate: string | null;
  ghLogDir: string;
  ghLogPath: string;
} = {
  boundary: null,
  targetRepoArgs: [],
  seededComments: new Map(),
  seededQueueEntries: new Map(),
  webhookFixtures: new Map(),
  recordedLaunches: [],
  cronLogs: [],
  usedAdwIds: new Set(),
  usedIssueNumbers: new Set(),
  savedQueueRaw: null,
  savedAppEnv: { id: undefined, slug: undefined, key: undefined },
  savedWebhookSecret: undefined,
  savedAuthGate: null,
  ghLogDir: '',
  ghLogPath: '',
};

let ghMockDir: string | null = null;

/** A `gh` shadow mirroring feature-902-queue.steps.ts's — handles `auth token` and `issue comment ... --body-file -`. */
function createGhMockDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-908-gh-mock-'));
  const stubPath = path.join(dir, 'gh-stub.ts');
  const stubSource = [
    "import { readFileSync, appendFileSync } from 'fs';",
    '',
    'const args = process.argv.slice(2);',
    "const logPath = process.env['ADW_908_GH_LOG'];",
    '',
    "if (args[0] === 'auth' && args[1] === 'token') {",
    "  process.stdout.write('adw-908-fake-token\\n');",
    '  process.exit(0);',
    '}',
    '',
    "if (args[0] === 'issue' && args[1] === 'comment') {",
    '  const issueNumber = args[2];',
    "  const repoIdx = args.indexOf('--repo');",
    "  const repo = repoIdx !== -1 ? args[repoIdx + 1] : '';",
    "  const bodyFileIdx = args.indexOf('--body-file');",
    `  const body = bodyFileIdx !== -1 && args[bodyFileIdx + 1] === '-' ? readFileSync(0, 'utf-8') : '';`,
    '  if (logPath) {',
    "    appendFileSync(logPath, JSON.stringify({ issueNumber, repo, body }) + '\\n');",
    '  }',
    "  process.stdout.write('https://example.invalid/' + repo + '/issues/' + issueNumber + '#issuecomment-1\\n');",
    '  process.exit(0);',
    '}',
    '',
    'process.exit(0);',
  ].join('\n') + '\n';
  fs.writeFileSync(stubPath, stubSource, 'utf-8');

  const wrapperPath = path.join(dir, 'gh');
  const wrapperSource = ['#!/bin/sh', `exec bun "${stubPath}" "$@"`].join('\n') + '\n';
  fs.writeFileSync(wrapperPath, wrapperSource, { mode: 0o755 });

  return dir;
}

BeforeAll(function () {
  ghMockDir = createGhMockDir();
});

AfterAll(function () {
  if (ghMockDir) {
    try { fs.rmSync(ghMockDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  ghMockDir = null;
});

function resetLocalState(): void {
  s.boundary = null;
  s.targetRepoArgs = [];
  s.seededComments = new Map();
  s.seededQueueEntries = new Map();
  s.webhookFixtures = new Map();
  s.recordedLaunches = [];
  s.cronLogs = [];
  s.usedAdwIds = new Set();
  s.usedIssueNumbers = new Set();
}

Before({ tags: '@adw-908' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();

  process.env['PATH'] = `${ghMockDir}:${process.env['PATH'] ?? ''}`;
  s.savedAppEnv = {
    id: process.env['GITHUB_APP_ID'],
    slug: process.env['GITHUB_APP_SLUG'],
    key: process.env['GITHUB_APP_PRIVATE_KEY_PATH'],
  };
  process.env['GITHUB_APP_ID'] = '';
  process.env['GITHUB_APP_SLUG'] = '';
  process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '';

  // The webhook row posts an unsigned synthetic payload; a real GITHUB_WEBHOOK_SECRET in this
  // host's environment would reject it with 401 before the retry directive is ever reached,
  // turning the row's assertion vacuous.
  s.savedWebhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];
  delete process.env['GITHUB_WEBHOOK_SECRET'];

  s.ghLogDir = fs.mkdtempSync(path.join(tmpdir(), 'adw-908-gh-log-'));
  s.ghLogPath = path.join(s.ghLogDir, 'invocations.log');
  process.env['ADW_908_GH_LOG'] = s.ghLogPath;

  s.savedQueueRaw = fs.existsSync(PAUSE_QUEUE_PATH) ? fs.readFileSync(PAUSE_QUEUE_PATH, 'utf-8') : null;
  fs.rmSync(PAUSE_QUEUE_PATH, { force: true });

  s.savedAuthGate = fs.existsSync(AUTH_GATE_PATH) ? fs.readFileSync(AUTH_GATE_PATH, 'utf-8') : null;
  fs.rmSync(AUTH_GATE_PATH, { force: true });

  resetLocalState();
});

After({ tags: '@adw-908' }, async function (this: RegressionWorld) {
  for (const seeded of [...s.seededQueueEntries.values(), ...s.webhookFixtures.values()]) {
    try { execSync(`pkill -f ${JSON.stringify(seeded.scriptPath)}`, { stdio: 'ignore' }); } catch { /* nothing to kill */ }
    try { fs.rmSync(seeded.worktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  for (const adwId of s.usedAdwIds) {
    try { fs.rmSync(path.join(process.cwd(), 'agents', adwId), { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(path.join(process.cwd(), 'agents', 'paused_queue_logs', `${adwId}.resume.log`), { force: true }); } catch { /* best effort */ }
  }

  const lockRepo: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };
  for (const issueNumber of s.usedIssueNumbers) {
    try { fs.rmSync(getSpawnLockFilePath(lockRepo, issueNumber), { force: true }); } catch { /* best effort */ }
  }

  try { fs.rmSync(path.join(AGENTS_STATE_DIR, 'cron', 'acme_widgets.json'), { force: true }); } catch { /* best effort */ }

  if (s.savedQueueRaw !== null) {
    fs.writeFileSync(PAUSE_QUEUE_PATH, s.savedQueueRaw);
  } else {
    fs.rmSync(PAUSE_QUEUE_PATH, { force: true });
  }

  if (s.savedAuthGate !== null) {
    fs.mkdirSync(path.dirname(AUTH_GATE_PATH), { recursive: true });
    fs.writeFileSync(AUTH_GATE_PATH, s.savedAuthGate);
  } else {
    fs.rmSync(AUTH_GATE_PATH, { force: true });
  }

  process.env['GITHUB_APP_ID'] = s.savedAppEnv.id;
  process.env['GITHUB_APP_SLUG'] = s.savedAppEnv.slug;
  process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = s.savedAppEnv.key;
  if (s.savedWebhookSecret === undefined) delete process.env['GITHUB_WEBHOOK_SECRET'];
  else process.env['GITHUB_WEBHOOK_SECRET'] = s.savedWebhookSecret;
  delete process.env['ADW_908_GH_LOG'];
  if (s.ghLogDir) {
    try { fs.rmSync(s.ghLogDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  await teardownMockInfrastructure();
  this.mockContext = null;
  resetLocalState();
});

function writeFixtureOrchestratorScript(worktreePath: string, invocationLogPath: string): string {
  const scriptPath = path.join(worktreePath, 'fixture-orchestrator.ts');
  const source = [
    "import { appendFileSync } from 'fs';",
    `appendFileSync(${JSON.stringify(invocationLogPath)}, JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }) + ${JSON.stringify('\n')});`,
    '// Stays alive past any readiness window; the After hook kills it by script path.',
    'setInterval(() => {}, 60_000);',
  ].join('\n') + '\n';
  fs.writeFileSync(scriptPath, source, 'utf-8');
  return scriptPath;
}

function seedFixture(prefix: string, issueNumber: number): SeededQueueEntry {
  const worktreePath = fs.mkdtempSync(path.join(tmpdir(), `adw-908-${prefix}-${issueNumber}-`));
  const invocationLogPath = path.join(worktreePath, 'invocations.log');
  const scriptPath = writeFixtureOrchestratorScript(worktreePath, invocationLogPath);
  return { adwId: '', worktreePath, scriptPath, invocationLogPath };
}

function countFixtureInvocations(entry: SeededQueueEntry | undefined): number {
  if (!entry || !fs.existsSync(entry.invocationLogPath)) return 0;
  return fs.readFileSync(entry.invocationLogPath, 'utf-8').trim().split('\n').filter(Boolean).length;
}

function launchesForIssue(issueNumber: number): number {
  const fromRecorder = s.recordedLaunches.filter((l) => l.args[2] === String(issueNumber)).length;
  const fromFixture = countFixtureInvocations(s.seededQueueEntries.get(issueNumber));
  return fromRecorder + fromFixture;
}

function recordingSpawnDetached(command: string, args: string[]): void {
  s.recordedLaunches.push({ command, args });
}

function captureConsoleLogsSync(fn: () => void): string[] {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function replayGhCommentLog(): Promise<void> {
  if (!fs.existsSync(s.ghLogPath)) return;
  const content = fs.readFileSync(s.ghLogPath, 'utf-8');
  fs.writeFileSync(s.ghLogPath, '');
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const serverUrl = process.env['MOCK_GITHUB_API_URL'];
  if (!serverUrl) return;
  for (const line of lines) {
    const parsed = JSON.parse(line) as { issueNumber: string; repo: string; body: string };
    await fetch(`${serverUrl}/repos/${parsed.repo}/issues/${parsed.issueNumber}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: parsed.body }),
    });
  }
}

async function waitBriefly(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

// ── Background ───────────────────────────────────────────────────────────────

Given(
  'the cron is polling the target repository {string} from a host checked out at {string}',
  function (targetRepoFullName: string, _hostFullName: string) {
    const [owner, repo] = targetRepoFullName.split('/');
    const targetRepo: TargetRepoInfo = { owner, repo, cloneUrl: `https://example.invalid/${targetRepoFullName}.git` };
    const repoInfo: RepoIdentifier = { owner, repo, platform: Platform.GitHub };
    s.targetRepoArgs = buildCronTargetRepoArgs(repoInfo, targetRepo, () => null);
    s.boundary = buildLaunchBoundary(targetRepo);
  },
);

// ── §1/§2/§3 seeding ─────────────────────────────────────────────────────────

Given('the latest ADW workflow comment on issue {int} names adwId {string}', function (issueNumber: number, adwId: string) {
  const comments = s.seededComments.get(issueNumber) ?? [];
  comments.push({ body: `**ADW ID:** \`${adwId}\`` });
  s.seededComments.set(issueNumber, comments);
  s.usedAdwIds.add(adwId);
  s.usedIssueNumbers.add(issueNumber);
});

Given(
  'the top-level state for adwId {string} records issue {int} at workflowStage {string} with orchestrator script {string}',
  function (adwId: string, issueNumber: number, stage: string, script: string) {
    s.usedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId, issueNumber, workflowStage: stage, orchestratorScript: script,
      repoIdentity: { owner: 'acme', repo: 'widgets' },
    });
  },
);

Given(
  'the top-level state for adwId {string} records issue {int} at workflowStage {string} with no orchestrator script',
  function (adwId: string, issueNumber: number, stage: string) {
    s.usedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId, issueNumber, workflowStage: stage,
      repoIdentity: { owner: 'acme', repo: 'widgets' },
    });
  },
);

Given(
  'the top-level state for adwId {string} records issue {int} at workflowStage {string} with a merge retry count of {int}',
  function (adwId: string, issueNumber: number, stage: string, count: number) {
    s.usedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId, issueNumber, workflowStage: stage, mergeRetryCount: count,
      repoIdentity: { owner: 'acme', repo: 'widgets' },
    });
  },
);

Given(
  'the top-level state for adwId {string} records issue {int} at workflowStage {string} with a resume attempt count of {int}',
  function (adwId: string, issueNumber: number, stage: string, count: number) {
    s.usedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId, issueNumber, workflowStage: stage, resumeAttempts: count,
      repoIdentity: { owner: 'acme', repo: 'widgets' },
    });
  },
);

Given(
  'the top-level state for adwId {string} records issue {int} at workflowStage {string} with a recording fixture as its orchestrator script',
  function (adwId: string, issueNumber: number, stage: string) {
    const seeded = seedFixture('webhook', issueNumber);
    seeded.adwId = adwId;
    s.webhookFixtures.set(issueNumber, seeded);
    s.usedAdwIds.add(adwId);
    s.usedIssueNumbers.add(issueNumber);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId, issueNumber, workflowStage: stage, orchestratorScript: seeded.scriptPath,
      repoIdentity: { owner: 'acme', repo: 'widgets' },
    });
  },
);

Given('the rate-limit pause queue holds no entry for adwId {string}', function (adwId: string) {
  removeFromPauseQueue(adwId);
});

Given('the rate-limit pause queue holds an entry for adwId {string} on issue {int}', function (adwId: string, issueNumber: number) {
  const seeded = seedFixture('queue', issueNumber);
  seeded.adwId = adwId;
  s.seededQueueEntries.set(issueNumber, seeded);

  const entry: PausedWorkflow = {
    adwId,
    issueNumber,
    orchestratorScript: seeded.scriptPath,
    pausedAtPhase: 'build',
    pauseReason: 'rate_limited',
    pausedAt: new Date().toISOString(),
    worktreePath: seeded.worktreePath,
    branchName: `feature-issue-${issueNumber}-${adwId}`,
    extraArgs: ['--target-repo', 'acme/widgets'],
  };
  appendToPauseQueue(entry);
});

// ── §1/§2/§3 the directive itself ────────────────────────────────────────────

When('the cron handles the ## Retry directive on issue {int}', async function (issueNumber: number) {
  assert.ok(s.boundary, 'Expected the Background to have built a launch boundary first');
  const comments = [...(s.seededComments.get(issueNumber) ?? []), { body: '## Retry' }];
  const deps = { ...buildRetryHandlerDeps(s.boundary, s.targetRepoArgs), spawnDetached: recordingSpawnDetached };
  const lines = captureConsoleLogsSync(() => {
    handleRetryDirective(issueNumber, comments, deps);
  });
  s.cronLogs.push(...lines);
  await replayGhCommentLog();
});

When('the pause-queue scanner then runs a probe cycle in which the rate limit has cleared', async function () {
  await scanPauseQueue(PROBE_INTERVAL_CYCLES, () => 'clear');
  await replayGhCommentLog();
});

// ── §1 assertions ────────────────────────────────────────────────────────────

Then('exactly one orchestrator was launched for issue {int}', function (issueNumber: number) {
  assert.strictEqual(launchesForIssue(issueNumber), 1, `Expected exactly one launch for issue ${issueNumber}, recorded: ${JSON.stringify(s.recordedLaunches)}`);
});

Then('no orchestrator was launched for issue {int}', async function (issueNumber: number) {
  await waitBriefly();
  assert.strictEqual(launchesForIssue(issueNumber), 0, `Expected no launch for issue ${issueNumber}, recorded: ${JSON.stringify(s.recordedLaunches)}`);
});

Then(
  'the orchestrator launched for issue {int} runs {string} under adwId {string}',
  function (issueNumber: number, script: string, adwId: string) {
    const call = s.recordedLaunches.find((l) => l.args[2] === String(issueNumber));
    assert.ok(call, `Expected a recorded launch for issue ${issueNumber}`);
    assert.strictEqual(call!.args[1], script, `Expected script "${script}", got argv=${call!.args.join(' ')}`);
    assert.strictEqual(call!.args[3], adwId, `Expected adwId "${adwId}", got argv=${call!.args.join(' ')}`);
  },
);

Then('the orchestrator launched for issue {int} targets the repository {string}', function (issueNumber: number, repoFullName: string) {
  const call = s.recordedLaunches.find((l) => l.args[2] === String(issueNumber));
  assert.ok(call, `Expected a recorded launch for issue ${issueNumber}`);
  const idx = call!.args.indexOf('--target-repo');
  assert.ok(idx !== -1 && call!.args[idx + 1] === repoFullName, `Expected --target-repo ${repoFullName}, got argv=${call!.args.join(' ')}`);
});

Then('no entry for adwId {string} was added to the rate-limit pause queue', function (adwId: string) {
  const entries = readPauseQueue();
  assert.ok(!entries.some((e) => e.adwId === adwId), `Expected no queue entry for adwId ${adwId}`);
});

Then('the rate-limit pause queue no longer holds an entry for adwId {string}', function (adwId: string) {
  const entries = readPauseQueue();
  assert.ok(!entries.some((e) => e.adwId === adwId), `Expected no queue entry for adwId ${adwId}`);
});

Then('the rate-limit pause queue still holds the entry for adwId {string}', function (adwId: string) {
  const entries = readPauseQueue();
  assert.ok(entries.some((e) => e.adwId === adwId), `Expected a queue entry for adwId ${adwId}`);
});

Then('the pause-queue scanner relaunched nothing for issue {int}', function (issueNumber: number) {
  assert.strictEqual(countFixtureInvocations(s.seededQueueEntries.get(issueNumber)), 0, `Expected the scanner not to have relaunched the fixture for issue ${issueNumber}`);
});

Then('the resumed comment is recorded on issue {int} in the target repository {string}', function (this: RegressionWorld, issueNumber: number, repoFullName: string) {
  const requests = this.getRecordedRequests();
  const found = requests.some((r) => {
    if (r.method !== 'POST' || !r.url.includes(`/repos/${repoFullName}/issues/${issueNumber}/comments`)) return false;
    try {
      const body = JSON.parse(r.body) as Record<string, unknown>;
      return typeof body['body'] === 'string' && body['body'].includes('## :arrow_forward: ADW Workflow Resuming');
    } catch {
      return false;
    }
  });
  assert.ok(found, `Expected a resumed comment on issue ${issueNumber} in ${repoFullName}. Recorded: ${requests.map((r) => `${r.method} ${r.url}`).join(', ')}`);
});

Then(
  "the mock harness recorded zero comment posts on issue {int} in the cron host's own repository {string}",
  function (this: RegressionWorld, issueNumber: number, repoFullName: string) {
    const requests = this.getRecordedRequests();
    const matches = requests.filter((r) => r.method === 'POST' && r.url.includes(`/repos/${repoFullName}/issues/${issueNumber}/comments`));
    assert.strictEqual(matches.length, 0, `Expected zero comment posts on issue ${issueNumber} in ${repoFullName}, recorded ${matches.length}`);
  },
);

// ── §2 assertions ────────────────────────────────────────────────────────────

Then('the Retry handling logged that issue {int} is paused_auth and left to the auth queue', function (issueNumber: number) {
  const found = s.cronLogs.some((line) => line.includes(`#${issueNumber}`) && /paused_auth/.test(line) && /auth[- ]?queue/i.test(line));
  assert.ok(found, `Expected a paused_auth/auth-queue log line for issue ${issueNumber}. Captured: ${s.cronLogs.join(' | ')}`);
});

// ── §3 assertions ────────────────────────────────────────────────────────────

Then('the top-level state for adwId {string} records a merge retry count of {int}', function (adwId: string, expected: number) {
  const state = AgentStateManager.readTopLevelState(adwId);
  assert.ok(state, `Expected top-level state for adwId ${adwId}`);
  assert.strictEqual(state!.mergeRetryCount, expected);
});

Then('the top-level state for adwId {string} records a resume attempt count of {int}', function (adwId: string, expected: number) {
  const state = AgentStateManager.readTopLevelState(adwId);
  assert.ok(state, `Expected top-level state for adwId ${adwId}`);
  assert.strictEqual(state!.resumeAttempts, expected);
});

// ── §4 the webhook caller ────────────────────────────────────────────────────

function fakeWebhookReq(event: string): http.IncomingMessage {
  return { headers: { 'x-github-event': event } } as unknown as http.IncomingMessage;
}

interface CapturedResponse { statusCode?: number; body?: Record<string, unknown> }

function fakeWebhookRes(): { res: http.ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = {};
  const res = {
    writeHead(code: number) { captured.statusCode = code; return res; },
    end(payload?: string) { if (payload) captured.body = JSON.parse(payload); },
  } as unknown as http.ServerResponse;
  return { res, captured };
}

function buildFakeWebhookBoundary(owner: string, repo: string, comments: { body: string }[]): LaunchBoundary {
  const repoId: RepoIdentifier = { owner, repo, platform: Platform.GitHub };
  const issueTracker = {
    fetchComments: () => comments,
    commentOnIssue: () => { /* not asserted on in this scenario */ },
  };
  const providers = { issueTracker, codeHost: {} } as unknown as BoundProviders;
  return { gitContext: {}, repoId, providers } as unknown as LaunchBoundary;
}

When(
  'the webhook receives a {string} comment on issue {int} from the repository {string}',
  function (commentText: string, issueNumber: number, repoFullName: string) {
    const [owner, repo] = repoFullName.split('/');
    writeCronPid(repoFullName, process.pid);

    const comments = s.seededComments.get(issueNumber) ?? [];
    const boundary = buildFakeWebhookBoundary(owner, repo, comments);

    const payload = {
      action: 'created',
      repository: { full_name: repoFullName, clone_url: `https://example.invalid/${repoFullName}.git` },
      issue: { number: issueNumber, body: '' },
      comment: { body: commentText },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const { res } = fakeWebhookRes();
    const req = fakeWebhookReq('issue_comment');

    dispatchWebhookEvent(req, res, rawBody, () => boundary);
  },
);

Then('no orchestrator was launched for issue {int} without the target repository {string}', async function (issueNumber: number, repoFullName: string) {
  await waitBriefly();
  const seeded = s.webhookFixtures.get(issueNumber);
  if (!seeded || !fs.existsSync(seeded.invocationLogPath)) return;
  const lines = fs.readFileSync(seeded.invocationLogPath, 'utf-8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    const parsed = JSON.parse(line) as { argv: string[] };
    const idx = parsed.argv.indexOf('--target-repo');
    assert.ok(
      idx !== -1 && parsed.argv[idx + 1] === repoFullName,
      `Expected every launch for issue ${issueNumber} to carry --target-repo ${repoFullName}, got argv=${parsed.argv.join(' ')}`,
    );
  }
});
