import { describe, it, expect, vi } from 'vitest';
import {
  describeWebhookEvent,
  safeParseWebhookBody,
  formatWebhookFailureLog,
  formatWebhookFailureAlert,
  reportWebhookEventFailure,
  type WebhookEventContext,
} from '../webhookEventBoundary';

// This suite must never let a call reach the real postSlack — the host's .env
// supplies a live SLACK_WEBHOOK_URL, and every reportWebhookEventFailure call
// below passes an injected `notify` for exactly that reason.

describe('describeWebhookEvent', () => {
  it('extracts event, repo, issue number from a full issue_comment payload', () => {
    const body = {
      repository: { full_name: 'paysdoc/paysdoc.nl' },
      issue: { number: 28 },
    };
    expect(describeWebhookEvent('issue_comment', body)).toEqual({
      event: 'issue_comment',
      repo: 'paysdoc/paysdoc.nl',
      issueNumber: 28,
      prNumber: null,
    });
  });

  it('falls back to unknown/null when event and body are undefined', () => {
    expect(describeWebhookEvent(undefined, undefined)).toEqual({
      event: 'unknown',
      repo: 'unknown',
      issueNumber: null,
      prNumber: null,
    });
  });

  it('degrades a hostile payload to the same fallbacks without throwing', () => {
    const hostile = { repository: 'nope', issue: { number: 'x' } };
    expect(() => describeWebhookEvent('issue_comment', hostile)).not.toThrow();
    expect(describeWebhookEvent('issue_comment', hostile)).toEqual({
      event: 'issue_comment',
      repo: 'unknown',
      issueNumber: null,
      prNumber: null,
    });
  });

  it('picks up pull_request.number for a pull_request payload', () => {
    const body = {
      repository: { full_name: 'paysdoc/paysdoc.nl' },
      pull_request: { number: 42 },
    };
    expect(describeWebhookEvent('pull_request', body)).toEqual({
      event: 'pull_request',
      repo: 'paysdoc/paysdoc.nl',
      issueNumber: null,
      prNumber: 42,
    });
  });
});

describe('safeParseWebhookBody', () => {
  it('parses valid JSON into an object', () => {
    expect(safeParseWebhookBody(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
  });

  it('returns undefined for unparseable JSON', () => {
    expect(safeParseWebhookBody(Buffer.from('not json'))).toBeUndefined();
  });

  it('returns undefined for a valid-but-non-object body (array)', () => {
    expect(safeParseWebhookBody(Buffer.from('[]'))).toBeUndefined();
  });

  it('returns undefined for a valid-but-non-object body (bare string)', () => {
    expect(safeParseWebhookBody(Buffer.from('"x"'))).toBeUndefined();
  });
});

describe('formatWebhookFailureLog / formatWebhookFailureAlert', () => {
  const context: WebhookEventContext = {
    event: 'issue_comment',
    repo: 'paysdoc/paysdoc.nl',
    issueNumber: 28,
    prNumber: null,
  };
  const error = new Error('Failed to fetch comments for issue #28: boom');

  it('formatWebhookFailureLog names event type, repo, issue number and the error message', () => {
    const line = formatWebhookFailureLog(context, error);
    expect(line).toContain('issue_comment');
    expect(line).toContain('paysdoc/paysdoc.nl');
    expect(line).toContain('28');
    expect(line).toContain('Failed to fetch comments for issue #28: boom');
  });

  it('formatWebhookFailureAlert names event type, repo, issue number and the error message', () => {
    const alert = formatWebhookFailureAlert(context, error);
    expect(alert).toContain('issue_comment');
    expect(alert).toContain('paysdoc/paysdoc.nl');
    expect(alert).toContain('28');
    expect(alert).toContain('Failed to fetch comments for issue #28: boom');
  });

  it('labels as n/a when neither issue nor PR number is set', () => {
    const noIdentity: WebhookEventContext = { event: 'ping', repo: 'unknown', issueNumber: null, prNumber: null };
    expect(formatWebhookFailureLog(noIdentity, error)).toContain('n/a');
    expect(formatWebhookFailureAlert(noIdentity, error)).toContain('n/a');
  });

  it('labels as PR #N when only a PR number is set', () => {
    const prOnly: WebhookEventContext = { event: 'pull_request', repo: 'paysdoc/paysdoc.nl', issueNumber: null, prNumber: 42 };
    expect(formatWebhookFailureLog(prOnly, error)).toContain('PR #42');
    expect(formatWebhookFailureAlert(prOnly, error)).toContain('PR #42');
  });

  it('formats a non-Error thrown value via String()', () => {
    const line = formatWebhookFailureLog(context, 'raw string failure');
    expect(line).toContain('raw string failure');
  });
});

describe('reportWebhookEventFailure', () => {
  const context: WebhookEventContext = {
    event: 'issue_comment',
    repo: 'paysdoc/paysdoc.nl',
    issueNumber: 28,
    prNumber: null,
  };
  const error = new Error('boom');

  it('calls logger once at error level and notify once with the alert text', () => {
    const logger = vi.fn();
    const notify = vi.fn().mockResolvedValue(undefined);
    reportWebhookEventFailure(context, error, { logger, notify });
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(formatWebhookFailureLog(context, error), 'error');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(formatWebhookFailureAlert(context, error));
  });

  it('never throws when notify throws synchronously', () => {
    const logger = vi.fn();
    const notify = vi.fn(() => { throw new Error('sync notify boom'); });
    expect(() => reportWebhookEventFailure(context, error, { logger, notify })).not.toThrow();
  });

  it('never throws when notify returns a rejected promise, and the rejection is consumed', async () => {
    const logger = vi.fn();
    const notify = vi.fn().mockRejectedValue(new Error('async notify boom'));
    expect(() => reportWebhookEventFailure(context, error, { logger, notify })).not.toThrow();
    // Let the rejection's .catch handler run on a later microtask/macrotask.
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('Webhook failure alert could not be delivered'),
      'warn',
    );
  });

  it('never throws when logger throws', () => {
    const logger = vi.fn(() => { throw new Error('logger boom'); });
    const notify = vi.fn().mockResolvedValue(undefined);
    expect(() => reportWebhookEventFailure(context, error, { logger, notify })).not.toThrow();
  });

  it('does not await the notifier — returns synchronously even with a never-settling promise', () => {
    const logger = vi.fn();
    const notify = vi.fn(() => new Promise<void>(() => { /* never settles */ }));
    const start = Date.now();
    reportWebhookEventFailure(context, error, { logger, notify });
    expect(Date.now() - start).toBeLessThan(50);
    expect(logger).toHaveBeenCalledTimes(1);
  });
});
