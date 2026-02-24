/**
 * Port allocator utility for assigning random available ports to worktree instances.
 * Picks a random port from the ephemeral range (10000–60000) and verifies availability.
 */

import * as net from 'net';

const PORT_RANGE_MIN = 10000;
const PORT_RANGE_MAX = 60000;
const MAX_RETRIES = 10;

/**
 * Tests whether a given port is available by attempting to bind a TCP server.
 * Returns true if the port is free, false if it is in use.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Generates a random integer between min (inclusive) and max (exclusive).
 */
function randomPort(): number {
  return Math.floor(Math.random() * (PORT_RANGE_MAX - PORT_RANGE_MIN)) + PORT_RANGE_MIN;
}

/**
 * Allocates a random available port from the ephemeral range (10000–60000).
 * Retries up to 10 times if the selected port is already in use.
 *
 * @returns A port number that is currently available
 * @throws Error if no available port is found after maximum retries
 */
export async function allocateRandomPort(): Promise<number> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = randomPort();
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`Failed to find an available port after ${MAX_RETRIES} attempts`);
}
