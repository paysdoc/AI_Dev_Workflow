import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveWebhookPort } from '../triggers/trigger_webhook';

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    isPortAvailable: vi.fn(),
    allocateRandomPort: vi.fn(),
    log: vi.fn(),
  };
});

import { isPortAvailable, allocateRandomPort } from '../core';

const mockedIsPortAvailable = vi.mocked(isPortAvailable);
const mockedAllocateRandomPort = vi.mocked(allocateRandomPort);

describe('resolveWebhookPort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
