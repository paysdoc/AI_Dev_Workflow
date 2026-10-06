/**
 * The comment path decides nothing about `adw:none` itself: it hands every `## Continue`
 * comment that does not waive a base-branch park to classifyAndSpawnWorkflow, the one function
 * all spawn paths pass through and the one that holds the opt-out. The payload's labels are a
 * snapshot that can be stale, so the webhook must not filter on them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as http from 'http';

const { classifyAndSpawnWorkflowMock, handleContinueDirectiveMock } = vi.hoisted(() => ({
  classifyAndSpawnWorkflowMock: vi.fn(() => Promise.resolve()),
  handleContinueDirectiveMock: vi.fn<(...args: unknown[]) => boolean>(() => false),
}));

vi.mock('../webhookGatekeeper', () => ({
  classifyAndSpawnWorkflow: classifyAndSpawnWorkflowMock,
  ensureCronProcess: vi.fn(),
  spawnDetached: vi.fn(),
  logDeferral: vi.fn(),
  closeAbandonedDependents: vi.fn(),
}));
vi.mock('../continueHandler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../continueHandler')>()),
  handleContinueDirective: handleContinueDirectiveMock,
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

const fetchComments = vi.fn((_issueNumber: number): { body: string }[] => []);

const boundary = {
  repoId: { owner: 'acme', repo: 'target', platform: Platform.GitHub },
  providers: { issueTracker: { fetchComments } },
} as unknown as LaunchBoundary;

function dispatchComment(issueNumber: number, labels: { name: string }[], commentBody = '## Continue'): unknown {
  const payload = {
    action: 'created',
    repository: { full_name: 'acme/target', clone_url: 'https://example.invalid/acme/target.git' },
    issue: { number: issueNumber, body: '', labels },
    comment: { body: commentBody },
  };
  const req = { headers: { 'x-github-event': 'issue_comment' } } as unknown as http.IncomingMessage;
  let responseBody: unknown;
  const res = { writeHead: () => res, end: (json: string) => { responseBody = JSON.parse(json); } } as unknown as http.ServerResponse;

  dispatchWebhookEvent(req, res, Buffer.from(JSON.stringify(payload)), () => boundary);
  return responseBody;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('dispatchWebhookEvent — issue_comment', () => {
  beforeEach(() => {
    classifyAndSpawnWorkflowMock.mockClear();
    handleContinueDirectiveMock.mockReset();
    fetchComments.mockReset();
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

  describe('## Continue and the waiver handler', () => {
    const comments = [{ body: '**ADW ID:** `adw-parked`' }, { body: '## Continue' }];
    const handlerDeps = expect.objectContaining({
      readTopLevelState: expect.any(Function),
      writeTopLevelState: expect.any(Function),
      now: expect.any(Function),
    });

    it('answers continue_waived and starts nothing when the handler waives the baseline', async () => {
      fetchComments.mockReturnValue(comments);
      handleContinueDirectiveMock.mockReturnValueOnce(true);

      const response = dispatchComment(79, []);
      await settle();

      expect(handleContinueDirectiveMock).toHaveBeenCalledOnce();
      expect(handleContinueDirectiveMock).toHaveBeenCalledWith(79, comments, handlerDeps);
      expect(response).toEqual({ status: 'continue_waived', issue: 79 });
      expect(classifyAndSpawnWorkflowMock).not.toHaveBeenCalled();
    });

    it('consults the handler with the issue comments and, when it declines, hands the comment to the gate as before', async () => {
      fetchComments.mockReturnValue(comments);

      const response = dispatchComment(80, []);

      expect(handleContinueDirectiveMock).toHaveBeenCalledOnce();
      expect(handleContinueDirectiveMock).toHaveBeenCalledWith(80, comments, handlerDeps);
      expect(response).toEqual({ status: 'processing', issue: 80 });
      await vi.waitFor(() => expect(classifyAndSpawnWorkflowMock).toHaveBeenCalledWith(80, boundary, TARGET_ARGS));
    });

    it('ignores a comment that is no directive without fetching the issue comments or consulting the handler', async () => {
      const response = dispatchComment(81, [], 'Looks good to me');
      await settle();

      expect(response).toEqual({ status: 'ignored' });
      expect(fetchComments).not.toHaveBeenCalled();
      expect(handleContinueDirectiveMock).not.toHaveBeenCalled();
      expect(classifyAndSpawnWorkflowMock).not.toHaveBeenCalled();
    });
  });
});
