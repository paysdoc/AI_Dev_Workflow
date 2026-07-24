import { describe, it, expect, afterEach } from 'vitest';
import { accessSync, constants } from 'fs';
import { join, delimiter, sep } from 'path';
import { tmpdir } from 'os';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../test-harness.ts';
import { startMockServer } from '../github-api-server.ts';

afterEach(async () => {
  await teardownMockInfrastructure();
});

/** Resolves once fetch succeeds, false if it rejects (i.e. nothing is listening). */
async function isListening(url: string): Promise<boolean> {
  return fetch(url).then(() => true).catch(() => false);
}

// ---------------------------------------------------------------------------
// Bug 1 — the git-mock wrapper dir must be writable scratch space, not cwd
// ---------------------------------------------------------------------------

describe('setupMockInfrastructure — git-mock wrapper location', () => {
  it('installs the git wrapper under a writable directory outside process.cwd()', async () => {
    await setupMockInfrastructure();

    const mockDir = (process.env['PATH'] ?? '').split(delimiter)[0] ?? '';
    const cwd = process.cwd();

    expect(mockDir).not.toBe('');
    expect(mockDir === cwd || mockDir.startsWith(cwd + sep)).toBe(false);
    expect(mockDir === tmpdir() || mockDir.startsWith(tmpdir() + sep)).toBe(true);
    expect(() => accessSync(mockDir, constants.W_OK)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Bug 2a — teardown must always close a listening server, even when isSetUp
// was never flipped true (the exact partial-setup state a mid-setup crash
// leaves behind)
// ---------------------------------------------------------------------------

describe('teardownMockInfrastructure — unconditional cleanup', () => {
  it('stops a mock server left listening by a partial setup', async () => {
    const { url } = await startMockServer(0);
    expect(await isListening(url)).toBe(true);

    await teardownMockInfrastructure();

    expect(await isListening(url)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bug 2b — setup must stop a server it started before rethrowing, even when
// the failing step is one only setupMockInfrastructure itself would trigger
// ---------------------------------------------------------------------------

describe('setupMockInfrastructure — crash safety', () => {
  it('stops the server it started when a later setup step throws', async () => {
    const FIXED_PORT = 48173;
    const originalTmpdir = process.env['TMPDIR'];
    process.env['TMPDIR'] = join(originalTmpdir ?? tmpdir(), 'adw-767-does-not-exist', 'nested');

    try {
      await expect(setupMockInfrastructure({ port: FIXED_PORT })).rejects.toThrow();
      expect(await isListening(`http://localhost:${FIXED_PORT}/`)).toBe(false);
    } finally {
      if (originalTmpdir === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = originalTmpdir;
      await teardownMockInfrastructure();
    }
  });
});
