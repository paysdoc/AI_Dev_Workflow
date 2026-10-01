/**
 * Every row drives the real webhook dispatch, the real cron tick or a real cron process against
 * feature-796's recording boundary. The fixture repositories ("adw-fixture/…-932") do not exist,
 * so a run that escapes this harness fails fast instead of acting on a repository.
 *
 * What could leave the process is shadowed by shell scripts that write their argv to a
 * per-scenario directory and do nothing else: `bunx` (every orchestrator launch), the Claude CLI
 * (`CLAUDE_CODE_PATH`, wrapped around test/mocks/claude-cli-stub.ts) and, for the cron-process
 * rows, `gh`. No orchestrator, classifier or label call is ever real.
 *
 * feature-796's and feature-820's hooks are scoped to their own tags and do not fire here, so
 * this file resets the shared world and cleans up after itself.
 */

import { Given, When, Then, Before, After, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import type * as http from 'http';

import { world796, resetWorld, seededIssueNumbers } from './feature-796.steps.ts';
import type { Fixture } from './feature-796.steps.ts';
import type { IssueComment, RepoIdentifier } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AUTH_GATE_PATH } from '../../../adws/core/authGate.ts';
import { AGENTS_STATE_DIR, LOGS_DIR, REPO_ROOT } from '../../../adws/core/config.ts';
import { clearClaudeCodePathCache } from '../../../adws/core/environment.ts';
import { readLocalRepoIdentity } from '../../../adws/core/localRepoIdentity.ts';
import { PAUSE_QUEUE_PATH } from '../../../adws/core/pauseQueue.ts';
import { writeCronPid } from '../../../adws/triggers/cronProcessGuard.ts';
import { getSpawnLockFilePath } from '../../../adws/triggers/spawnGate.ts';
import { dispatchWebhookEvent } from '../../../adws/triggers/trigger_webhook.ts';
import {
  cronPidFilePath,
  createRealCronWorld,
  killRealCronWorld,
  spawnRealCron,
  waitForRealCron,
} from '../../regression/step_definitions/realCronProcess.ts';

const CLAUDE_CLI_STUB = path.join(REPO_ROOT, 'test', 'mocks', 'claude-cli-stub.ts');

/** How long the recorders and the tracker's call log must stay silent before an asynchronous handling counts as settled. */
const QUIET_MS = 750;
const SETTLE_CAP_MS = 20_000;
const LAUNCH_WAIT_MS = 10_000;
const LABEL_WAIT_MS = 20_000;
const CRON_STARTUP_WAIT_MS = 15_000;
const CRON_TICK_WAIT_MS = 20_000;

interface Launch {
  readonly argv: string[];
  readonly script: string;
  readonly issue: string;
}

const s: {
  dir: string;
  savedPath: string | undefined;
  savedClaudeCodePath: string | undefined;
  savedWebhookSecret: string | undefined;
  savedAuthGate: string | null;
  savedQueueRaw: string | null;
  usedAdwIds: Set<string>;
  registeredCronRepoKeys: Set<string>;
  cron: ReturnType<typeof createRealCronWorld>;
  cronTargetReposDir: string;
  forgeRefusesLabels: boolean;
} = {
  dir: '',
  savedPath: undefined,
  savedClaudeCodePath: undefined,
  savedWebhookSecret: undefined,
  savedAuthGate: null,
  savedQueueRaw: null,
  usedAdwIds: new Set(),
  registeredCronRepoKeys: new Set(),
  cron: createRealCronWorld(),
  cronTargetReposDir: '',
  forgeRefusesLabels: false,
};

function bunxBinDir(): string {
  return path.join(s.dir, 'bunx-bin');
}

function ghBinDir(): string {
  return path.join(s.dir, 'gh-bin');
}

function writeExecutable(file: string, lines: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  fs.chmodSync(file, 0o755);
}

/** Writes each invocation's argv, NUL-separated, to its own file named after the shell's pid. */
function recordArgvLine(prefix: string): string {
  return `printf '%s\\0' "$@" > '${s.dir}/${prefix}-'$$'.args'`;
}

function installBunxShadow(): void {
  writeExecutable(path.join(bunxBinDir(), 'bunx'), ['#!/bin/sh', recordArgvLine('launch')]);
}

/** Records the invocation, runs the stub, then marks the invocation finished so a slow classification is never mistaken for silence. */
function installClaudeShadow(): string {
  const shadow = path.join(s.dir, 'claude');
  writeExecutable(shadow, [
    '#!/bin/sh',
    recordArgvLine('claude'),
    `bun '${CLAUDE_CLI_STUB}' "$@"`,
    'status=$?',
    `: > '${s.dir}/claude-'$$'.done'`,
    'exit $status',
  ]);
  return shadow;
}

/** Answers `gh auth token`, records every `gh label create`, and exits 0 — or 1 when the forge is to refuse. */
function installGhShadow(refuseLabels: boolean): void {
  writeExecutable(path.join(ghBinDir(), 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "auth" ] && [ "$2" = "token" ]; then echo adw-932-fake-token; exit 0; fi',
    'if [ "$1" = "label" ] && [ "$2" = "create" ]; then',
    `  ${recordArgvLine('gh-label')}`,
    ...(refuseLabels ? ["  echo 'HTTP 403: label creation refused' >&2", '  exit 1'] : ['  exit 0']),
    'fi',
    'exit 0',
  ]);
}

function readArgvRecords(prefix: string): string[][] {
  return fs.readdirSync(s.dir)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.args'))
    .sort()
    .map((name) => fs.readFileSync(path.join(s.dir, name), 'utf-8').split('\0').slice(0, -1));
}

/** argv is `tsx <script> <issue> …`; a launch belongs to the issue named right after the script. */
function readLaunches(): Launch[] {
  return readArgvRecords('launch').map((argv) => ({
    argv,
    script: path.relative(REPO_ROOT, argv[1] ?? ''),
    issue: argv[2] ?? '',
  }));
}

function launchesFor(issueNumber: number): Launch[] {
  return readLaunches().filter((launch) => launch.issue === String(issueNumber));
}

function describeLaunches(): string {
  return JSON.stringify(readLaunches().map((launch) => launch.argv.join(' ')));
}

/** The prompt is the Claude CLI's last argument. */
function classifierConsulted(issueNumber: number): boolean {
  return readArgvRecords('claude')
    .map((args) => args[args.length - 1] ?? '')
    .some((prompt) => prompt.includes('/classify_issue') && prompt.includes(`#${issueNumber}:`));
}

function classifierBusy(): boolean {
  const names = fs.readdirSync(s.dir);
  const started = names.filter((name) => /^claude-.*\.args$/.test(name)).length;
  const finished = names.filter((name) => /^claude-.*\.done$/.test(name)).length;
  return started > finished;
}

function activityCount(): number {
  return world796().activeCallLog.length + fs.readdirSync(s.dir).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The opened, comment and closed branches finish asynchronously, and so do the recorders of the
 * launches they make. Handling has settled once the tracker's call log and the shadows' records have
 * stayed unchanged for QUIET_MS and no classification is still running.
 */
async function settle(): Promise<void> {
  const start = Date.now();
  let seen = activityCount();
  let lastChange = Date.now();
  while (Date.now() - start < SETTLE_CAP_MS) {
    await sleep(50);
    const current = activityCount();
    if (current !== seen || classifierBusy()) {
      seen = current;
      lastChange = Date.now();
    }
    if (Date.now() - lastChange >= QUIET_MS) return;
  }
  assert.fail(`Handling did not settle within ${SETTLE_CAP_MS} ms`);
}

async function waitFor(predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  assert.ok(predicate(), `Timed out after ${timeoutMs} ms waiting for ${description}`);
}

function requireBoundary(): LaunchBoundary {
  const { boundary } = world796();
  assert.ok(boundary, 'Expected a launch boundary to have been built first');
  return boundary;
}

function requireFixture(): Fixture {
  const { activeFixture } = world796();
  assert.ok(activeFixture, 'Expected provider fixtures to have been set up first');
  return activeFixture;
}

function repoKeyOf(repoId: RepoIdentifier): string {
  return `${repoId.owner}/${repoId.repo}`;
}

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

function restoreEnv(name: string, saved: string | undefined): void {
  if (saved === undefined) delete process.env[name];
  else process.env[name] = saved;
}

function resetLocalState(): void {
  s.dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-932-'));
  s.usedAdwIds = new Set();
  s.registeredCronRepoKeys = new Set();
  s.cron = createRealCronWorld();
  s.cronTargetReposDir = '';
  s.forgeRefusesLabels = false;
}

Before({ tags: '@adw-932' }, function () {
  resetWorld();
  resetLocalState();
  installBunxShadow();

  s.savedPath = process.env['PATH'];
  s.savedClaudeCodePath = process.env['CLAUDE_CODE_PATH'];
  process.env['CLAUDE_CODE_PATH'] = installClaudeShadow();
  clearClaudeCodePathCache();

  // An unsigned payload is refused with a 401 once a secret is set, and an auth gate makes the
  // webhook and the cron ignore the event — either would turn a "no run" assertion vacuous.
  s.savedWebhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];
  delete process.env['GITHUB_WEBHOOK_SECRET'];
  s.savedAuthGate = readIfExists(AUTH_GATE_PATH);
  fs.rmSync(AUTH_GATE_PATH, { force: true });

  // The tick scans the checkout's real pause queue.
  s.savedQueueRaw = readIfExists(PAUSE_QUEUE_PATH);
  fs.rmSync(PAUSE_QUEUE_PATH, { force: true });
});

/** The spawn lock is keyed by the repository whoever takes it: evaluateCandidate by the boundary's, the cron's own release by the cron module's. */
function spawnLockIdentities(boundary: LaunchBoundary | null): RepoIdentifier[] {
  const identities = boundary ? [boundary.repoId] : [];
  try {
    return [...identities, readLocalRepoIdentity()];
  } catch {
    return identities;
  }
}

function removeSpawnLocks(issueNumbers: readonly number[], identities: readonly RepoIdentifier[]): void {
  for (const identity of identities) {
    for (const issueNumber of issueNumbers) {
      fs.rmSync(getSpawnLockFilePath(identity, issueNumber), { force: true });
    }
  }
}

After({ tags: '@adw-932' }, function () {
  killRealCronWorld(s.cron);
  for (const repoKey of s.registeredCronRepoKeys) fs.rmSync(cronPidFilePath(repoKey), { force: true });

  const w = world796();
  const issueNumbers = w.activeFixture ? seededIssueNumbers(w.activeFixture) : [];
  removeSpawnLocks(issueNumbers, spawnLockIdentities(w.boundary));
  for (const adwId of s.usedAdwIds) {
    fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
    fs.rmSync(path.join(LOGS_DIR, adwId), { recursive: true, force: true });
  }
  for (const dir of [...w.tempDirs, s.dir, s.cronTargetReposDir]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }

  restoreEnv('PATH', s.savedPath);
  restoreEnv('CLAUDE_CODE_PATH', s.savedClaudeCodePath);
  clearClaudeCodePathCache();
  restoreEnv('GITHUB_WEBHOOK_SECRET', s.savedWebhookSecret);
  restoreFile(AUTH_GATE_PATH, s.savedAuthGate);
  restoreFile(PAUSE_QUEUE_PATH, s.savedQueueRaw);
  resetWorld();
});

// ── Seeding ──────────────────────────────────────────────────────────────────────────────────

Given(
  'issue {int} in the recording tracker carries the labels {string}, {string} and {string}',
  function (issueNumber: number, first: string, second: string, third: string) {
    requireFixture().issueLabels.set(issueNumber, [first, second, third]);
  },
);

Given('issue {int} in the recording tracker is in state {string}', function (issueNumber: number, state: string) {
  requireFixture().issueStates.set(issueNumber, state);
});

Given('the body of issue {int} in the recording tracker reads:', function (issueNumber: number, body: string) {
  requireFixture().issueBodies.set(issueNumber, body);
});

Given(
  'issue {int} has an earlier ADW workflow under adw id {string} recorded at workflowStage {string} running {string}',
  function (issueNumber: number, adwId: string, workflowStage: string, orchestratorScript: string) {
    const fixture = requireFixture();
    const { repoId } = requireBoundary();
    const comment: IssueComment = {
      id: `adw-id-comment-${adwId}`,
      body: `**ADW ID:** \`${adwId}\``,
      author: 'adw-bot[bot]',
      createdAt: staleTimestamp(),
    };
    fixture.issueComments.set(issueNumber, [...(fixture.issueComments.get(issueNumber) ?? []), comment]);
    s.usedAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      issueNumber,
      workflowStage,
      orchestratorScript,
      repoIdentity: { owner: repoId.owner, repo: repoId.repo },
    });
  },
);

/** Well before GRACE_PERIOD_MS, or the cron's filter drops every issue as `grace_period`. */
function staleTimestamp(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function seedListingTimestamps(): void {
  const fixture = requireFixture();
  for (const issueNumber of seededIssueNumbers(fixture)) {
    if (!fixture.issueCreatedAts.has(issueNumber)) fixture.issueCreatedAts.set(issueNumber, staleTimestamp());
    if (!fixture.issueUpdatedAts.has(issueNumber)) fixture.issueUpdatedAts.set(issueNumber, staleTimestamp());
  }
}

// ── Driving the webhook and the cron ─────────────────────────────────────────────────────────

/** Every launch goes through `bunx`; shadowing it for the whole scenario keeps any orchestrator from starting. */
function shadowBunx(): void {
  process.env['PATH'] = `${bunxBinDir()}${path.delimiter}${s.savedPath ?? ''}`;
}

function repositoryPayload(boundary: LaunchBoundary): Record<string, unknown> {
  const fullName = repoKeyOf(boundary.repoId);
  return { full_name: fullName, clone_url: `https://example.invalid/${fullName}.git` };
}

/** The issue as the recording tracker holds it, so reading the event and reading the tracker see the same thing. */
function issuePayload(issueNumber: number, labelsInEvent: boolean): Record<string, unknown> {
  const fixture = requireFixture();
  const labels = labelsInEvent ? (fixture.issueLabels.get(issueNumber) ?? []).map((name) => ({ name })) : [];
  return {
    number: issueNumber,
    title: fixture.issueTitles.get(issueNumber) ?? '',
    body: fixture.issueBodies.get(issueNumber) ?? '',
    labels,
  };
}

async function dispatchWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  const boundary = requireBoundary();
  // ensureCronProcess launches nothing for a repository whose cron is registered as alive.
  const repoKey = repoKeyOf(boundary.repoId);
  writeCronPid(repoKey, process.pid);
  s.registeredCronRepoKeys.add(repoKey);
  shadowBunx();

  const response: { body?: Record<string, unknown> } = {};
  const req = { headers: { 'x-github-event': event } } as unknown as http.IncomingMessage;
  const res = {
    writeHead: () => res,
    end: (body?: string) => { if (body) response.body = JSON.parse(body) as Record<string, unknown>; },
  } as unknown as http.ServerResponse;

  dispatchWebhookEvent(req, res, Buffer.from(JSON.stringify(payload)), () => boundary);

  // An event the webhook ignores (cooldown, auth gate, no boundary) would make every "no run" assertion pass for the wrong reason.
  assert.strictEqual(response.body?.status, 'processing', `Expected the webhook to process the ${event} event, answered ${JSON.stringify(response.body)}`);
  await settle();
}

function dispatchIssueEvent(action: 'opened' | 'closed', issueNumber: number, labelsInEvent: boolean): Promise<void> {
  const boundary = requireBoundary();
  return dispatchWebhook('issues', { action, repository: repositoryPayload(boundary), issue: issuePayload(issueNumber, labelsInEvent) });
}

When('the webhook dispatches the opening of issue {int} from that boundary', function (issueNumber: number) {
  return dispatchIssueEvent('opened', issueNumber, true);
});

When(
  'the webhook dispatches the opening of issue {int} from that boundary with no labels in the event',
  function (issueNumber: number) {
    return dispatchIssueEvent('opened', issueNumber, false);
  },
);

When('the webhook dispatches the closing of issue {int} from that boundary', function (issueNumber: number) {
  return dispatchIssueEvent('closed', issueNumber, true);
});

When(
  'the webhook dispatches a {string} comment on issue {int} from that boundary',
  function (commentText: string, issueNumber: number) {
    return dispatchWebhook('issue_comment', {
      action: 'created',
      repository: repositoryPayload(requireBoundary()),
      issue: issuePayload(issueNumber, true),
      comment: { body: commentText },
    });
  },
);

When('the cron tick runs once from that boundary', async function () {
  const boundary = requireBoundary();
  seedListingTimestamps();
  shadowBunx();
  // Imported here, not at load: importing the cron module resolves the checkout's own repository.
  const { checkAndTrigger } = await import('../../../adws/triggers/trigger_cron.ts');
  await checkAndTrigger(boundary);
  await settle();
});

// ── Observing the runs ───────────────────────────────────────────────────────────────────────

Then('no ADW run was started for issue {int}', function (issueNumber: number) {
  assert.deepStrictEqual(launchesFor(issueNumber), [], `Expected no ADW run for issue ${issueNumber}, recorded: ${describeLaunches()}`);
});

Then('exactly one ADW run was started for issue {int}', async function (issueNumber: number) {
  await waitFor(() => launchesFor(issueNumber).length > 0, LAUNCH_WAIT_MS, `an ADW run for issue ${issueNumber}`);
  assert.strictEqual(launchesFor(issueNumber).length, 1, `Expected exactly one ADW run for issue ${issueNumber}, recorded: ${describeLaunches()}`);
});

Then('the ADW run started for issue {int} runs the orchestrator {string}', function (issueNumber: number, script: string) {
  const [launch] = launchesFor(issueNumber);
  assert.ok(launch, `Expected an ADW run for issue ${issueNumber}, recorded: ${describeLaunches()}`);
  assert.strictEqual(launch.script, script, `Expected issue ${issueNumber} to run ${script}, ran: ${launch.argv.join(' ')}`);
});

Then('the issue classifier was not consulted for issue {int}', function (issueNumber: number) {
  assert.ok(!classifierConsulted(issueNumber), `Expected the issue classifier not to be consulted for issue ${issueNumber}`);
});

Then('the issue classifier was consulted for issue {int}', async function (issueNumber: number) {
  await waitFor(() => classifierConsulted(issueNumber), LAUNCH_WAIT_MS, `the issue classifier to be consulted for issue ${issueNumber}`);
});

// ── A real cron process provisions the label catalogue ───────────────────────────────────────

Given('the forge refuses to create labels', function () {
  s.forgeRefusesLabels = true;
});

/** The bunx shadow must stay off the PATH here: it would swallow the launch of the cron itself. */
When('a cron trigger process is launched with --target-repo {string}', function (repoKey: string) {
  assert.ok(
    !(process.env['PATH'] ?? '').split(path.delimiter).includes(bunxBinDir()),
    'Expected the bunx shadow to be off the PATH while a real cron process is launched',
  );
  installGhShadow(s.forgeRefusesLabels);
  s.cronTargetReposDir = fs.mkdtempSync(path.join(tmpdir(), 'adw-932-cron-targets-'));
  spawnRealCron(s.cron, repoKey, {
    PATH: `${ghBinDir()}${path.delimiter}${process.env['PATH'] ?? ''}`,
    TARGET_REPOS_DIR: s.cronTargetReposDir,
  });
});

function labelsAskedOn(repoKey: string): string[] {
  return readArgvRecords('gh-label')
    .filter((args) => args[args.indexOf('--repo') + 1] === repoKey && args.includes('--force'))
    .map((args) => args[2] ?? '');
}

async function waitForLabelCreations(repoKey: string, table: DataTable): Promise<void> {
  const wanted = table.hashes().map((row) => row['label'] ?? '');
  const missing = () => wanted.filter((label) => !labelsAskedOn(repoKey).includes(label));
  await waitFor(() => missing().length === 0, LABEL_WAIT_MS, `the forge to be asked for ${wanted.join(', ')} on ${repoKey}`);
}

Then('the repository {string} has each of these labels:', function (repoKey: string, table: DataTable) {
  return waitForLabelCreations(repoKey, table);
});

Then(
  'the forge was asked to create each of these labels on the repository {string}:',
  function (repoKey: string, table: DataTable) {
    return waitForLabelCreations(repoKey, table);
  },
);

Then(
  'the cron trigger process launched with --target-repo {string} completes its first poll tick',
  async function (repoKey: string) {
    assert.strictEqual(s.cron.repoKey, repoKey, `Expected the cron launched for ${repoKey}`);
    await waitForRealCron(s.cron, () => s.cron.stdout.includes('CRON trigger (backlog sweeper) started'), CRON_STARTUP_WAIT_MS, 'the cron startup line');
    await waitForRealCron(
      s.cron,
      () => s.cron.stdout.includes('POLL:') || s.cron.stdout.includes('checkAndTrigger: tick failed'),
      CRON_TICK_WAIT_MS,
      'the first poll tick',
    );
  },
);
