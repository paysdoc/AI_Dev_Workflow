import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';

// Mock child_process before importing the module under test
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import {
  substitutePort,
  spawnServer,
  probeHealth,
  killProcessGroup,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  MAX_START_ATTEMPTS,
  KILL_GRACE_MS,
} from '../devServerLifecycle';

const mockSpawn = vi.mocked(spawn);

function makeFakeProcess(pid = 1234): ChildProcess {
  return {
    pid,
    unref: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

beforeEach(() => {
  mockSpawn.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('substitutePort', () => {
  it('replaces {PORT} with the given port number', () => {
    expect(substitutePort('bun run dev --port {PORT}', 3456)).toBe(
      'bun run dev --port 3456',
    );
  });

  it('replaces multiple {PORT} occurrences', () => {
    expect(substitutePort('cmd --port {PORT} --alt {PORT}', 8080)).toBe(
      'cmd --port 8080 --alt 8080',
    );
  });

  it('returns the command unchanged when there is no {PORT}', () => {
    expect(substitutePort('bun run dev', 3000)).toBe('bun run dev');
  });
});

describe('spawnServer', () => {
  it('calls spawn with detached: true', () => {
    const fakeProc = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    spawnServer('bun run dev', '/tmp');

    expect(mockSpawn).toHaveBeenCalledWith(
      'bun run dev',
      [],
      expect.objectContaining({ detached: true }),
    );
  });

  it('calls spawn with shell: true', () => {
    mockSpawn.mockReturnValue(makeFakeProcess());
    spawnServer('bun run dev', '/tmp');
    expect(mockSpawn).toHaveBeenCalledWith(
      'bun run dev',
      [],
      expect.objectContaining({ shell: true }),
    );
  });

  it('passes the cwd option to spawn', () => {
    mockSpawn.mockReturnValue(makeFakeProcess());
    spawnServer('bun run dev', '/projects/myapp');
    expect(mockSpawn).toHaveBeenCalledWith(
      'bun run dev',
      [],
      expect.objectContaining({ cwd: '/projects/myapp' }),
    );
  });

  it('calls unref() on the spawned process', () => {
    const fakeProc = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);
    spawnServer('bun run dev', '/tmp');
    expect(fakeProc.unref).toHaveBeenCalledOnce();
  });
});

describe('probeHealth', () => {
  it('returns true immediately when fetch responds with 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const result = await probeHealth('http://localhost:3000/', 100, 5000);
    expect(result).toBe(true);
  });

  it('returns false when timeout elapses before a healthy response', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const promise = probeHealth('http://localhost:3000/', 100, 500);
    // Advance past timeout (500ms) + one extra interval
    await vi.advanceTimersByTimeAsync(700);
    const result = await promise;

    expect(result).toBe(false);
  });

  it('retries after each failed probe at the given interval', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const promise = probeHealth('http://localhost:3000/', 100, 5000);
    // Allow 3 iterations: two failures (each waits 100ms sleep), then success
    await vi.advanceTimersByTimeAsync(250);
    const result = await promise;

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats non-2xx responses as probe failures', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const promise = probeHealth('http://localhost:3000/', 100, 5000);
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends GET request to the exact URL provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await probeHealth('http://localhost:4000/healthz', 100, 5000);

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/healthz');
  });
});

describe('killProcessGroup', () => {
  it('sends SIGTERM to the negative PID (process group)', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    killProcessGroup(12345, 10000);

    expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
  });

  it('does not send SIGTERM to the positive PID', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    killProcessGroup(12345, 10000);

    expect(killSpy).not.toHaveBeenCalledWith(12345, 'SIGTERM');
  });

  it('escalates to SIGKILL after the grace period', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    killProcessGroup(12345, 500);
    expect(killSpy).not.toHaveBeenCalledWith(-12345, 'SIGKILL');

    await vi.advanceTimersByTimeAsync(501);
    expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGKILL');
  });

  it('does not crash when SIGTERM target is already gone (ESRCH)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    expect(() => killProcessGroup(99999, 100)).not.toThrow();
  });
});

describe('constants', () => {
  it('PROBE_INTERVAL_MS is 1000 (1 second)', () => {
    expect(PROBE_INTERVAL_MS).toBe(1000);
  });

  it('PROBE_TIMEOUT_MS is 20000 (20 seconds)', () => {
    expect(PROBE_TIMEOUT_MS).toBe(20000);
  });

  it('MAX_START_ATTEMPTS is 3', () => {
    expect(MAX_START_ATTEMPTS).toBe(3);
  });

  it('KILL_GRACE_MS is 5000 (5 seconds)', () => {
    expect(KILL_GRACE_MS).toBe(5000);
  });
});
