import * as net from 'net';

const PORT_RANGE_MIN = 10000;
const PORT_RANGE_MAX = 60000;
const MAX_RETRIES = 10;

/** Tests whether a given port is available by attempting to bind a TCP server. */
export function isPortAvailable(port: number, host: string = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function randomPort(): number {
  return Math.floor(Math.random() * (PORT_RANGE_MAX - PORT_RANGE_MIN)) + PORT_RANGE_MIN;
}

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
