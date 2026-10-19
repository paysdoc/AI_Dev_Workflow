import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { systemDeviceExecutor, type DeviceCommand } from '../deviceExecutor';

const TIMEOUT_MS = 5000;

const shell = (script: string, extra: Partial<DeviceCommand> = {}): DeviceCommand => ({
  argv: ['sh', '-c', script],
  timeoutMs: TIMEOUT_MS,
  ...extra,
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-device-executor-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('systemDeviceExecutor.run', () => {
  it('gives the exit code and one output holding standard output and standard error', async () => {
    const result = await systemDeviceExecutor.run(shell('echo out; echo err >&2; exit 3'));

    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });

  it('writes the input to standard input, which is how avdmanager is told "no" to its hardware-profile question', async () => {
    const result = await systemDeviceExecutor.run(shell('read answer; echo "got $answer"', { input: 'no\n' }));

    expect(result).toEqual({ exitCode: 0, output: 'got no\n' });
  });

  it('closes standard input when there is no input, so that a command that reads it sees end of file at once', async () => {
    const result = await systemDeviceExecutor.run(shell('read answer; echo "got [$answer]"'));

    expect(result).toEqual({ exitCode: 0, output: 'got []\n' });
  });

  it('runs the arguments as given, without a shell to interpret them', async () => {
    const result = await systemDeviceExecutor.run({ argv: ['echo', '$(echo injected); echo also'], timeoutMs: TIMEOUT_MS });

    expect(result).toEqual({ exitCode: 0, output: '$(echo injected); echo also\n' });
  });

  it('resolves, and never rejects, for a program that does not exist: no exit code, and the reason in the output', async () => {
    const result = await systemDeviceExecutor.run({ argv: ['adw-no-such-device-tool'], timeoutMs: TIMEOUT_MS });

    expect(result.exitCode).toBeNull();
    expect(result.output).toContain('ENOENT');
  });

  it('resolves with no exit code when the command outlives its timeout, long before it would have ended', async () => {
    const startedAt = Date.now();

    const result = await systemDeviceExecutor.run({ argv: ['sleep', '5'], timeoutMs: 100 });

    expect(result.exitCode).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });
});

describe('systemDeviceExecutor.start', () => {
  it('creates the directory of the output file, writes the process output to it and reports the exit code', async () => {
    const outputPath = path.join(tmpDir, 'logs', 'emulator.log');

    const started = systemDeviceExecutor.start(['sh', '-c', 'echo started; sleep 0.2'], outputPath);

    expect(await started.exited).toBe(0);
    expect(fs.readFileSync(outputPath, 'utf-8')).toBe('started\n');
  });

  it('does not throw for a program that does not exist: it has exited, with no exit code', async () => {
    const started = systemDeviceExecutor.start(['adw-no-such-device-tool'], path.join(tmpDir, 'missing.log'));

    expect(await started.exited).toBeNull();
  });

  it('does not throw when the output file cannot be created: the process has exited, with no exit code', async () => {
    fs.writeFileSync(path.join(tmpDir, 'blocker'), '');

    const started = systemDeviceExecutor.start(['sleep', '30'], path.join(tmpDir, 'blocker', 'emulator.log'));

    expect(await started.exited).toBeNull();
  });

  it('stops the process and its children when it is killed', async () => {
    const started = systemDeviceExecutor.start(['sh', '-c', 'sleep 30 & wait'], path.join(tmpDir, 'long.log'));
    const startedAt = Date.now();

    started.kill();

    expect(await started.exited).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });

  it('does nothing when it is killed after it has exited', async () => {
    const started = systemDeviceExecutor.start(['true'], path.join(tmpDir, 'done.log'));
    await started.exited;

    expect(() => started.kill()).not.toThrow();
  });
});
