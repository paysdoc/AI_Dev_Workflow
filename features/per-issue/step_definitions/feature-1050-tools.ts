/**
 * Stand-ins for the host's device tools, `avdmanager`, `emulator`, `adb` and `xcrun`, as programs that lead `PATH` while the cron
 * polls. The cron's own device janitor runs these tools by name through the lifecycle's executor, so it reaches the stand-ins and
 * never the host's real tools. Each program hands its argv over a loopback connection to a stand-in host that holds the devices of
 * the scenario's table; the host records the run, applies it to those devices and answers it, and the program prints the answer and
 * exits with its code. Only the programs reach the host, so what it recorded and still holds is what the programs were run with and
 * left. No hooks and no steps: any step file may import it.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { text } from 'stream/consumers';

import { withStandInsOnPath } from '../../regression/step_definitions/feature-992-standins.ts';
import { standInDeviceExecutor, type StandInDeviceCommand, type StandInDeviceExecutor, type StandInHeldDevices, type StandInLeftoverDevice } from '../../regression/support/standInDevices.ts';

const DEVICE_TOOL_PROGRAMS = ['avdmanager', 'emulator', 'adb', 'xcrun'];

export interface StandInDeviceTools {
  readonly rootDir: string;
  readonly binDir: string;
  /** Each run of a stand-in program, in the order run. */
  readonly runs: readonly StandInDeviceCommand[];
  /** The devices of the scenario's table, before any run. */
  readonly leftovers: StandInHeldDevices;
  held(): StandInHeldDevices;
  /** Runs `run` while the programs lead `PATH`; outside it no program is on `PATH` and none is answered. */
  onPath<T>(run: () => Promise<T>): Promise<T>;
}

interface Relay {
  readonly server: http.Server;
  readonly port: number;
}

// Plain `var` source, so that the relay runs under the Node the suite runs under with no loader.
const relaySource = (port: number): string => `'use strict';
var http = require('http');
var argv = process.argv.slice(2);
var request = http.request({ host: '127.0.0.1', port: ${port}, method: 'POST', agent: false }, function (response) {
  var chunks = [];
  response.on('data', function (chunk) { chunks.push(chunk); });
  response.on('end', function () {
    var answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    process.stdout.write(answer.output);
    process.exitCode = answer.exitCode === null ? 1 : answer.exitCode;
  });
});
request.on('error', function (error) {
  process.stderr.write('stand-in ' + argv[0] + ': the scenario did not answer: ' + error.message + '\\n');
  process.exitCode = 1;
});
request.end(JSON.stringify({ argv: argv }));
`;

// A shebang cannot carry a path with spaces, so each program is a shell script that hands its name and its arguments to the relay.
const programSource = (program: string, relay: string): string => `#!/bin/sh\nexec '${process.execPath}' '${relay}' '${program}' "$@"\n`;

const isArgv = (value: unknown): value is [string, ...string[]] =>
  Array.isArray(value) && value.length > 0 && value.every(word => typeof word === 'string');

async function answerRun(host: StandInDeviceExecutor, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const { argv } = JSON.parse(await text(request)) as { readonly argv?: unknown };
  if (!isArgv(argv)) {
    response.end(JSON.stringify({ exitCode: 1, output: 'stand-in: the program sent no argv\n' }));
    return;
  }
  // The executor that ran the program holds it to the command's timeout; the stand-in host answers at once.
  const { exitCode, output } = await host.executor.run({ argv, timeoutMs: 0 });
  response.end(JSON.stringify({ exitCode, output }));
}

async function startRelay(host: StandInDeviceExecutor): Promise<Relay> {
  const server = http.createServer((request, response) => {
    void answerRun(host, request, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object', 'Expected the relay of the stand-in device tools to listen on a port');
  return { server, port: address.port };
}

function closeRelay({ server }: Relay): Promise<void> {
  server.closeAllConnections();
  return new Promise(resolve => server.close(() => resolve()));
}

function writePrograms(rootDir: string, binDir: string, port: number): void {
  const relay = path.join(rootDir, 'relay.cjs');
  fs.writeFileSync(relay, relaySource(port));
  DEVICE_TOOL_PROGRAMS.forEach(program => fs.writeFileSync(path.join(binDir, program), programSource(program, relay), { mode: 0o755 }));
}

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** What a spawn of the program by its name runs: the first executable of that name on `PATH`. */
function resolvedOnPath(program: string): string | undefined {
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, program)).find(isExecutableFile);
}

function assertLeadPath(binDir: string): void {
  DEVICE_TOOL_PROGRAMS.forEach((program) => {
    assert.strictEqual(resolvedOnPath(program), path.join(binDir, program), `Expected the stand-in "${program}" to lead PATH, so that the host's own is never run; PATH is ${process.env.PATH}`);
  });
}

export function standInDeviceTools(devices: readonly StandInLeftoverDevice[]): StandInDeviceTools {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-1050-device-tools-'));
  const binDir = path.join(rootDir, 'bin');
  fs.mkdirSync(binDir);
  const host = standInDeviceExecutor({ devices });

  async function onPath<T>(run: () => Promise<T>): Promise<T> {
    const relay = await startRelay(host);
    try {
      writePrograms(rootDir, binDir, relay.port);
      return await withStandInsOnPath({ binDir }, () => {
        assertLeadPath(binDir);
        return run();
      });
    } finally {
      await closeRelay(relay);
    }
  }

  return { rootDir, binDir, runs: host.commands, leftovers: host.leftovers, held: host.held, onPath };
}
