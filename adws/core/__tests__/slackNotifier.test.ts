import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendSlackDetectionNotification, sendSlackRecoveryNotification, postSlack } from '../slackNotifier';

vi.mock('../logger', () => ({ log: vi.fn() }));

import { log } from '../logger';

const WEBHOOK_URL = 'https://hooks.slack.com/test';

function makeFetchMock(ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// postSlack — delivery log (Fix #2)
// ---------------------------------------------------------------------------

describe('postSlack', () => {
  it('logs delivered at info level on a 2xx response', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    vi.stubGlobal('fetch', makeFetchMock(true, 200));
    const logMock = vi.mocked(log);

    await postSlack(':eyes: HITL ping');

    const deliveredCall = logMock.mock.calls.find(
      ([msg, lvl]) => msg.includes('delivered') && lvl === 'info',
    );
    // RED before Fix #2: no success log is emitted
    expect(deliveredCall).toBeDefined();
  });

  it('logs warn with HTTP status on a non-2xx response and does not log delivered', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    vi.stubGlobal('fetch', makeFetchMock(false, 400));
    const logMock = vi.mocked(log);

    await postSlack(':eyes: HITL ping');

    const warnCall = logMock.mock.calls.find(
      ([msg, lvl]) => msg.includes('HTTP 400') && lvl === 'warn',
    );
    expect(warnCall).toBeDefined();
    const deliveredCall = logMock.mock.calls.find(([msg]) => msg.includes('delivered'));
    expect(deliveredCall).toBeUndefined();
  });

  it('logs warn on a thrown fetch error and does not throw', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const logMock = vi.mocked(log);

    await expect(postSlack(':eyes: HITL ping')).resolves.toBeUndefined();

    const warnCall = logMock.mock.calls.find(
      ([msg, lvl]) => msg.includes('failed') && lvl === 'warn',
    );
    expect(warnCall).toBeDefined();
  });

  it('logs a skip warn and does not call fetch when SLACK_WEBHOOK_URL is unset', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const logMock = vi.mocked(log);

    await postSlack(':eyes: HITL ping');

    expect(fetchMock).not.toHaveBeenCalled();
    const skipCall = logMock.mock.calls.find(([msg]) => msg.includes('skipping'));
    expect(skipCall).toBeDefined();
  });
});

describe('sendSlackDetectionNotification', () => {
  it('calls fetch once with POST, correct content-type, and body containing host/adwId', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    await sendSlackDetectionNotification({
      host: 'myhost',
      adwId: 'adw-123',
      issueNumber: 42,
      agentName: 'orchestrator',
      firstDetectedAt: '2026-05-13T00:00:00Z',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(options.method).toBe('POST');
    expect(options.headers['content-type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.text).toContain('myhost');
    expect(body.text).toContain('adw-123');
  });

  it('does not call fetch when SLACK_WEBHOOK_URL is unset', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    await sendSlackDetectionNotification({
      host: 'myhost',
      adwId: null,
      issueNumber: null,
      agentName: 'orchestrator',
      firstDetectedAt: '2026-05-13T00:00:00Z',
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('swallows fetch errors without throwing', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      sendSlackDetectionNotification({
        host: 'myhost',
        adwId: null,
        issueNumber: null,
        agentName: 'orchestrator',
        firstDetectedAt: '2026-05-13T00:00:00Z',
      })
    ).resolves.toBeUndefined();
  });
});

describe('sendSlackRecoveryNotification', () => {
  it('calls fetch once with body containing clearedAt', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    const clearedAt = '2026-05-13T12:00:00Z';
    await sendSlackRecoveryNotification({
      host: 'myhost',
      clearedAt,
      resumedCount: 3,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.text).toContain(clearedAt);
    expect(body.text).toContain('myhost');
  });

  it('does not call fetch when SLACK_WEBHOOK_URL is unset', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const mockFetch = makeFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    await sendSlackRecoveryNotification({
      host: 'myhost',
      clearedAt: '2026-05-13T12:00:00Z',
      resumedCount: 0,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('swallows fetch errors without throwing', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', WEBHOOK_URL);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));

    await expect(
      sendSlackRecoveryNotification({
        host: 'myhost',
        clearedAt: '2026-05-13T12:00:00Z',
        resumedCount: 1,
      })
    ).resolves.toBeUndefined();
  });
});
