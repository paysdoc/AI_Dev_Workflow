import { describe, it, expect } from 'vitest';
import * as net from 'net';
import { allocateRandomPort, isPortAvailable } from '../portAllocator';

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

    // Verify the port is available by trying to bind to it on 0.0.0.0 (the default host)
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '0.0.0.0');
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

describe('isPortAvailable', () => {
  it('returns true for a port that is not in use', async () => {
    // Use a random high port unlikely to be in use
    const port = 40000 + Math.floor(Math.random() * 10000);
    const available = await isPortAvailable(port);

    expect(available).toBe(true);
  });

  it('returns true for a free port on 0.0.0.0', async () => {
    const port = 40000 + Math.floor(Math.random() * 10000);
    const available = await isPortAvailable(port, '0.0.0.0');

    expect(available).toBe(true);
  });

  it('returns false for a port that is in use on the specified host', async () => {
    const server = net.createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '0.0.0.0', () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    try {
      const available = await isPortAvailable(port, '0.0.0.0');
      expect(available).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns false for a port that is in use (default host)', async () => {
    const server = net.createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '0.0.0.0', () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    try {
      const available = await isPortAvailable(port);
      expect(available).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
