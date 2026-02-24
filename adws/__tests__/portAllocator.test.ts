import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import { allocateRandomPort } from '../core/portAllocator';

describe('allocateRandomPort', () => {
  it('returns a port number within the expected range', async () => {
    const port = await allocateRandomPort();

    expect(port).toBeGreaterThanOrEqual(10000);
    expect(port).toBeLessThan(60000);
  });

  it('returns a number', async () => {
    const port = await allocateRandomPort();

    expect(typeof port).toBe('number');
    expect(Number.isInteger(port)).toBe(true);
  });

  it('returns a port that is currently available', async () => {
    const port = await allocateRandomPort();

    // Verify the port is available by trying to bind to it
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });

    expect(available).toBe(true);
  });

  it('returns different ports on successive calls (non-deterministic)', async () => {
    const ports = new Set<number>();
    for (let i = 0; i < 5; i++) {
      ports.add(await allocateRandomPort());
    }

    // With a range of 50000 ports, getting the same port 5 times is astronomically unlikely
    expect(ports.size).toBeGreaterThan(1);
  });
});
