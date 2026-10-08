import { describe, it, expect } from 'vitest';
import type { ProcessOutcome, ProcessRunner } from '../checkRunner';
import {
  INSTALL_DEPENDENCIES_CHECK,
  runBaselineChecks,
  type BaselineCommands,
  type BaselineEvent,
  type DevServerStartResult,
} from '../baselineGate';

const CWD = '/repo/.worktrees/base-issue-990-x';

const COMMANDS: BaselineCommands = {
  installDeps: 'install-deps',
  typeCheck: 'tc',
  additionalTypeChecks: 'atc',
  runLinter: 'lint',
  runBuild: 'build',
};

const NO_CHECKS: BaselineCommands = {
  installDeps: 'install-deps',
  typeCheck: 'N/A',
  additionalTypeChecks: 'N/A',
  runLinter: 'N/A',
  runBuild: 'N/A',
};

type Script = Readonly<Record<string, ProcessOutcome | Error>>;

function fakeProcessRunner(script: Script = {}): { runProcess: ProcessRunner; calls: { command: string; cwd: string }[] } {
  const calls: { command: string; cwd: string }[] = [];
  const runProcess: ProcessRunner = async (command, cwd) => {
    calls.push({ command, cwd });
    const scripted = script[command] ?? { exitCode: 0, output: '' };
    if (scripted instanceof Error) throw scripted;
    return scripted;
  };
  return { runProcess, calls };
}

function fakeServer(result: DevServerStartResult): { startDevServer: () => Promise<DevServerStartResult>; started: () => number } {
  let starts = 0;
  return {
    startDevServer: async () => {
      starts += 1;
      return result;
    },
    started: () => starts,
  };
}

describe('runBaselineChecks — green', () => {
  it('installs first, then runs the checks in their fixed order, all in the given directory', async () => {
    const { runProcess, calls } = fakeProcessRunner();

    const verdict = await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess });

    expect(verdict).toEqual({ kind: 'green' });
    expect(calls).toEqual([
      { command: 'install-deps', cwd: CWD },
      { command: 'tc', cwd: CWD },
      { command: 'atc', cwd: CWD },
      { command: 'lint', cwd: CWD },
      { command: 'build', cwd: CWD },
    ]);
  });
});

describe('runBaselineChecks — red checks', () => {
  it('reports the failing check with its command, exit code and output', async () => {
    const { runProcess } = fakeProcessRunner({ lint: { exitCode: 2, output: 'L' } });

    const verdict = await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess });

    expect(verdict).toEqual({
      kind: 'checks_red',
      failed: [{ check: 'lint', command: 'lint', exitCode: 2, output: 'L' }],
    });
  });

  it('reports every failing check, in check order, and still runs the later checks', async () => {
    const { runProcess, calls } = fakeProcessRunner({
      tc: { exitCode: 2, output: 'T' },
      build: { exitCode: 1, output: 'B' },
    });

    const verdict = await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess });

    expect(verdict).toEqual({
      kind: 'checks_red',
      failed: [
        { check: 'type check', command: 'tc', exitCode: 2, output: 'T' },
        { check: 'build', command: 'build', exitCode: 1, output: 'B' },
      ],
    });
    expect(calls.map(call => call.command)).toEqual(['install-deps', 'tc', 'atc', 'lint', 'build']);
  });

  it('does not start the dev server when a check is red', async () => {
    const { runProcess } = fakeProcessRunner({ lint: { exitCode: 1, output: 'L' } });
    const server = fakeServer({ healthy: true, output: '' });

    await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess, startDevServer: server.startDevServer });

    expect(server.started()).toBe(0);
  });

  it('counts a runner that throws as a failed command with no exit code and the error text as output', async () => {
    const { runProcess } = fakeProcessRunner({ lint: new Error('spawn ENOENT') });

    const verdict = await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess });

    expect(verdict).toEqual({
      kind: 'checks_red',
      failed: [{ check: 'lint', command: 'lint', exitCode: null, output: 'Error: spawn ENOENT' }],
    });
  });
});

describe('runBaselineChecks — install', () => {
  it('reports a failed install as the one failure and runs no static check', async () => {
    const { runProcess, calls } = fakeProcessRunner({ 'install-deps': { exitCode: 1, output: 'E404 no such package' } });

    const verdict = await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess });

    expect(verdict).toEqual({
      kind: 'checks_red',
      failed: [{ check: INSTALL_DEPENDENCIES_CHECK, command: 'install-deps', exitCode: 1, output: 'E404 no such package' }],
    });
    expect(calls.map(call => call.command)).toEqual(['install-deps']);
  });

  it('counts an install runner that throws as a failed install', async () => {
    const { runProcess } = fakeProcessRunner({ 'install-deps': new Error('boom') });

    const verdict = await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess });

    expect(verdict).toEqual({
      kind: 'checks_red',
      failed: [{ check: INSTALL_DEPENDENCIES_CHECK, command: 'install-deps', exitCode: null, output: 'Error: boom' }],
    });
  });

  it('installs nothing when the install command is N/A, and still runs the checks', async () => {
    const { runProcess, calls } = fakeProcessRunner();

    const verdict = await runBaselineChecks({ commands: { ...COMMANDS, installDeps: 'N/A' }, cwd: CWD, runProcess });

    expect(verdict).toEqual({ kind: 'green' });
    expect(calls.map(call => call.command)).toEqual(['tc', 'atc', 'lint', 'build']);
  });

  it('installs nothing when no check is configured and no dev server is declared', async () => {
    const { runProcess, calls } = fakeProcessRunner();

    const verdict = await runBaselineChecks({ commands: NO_CHECKS, cwd: CWD, runProcess });

    expect(verdict).toEqual({ kind: 'green' });
    expect(calls).toEqual([]);
  });

  it('installs when no check is configured but a dev server is declared', async () => {
    const { runProcess, calls } = fakeProcessRunner();
    const server = fakeServer({ healthy: true, output: '' });

    await runBaselineChecks({ commands: NO_CHECKS, cwd: CWD, runProcess, startDevServer: server.startDevServer });

    expect(calls.map(call => call.command)).toEqual(['install-deps']);
    expect(server.started()).toBe(1);
  });
});

describe('runBaselineChecks — dev server', () => {
  it('reports a server that is not healthy, with its output', async () => {
    const { runProcess } = fakeProcessRunner();
    const server = fakeServer({ healthy: false, output: 'EADDRINUSE' });

    const verdict = await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess, startDevServer: server.startDevServer });

    expect(verdict).toEqual({ kind: 'server_down', output: 'EADDRINUSE' });
  });

  it('is green when the server is healthy', async () => {
    const { runProcess } = fakeProcessRunner();
    const server = fakeServer({ healthy: true, output: 'ready' });

    const verdict = await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess, startDevServer: server.startDevServer });

    expect(verdict).toEqual({ kind: 'green' });
    expect(server.started()).toBe(1);
  });

  it('starts no server when none is given', async () => {
    const { runProcess } = fakeProcessRunner();
    const server = fakeServer({ healthy: false, output: 'never started' });

    const verdict = await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess });

    expect(verdict).toEqual({ kind: 'green' });
    expect(server.started()).toBe(0);
  });
});

describe('runBaselineChecks — report', () => {
  it('reports the install, the checks and the dev server, in the order they ran', async () => {
    const { runProcess } = fakeProcessRunner();
    const server = fakeServer({ healthy: true, output: 'ready' });
    const events: BaselineEvent[] = [];

    await runBaselineChecks({
      commands: COMMANDS,
      cwd: CWD,
      runProcess,
      startDevServer: server.startDevServer,
      report: event => events.push(event),
    });

    expect(events.map(event => event.kind)).toEqual(['dependencies_installed', 'checks_ran', 'dev_server_checked']);
  });

  it('carries what each step produced', async () => {
    const { runProcess } = fakeProcessRunner({ 'install-deps': { exitCode: 0, output: 'installed' }, lint: { exitCode: 1, output: 'L' } });
    const events: BaselineEvent[] = [];

    await runBaselineChecks({ commands: COMMANDS, cwd: CWD, runProcess, report: event => events.push(event) });

    expect(events[0]).toEqual({ kind: 'dependencies_installed', command: 'install-deps', exitCode: 0, output: 'installed' });
    const ran = events[1];
    expect(ran?.kind).toBe('checks_ran');
    if (ran?.kind !== 'checks_ran') throw new Error('expected checks_ran');
    expect(ran.verdicts.map(verdict => `${verdict.check}:${verdict.status}`)).toEqual([
      'type check:passed',
      'additional type checks:passed',
      'lint:failed',
      'build:passed',
    ]);
  });

  it('reports only the steps that ran', async () => {
    const { runProcess } = fakeProcessRunner({ 'install-deps': { exitCode: 1, output: 'no network' } });
    const server = fakeServer({ healthy: true, output: '' });
    const events: BaselineEvent[] = [];

    await runBaselineChecks({
      commands: COMMANDS,
      cwd: CWD,
      runProcess,
      startDevServer: server.startDevServer,
      report: event => events.push(event),
    });

    expect(events.map(event => event.kind)).toEqual(['dependencies_installed']);
  });

  it('reports the server result', async () => {
    const { runProcess } = fakeProcessRunner();
    const server = fakeServer({ healthy: false, output: 'EADDRINUSE' });
    const events: BaselineEvent[] = [];

    await runBaselineChecks({
      commands: COMMANDS,
      cwd: CWD,
      runProcess,
      startDevServer: server.startDevServer,
      report: event => events.push(event),
    });

    expect(events[events.length - 1]).toEqual({ kind: 'dev_server_checked', result: { healthy: false, output: 'EADDRINUSE' } });
  });
});
