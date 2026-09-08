/**
 * jiraApiClient.test.ts — fake config in, fetch call out (#818).
 *
 * Proves JiraApiClient builds its request from INJECTED auth/instanceUrl
 * (never from process.env), threads the injected logger, and preserves
 * today's exact URL template, header shape, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { JiraApiClient, type FetchFn, type JiraAuth } from '../jiraApiClient';
import type { LogLevel } from '../../../gitContext/types';

function makeRecordingFetch(body: unknown, status = 200): { fetchFn: FetchFn; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const responseBody = status === 204 ? null : JSON.stringify(body);
    return new Response(responseBody, { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchFn, calls };
}

function makeLoggerSpy(): { logger: (message: string, level?: LogLevel) => void; messages: { message: string; level?: LogLevel }[] } {
  const messages: { message: string; level?: LogLevel }[] = [];
  return {
    logger: (message, level) => { messages.push({ message, level }); },
    messages,
  };
}

const CLOUD_AUTH: JiraAuth = { email: 'me@example.com', apiToken: 'tok' };
const INSTANCE = 'https://acme.atlassian.net/';

describe('JiraApiClient — request shape from injected configuration (#818)', () => {
  it('getIssue builds the expected URL, method, and Basic auth header for cloud auth', () => {
    const { fetchFn, calls } = makeRecordingFetch({ key: 'ADW-7' });
    const client = new JiraApiClient(INSTANCE, CLOUD_AUTH, { fetchFn });

    return client.getIssue('ADW-7').then((result) => {
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://acme.atlassian.net/rest/api/3/issue/ADW-7?expand=renderedFields');
      expect(calls[0].init.method).toBe('GET');
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Basic ${btoa('me@example.com:tok')}`);
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');
      expect(calls[0].init.body).toBeUndefined();
      expect(result).toEqual({ key: 'ADW-7' });
    });
  });

  it('a personal access token produces a Bearer header', async () => {
    const { fetchFn, calls } = makeRecordingFetch({ key: 'ADW-7' });
    const client = new JiraApiClient(INSTANCE, { pat: 'pat-1' }, { fetchFn });

    await client.getIssue('ADW-7');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer pat-1');
  });

  it('addComment posts { body: adf } to the comment endpoint', async () => {
    const adf = { type: 'doc', content: [] };
    const { fetchFn, calls } = makeRecordingFetch({ id: '1' });
    const client = new JiraApiClient(INSTANCE, CLOUD_AUTH, { fetchFn });

    await client.addComment('ADW-7', adf);

    expect(calls[0].url).toBe('https://acme.atlassian.net/rest/api/3/issue/ADW-7/comment');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ body: adf });
  });

  it('deleteComment issues a DELETE and a 204 response resolves undefined', async () => {
    const { fetchFn, calls } = makeRecordingFetch(null, 204);
    const client = new JiraApiClient(INSTANCE, CLOUD_AUTH, { fetchFn });

    const result = await client.deleteComment('ADW-7', '42');

    expect(calls[0].url).toBe('https://acme.atlassian.net/rest/api/3/issue/ADW-7/comment/42');
    expect(calls[0].init.method).toBe('DELETE');
    expect(result).toBeUndefined();
  });

  it('getTransitions/doTransition/getComments build their expected requests', async () => {
    const { fetchFn, calls } = makeRecordingFetch({ transitions: [{ id: '31' }] });
    const client = new JiraApiClient(INSTANCE, CLOUD_AUTH, { fetchFn });

    const transitions = await client.getTransitions('ADW-7');
    expect(transitions).toEqual([{ id: '31' }]);

    await client.doTransition('ADW-7', '31');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ transition: { id: '31' } });

    const { fetchFn: fetchFn2, calls: calls2 } = makeRecordingFetch({ comments: [{ id: 'c1' }] });
    const client2 = new JiraApiClient(INSTANCE, CLOUD_AUTH, { fetchFn: fetchFn2 });
    const comments = await client2.getComments('ADW-7');
    expect(comments).toEqual([{ id: 'c1' }]);
    expect(calls2[0].url).toBe('https://acme.atlassian.net/rest/api/3/issue/ADW-7/comment');
  });
});

describe('JiraApiClient — error paths log through the injected logger (#818)', () => {
  it('a non-ok response rejects and logs once at error', async () => {
    const { fetchFn } = makeRecordingFetch('boom', 500);
    const { logger, messages } = makeLoggerSpy();
    const client = new JiraApiClient(INSTANCE, CLOUD_AUTH, { fetchFn, logger });

    await expect(client.getIssue('ADW-7')).rejects.toThrow(/failed with 500/);
    expect(messages).toHaveLength(1);
    expect(messages[0].level).toBe('error');
  });

  it('a 429 logs a warn with Retry-After, then the error', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, init });
      return new Response('rate limited', { status: 429, headers: { 'Retry-After': '7' } });
    };
    const { logger, messages } = makeLoggerSpy();
    const client = new JiraApiClient(INSTANCE, CLOUD_AUTH, { fetchFn, logger });

    await expect(client.getIssue('ADW-7')).rejects.toThrow();

    expect(messages).toHaveLength(2);
    expect(messages[0].level).toBe('warn');
    expect(messages[0].message).toContain('Retry-After: 7');
    expect(messages[1].level).toBe('error');
  });
});

describe('JiraApiClient — ambient environment is ignored (#818)', () => {
  it('poisoned JIRA_* env vars never reach the wire', async () => {
    const prevPat = process.env.JIRA_PAT;
    const prevEmail = process.env.JIRA_EMAIL;
    const prevToken = process.env.JIRA_API_TOKEN;
    process.env.JIRA_PAT = 'ambient';
    process.env.JIRA_EMAIL = 'poison@example.com';
    process.env.JIRA_API_TOKEN = 'poison-token';

    try {
      const { fetchFn, calls } = makeRecordingFetch({ key: 'ADW-7' });
      const client = new JiraApiClient(INSTANCE, CLOUD_AUTH, { fetchFn });

      await client.getIssue('ADW-7');

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Basic ${btoa('me@example.com:tok')}`);
    } finally {
      if (prevPat === undefined) delete process.env.JIRA_PAT; else process.env.JIRA_PAT = prevPat;
      if (prevEmail === undefined) delete process.env.JIRA_EMAIL; else process.env.JIRA_EMAIL = prevEmail;
      if (prevToken === undefined) delete process.env.JIRA_API_TOKEN; else process.env.JIRA_API_TOKEN = prevToken;
    }
  });
});
