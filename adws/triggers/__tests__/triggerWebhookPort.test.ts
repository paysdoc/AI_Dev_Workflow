import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveWebhookPort } from '../trigger_webhook';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    isPortAvailable: vi.fn(),
    allocateRandomPort: vi.fn(),
    log: vi.fn(),
  };
});

import { isPortAvailable, allocateRandomPort } from '../../core';

const mockedIsPortAvailable = vi.mocked(isPortAvailable);
const mockedAllocateRandomPort = vi.mocked(allocateRandomPort);

describe('resolveWebhookPort', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns the preferred port when it is available', async () => {
    mockedIsPortAvailable.mockResolvedValue(true);

    const port = await resolveWebhookPort(8001);

    expect(port).toBe(8001);
    expect(mockedIsPortAvailable).toHaveBeenCalledWith(8001, '0.0.0.0');
    expect(mockedAllocateRandomPort).not.toHaveBeenCalled();
  });

  it('returns a different port from the allocator when preferred port is in use', async () => {
    mockedIsPortAvailable.mockResolvedValue(false);
    mockedAllocateRandomPort.mockResolvedValue(34567);

    const port = await resolveWebhookPort(8001);

    expect(port).toBe(34567);
    expect(mockedIsPortAvailable).toHaveBeenCalledWith(8001, '0.0.0.0');
    expect(mockedAllocateRandomPort).toHaveBeenCalled();
  });

  it('throws when GITHUB_WEBHOOK_SECRET is set and preferred port is unavailable', async () => {
    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    mockedIsPortAvailable.mockResolvedValue(false);

    await expect(resolveWebhookPort(8001)).rejects.toThrow(
      'Port 8001 is in use and GITHUB_WEBHOOK_SECRET is set (tunnel mode)',
    );
    expect(mockedAllocateRandomPort).not.toHaveBeenCalled();
  });

  it('falls back to random port when GITHUB_WEBHOOK_SECRET is not set and preferred port is unavailable', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    mockedIsPortAvailable.mockResolvedValue(false);
    mockedAllocateRandomPort.mockResolvedValue(45678);

    const port = await resolveWebhookPort(8001);

    expect(port).toBe(45678);
    expect(mockedAllocateRandomPort).toHaveBeenCalled();
  });
});
