/**
 * BDD step definitions for feature-818.feature
 *
 * GitLab and Jira adapters take injected configuration and the Logger port —
 * no environment reads, no `adws/core` imports (#818).
 *
 * §1-§5 stand a real HTTP recorder on 127.0.0.1, hand its address to the
 * adapter AS THE INJECTED instanceUrl, and drive each adapter in a CHILD
 * PROCESS whose environment can carry a poisoned value for each of the five
 * forge variables — the only vantage point from which "configuration arrives
 * injected" and "no environment read remaining" are both observable, since
 * the reads (when present) are load-time constants Cucumber has already
 * imported before any in-process hook could poison a variable. Both clients
 * run through their DEFAULT transport (real curl, real fetch) so the shipped
 * path is exercised end to end, not the vitest seams.
 *
 * §6 reuses the guard fixture-tree Given/When/Then family from
 * feature-816.steps.ts verbatim — no redefinitions. Because this file's
 * scenarios carry @adw-818, not @adw-816, feature-816.steps.ts's own
 * Before/After (tag-scoped to @adw-816) never run for them; this file forces
 * fixture-tree isolation from its own hooks, as feature-817.steps.ts does.
 *
 * §7 reuses `the git/gh guard runs across the whole ADW repository` / `the
 * guard run reports no violations` (feature-769.steps.ts) and `the ADW
 * TypeScript type-check passes` (feature-504.steps.ts) — no redefinitions.
 */

import { Given, When, Then, Before, After, AfterAll } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resetGuardFixtureTree } from './feature-816.steps.ts';

const execFileAsync = promisify(execFile);

import { GitLabCodeHost } from '../../../adws/providers/gitlab/gitlabCodeHost.ts';
import type { GitLabApiClient } from '../../../adws/providers/gitlab/gitlabApiClient.ts';
import { createGitLabBoardManager } from '../../../adws/providers/gitlab/gitlabBoardManager.ts';
import { JiraIssueTracker } from '../../../adws/providers/jira/jiraIssueTracker.ts';
import type { JiraApiClient } from '../../../adws/providers/jira/jiraApiClient.ts';
import { createJiraBoardManager } from '../../../adws/providers/jira/jiraBoardManager.ts';
import { Platform, type BoardManager } from '../../../adws/providers/types.ts';

const REPO_ROOT = process.cwd();
const FORGE_ENV_VAR_NAMES = ['GITLAB_TOKEN', 'GITLAB_INSTANCE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PAT'];
const ADW_LOG_DECORATION_RE = /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/;

// ---------------------------------------------------------------------------
// Driver scripts — generated once, written to os.tmpdir() (never under adws/,
// or the whole-repo guard scenario in §7 would trip over them), imported by
// ABSOLUTE path so they run identically regardless of cwd.
// ---------------------------------------------------------------------------

function buildGitLabDriverSource(repoRoot: string): string {
  const codeHostPath = JSON.stringify(path.join(repoRoot, 'adws/providers/gitlab/gitlabCodeHost'));
  const repoContextPath = JSON.stringify(path.join(repoRoot, 'adws/providers/repoContext'));
  const typesPath = JSON.stringify(path.join(repoRoot, 'adws/providers/types'));
  return `
import * as fs from 'fs';
import { createGitLabCodeHost } from ${codeHostPath};
import { resolveCodeHost } from ${repoContextPath};
import { Platform } from ${typesPath};

const specPath = process.argv[2];
const outPath = process.argv[3];
const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

const loggerMessages = [];
const capturingLogger = (message, level) => { loggerMessages.push({ message, level }); };

function performOperation(codeHost, operation, createPrOptions) {
  switch (operation) {
    case 'default branch': return codeHost.getDefaultBranch();
    case 'fetch pull request 7': return codeHost.fetchPullRequest(7);
    case 'fetch review comments': return codeHost.fetchReviewComments(7);
    case 'list open requests': return codeHost.listOpenPullRequests();
    case 'create pull request': return codeHost.createPullRequest(createPrOptions);
    default: throw new Error('Unknown operation: ' + operation);
  }
}

const output = { success: false };

try {
  const repoId = { owner: spec.owner, repo: spec.repo, platform: Platform.GitLab };
  let codeHost;
  if (spec.mode === 'wiring') {
    codeHost = resolveCodeHost(Platform.GitLab, repoId);
  } else {
    const config = { token: spec.hasToken ? spec.token : '', instanceUrl: spec.instanceUrl };
    const deps = spec.useCapturingLogger ? { logger: capturingLogger } : {};
    codeHost = createGitLabCodeHost(repoId, config, deps);
  }
  output.result = performOperation(codeHost, spec.operation, spec.createPrOptions);
  output.success = true;
} catch (error) {
  output.success = false;
  output.errorMessage = error && error.message ? error.message : String(error);
}

output.loggerMessages = loggerMessages;
fs.writeFileSync(outPath, JSON.stringify(output));
`;
}

function buildJiraDriverSource(repoRoot: string): string {
  const trackerPath = JSON.stringify(path.join(repoRoot, 'adws/providers/jira/jiraIssueTracker'));
  const repoContextPath = JSON.stringify(path.join(repoRoot, 'adws/providers/repoContext'));
  return `
import * as fs from 'fs';
import { createJiraIssueTracker } from ${trackerPath};
import { jiraAuthFromEnv } from ${repoContextPath};

const specPath = process.argv[2];
const outPath = process.argv[3];
const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

const loggerMessages = [];
const capturingLogger = (message, level) => { loggerMessages.push({ message, level }); };

const output = { success: false };

(async () => {
  try {
    let auth = spec.auth;
    if (spec.mode === 'wiring') {
      auth = jiraAuthFromEnv();
    }
    const config = { instanceUrl: spec.instanceUrl, projectKey: spec.projectKey, auth };
    const deps = spec.useCapturingLogger ? { logger: capturingLogger } : {};
    const tracker = createJiraIssueTracker(config, deps);
    tracker.commentOnIssue(spec.issueNumber, spec.commentBody);
    // commentOnIssue is fire-and-forget (logs from a .then/.catch); give the
    // real network round-trip to our own loopback recorder time to settle
    // before this process exits and its output is read back.
    await new Promise((resolve) => setTimeout(resolve, 500));
    output.success = true;
  } catch (error) {
    output.success = false;
    output.errorMessage = error && error.message ? error.message : String(error);
  }
  output.loggerMessages = loggerMessages;
  fs.writeFileSync(outPath, JSON.stringify(output));
})();
`;
}

const DRIVER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-818-driver-'));
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-818-work-'));
const GITLAB_DRIVER_PATH = path.join(DRIVER_DIR, 'gitlabDriver.ts');
const JIRA_DRIVER_PATH = path.join(DRIVER_DIR, 'jiraDriver.ts');
fs.writeFileSync(GITLAB_DRIVER_PATH, buildGitLabDriverSource(REPO_ROOT));
fs.writeFileSync(JIRA_DRIVER_PATH, buildJiraDriverSource(REPO_ROOT));

AfterAll(function () {
  fs.rmSync(DRIVER_DIR, { recursive: true, force: true });
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Recording forge endpoint — a real loopback HTTP server, not a spy.
// ---------------------------------------------------------------------------

type RecordedRequest = { method: string; url: string; headers: Record<string, string>; body: string };
type ResponseMode = 'default' | 'unauthorized' | 'rateLimited';

let server: http.Server | null = null;
let serverPort = 0;
let recordedRequests: RecordedRequest[] = [];
let responseMode: ResponseMode = 'default';
let focusedRequestIndex: number | null = null;

function recorderBaseUrl(): string {
  assert.ok(server, 'Expected "a recording forge endpoint is listening" to have run first');
  return `http://127.0.0.1:${serverPort}`;
}

function computeResponse(method: string, url: string): { status: number; body: string; headers: Record<string, string> } {
  if (responseMode === 'unauthorized') {
    return { status: 401, body: JSON.stringify({ message: '401 Unauthorized' }), headers: {} };
  }
  if (responseMode === 'rateLimited') {
    return { status: 429, body: 'rate limited', headers: { 'Retry-After': '7' } };
  }
  const p = url.split('?')[0];
  if (method === 'GET' && (p.endsWith('/discussions') || p.endsWith('/merge_requests'))) {
    return { status: 200, body: '[]', headers: {} };
  }
  return { status: 200, body: '{}', headers: {} };
}

function startRecorder(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        recordedRequests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: { ...req.headers } as Record<string, string>,
          body,
        });
        const resp = computeResponse(req.method ?? '', req.url ?? '');
        res.writeHead(resp.status, { 'Content-Type': 'application/json', ...resp.headers });
        res.end(resp.body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      serverPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
    server.once('error', reject);
  });
}

function stopRecorder(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    server = null;
    s.closeAllConnections?.();
    s.close(() => resolve());
  });
}

// ---------------------------------------------------------------------------
// Scenario state
// ---------------------------------------------------------------------------

type GitLabConfigState = { owner: string; repo: string; hasToken: boolean; token: string; instanceUrl: string };
type JiraAuthState = { email: string; apiToken: string } | { pat: string };
type JiraConfigState = { projectKey: string; auth: JiraAuthState; instanceUrl: string };
type DriverOutput = { success: boolean; errorMessage?: string; loggerMessages?: { message: string; level?: string }[]; childStdout?: string };

let poisonEnv: Record<string, string> = {};
let gitlabConfig: GitLabConfigState | null = null;
let jiraConfig: JiraConfigState | null = null;
let useCapturingLoggerGitLab = false;
let useCapturingLoggerJira = false;
let lastResult: DriverOutput | null = null;
let lastGitLabCodeHost: GitLabCodeHost | null = null;
let lastJiraTracker: JiraIssueTracker | null = null;
let lastBoardManager: BoardManager | null = null;

Before({ tags: '@adw-818' }, async function () {
  await stopRecorder();
  recordedRequests = [];
  responseMode = 'default';
  focusedRequestIndex = null;
  poisonEnv = {};
  gitlabConfig = null;
  jiraConfig = null;
  useCapturingLoggerGitLab = false;
  useCapturingLoggerJira = false;
  lastResult = null;
  lastGitLabCodeHost = null;
  lastJiraTracker = null;
  lastBoardManager = null;
  resetGuardFixtureTree();
});

After({ tags: '@adw-818' }, async function () {
  await stopRecorder();
  resetGuardFixtureTree();
});

// ---------------------------------------------------------------------------
// Driving the adapters in a child process
// ---------------------------------------------------------------------------

function forcedForgeEnv(): Record<string, string> {
  return {
    GITLAB_TOKEN: '',
    GITLAB_INSTANCE_URL: '',
    JIRA_EMAIL: '',
    JIRA_API_TOKEN: '',
    JIRA_PAT: '',
    JIRA_PROJECT_KEY: '',
    ...poisonEnv,
  };
}

/**
 * Runs the driver in a CHILD PROCESS asynchronously (never *Sync*). The
 * recording endpoint's HTTP server lives in THIS process, so a synchronous
 * spawn would freeze this process's event loop while the child's curl/fetch
 * call waits for a response from it — a self-deadlock. `execFile` (promisified)
 * keeps the event loop running so the recorder can service the child's
 * request while this call awaits the child's exit.
 */
async function driveChild(driverPath: string, spec: Record<string, unknown>): Promise<DriverOutput> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const specPath = path.join(WORK_DIR, `spec-${unique}.json`);
  const outPath = path.join(WORK_DIR, `out-${unique}.json`);
  fs.writeFileSync(specPath, JSON.stringify(spec));

  let childStdout = '';
  let execError: (Error & { stdout?: string; stderr?: string }) | null = null;
  try {
    const result = await execFileAsync('bunx', ['tsx', driverPath, specPath, outPath], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env, ...forcedForgeEnv(), NODE_OPTIONS: '' },
    });
    childStdout = result.stdout;
  } catch (err) {
    execError = err as Error & { stdout?: string; stderr?: string };
    childStdout = execError.stdout ?? '';
  }

  let output: DriverOutput = { success: false, errorMessage: `driver process did not produce output.\nstderr: ${execError?.stderr ?? ''}` };
  if (fs.existsSync(outPath)) {
    output = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as DriverOutput;
  }
  output.childStdout = childStdout;
  return output;
}

async function runGitLabDriver(overrides: { mode: 'direct' | 'wiring'; owner?: string; repo?: string; operation: string; createPrOptions?: unknown }): Promise<void> {
  const spec = {
    mode: overrides.mode,
    owner: overrides.owner ?? gitlabConfig?.owner ?? 'acme',
    repo: overrides.repo ?? gitlabConfig?.repo ?? 'widget',
    hasToken: gitlabConfig?.hasToken ?? true,
    token: gitlabConfig?.token ?? '',
    instanceUrl: gitlabConfig?.instanceUrl ?? recorderBaseUrl(),
    useCapturingLogger: useCapturingLoggerGitLab,
    operation: overrides.operation,
    createPrOptions: overrides.createPrOptions,
  };
  lastResult = await driveChild(GITLAB_DRIVER_PATH, spec);
}

async function runJiraDriver(overrides: { mode: 'direct' | 'wiring'; issueNumber: number; commentBody: string; projectKey?: string; instanceUrl?: string }): Promise<void> {
  const spec = {
    mode: overrides.mode,
    instanceUrl: overrides.instanceUrl ?? jiraConfig?.instanceUrl ?? recorderBaseUrl(),
    projectKey: overrides.projectKey ?? jiraConfig?.projectKey ?? 'ADW',
    auth: jiraConfig?.auth ?? { pat: 'unused' },
    useCapturingLogger: useCapturingLoggerJira,
    issueNumber: overrides.issueNumber,
    commentBody: overrides.commentBody,
  };
  lastResult = await driveChild(JIRA_DRIVER_PATH, spec);
}

// ---------------------------------------------------------------------------
// Given — the recording endpoint
// ---------------------------------------------------------------------------

Given('a recording forge endpoint is listening', async function () {
  await startRecorder();
});

Given('the recording endpoint replies to every request with an unauthorized error body', function () {
  responseMode = 'unauthorized';
});

Given('the recording endpoint replies to every request with a rate-limit status', function () {
  responseMode = 'rateLimited';
});

// ---------------------------------------------------------------------------
// Given — GitLab / Jira configuration
// ---------------------------------------------------------------------------

Given('GitLab code-host configuration for {string} with token {string} pointing at the recording endpoint', function (ownerRepo: string, token: string) {
  const [owner, repo] = ownerRepo.split('/');
  gitlabConfig = { owner, repo, hasToken: true, token, instanceUrl: recorderBaseUrl() };
});

Given('GitLab code-host configuration for {string} with token {string} pointing at the recording endpoint with a trailing slash', function (ownerRepo: string, token: string) {
  const [owner, repo] = ownerRepo.split('/');
  gitlabConfig = { owner, repo, hasToken: true, token, instanceUrl: `${recorderBaseUrl()}/` };
});

Given('GitLab code-host configuration for {string} with no token pointing at the recording endpoint', function (ownerRepo: string) {
  const [owner, repo] = ownerRepo.split('/');
  gitlabConfig = { owner, repo, hasToken: false, token: '', instanceUrl: recorderBaseUrl() };
});

Given('Jira issue-tracker configuration with project key {string} and cloud auth {string} \\/ {string} pointing at the recording endpoint', function (projectKey: string, email: string, apiToken: string) {
  jiraConfig = { projectKey, auth: { email, apiToken }, instanceUrl: recorderBaseUrl() };
});

Given('Jira issue-tracker configuration with project key {string} and personal-access-token auth {string} pointing at the recording endpoint', function (projectKey: string, pat: string) {
  jiraConfig = { projectKey, auth: { pat }, instanceUrl: recorderBaseUrl() };
});

Given('Jira issue-tracker configuration with project key {string} and personal-access-token auth {string} pointing at the recording endpoint with a trailing slash', function (projectKey: string, pat: string) {
  jiraConfig = { projectKey, auth: { pat }, instanceUrl: `${recorderBaseUrl()}/` };
});

Given('Jira issue-tracker configuration with project key {string} and no auth pointing at the recording endpoint', function (projectKey: string) {
  jiraConfig = { projectKey, auth: { email: '', apiToken: '' }, instanceUrl: recorderBaseUrl() };
});

// ---------------------------------------------------------------------------
// Given — poisoned / real environment for the child process
// ---------------------------------------------------------------------------

Given('the adapter runs with {string} set to {string} in its environment', function (varName: string, value: string) {
  poisonEnv[varName] = value;
});

Given('the adapter runs with {string} pointing at the recording endpoint', function (varName: string) {
  poisonEnv[varName] = recorderBaseUrl();
});

// ---------------------------------------------------------------------------
// Given — logger injection
// ---------------------------------------------------------------------------

Given('a capturing logger is injected into the GitLab code host', function () {
  useCapturingLoggerGitLab = true;
});

Given('a capturing logger is injected into the Jira issue tracker', function () {
  useCapturingLoggerJira = true;
});

Given('no logger is injected into the Jira issue tracker', function () {
  useCapturingLoggerJira = false;
});

Given('no logger is injected into the GitLab code host', function () {
  useCapturingLoggerGitLab = false;
});

// ---------------------------------------------------------------------------
// When — drive the adapters
// ---------------------------------------------------------------------------

When('the GitLab code host opens a merge request from {string} to {string} titled {string}', async function (sourceBranch: string, targetBranch: string, title: string) {
  await runGitLabDriver({ mode: 'direct', operation: 'create pull request', createPrOptions: { sourceBranch, targetBranch, title, body: '' } });
});

When('the GitLab code host performs the {string} operation', async function (operation: string) {
  await runGitLabDriver({ mode: 'direct', operation });
});

When("ADW's provider wiring resolves a GitLab code host for {string} and performs the {string} operation", async function (ownerRepo: string, operation: string) {
  const [owner, repo] = ownerRepo.split('/');
  await runGitLabDriver({ mode: 'wiring', owner, repo, operation });
});

When('the Jira issue tracker comments {string} on issue {int}', async function (commentBody: string, issueNumber: number) {
  await runJiraDriver({ mode: 'direct', issueNumber, commentBody });
});

When("ADW's provider wiring resolves Jira credentials and the issue tracker comments on issue 42 at the recording endpoint with project key {string}", async function (projectKey: string) {
  await runJiraDriver({ mode: 'wiring', issueNumber: 42, commentBody: 'Build green', projectKey, instanceUrl: recorderBaseUrl() });
});

// ---------------------------------------------------------------------------
// Then — request-shape assertions
// ---------------------------------------------------------------------------

Then('the recording endpoint received a {string} request to {string}', function (method: string, urlPath: string) {
  const idx = recordedRequests.findIndex((r) => r.method === method && r.url === urlPath);
  assert.ok(
    idx !== -1,
    `Expected a ${method} request to ${urlPath}. Recorded: ${JSON.stringify(recordedRequests.map((r) => ({ method: r.method, url: r.url })))}`,
  );
  focusedRequestIndex = idx;
});

function focusedRequest(): RecordedRequest {
  const idx = focusedRequestIndex ?? recordedRequests.length - 1;
  assert.ok(idx >= 0 && recordedRequests[idx], 'Expected at least one recorded request');
  return recordedRequests[idx];
}

Then('the recorded request carried the header {string} with value {string}', function (headerName: string, value: string) {
  const req = focusedRequest();
  assert.strictEqual(req.headers[headerName.toLowerCase()], value);
});

Then('the recorded request body carried {string} set to {string}', function (key: string, value: string) {
  const req = focusedRequest();
  const body = JSON.parse(req.body || '{}');
  assert.strictEqual(body[key], value);
});

Then('the recorded request carried basic authentication for {string} and {string}', function (email: string, token: string) {
  const req = focusedRequest();
  const expected = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  assert.strictEqual(req.headers['authorization'], expected);
});

Then('the recorded request body carried a document under {string}', function (key: string) {
  const req = focusedRequest();
  const body = JSON.parse(req.body || '{}');
  assert.ok(body[key] && typeof body[key] === 'object', `Expected body.${key} to be a document/object. Got: ${JSON.stringify(body)}`);
});

Then('the recorded request carried the header {string} beginning with {string}', function (headerName: string, prefix: string) {
  const req = focusedRequest();
  const value = req.headers[headerName.toLowerCase()] || '';
  assert.ok(value.startsWith(prefix), `Expected header ${headerName} to begin with "${prefix}". Got: "${value}"`);
});

Then('the recording endpoint received no request', function () {
  assert.strictEqual(recordedRequests.length, 0, `Expected no requests. Recorded: ${JSON.stringify(recordedRequests)}`);
});

Then('no recorded request carried the value {string}', function (value: string) {
  for (const req of recordedRequests) {
    const combined = JSON.stringify(req);
    assert.ok(!combined.includes(value), `Expected no recorded request to carry "${value}". Found in: ${combined}`);
  }
});

// ---------------------------------------------------------------------------
// Then — refusal assertions
// ---------------------------------------------------------------------------

Then('the adapter refuses with an error', function () {
  assert.ok(lastResult, 'Expected a prior When to have driven the adapter');
  assert.strictEqual(lastResult!.success, false, `Expected the adapter to refuse. Got: ${JSON.stringify(lastResult)}`);
  assert.ok(lastResult!.errorMessage, 'Expected an error message');
});

Then("the adapter's refusal names no environment variable", function () {
  const msg = lastResult?.errorMessage ?? '';
  for (const name of FORGE_ENV_VAR_NAMES) {
    assert.ok(!msg.includes(name), `Expected refusal not to name ${name}. Message: ${msg}`);
  }
});

Then('the adapter refuses with an error naming {string}', function (name: string) {
  assert.ok(lastResult, 'Expected a prior When to have driven the adapter');
  assert.strictEqual(lastResult!.success, false, `Expected the adapter to refuse. Got: ${JSON.stringify(lastResult)}`);
  assert.ok(
    lastResult!.errorMessage && lastResult!.errorMessage.includes(name),
    `Expected refusal naming "${name}". Got: ${lastResult!.errorMessage}`,
  );
});

// ---------------------------------------------------------------------------
// Then — logger / stdout assertions
// ---------------------------------------------------------------------------

Then('the injected logger recorded a message containing {string} at level {string}', function (text: string, level: string) {
  const messages = lastResult?.loggerMessages ?? [];
  const found = messages.some((m) => m.message.includes(text) && m.level === level);
  assert.ok(found, `Expected a logger message containing "${text}" at level "${level}". Got: ${JSON.stringify(messages)}`);
});

Then('the adapter wrote a line containing {string} to stdout', function (text: string) {
  const lines = (lastResult?.childStdout ?? '').split('\n');
  assert.ok(lines.some((l) => l.includes(text)), `Expected a stdout line containing "${text}". Got:\n${lastResult?.childStdout}`);
});

Then("no line the adapter wrote to stdout carries ADW's timestamped log decoration", function () {
  const lines = (lastResult?.childStdout ?? '').split('\n');
  for (const line of lines) {
    assert.ok(!ADW_LOG_DECORATION_RE.test(line), `Expected no ADW log decoration in stdout line: "${line}"`);
  }
});

// ---------------------------------------------------------------------------
// §7 — existing suites and the ratchet (in-process; no child process needed)
// ---------------------------------------------------------------------------

function expectThrows(fn: () => void, expectedSubstring: string): void {
  try {
    fn();
  } catch (err) {
    assert.ok(String((err as Error).message).includes(expectedSubstring), `Expected error message to include "${expectedSubstring}". Got: ${(err as Error).message}`);
    return;
  }
  assert.fail(`Expected function to throw containing "${expectedSubstring}"`);
}

async function expectRejects(promiseFactory: () => Promise<unknown>, expectedSubstring: string): Promise<void> {
  try {
    await promiseFactory();
  } catch (err) {
    assert.ok(String((err as Error).message).includes(expectedSubstring), `Expected rejection message to include "${expectedSubstring}". Got: ${(err as Error).message}`);
    return;
  }
  assert.fail(`Expected promise to reject containing "${expectedSubstring}"`);
}

const REPO_ID_ACME_WIDGET_GITLAB = { owner: 'acme', repo: 'widget', platform: Platform.GitLab };

When('a GitLab code host is constructed with only a repository identifier and an API client', function () {
  lastGitLabCodeHost = new GitLabCodeHost(REPO_ID_ACME_WIDGET_GITLAB, {} as GitLabApiClient);
});

Then('asking it to approve a pull request refuses naming {string}', function (name: string) {
  assert.ok(lastGitLabCodeHost, 'Expected a prior When to have constructed the GitLab code host');
  expectThrows(() => lastGitLabCodeHost!.approvePullRequest(), name);
});

Then('asking it to list merged pull requests refuses naming {string}', function (name: string) {
  assert.ok(lastGitLabCodeHost, 'Expected a prior When to have constructed the GitLab code host');
  expectThrows(() => lastGitLabCodeHost!.listMergedPullRequests(), name);
});

When('a Jira issue tracker is constructed with only an API client and the project key {string}', function (projectKey: string) {
  lastJiraTracker = new JiraIssueTracker({} as JiraApiClient, projectKey);
});

Then('asking it to fetch labels refuses naming {string}', function (name: string) {
  assert.ok(lastJiraTracker, 'Expected a prior When to have constructed the Jira issue tracker');
  expectThrows(() => lastJiraTracker!.fetchLabels(), name);
});

Then('asking it to list issues refuses naming {string}', function (name: string) {
  assert.ok(lastJiraTracker, 'Expected a prior When to have constructed the Jira issue tracker');
  expectThrows(() => lastJiraTracker!.listIssues(), name);
});

When('the {string} board manager is constructed with no arguments', function (platform: string) {
  if (platform === 'GitLab') {
    lastBoardManager = createGitLabBoardManager();
  } else if (platform === 'Jira') {
    lastBoardManager = createJiraBoardManager();
  } else {
    throw new Error(`Unknown platform: ${platform}`);
  }
});

Then('asking it to find a board refuses naming {string}', async function (platform: string) {
  assert.ok(lastBoardManager, 'Expected a prior When to have constructed a board manager');
  await expectRejects(() => lastBoardManager!.findBoard(), platform);
});
