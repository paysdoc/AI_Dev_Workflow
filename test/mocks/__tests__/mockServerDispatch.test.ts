import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dispatchMockRequest, getMockServerState, getRecordedRequests, resetMockServer, startMockServer, stopMockServer } from '../github-api-server.ts';

const COMMENTS_URL = '/repos/acme/widgets/issues/7/comments';

beforeEach(() => resetMockServer());
afterEach(() => stopMockServer());

describe('dispatchMockRequest', () => {
  it('records the request and runs its route in one synchronous call', () => {
    const response = dispatchMockRequest('POST', COMMENTS_URL, JSON.stringify({ body: 'hello' }));

    expect(response.status).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({ body: 'hello' });
    expect(getRecordedRequests()).toMatchObject([{ method: 'POST', url: COMMENTS_URL, body: JSON.stringify({ body: 'hello' }) }]);
  });

  it('appends the comment to the state before it returns', () => {
    dispatchMockRequest('POST', COMMENTS_URL, JSON.stringify({ body: 'first' }));
    dispatchMockRequest('POST', COMMENTS_URL, JSON.stringify({ body: 'second' }));

    expect(getMockServerState().comments['7']).toMatchObject([{ body: 'first' }, { body: 'second' }]);
  });

  it('records the headers it is given, and none when it is given none', () => {
    dispatchMockRequest('GET', '/repos/acme/widgets/issues/1', '', { authorization: 'token x' });
    dispatchMockRequest('GET', '/repos/acme/widgets/issues/1', '');

    expect(getRecordedRequests().map((r) => r.headers)).toEqual([{ authorization: 'token x' }, {}]);
  });

  it('does not record a control request, but still runs it', () => {
    const response = dispatchMockRequest('POST', '/_mock/state', JSON.stringify({ issues: { '5': { number: 5 } } }));

    expect(response.status).toBe(200);
    expect(getRecordedRequests()).toEqual([]);
    expect(getMockServerState().issues).toEqual({ '5': { number: 5 } });
  });

  it('answers 404 naming the path for a route nothing serves, and still records the request', () => {
    const response = dispatchMockRequest('GET', '/repos/acme/widgets/nothing-here?page=2', '');

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ message: 'Not implemented: /repos/acme/widgets/nothing-here' });
    expect(getRecordedRequests()).toHaveLength(1);
  });

  it('matches a route by its path alone, whatever the query string', () => {
    expect(dispatchMockRequest('GET', '/repos/acme/widgets/issues/42?x=1', '').status).toBe(200);
  });
});

describe('getMockServerState', () => {
  it('returns a deep copy the caller may mutate without touching the server', () => {
    dispatchMockRequest('POST', COMMENTS_URL, JSON.stringify({ body: 'kept' }));

    const snapshot = getMockServerState();
    snapshot.comments['7']?.push({ body: 'injected' });
    delete snapshot.issues['42'];

    const after = getMockServerState();
    expect(after.comments['7']).toHaveLength(1);
    expect(after.issues['42']).toBeDefined();
  });

  it('reflects the default state after a reset', () => {
    dispatchMockRequest('POST', '/_mock/state', JSON.stringify({ issues: {} }));
    expect(getMockServerState().issues).toEqual({});

    resetMockServer();

    expect(Object.keys(getMockServerState().issues).sort()).toEqual(['1', '42']);
  });
});

describe('the HTTP listener', () => {
  it('serves the same dispatch an in-process caller gets, and records the request', async () => {
    const { url } = await startMockServer(0);

    const response = await fetch(`${url}${COMMENTS_URL}`, { method: 'POST', body: JSON.stringify({ body: 'over http' }) });

    expect(response.status).toBe(201);
    expect(getMockServerState().comments['7']).toMatchObject([{ body: 'over http' }]);
    expect(getRecordedRequests()).toMatchObject([{ method: 'POST', url: COMMENTS_URL }]);
  });
});
