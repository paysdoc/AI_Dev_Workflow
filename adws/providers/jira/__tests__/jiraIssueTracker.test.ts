/**
 * jiraIssueTracker.test.ts — factory validation and end-to-end drive through
 * a scripted fetch, proving `createJiraIssueTracker` threads injected
 * configuration, auth, and the Logger port down through the client it
 * builds (#818).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createJiraIssueTracker } from '../jiraIssueTracker';
import type { FetchFn, JiraAuth } from '../jiraApiClient';
import { BoardStatus } from '../../types';
import type { LogLevel } from '../../../gitContext/types';
import type { JiraIssueResponse, JiraTransitionsResponse } from '../jiraTypes';

function makeLoggerSpy(): { logger: (message: string, level?: LogLevel) => void; messages: { message: string; level?: LogLevel }[] } {
  const messages: { message: string; level?: LogLevel }[] = [];
  return {
    logger: (message, level) => { messages.push({ message, level }); },
    messages,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ISSUE_NEW: JiraIssueResponse = {
  id: '1',
  key: 'ADW-7',
  fields: {
    summary: 'Title',
    description: { type: 'doc', content: [] },
    status: { name: 'Open', statusCategory: { id: 1, key: 'new', name: 'To Do' } },
    creator: { displayName: 'Bot' },
    labels: [],
    comment: { comments: [], startAt: 0, maxResults: 0, total: 0 },
    created: '2026-01-01T00:00:00.000Z',
  },
};

const ISSUE_DONE: JiraIssueResponse = {
  ...ISSUE_NEW,
  fields: { ...ISSUE_NEW.fields, status: { name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } } },
};

const TRANSITIONS_TO_DONE: JiraTransitionsResponse = {
  transitions: [{ id: '31', name: 'Done', to: { name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } } }],
};

const AUTH: JiraAuth = { pat: 'jira-injected-pat' };
const INSTANCE = 'https://acme.atlassian.net';
const ISSUE_URL = 'https://acme.atlassian.net/rest/api/3/issue/ADW-7?expand=renderedFields';
const TRANSITIONS_URL = 'https://acme.atlassian.net/rest/api/3/issue/ADW-7/transitions';

function scriptedFetch(answers: { match: (url: string, init: RequestInit) => boolean; respond: () => Response }[]): FetchFn {
  return async (url, init) => {
    for (const answer of answers) {
      if (answer.match(url, init)) return answer.respond();
    }
    throw new Error(`Unmatched fetch: ${init.method} ${url}`);
  };
}

describe('createJiraIssueTracker — validates injected configuration (#818)', () => {
  it('throws naming projectKey when blank', () => {
    expect(() => createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: '', auth: AUTH })).toThrow(/non-empty projectKey/);
  });

  it('throws naming instanceUrl when blank', () => {
    expect(() => createJiraIssueTracker({ instanceUrl: '', projectKey: 'ADW', auth: AUTH })).toThrow(/non-empty instanceUrl/);
  });

  it('throws naming email and apiToken when cloud auth is blank', () => {
    expect(() => createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: { email: '', apiToken: '' } })).toThrow(/email and apiToken/);
  });

  it('throws naming a pat when data-center auth is blank', () => {
    expect(() => createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: { pat: '' } })).toThrow(/pat/);
  });
});

describe('createJiraIssueTracker — end-to-end through the factory with a scripted fetch (#818)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchIssue maps the response using the injected projectKey', async () => {
    const fetchFn = scriptedFetch([
      { match: (url) => url.includes('/issue/ADW-7'), respond: () => jsonResponse(ISSUE_NEW) },
    ]);
    const tracker = createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: AUTH }, { fetchFn });

    const issue = await tracker.fetchIssue(7);

    expect(issue).toMatchObject({ id: 'ADW-7', number: 7, title: 'Title', state: 'OPEN' });
    expect(issue.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(issue.url).toBe('https://acme.atlassian.net/browse/ADW-7');
  });

  it('closeIssue transitions a new-category issue to done, returns true, and logs success with level', async () => {
    const fetchFn = scriptedFetch([
      { match: (url, init) => url === ISSUE_URL && init.method === 'GET', respond: () => jsonResponse(ISSUE_NEW) },
      { match: (url, init) => url === TRANSITIONS_URL && init.method === 'GET', respond: () => jsonResponse(TRANSITIONS_TO_DONE) },
      { match: (url, init) => url === TRANSITIONS_URL && init.method === 'POST', respond: () => jsonResponse(null, 204) },
    ]);
    const { logger, messages } = makeLoggerSpy();
    const tracker = createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: AUTH }, { fetchFn, logger });

    const result = await tracker.closeIssue(7);

    expect(result).toBe(true);
    const successMsg = messages.find((m) => m.level === 'success');
    expect(successMsg).toBeDefined();
    expect(successMsg?.message).toContain('ADW-7');
  });

  it('closeIssue on a done-category issue returns false and logs info', async () => {
    const fetchFn = scriptedFetch([
      { match: (url) => url.includes('/issue/ADW-7'), respond: () => jsonResponse(ISSUE_DONE) },
    ]);
    const { logger, messages } = makeLoggerSpy();
    const tracker = createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: AUTH }, { fetchFn, logger });

    const result = await tracker.closeIssue(7);

    expect(result).toBe(false);
    expect(messages.some((m) => m.level === 'info')).toBe(true);
  });

  it('closeIssue swallows a rejecting fetch, returns false, and logs error', async () => {
    const fetchFn: FetchFn = async () => { throw new Error('network down'); };
    const { logger, messages } = makeLoggerSpy();
    const tracker = createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: AUTH }, { fetchFn, logger });

    const result = await tracker.closeIssue(7);

    expect(result).toBe(false);
    expect(messages.some((m) => m.level === 'error')).toBe(true);
  });

  it('moveToStatus fuzzy-matches an available transition, posts, and logs success', async () => {
    const fetchFn = scriptedFetch([
      { match: (url, init) => url === ISSUE_URL && init.method === 'GET', respond: () => jsonResponse(ISSUE_NEW) },
      { match: (url, init) => url === TRANSITIONS_URL && init.method === 'GET', respond: () => jsonResponse({ transitions: [{ id: '5', name: 'In Progress', to: { name: 'In Progress', statusCategory: { id: 2, key: 'indeterminate', name: 'In Progress' } } }] }) },
      { match: (url, init) => url === TRANSITIONS_URL && init.method === 'POST', respond: () => jsonResponse(null, 204) },
    ]);
    const { logger, messages } = makeLoggerSpy();
    const tracker = createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: AUTH }, { fetchFn, logger });

    const result = await tracker.moveToStatus(7, BoardStatus.InProgress);

    expect(result).toBe(true);
    expect(messages.some((m) => m.level === 'success')).toBe(true);
  });

  it('moveToStatus with no matching transition returns false and logs warn listing available names', async () => {
    const fetchFn = scriptedFetch([
      { match: (url, init) => url === ISSUE_URL && init.method === 'GET', respond: () => jsonResponse(ISSUE_NEW) },
      { match: (url, init) => url === TRANSITIONS_URL && init.method === 'GET', respond: () => jsonResponse({ transitions: [{ id: '5', name: 'Blocked', to: { name: 'Blocked', statusCategory: { id: 4, key: 'new', name: 'Blocked' } } }] }) },
    ]);
    const { logger, messages } = makeLoggerSpy();
    const tracker = createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: AUTH }, { fetchFn, logger });

    const result = await tracker.moveToStatus(7, BoardStatus.InProgress);

    expect(result).toBe(false);
    const warnMsg = messages.find((m) => m.level === 'warn');
    expect(warnMsg?.message).toContain('Blocked');
  });

  it('with no logger injected the console default receives the success line', async () => {
    const fetchFn = scriptedFetch([
      { match: (url, init) => url === ISSUE_URL && init.method === 'GET', respond: () => jsonResponse(ISSUE_NEW) },
      { match: (url, init) => url === TRANSITIONS_URL && init.method === 'GET', respond: () => jsonResponse(TRANSITIONS_TO_DONE) },
      { match: (url, init) => url === TRANSITIONS_URL && init.method === 'POST', respond: () => jsonResponse(null, 204) },
    ]);
    const tracker = createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: AUTH }, { fetchFn });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await tracker.closeIssue(7);

    expect(consoleSpy.mock.calls.some((call) => String(call[0]).includes('Closed Jira issue ADW-7'))).toBe(true);
    consoleSpy.mockRestore();
  });

  it('refusal stubs are unchanged — fetchLabels still throws naming the method', () => {
    const fetchFn: FetchFn = async () => jsonResponse({});
    const tracker = createJiraIssueTracker({ instanceUrl: INSTANCE, projectKey: 'ADW', auth: AUTH }, { fetchFn });

    expect(() => tracker.fetchLabels(7)).toThrow('JiraIssueTracker.fetchLabels is not implemented');
  });
});
