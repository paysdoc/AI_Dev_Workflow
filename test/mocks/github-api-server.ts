/**
 * GitHub API mock server for ADW behavioral testing.
 *
 * A Node.js HTTP server that mimics api.github.com endpoints, loads fixture
 * defaults from JSON files, supports programmatic state setup, and records
 * all incoming requests for assertion in Then steps.
 */

import * as http from 'http';
import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { MockServerState, RecordedRequest } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../fixtures/github');

// ---------------------------------------------------------------------------
// Route table types
// ---------------------------------------------------------------------------

interface RouteParams {
  owner?: string;
  repo?: string;
  issueNumber?: string;
  prNumber?: string;
  commentId?: string;
  [key: string]: string | undefined;
}

interface MockResponse {
  status: number;
  body: string;
}

type RouteHandler = (
  params: RouteParams,
  body: string,
  method: string,
) => MockResponse | Promise<MockResponse>;

interface RouteDefinition {
  method: string;
  pattern: string;
  handler: RouteHandler;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let serverState: MockServerState = loadDefaultState();
let recordedRequests: RecordedRequest[] = [];

function loadDefaultState(): MockServerState {
  const issue = JSON.parse(readFileSync(join(FIXTURES_DIR, 'default-issue.json'), 'utf-8'));
  const pr = JSON.parse(readFileSync(join(FIXTURES_DIR, 'default-pr.json'), 'utf-8'));
  const comments = JSON.parse(readFileSync(join(FIXTURES_DIR, 'default-comments.json'), 'utf-8'));
  return {
    issues: { '1': issue },
    prs: { '1': pr },
    comments: { '1': comments },
    labels: {},
  };
}

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

function matchPattern(pattern: string, pathname: string): RouteParams | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params: RouteParams = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i] ?? '';
    const qp = pathParts[i] ?? '';
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = qp;
    } else if (pp !== qp) {
      return null;
    }
  }
  return params;
}

function matchRoute(method: string, pathname: string): { handler: RouteHandler; params: RouteParams } | null {
  for (const route of ROUTES) {
    if (route.method !== method && route.method !== '*') continue;
    const params = matchPattern(route.pattern, pathname);
    if (params !== null) return { handler: route.handler, params };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): MockResponse {
  return { status, body: JSON.stringify(data) };
}

// ---------------------------------------------------------------------------
// Issue handlers
// ---------------------------------------------------------------------------

const getIssue: RouteHandler = (params) => {
  const num = params['issueNumber'] ?? '1';
  const issue = serverState.issues[num];
  if (!issue) return jsonResponse({ message: 'Not Found' }, 404);
  return jsonResponse(issue);
};

const postIssueComment: RouteHandler = (params, body) => {
  const num = params['issueNumber'] ?? '1';
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { /* ignore */ }
  const comment = {
    id: Date.now(),
    body: parsed['body'] ?? '',
    user: { login: 'mock-server', type: 'Bot' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const existing = serverState.comments[num] ?? [];
  serverState = { ...serverState, comments: { ...serverState.comments, [num]: [...existing, comment] } };
  return jsonResponse(comment, 201);
};

const getIssueComments: RouteHandler = (params) =>
  jsonResponse(serverState.comments[params['issueNumber'] ?? '1'] ?? []);

const patchIssue: RouteHandler = (params, body) => {
  const num = params['issueNumber'] ?? '1';
  let updates: Record<string, unknown> = {};
  try { updates = JSON.parse(body) as Record<string, unknown>; } catch {
    return jsonResponse({ message: 'Invalid JSON' }, 400);
  }
  const updated = { ...(serverState.issues[num] as Record<string, unknown> ?? {}), ...updates };
  serverState = { ...serverState, issues: { ...serverState.issues, [num]: updated } };
  return jsonResponse(updated);
};

const deleteIssueComment: RouteHandler = () => ({ status: 204, body: '' });

// ---------------------------------------------------------------------------
// PR handlers
// ---------------------------------------------------------------------------

const getPr: RouteHandler = (params) => {
  const num = params['prNumber'] ?? '1';
  const pr = serverState.prs[num];
  if (!pr) return jsonResponse({ message: 'Not Found' }, 404);
  return jsonResponse(pr);
};

const postPr: RouteHandler = (_params, body) => {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(body) as Record<string, unknown>; } catch {
    return jsonResponse({ message: 'Invalid JSON' }, 400);
  }
  const pr = { number: Date.now() % 10000, ...data, state: 'OPEN' };
  const num = String(pr['number']);
  serverState = { ...serverState, prs: { ...serverState.prs, [num]: pr } };
  return jsonResponse(pr, 201);
};

const getPrReviews: RouteHandler = () => jsonResponse([]);
const getPrComments: RouteHandler = (params) =>
  jsonResponse(serverState.comments[params['prNumber'] ?? '1'] ?? []);

// ---------------------------------------------------------------------------
// Control endpoint handlers
// ---------------------------------------------------------------------------

const postMockState: RouteHandler = (_params, body) => {
  let updates: Partial<MockServerState>;
  try {
    updates = JSON.parse(body) as Partial<MockServerState>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON in request body' }, 400);
  }
  serverState = { ...serverState, ...updates };
  return jsonResponse({ ok: true });
};

const getMockRequests: RouteHandler = () => jsonResponse(recordedRequests);

const postMockReset: RouteHandler = () => {
  recordedRequests = [];
  serverState = loadDefaultState();
  return jsonResponse({ ok: true });
};

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const ROUTES: RouteDefinition[] = [
  { method: 'GET',    pattern: '/repos/:owner/:repo/issues/:issueNumber', handler: getIssue },
  { method: 'POST',   pattern: '/repos/:owner/:repo/issues/:issueNumber/comments', handler: postIssueComment },
  { method: 'GET',    pattern: '/repos/:owner/:repo/issues/:issueNumber/comments', handler: getIssueComments },
  { method: 'PATCH',  pattern: '/repos/:owner/:repo/issues/:issueNumber', handler: patchIssue },
  { method: 'DELETE', pattern: '/repos/:owner/:repo/issues/comments/:commentId', handler: deleteIssueComment },
  { method: 'POST',   pattern: '/repos/:owner/:repo/pulls', handler: postPr },
  { method: 'GET',    pattern: '/repos/:owner/:repo/pulls/:prNumber', handler: getPr },
  { method: 'GET',    pattern: '/repos/:owner/:repo/pulls/:prNumber/reviews', handler: getPrReviews },
  { method: 'GET',    pattern: '/repos/:owner/:repo/pulls/:prNumber/comments', handler: getPrComments },
  { method: 'POST',   pattern: '/_mock/state', handler: postMockState },
  { method: 'GET',    pattern: '/_mock/requests', handler: getMockRequests },
  { method: 'POST',   pattern: '/_mock/reset', handler: postMockReset },
];

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let activeServer: http.Server | null = null;

/** Reads the full request body as a string. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/** Starts the GitHub API mock server on the given port (0 = random). */
export function startMockServer(port = 0): Promise<{ port: number; url: string }> {
  if (activeServer?.listening) {
    const addr = activeServer.address() as { port: number };
    return Promise.resolve({ port: addr.port, url: `http://localhost:${addr.port}` });
  }

  serverState = loadDefaultState();
  recordedRequests = [];

  activeServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';

    // Only record application requests, not control endpoint calls
    if (!pathname.startsWith('/_mock/')) {
      recordedRequests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers as Record<string, string>,
        body,
        timestamp: new Date().toISOString(),
      });
    }

    const match = matchRoute(req.method ?? 'GET', pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `Not implemented: ${pathname}` }));
      return;
    }

    const result = await Promise.resolve(match.handler(match.params, body, req.method ?? 'GET'));
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(result.body);
  });

  return new Promise((resolve, reject) => {
    activeServer!.listen(port, () => {
      const addr = activeServer!.address() as { port: number };
      resolve({ port: addr.port, url: `http://localhost:${addr.port}` });
    });
    activeServer!.on('error', reject);
  });
}

/** Stops the mock server and resets state. */
export function stopMockServer(): void {
  if (activeServer) {
    activeServer.close();
    activeServer = null;
  }
  recordedRequests = [];
  serverState = loadDefaultState();
}

/** Returns all recorded requests (snapshot). */
export function getRecordedRequests(): RecordedRequest[] {
  return [...recordedRequests];
}

/** Applies partial state updates to the mock server state. */
export function applyState(updates: Partial<MockServerState>): void {
  serverState = { ...serverState, ...updates };
}

/** Resets recorded requests and server state to defaults without stopping the server. */
export function resetMockServer(): void {
  recordedRequests = [];
  serverState = loadDefaultState();
}
