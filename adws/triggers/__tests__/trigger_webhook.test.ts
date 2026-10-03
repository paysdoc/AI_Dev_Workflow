/**
 * The comment path decides nothing about `adw:none` itself: it hands every `## Continue`
 * comment to classifyAndSpawnWorkflow, the one function all spawn paths pass through and the
 * one that holds the opt-out. The payload's labels are a snapshot that can be stale, so the
 * webhook must not filter on them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as http from 'http';

const { classifyAndSpawnWorkflowMock } = vi.hoisted(() => ({
  classifyAndSpawnWorkflowMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../webhookGatekeeper', () => ({
  classifyAndSpawnWorkflow: classifyAndSpawnWorkflowMock,
  ensureCronProcess: vi.fn(),
  spawnDetached: vi.fn(),
  logDeferral: vi.fn(),
  closeAbandonedDependents: vi.fn(),
}));
vi.mock('../../forge/workflowCommentsBase', () => ({ isAdwRunningForIssue: vi.fn(() => Promise.resolve(false)) }));
vi.mock('../issueEligibility', () => ({ checkIssueEligibility: vi.fn(() => Promise.resolve({ eligible: true })) }));
vi.mock('../../core/authGate', () => ({ readAuthGate: vi.fn(() => null), writeAuthGate: vi.fn() }));
vi.mock('../../core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core')>()),
  log: vi.fn(),
}));

import { dispatchWebhookEvent } from '../trigger_webhook';
import { Platform } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../core';

const TARGET_ARGS = ['--target-repo', 'acme/target', '--clone-url', 'https://example.invalid/acme/target.git'];

const boundary = {
  repoId: { owner: 'acme', repo: 'target', platform: Platform.GitHub },
  providers: { issueTracker: { fetchComments: vi.fn(() => []) } },
} as unknown as LaunchBoundary;

function dispatchComment(issueNumber: number, labels: { name: string }[]): void {
  const payload = {
    action: 'created',
    repository: { full_name: 'acme/target', clone_url: 'https://example.invalid/acme/target.git' },
    issue: { number: issueNumber, body: '', labels },
    comment: { body: '## Continue' },
  };
  const req = { headers: { 'x-github-event': 'issue_comment' } } as unknown as http.IncomingMessage;
  const res = { writeHead: () => res, end: () => undefined } as unknown as http.ServerResponse;

  dispatchWebhookEvent(req, res, Buffer.from(JSON.stringify(payload)), () => boundary);
}

describe('dispatchWebhookEvent — issue_comment', () => {
  beforeEach(() => {
    classifyAndSpawnWorkflowMock.mockClear();
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hands a ## Continue comment on an adw:none issue to the gate, which holds the opt-out', async () => {
    dispatchComment(77, [{ name: 'adw:none' }]);

    await vi.waitFor(() => expect(classifyAndSpawnWorkflowMock).toHaveBeenCalledWith(77, boundary, TARGET_ARGS));
  });

  it('hands a ## Continue comment on an unlabelled issue to the same gate, by the same call', async () => {
    dispatchComment(78, []);

    await vi.waitFor(() => expect(classifyAndSpawnWorkflowMock).toHaveBeenCalledWith(78, boundary, TARGET_ARGS));
  });
});
