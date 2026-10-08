import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChildProcess } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import {
  devServerPort,
  isDevServerConfigured,
  spawnServer,
  withHealthyDevServer,
  KILL_GRACE_MS,
  MAX_START_ATTEMPTS,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  type DevServerLifecycleDeps,
  type HealthyDevServerConfig,
} from '../devServerLifecycle';

const mockSpawn = vi.mocked(spawn);

const pidOf = (attempt: number): number => 100 + attempt;
const lastAttemptOutput = `attempt-${MAX_START_ATTEMPTS}\n`;

const isOpen = (fd: number): boolean => {
  try {
    fs.fstatSync(fd);
    return true;
  } catch {
    return false;
  }
};

interface HarnessOptions {
  readonly healthyAttempt?: number;
  readonly pollsUntilGone?: number;
  readonly pidlessAttempt?: number;
}

function makeHarness({ healthyAttempt, pollsUntilGone = 0, pidlessAttempt }: HarnessOptions = {}) {
  const events: string[] = [];
  const outputFdOpenAtProbe: boolean[] = [];
  let pollsLeft = 0;
  let attempt = 0;
  let outputFd = -1;

  const deps = {
    spawn: vi.fn<DevServerLifecycleDeps['spawn']>((_command, _cwd, fd) => {
      attempt += 1;
      outputFd = fd;
      fs.writeSync(fd, `attempt-${attempt}\n`);
      events.push(`spawn ${attempt}`);
      return (attempt === pidlessAttempt ? {} : { pid: pidOf(attempt) }) as unknown as ChildProcess;
    }),
    probe: vi.fn<DevServerLifecycleDeps['probe']>(async () => {
      events.push(`probe ${attempt}`);
      outputFdOpenAtProbe.push(isOpen(outputFd));
      return attempt === healthyAttempt;
    }),
    kill: vi.fn<DevServerLifecycleDeps['kill']>(pid => {
      events.push(`kill ${pid}`);
      pollsLeft = pollsUntilGone;
    }),
    alive: vi.fn<DevServerLifecycleDeps['alive']>(pid => {
      const running = pollsLeft > 0;
      pollsLeft -= 1;
      events.push(`alive ${pid} ${running}`);
      return running;
    }),
  };
  const work = vi.fn(async () => {
    events.push('work');
    return 'done';
  });
  return { deps, events, outputFdOpenAtProbe, work };
}

const fakeProcess = (): ChildProcess => ({ pid: 4242, unref: vi.fn() }) as unknown as ChildProcess;

let tmpDir: string;
let outputPath: string;

const makeConfig = (): HealthyDevServerConfig => ({
  startCommand: 'bun run dev --port {PORT}',
  port: 4123,
  healthPath: '/health',
  cwd: '/checkout',
  outputPath,
});

beforeEach(() => {
  mockSpawn.mockReset();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-healthy-dev-server-'));
  outputPath = path.join(tmpDir, 'logs', 'server.log');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('withHealthyDevServer — a server that starts', () => {
  it('runs work once on a healthy first attempt and stops the server after it', async () => {
    const { deps, events, work } = makeHarness({ healthyAttempt: 1 });

    const outcome = await withHealthyDevServer(makeConfig(), work, deps);

    expect(outcome).toEqual({ started: true, result: 'done' });
    expect(work).toHaveBeenCalledOnce();
    expect(deps.kill.mock.calls).toEqual([[pidOf(1), KILL_GRACE_MS]]);
    expect(events).toEqual(['spawn 1', 'probe 1', 'work', 'kill 101', 'alive 101 false']);
  });

  it('stops each unhealthy attempt, and waits until it is gone, before spawning the next', async () => {
    const { deps, events, work } = makeHarness({ healthyAttempt: 3, pollsUntilGone: 1 });

    const promise = withHealthyDevServer(makeConfig(), work, deps);
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ started: true, result: 'done' });
    expect(events).toEqual([
      'spawn 1', 'probe 1', 'kill 101', 'alive 101 true', 'alive 101 false',
      'spawn 2', 'probe 2', 'kill 102', 'alive 102 true', 'alive 102 false',
      'spawn 3', 'probe 3', 'work', 'kill 103', 'alive 103 true', 'alive 103 false',
    ]);
  });

  it('substitutes {PORT} into the start command and probes localhost on that port', async () => {
    const { deps, work } = makeHarness({ healthyAttempt: 1 });

    await withHealthyDevServer(makeConfig(), work, deps);

    expect(deps.spawn).toHaveBeenCalledWith('bun run dev --port 4123', '/checkout', expect.any(Number));
    expect(deps.probe).toHaveBeenCalledWith('http://localhost:4123/health', PROBE_INTERVAL_MS, PROBE_TIMEOUT_MS);
  });

  it('closes its descriptor on the output file right after spawning, before probing', async () => {
    const { deps, outputFdOpenAtProbe, work } = makeHarness({ healthyAttempt: 1 });

    await withHealthyDevServer(makeConfig(), work, deps);

    expect(outputFdOpenAtProbe).toEqual([false]);
  });

  it('stops the server, and waits for it, when work throws', async () => {
    const { deps, events } = makeHarness({ healthyAttempt: 1, pollsUntilGone: 1 });
    const failing = vi.fn(async () => {
      events.push('work');
      throw new Error('work exploded');
    });

    const assertion = expect(withHealthyDevServer(makeConfig(), failing, deps)).rejects.toThrow('work exploded');
    await vi.runAllTimersAsync();
    await assertion;

    expect(events).toEqual(['spawn 1', 'probe 1', 'work', 'kill 101', 'alive 101 true', 'alive 101 false']);
  });
});

describe('withHealthyDevServer — waiting for the group to stop', () => {
  it('resolves only once the group has stopped answering', async () => {
    const { deps, work } = makeHarness({ healthyAttempt: 1, pollsUntilGone: 2 });
    const settled = vi.fn();

    withHealthyDevServer(makeConfig(), work, deps).then(settled);
    await vi.advanceTimersByTimeAsync(2 * PROBE_INTERVAL_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    expect(deps.alive).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(deps.alive).toHaveBeenCalledTimes(3);
    expect(settled).toHaveBeenCalledOnce();
  });

  it('gives up on a group that never goes after KILL_GRACE_MS + PROBE_INTERVAL_MS, without an error', async () => {
    const { deps, work } = makeHarness({ healthyAttempt: 1, pollsUntilGone: Infinity });
    const settled = vi.fn();

    withHealthyDevServer(makeConfig(), work, deps).then(settled);
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS + PROBE_INTERVAL_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith({ started: true, result: 'done' });
  });
});

describe('withHealthyDevServer — a server that does not start', () => {
  it('returns started:false with only the last attempt\'s output, without running work', async () => {
    const { deps, work } = makeHarness();

    const outcome = await withHealthyDevServer(makeConfig(), work, deps);

    expect(outcome).toEqual({ started: false, output: lastAttemptOutput });
    expect(fs.readFileSync(outputPath, 'utf-8')).toBe(lastAttemptOutput);
    expect(work).not.toHaveBeenCalled();
    expect(deps.spawn).toHaveBeenCalledTimes(MAX_START_ATTEMPTS);
    expect(deps.kill.mock.calls).toEqual(
      Array.from({ length: MAX_START_ATTEMPTS }, (_, i) => [pidOf(i + 1), KILL_GRACE_MS]),
    );
  });

  it('reads the output only after the last attempt is gone, so the last words are in it', async () => {
    const { deps, work } = makeHarness({ pollsUntilGone: 1 });
    const alive: DevServerLifecycleDeps['alive'] = pid => {
      const running = deps.alive(pid);
      if (!running) fs.appendFileSync(outputPath, `farewell-${pid}\n`);
      return running;
    };

    const promise = withHealthyDevServer(makeConfig(), work, { ...deps, alive });
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({
      started: false,
      output: `${lastAttemptOutput}farewell-${pidOf(MAX_START_ATTEMPTS)}\n`,
    });
  });

  it('treats a spawn without a pid as unhealthy: it is neither probed nor killed', async () => {
    const { deps, events, work } = makeHarness({ healthyAttempt: 2, pidlessAttempt: 1 });

    const outcome = await withHealthyDevServer(makeConfig(), work, deps);

    expect(outcome).toEqual({ started: true, result: 'done' });
    expect(events).toEqual(['spawn 1', 'spawn 2', 'probe 2', 'work', 'kill 102', 'alive 102 false']);
  });
});

describe('withHealthyDevServer — default dependencies', () => {
  it('spawns into the output file, probes over HTTP, and signals the group until it is gone', async () => {
    mockSpawn.mockReturnValue(fakeProcess());
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    let answersLeft = 2;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal !== 0) return true;
      if (answersLeft === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      answersLeft -= 1;
      return true;
    });

    const promise = withHealthyDevServer(makeConfig(), async () => 'done');
    await vi.advanceTimersByTimeAsync(2 * PROBE_INTERVAL_MS);

    expect(await promise).toEqual({ started: true, result: 'done' });
    expect(mockSpawn).toHaveBeenCalledWith(
      'bun run dev --port 4123',
      [],
      expect.objectContaining({ cwd: '/checkout', stdio: ['ignore', expect.any(Number), expect.any(Number)] }),
    );
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4123/health');
    expect(killSpy.mock.calls).toEqual([[-4242, 'SIGTERM'], [-4242, 0], [-4242, 0], [-4242, 0]]);
  });
});

describe('spawnServer output', () => {
  it('ignores the output by default and sends stdout and stderr to a given descriptor', () => {
    mockSpawn.mockReturnValue(fakeProcess());

    spawnServer('bun run dev', '/tmp');
    spawnServer('bun run dev', '/tmp', 7);

    expect(mockSpawn.mock.calls.map(([, , options]) => options?.stdio)).toEqual(['ignore', ['ignore', 7, 7]]);
  });
});

describe('devServerPort', () => {
  it.each<[string, number]>([
    ['http://localhost:4123', 4123],
    ['http://localhost', 3000],
    ['not a url', 3000],
    ['', 3000],
  ])('%j gives port %i', (applicationUrl, expected) => {
    expect(devServerPort(applicationUrl)).toBe(expected);
  });
});

describe('isDevServerConfigured', () => {
  it.each(['N/A', '', '   ', '  N/A \n'])('is false for %j', command => {
    expect(isDevServerConfigured(command)).toBe(false);
  });

  it('is true for a command', () => {
    expect(isDevServerConfigured('bun run dev --port {PORT}')).toBe(true);
  });
});
