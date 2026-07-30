/**
 * BDD step definitions for feature-780.feature
 * appAuth error paths leak the GitHub App JWT into logs.
 *
 * Does NOT redefine "the ADW codebase is checked out" (ensureCronOnEveryEventSteps.ts,
 * registry G18) or "the ADW TypeScript type-check passes" (feature-504.steps.ts,
 * registry T22) — both already registered globally.
 *
 * Design (see feature-780.feature's own notes for the full rationale):
 *  - The `When` step drives the REAL getInstallationToken (adws/gitContext/appAuth.ts),
 *    including the real JWT mint, pointed at an out-of-process HTTP stub via the
 *    injectable `apiBaseUrl` seam. The stub MUST run out-of-process: getInstallationToken
 *    is synchronous (execFileSync blocks the event loop), so an in-process stub could
 *    never accept the connection — verified empirically while authoring the feature file.
 *  - Argv observability (§3) is captured by injecting a pass-through `runCurl` that
 *    records `['curl', ...args]` and then delegates to the real execFileSync, mirroring
 *    production's own stdio:['pipe','pipe','pipe'] so the credential still reaches the
 *    stub over real HTTP while the argv stays observable.
 *  - Log-stream observability (§1b) is captured by intercepting process.stdout/stderr
 *    .write for the duration of the mint call.
 *  - Before/After are tag-scoped to @adw-780 — env vars and the stub process are
 *    process-wide state, so an unscoped hook would leak into other scenarios.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import {
  getInstallationToken,
  clearAppAuthCaches,
} from '../../../adws/gitContext/appAuth.ts';
import type { AppAuthDeps, RunCurl } from '../../../adws/gitContext/appAuth.ts';

// ---------------------------------------------------------------------------
// Out-of-process recording stub — plain Node/Bun HTTP server, no dependencies.
// Reads its route table fresh from config.json on every request (so later
// Given steps can add routes after the process has already started) and
// appends every received request to requests.json for post-hoc assertions.
// ---------------------------------------------------------------------------

const STUB_SERVER_SOURCE = `
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const REQUESTS_PATH = path.join(__dirname, 'requests.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { routes: {} };
  }
}

function appendRequest(record) {
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(REQUESTS_PATH, 'utf-8'));
  } catch {
    existing = [];
  }
  existing.push(record);
  fs.writeFileSync(REQUESTS_PATH, JSON.stringify(existing));
}

const server = http.createServer((req, res) => {
  const key = \`\${req.method} \${req.url}\`;
  appendRequest({ method: req.method, url: req.url, authorization: req.headers['authorization'] ?? null });
  const config = readConfig();
  const route = config.routes[key];
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'no stub route configured for ' + key }));
    return;
  }
  res.writeHead(route.status, { 'content-type': 'application/json' });
  res.end(route.body);
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write('PORT ' + server.address().port + '\\n');
});
`;

// ---------------------------------------------------------------------------
// Scenario-scoped state
// ---------------------------------------------------------------------------

interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | null;
}

const state: {
  scratchDir: string | null;
  stubProcess: ChildProcess | null;
  apiBaseUrl: string | null;
  thrownError: Error | null;
  mintedToken: string | null;
  recordedCredential: string | null;
  loggedChunks: string[];
  recordCommandLines: boolean;
  commandLines: string[];
  priorEnv: { appId?: string; appSlug?: string; keyPath?: string };
} = {
  scratchDir: null,
  stubProcess: null,
  apiBaseUrl: null,
  thrownError: null,
  mintedToken: null,
  recordedCredential: null,
  loggedChunks: [],
  recordCommandLines: false,
  commandLines: [],
  priorEnv: {},
};

const JWT_SHAPE_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;

Before({ tags: '@adw-780' }, function () {
  clearAppAuthCaches();
  state.scratchDir = null;
  state.stubProcess = null;
  state.apiBaseUrl = null;
  state.thrownError = null;
  state.mintedToken = null;
  state.recordedCredential = null;
  state.loggedChunks = [];
  state.recordCommandLines = false;
  state.commandLines = [];
  state.priorEnv = {
    appId: process.env.GITHUB_APP_ID,
    appSlug: process.env.GITHUB_APP_SLUG,
    keyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
  };
});

After({ tags: '@adw-780' }, function () {
  if (state.stubProcess) {
    state.stubProcess.kill();
  }
  if (state.scratchDir) {
    fs.rmSync(state.scratchDir, { recursive: true, force: true });
  }
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  };
  restore('GITHUB_APP_ID', state.priorEnv.appId);
  restore('GITHUB_APP_SLUG', state.priorEnv.appSlug);
  restore('GITHUB_APP_PRIVATE_KEY_PATH', state.priorEnv.keyPath);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureScratchDir(): string {
  if (!state.scratchDir) {
    state.scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-780-'));
  }
  return state.scratchDir;
}

function requireScratchDir(): string {
  assert.ok(state.scratchDir, 'No scratch directory — did a Given step set up the App or the stub first?');
  return state.scratchDir;
}

function readRequests(): RecordedRequest[] {
  const p = path.join(requireScratchDir(), 'requests.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as RecordedRequest[];
}

function updateStubConfig(mutator: (config: { routes: Record<string, { status: number; body: string }> }) => void): void {
  const p = path.join(requireScratchDir(), 'config.json');
  const config = JSON.parse(fs.readFileSync(p, 'utf-8')) as { routes: Record<string, { status: number; body: string }> };
  mutator(config);
  fs.writeFileSync(p, JSON.stringify(config), 'utf-8');
}

function defaultMessageForStatus(status: number): string {
  if (status === 401) return 'Bad credentials';
  if (status === 404) return 'Not Found';
  if (status === 500) return 'Internal Server Error';
  return 'Error';
}

function findBearerCredential(requests: RecordedRequest[], match: (r: RecordedRequest) => boolean): string | null {
  const hit = requests.find(match);
  const auth = hit?.authorization;
  if (!auth) return null;
  const m = auth.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}

function requireThrownMessage(): string {
  assert.ok(state.thrownError, 'Expected a prior When step to have raised a failure');
  return state.thrownError.message;
}

function requireRecordedCredential(): string {
  assert.ok(state.recordedCredential, 'Expected a prior Then step to have recorded the bearer credential from the stub');
  return state.recordedCredential;
}

type WriteFn = typeof process.stdout.write;

/** Captures everything written to stdout/stderr for the duration of the wrapped call, then restores the originals. */
function interceptProcessOutput(sink: string[]): () => void {
  const origStdout: WriteFn = process.stdout.write.bind(process.stdout);
  const origStderr: WriteFn = process.stderr.write.bind(process.stderr);

  const capture = (orig: WriteFn): WriteFn =>
    ((chunk: unknown, ...rest: unknown[]) => {
      sink.push(Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk));
      return (orig as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as WriteFn;

  process.stdout.write = capture(origStdout);
  process.stderr.write = capture(origStderr);

  return () => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  };
}

/**
 * Records the full `curl <args>` command line and then delegates to the real
 * execFileSync, mirroring production's own execCurl exactly (including
 * stdio: ['pipe','pipe','pipe'], so nothing leaks to the parent's stderr and
 * the §1b guarantee holds even when this recorder is in use). The stub is
 * still reached over real HTTP; only the argv becomes observable.
 */
function makeRecordingPassThroughRunCurl(sink: string[]): RunCurl {
  return (args, stdinConfig) => {
    sink.push(['curl', ...args].join(' '));
    return execFileSync('curl', [...args], {
      input: stdinConfig,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  };
}

// ---------------------------------------------------------------------------
// Given — App configuration + stub server
// ---------------------------------------------------------------------------

Given('the GitHub App is configured with a throwaway signing key', function () {
  const dir = ensureScratchDir();
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const keyPath = path.join(dir, 'throwaway-key.pem');
  fs.writeFileSync(keyPath, privateKey, 'utf-8');

  process.env.GITHUB_APP_ID = 'adw-780-app-id';
  process.env.GITHUB_APP_SLUG = 'adw-780-bot';
  process.env.GITHUB_APP_PRIVATE_KEY_PATH = keyPath;
});

Given('the GitHub App API is served by an out-of-process recording stub', async function () {
  const dir = ensureScratchDir();
  const scriptPath = path.join(dir, 'stubServer.mjs');
  fs.writeFileSync(scriptPath, STUB_SERVER_SOURCE, 'utf-8');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ routes: {} }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'requests.json'), JSON.stringify([]), 'utf-8');

  const child = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  state.stubProcess = child;

  const port = await new Promise<number>((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const match = buffer.match(/PORT (\d+)/);
      if (match) {
        child.stdout?.off('data', onData);
        resolve(Number(match[1]));
      }
    };
    child.stdout?.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!buffer.includes('PORT')) reject(new Error(`out-of-process stub exited early with code ${String(code)}`));
    });
  });

  state.apiBaseUrl = `http://127.0.0.1:${port}`;
});

Given('the stub answers the installation lookup for owner {string} repo {string} with HTTP {int}', function (owner: string, repo: string, status: number) {
  updateStubConfig((config) => {
    config.routes[`GET /repos/${owner}/${repo}/installation`] = {
      status,
      body: JSON.stringify({ message: defaultMessageForStatus(status) }),
    };
  });
});

Given('the stub answers the installation lookup for owner {string} repo {string} with installation id {string}', function (owner: string, repo: string, installationId: string) {
  updateStubConfig((config) => {
    config.routes[`GET /repos/${owner}/${repo}/installation`] = {
      status: 200,
      body: JSON.stringify({ id: Number(installationId) }),
    };
  });
});

Given('the stub answers the token exchange for installation id {string} with HTTP {int}', function (installationId: string, status: number) {
  updateStubConfig((config) => {
    config.routes[`POST /app/installations/${installationId}/access_tokens`] = {
      status,
      body: JSON.stringify({ message: defaultMessageForStatus(status) }),
    };
  });
});

Given('the stub answers the token exchange for installation id {string} with HTTP {int} and a body carrying the credential {string}', function (installationId: string, status: number, credential: string) {
  updateStubConfig((config) => {
    config.routes[`POST /app/installations/${installationId}/access_tokens`] = {
      status,
      body: JSON.stringify({ unexpected_key: credential }),
    };
  });
});

Given('the stub answers the token exchange for installation id {string} with the token {string}', function (installationId: string, token: string) {
  updateStubConfig((config) => {
    config.routes[`POST /app/installations/${installationId}/access_tokens`] = {
      status: 201,
      body: JSON.stringify({ token, expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    };
  });
});

Given('the command lines of subprocesses spawned during the attempt are recorded', function () {
  state.recordCommandLines = true;
  state.commandLines = [];
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('an installation token is requested for owner {string} repo {string}', async function (owner: string, repo: string) {
  assert.ok(state.apiBaseUrl, 'Expected a prior Given step to have started the stub');
  const deps: AppAuthDeps = { apiBaseUrl: state.apiBaseUrl };
  if (state.recordCommandLines) {
    deps.runCurl = makeRecordingPassThroughRunCurl(state.commandLines);
  }

  const restoreOutput = interceptProcessOutput(state.loggedChunks);
  try {
    const result = getInstallationToken(owner, repo, deps) as string | Promise<string>;
    state.mintedToken = await result;
    state.thrownError = null;
  } catch (err) {
    state.thrownError = err as Error;
    state.mintedToken = null;
  } finally {
    restoreOutput();
  }
});

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('the installation token request fails', function () {
  assert.ok(state.thrownError, 'Expected the installation token request to throw, but it did not');
});

Then('the stub recorded a bearer credential on the installation lookup', function () {
  const cred = findBearerCredential(readRequests(), (r) => r.method === 'GET' && r.url.endsWith('/installation'));
  assert.ok(cred, 'Expected the stub to have recorded a Bearer credential on the installation lookup');
  state.recordedCredential = cred;
});

Then('the stub recorded a bearer credential on the token exchange', function () {
  const cred = findBearerCredential(readRequests(), (r) => r.method === 'POST' && r.url.endsWith('/access_tokens'));
  assert.ok(cred, 'Expected the stub to have recorded a Bearer credential on the token exchange');
  state.recordedCredential = cred;
});

Then('the raised failure identifies the failing operation as the token exchange', function () {
  const message = requireThrownMessage();
  assert.ok(message.includes('token exchange'), `Expected "token exchange" in:\n${message}`);
});

Then('the raised failure does not contain the credential {string}', function (credential: string) {
  const message = requireThrownMessage();
  assert.ok(!message.includes(credential), `Expected the raised failure NOT to contain "${credential}":\n${message}`);
});

Then('the raised failure does not contain the bearer credential the stub recorded', function () {
  const cred = requireRecordedCredential();
  const message = requireThrownMessage();
  assert.ok(!message.includes(cred), `Expected the raised failure NOT to contain the recorded credential:\n${message}`);
});

Then('the raised failure does not contain a JWT-shaped token', function () {
  const message = requireThrownMessage();
  assert.doesNotMatch(message, JWT_SHAPE_PATTERN, `Expected no JWT-shaped token in:\n${message}`);
});

Then('the raised failure identifies the failing operation as the installation lookup', function () {
  const message = requireThrownMessage();
  assert.ok(message.includes('installation lookup'), `Expected "installation lookup" in:\n${message}`);
});

Then('the raised failure names the repository identity {string}', function (identity: string) {
  const message = requireThrownMessage();
  assert.ok(message.includes(identity), `Expected "${identity}" in:\n${message}`);
});

Then('the raised failure names HTTP status {int}', function (status: number) {
  const message = requireThrownMessage();
  assert.ok(message.includes(`HTTP ${status}`), `Expected "HTTP ${status}" in:\n${message}`);
});

Then('no message logged during the attempt contains the bearer credential the stub recorded', function () {
  const cred = requireRecordedCredential();
  const leaked = state.loggedChunks.some((chunk) => chunk.includes(cred));
  assert.ok(!leaked, `Expected no logged output to contain the recorded credential; captured chunks:\n${state.loggedChunks.join('')}`);
});

Then('no recorded subprocess command line contains the bearer credential the stub recorded', function () {
  const cred = requireRecordedCredential();
  assert.ok(state.commandLines.length > 0, 'Expected at least one recorded subprocess command line');
  for (const line of state.commandLines) {
    assert.ok(!line.includes(cred), `Expected no recorded command line to contain the credential:\n${line}`);
    assert.doesNotMatch(line, /Bearer/, `Expected no recorded command line to mention "Bearer":\n${line}`);
  }
});

Then('the installation token request succeeds', function () {
  assert.ok(!state.thrownError, `Expected the installation token request to succeed, but it threw: ${state.thrownError?.message ?? ''}`);
});

Then('the minted token is {string}', function (expected: string) {
  assert.strictEqual(state.mintedToken, expected);
});

Then('the stub recorded a token exchange for installation id {string}', function (installationId: string) {
  const requests = readRequests();
  const hit = requests.find((r) => r.method === 'POST' && r.url === `/app/installations/${installationId}/access_tokens`);
  assert.ok(hit, `Expected a recorded POST to the token exchange for installation ${installationId}`);
});
