/**
 * The process boundary of the device lifecycle: the one place that runs `avdmanager`, `emulator`, `adb` and
 * `xcrun simctl`. Everything above it is pure decisions over the answers it gives.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { killProcessGroup } from './processKill';

export interface DeviceCommand {
  readonly argv: readonly [string, ...string[]];
  readonly timeoutMs: number;
  /** Written to the command's standard input, which is otherwise closed. */
  readonly input?: string;
}

export interface DeviceCommandResult {
  /** `null` when the command could not start or was killed at its timeout. */
  readonly exitCode: number | null;
  /** Standard output and standard error in arrival order. */
  readonly output: string;
  /** Set only when the program is not on the host's `PATH`, so that the command never ran. */
  readonly programMissing?: true;
}

export interface DeviceProcess {
  /** The exit code, or `null` when the process could not start or was ended by a signal. */
  readonly exited: Promise<number | null>;
  /** Signals the process's whole group; a process that has exited is left alone. */
  kill(): void;
  /** Whether the program is not on the host's `PATH`; known once `exited` has settled. */
  programMissing(): boolean;
  /** What the process has written to its output file so far. Never rejects. */
  output(): Promise<string>;
}

/**
 * `run` never rejects and `start` never throws: a failure to run is an answer, for the caller to judge. Nothing runs
 * through a shell, so no ADW ID or device-source value can be interpreted. Nothing blocks the event loop: a boot takes
 * minutes, and the orchestrator's heartbeat must keep firing through it.
 */
export interface DeviceExecutor {
  run(command: DeviceCommand): Promise<DeviceCommandResult>;
  /** Starts a long-running process, detached, with its standard output and standard error written to `outputPath`. */
  start(argv: DeviceCommand['argv'], outputPath: string): DeviceProcess;
}

const KILL_GRACE_MS = 5_000;

// An output file that cannot be opened is not a missing tool.
const NEVER_STARTED: DeviceProcess = { exited: Promise.resolve(null), kill: () => undefined, programMissing: () => false, output: async () => '' };

const isProgramMissing = (error: Error): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

function runDeviceCommand({ argv: [program, ...args], timeoutMs, input }: DeviceCommand): Promise<DeviceCommandResult> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(program, args, {
        stdio: 'pipe',
        env: process.env,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
      });

      // One buffer in arrival order, as `runShellCommand` keeps it.
      const chunks: string[] = [];
      const collect = (data: Buffer): void => {
        chunks.push(data.toString());
      };
      proc.stdout.on('data', collect);
      proc.stderr.on('data', collect);

      // A command that cannot be spawned reports here, and a close event may follow it; the first of the two settles the promise.
      proc.on('error', (error) => {
        const output = [...chunks, String(error)].join('');
        resolve(isProgramMissing(error) ? { exitCode: null, output, programMissing: true } : { exitCode: null, output });
      });
      proc.on('close', (exitCode) => resolve({ exitCode, output: chunks.join('') }));

      // A command that exits without reading its input has answered; the broken pipe is not a failure of ours.
      proc.stdin.on('error', () => undefined);
      proc.stdin.end(input);
    } catch (error) {
      resolve({ exitCode: null, output: String(error) });
    }
  });
}

function launch([program, ...args]: DeviceCommand['argv'], outputPath: string): DeviceProcess {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const outputFd = fs.openSync(outputPath, 'w');
  let proc: ChildProcess;
  try {
    proc = spawn(program, args, { detached: true, stdio: ['ignore', outputFd, outputFd], env: process.env });
  } finally {
    fs.closeSync(outputFd);
  }
  proc.unref();

  let hasExited = false;
  let missing = false;
  const exited = new Promise<number | null>((resolve) => {
    proc.on('exit', (code) => {
      hasExited = true;
      resolve(code);
    });
    proc.on('error', (error) => {
      missing = isProgramMissing(error);
      resolve(null);
    });
  });
  const kill = (): void => {
    if (hasExited || proc.pid === undefined) return;
    killProcessGroup(proc.pid, KILL_GRACE_MS);
  };
  const output = (): Promise<string> => fs.promises.readFile(outputPath, 'utf-8').catch(() => '');
  return { exited, kill, programMissing: () => missing, output };
}

function startDeviceProcess(argv: DeviceCommand['argv'], outputPath: string): DeviceProcess {
  try {
    return launch(argv, outputPath);
  } catch {
    return NEVER_STARTED;
  }
}

export const systemDeviceExecutor: DeviceExecutor = { run: runDeviceCommand, start: startDeviceProcess };
