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
  withDevServer,
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

// ---------------------------------------------------------------------------
// substitutePort
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// spawnServer
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// probeHealth
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// killProcessGroup
// ---------------------------------------------------------------------------

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

    // Should not throw
    expect(() => killProcessGroup(99999, 100)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// withDevServer — integration scenarios
// ---------------------------------------------------------------------------

describe('withDevServer', () => {
  it('substitutes {PORT} in the start command before spawning', async () => {
    vi.useFakeTimers();
    const fakeProc = makeFakeProcess(111);
    mockSpawn.mockReturnValue(fakeProc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const workFn = vi.fn().mockResolvedValue('ok');
    const promise = withDevServer(
      { startCommand: 'bun run dev --port {PORT}', port: 3456, healthPath: '/', cwd: '/tmp' },
      workFn,
    );
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'bun run dev --port 3456',
      [],
      expect.any(Object),
    );
  });

  it('spawns with detached: true', async () => {
    vi.useFakeTimers();
    mockSpawn.mockReturnValue(makeFakeProcess(222));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const promise = withDevServer(
      { startCommand: 'start', port: 3000, healthPath: '/', cwd: '/tmp' },
      vi.fn().mockResolvedValue(undefined),
    );
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ detached: true }),
    );
  });

  it('probes the correct URL (localhost + port + healthPath)', async () => {
    vi.useFakeTimers();
    mockSpawn.mockReturnValue(makeFakeProcess(333));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const promise = withDevServer(
      { startCommand: 'start', port: 4000, healthPath: '/healthz', cwd: '/tmp' },
      vi.fn().mockResolvedValue(undefined),
    );
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/healthz');
  });

  it('runs the work function exactly once on successful probe', async () => {
    vi.useFakeTimers();
    mockSpawn.mockReturnValue(makeFakeProcess(444));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const workFn = vi.fn().mockResolvedValue('result');
    const promise = withDevServer(
      { startCommand: 'start', port: 3000, healthPath: '/', cwd: '/tmp' },
      workFn,
    );
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(workFn).toHaveBeenCalledOnce();
  });

  it('returns the value from the work function', async () => {
    vi.useFakeTimers();
    mockSpawn.mockReturnValue(makeFakeProcess(555));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const promise = withDevServer(
      { startCommand: 'start', port: 3000, healthPath: '/', cwd: '/tmp' },
      async () => 42,
    );
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe(42);
  });

  it('retries spawn exactly MAX_START_ATTEMPTS times when all probes fail', async () => {
    vi.useFakeTimers();
    mockSpawn.mockImplementation(() => makeFakeProcess(666));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const workFn = vi.fn().mockResolvedValue(undefined);
    const promise = withDevServer(
      { startCommand: 'start', port: 3000, healthPath: '/', cwd: '/tmp' },
      workFn,
    );

    // Each probe attempt runs for PROBE_TIMEOUT_MS (20000ms)
    // Advance past 3 attempts + SIGKILL grace per attempt
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS * MAX_START_ATTEMPTS + KILL_GRACE_MS * MAX_START_ATTEMPTS + 1000);
    await promise;

    expect(mockSpawn).toHaveBeenCalledTimes(MAX_START_ATTEMPTS);
  });

  it('falls back to running work after all start attempts fail', async () => {
    vi.useFakeTimers();
    mockSpawn.mockImplementation(() => makeFakeProcess(777));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const workFn = vi.fn().mockResolvedValue('fallback-result');
    const promise = withDevServer(
      { startCommand: 'start', port: 3000, healthPath: '/', cwd: '/tmp' },
      workFn,
    );

    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS * MAX_START_ATTEMPTS + KILL_GRACE_MS * MAX_START_ATTEMPTS + 1000);
    await promise;

    expect(workFn).toHaveBeenCalledOnce();
  });

  it('kills the process group (negative PID) on successful cleanup', async () => {
    vi.useFakeTimers();
    const fakeProc = makeFakeProcess(12345);
    mockSpawn.mockReturnValue(fakeProc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const promise = withDevServer(
      { startCommand: 'start', port: 3000, healthPath: '/', cwd: '/tmp' },
      vi.fn().mockResolvedValue(undefined),
    );
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
  });

  it('kills the process group when work throws (finally-block cleanup)', async () => {
    vi.useFakeTimers();
    const fakeProc = makeFakeProcess(12345);
    mockSpawn.mockReturnValue(fakeProc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    // Attach rejection handler immediately so the rejection is never unhandled
    const rejectAssertion = expect(
      withDevServer(
        { startCommand: 'start', port: 3000, healthPath: '/', cwd: '/tmp' },
        async () => { throw new Error('work exploded'); },
      ),
    ).rejects.toThrow('work exploded');

    await rejectAssertion;
    expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
  });

  it('re-throws the error from the work function', async () => {
    vi.useFakeTimers();
    mockSpawn.mockReturnValue(makeFakeProcess(888));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(
      withDevServer(
        { startCommand: 'start', port: 3000, healthPath: '/', cwd: '/tmp' },
        async () => { throw new Error('something went wrong'); },
      ),
    ).rejects.toThrow('something went wrong');
  });

  it('escalates SIGTERM to SIGKILL after KILL_GRACE_MS on cleanup', async () => {
    vi.useFakeTimers();
    const fakeProc = makeFakeProcess(12345);
    mockSpawn.mockReturnValue(fakeProc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const promise = withDevServer(
      { startCommand: 'start', port: 3000, healthPath: '/', cwd: '/tmp' },
      vi.fn().mockResolvedValue(undefined),
    );
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    // SIGTERM should have been sent
    expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
    // SIGKILL should not yet have been sent (grace period not elapsed)
    expect(killSpy).not.toHaveBeenCalledWith(-12345, 'SIGKILL');

    // Advance past the grace period
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS + 100);
    expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGKILL');
  });
});
