/**
 * The `docker` a workflow run finds on its PATH. NEVER THE REAL DOCKER: it never builds, pulls or
 * runs an image. It records every call with its arguments and working directory. `build` succeeds
 * and marks the image built, `image inspect` succeeds once the image is built, and `run` exits with
 * the scripted status. Like Docker, `run` refuses a volume or mount whose target lies inside a
 * read-only bind mount when the bind's source has no entry at that path, because the mount point
 * cannot be made there: it writes Docker's "read-only file system" error to stderr and exits 125.
 * `run` understands `-v`, `--volume`, `--mount` and `--tmpfs`, and records the mounts it read. An
 * option or a mount type it does not know is recorded as `unsupported` and fails the call, so that
 * no new kind of mount goes unseen.
 */

import * as fs from 'fs';

export interface DockerMount {
  readonly type: 'bind' | 'volume' | 'tmpfs';
  /** The host path of a bind mount, or the name of a named volume; `null` for an anonymous volume and a tmpfs. */
  readonly source: string | null;
  readonly target: string;
  readonly readOnly: boolean;
}

export interface DockerCall {
  readonly args: readonly string[];
  readonly cwd: string;
  /** Only a `docker run` records the mounts it was given. */
  readonly mounts?: readonly DockerMount[];
  /** The first option or mount type of a `docker run` that the stand-in does not understand. */
  readonly unsupported?: string;
}

export interface DockerStandInPaths {
  /** One JSON line per call, in the order of the calls. */
  readonly callsPath: string;
  /** Exists once `docker build` ran. */
  readonly builtPath: string;
}

export function readDockerCalls(callsPath: string): DockerCall[] {
  if (!fs.existsSync(callsPath)) return [];
  return fs.readFileSync(callsPath, 'utf-8').split('\n').filter(line => line !== '').map(line => JSON.parse(line) as DockerCall);
}

/** The script, which `runStatus` is the exit status of a `docker run` that is not refused. */
export function dockerStandInSource(paths: DockerStandInPaths, runStatus: number): string {
  return String.raw`#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const CALLS = ${JSON.stringify(paths.callsPath)};
const BUILT = ${JSON.stringify(paths.builtPath)};
const RUN_STATUS = ${runStatus};

// How many words each option of "docker run" takes after itself.
const ARITY = {
  '--rm': 0, '--init': 0, '-i': 0, '-t': 0, '-it': 0, '--interactive': 0, '--tty': 0,
  '-v': 1, '--volume': 1, '--mount': 1, '--tmpfs': 1, '-e': 1, '--env': 1, '--entrypoint': 1,
  '-w': 1, '--workdir': 1, '--name': 1, '-u': 1, '--user': 1,
};
const MOUNT_TYPES = ['bind', 'volume', 'tmpfs'];

function record(call) {
  const entry = Object.assign({ args: process.argv.slice(2), cwd: process.cwd() }, call);
  fs.appendFileSync(CALLS, JSON.stringify(entry) + '\n');
}

function splitOptions(args) {
  const options = [];
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const argument = args[index];
    const equals = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const name = equals === -1 ? argument : argument.slice(0, equals);
    if (!(name in ARITY)) return { options: options, image: null, unsupported: argument };
    if (ARITY[name] === 0) {
      options.push({ name: name, value: '' });
      index += 1;
    } else if (equals !== -1) {
      options.push({ name: name, value: argument.slice(equals + 1) });
      index += 1;
    } else {
      options.push({ name: name, value: args[index + 1] === undefined ? '' : args[index + 1] });
      index += 2;
    }
  }
  return { options: options, image: args[index] === undefined ? null : args[index], unsupported: undefined };
}

function volumeMount(spec) {
  const parts = spec.split(':');
  if (parts.length === 1) return { type: 'volume', source: null, target: parts[0], readOnly: false };
  const isPath = ['/', '.', '~'].some(function (start) { return parts[0].startsWith(start); });
  return { type: isPath ? 'bind' : 'volume', source: parts[0], target: parts[1], readOnly: (parts[2] || '').split(',').includes('ro') };
}

function fieldsOf(spec) {
  return new Map(spec.split(',').map(function (part) {
    const equals = part.indexOf('=');
    return equals === -1 ? [part, 'true'] : [part.slice(0, equals), part.slice(equals + 1)];
  }));
}

function firstOf(fields, names) {
  const found = names.find(function (name) { return fields.has(name); });
  return found === undefined ? null : fields.get(found);
}

function typedMount(spec) {
  const fields = fieldsOf(spec);
  const type = firstOf(fields, ['type']) || 'volume';
  const source = firstOf(fields, ['source', 'src']);
  const target = firstOf(fields, ['target', 'destination', 'dst']);
  const flag = firstOf(fields, ['readonly', 'ro']);
  if (!MOUNT_TYPES.includes(type)) return { unsupported: 'a mount of type ' + type };
  if (target === null || (type === 'bind' && source === null)) return { unsupported: 'the mount ' + spec };
  return { type: type, source: type === 'tmpfs' ? null : source, target: target, readOnly: flag === 'true' || flag === '1' };
}

function tmpfsMount(spec) {
  const parts = spec.split(':');
  return { type: 'tmpfs', source: null, target: parts[0], readOnly: (parts[1] || '').split(',').includes('ro') };
}

function mountOf(option) {
  if (option.name === '-v' || option.name === '--volume') return volumeMount(option.value);
  if (option.name === '--mount') return typedMount(option.value);
  if (option.name === '--tmpfs') return tmpfsMount(option.value);
  return null;
}

function unsupportedIn(parsed, mounts) {
  if (parsed.unsupported !== undefined) return parsed.unsupported;
  const found = mounts.find(function (mount) { return mount.unsupported !== undefined; });
  return found === undefined ? undefined : found.unsupported;
}

// The mount point of a mount inside a read-only bind mount must already be an entry of the bind's source.
function lacksMountPoint(mount, mounts) {
  return mounts.some(function (bind) {
    if (bind.type !== 'bind' || !bind.readOnly) return false;
    const inside = path.posix.relative(bind.target, mount.target);
    if (inside === '' || inside.startsWith('..')) return false;
    return fs.lstatSync(path.join(path.resolve(bind.source), inside), { throwIfNoEntry: false }) === undefined;
  });
}

function run(args) {
  const parsed = splitOptions(args);
  const mounts = parsed.options.map(mountOf).filter(function (mount) { return mount !== null; });
  const unsupported = unsupportedIn(parsed, mounts);
  if (unsupported !== undefined) {
    record({ mounts: [], unsupported: unsupported });
    process.stderr.write('docker stand-in: unsupported: ' + unsupported + '\n');
    process.exitCode = 2;
    return;
  }
  const refused = mounts.find(function (mount) { return lacksMountPoint(mount, mounts); });
  record({ mounts: mounts });
  if (refused !== undefined) {
    process.stderr.write('docker: Error response from daemon: failed to create task for container: error mounting "' + refused.target + '": mkdir ' + refused.target + ': read-only file system\n');
    process.exitCode = 125;
    return;
  }
  process.exitCode = RUN_STATUS;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'run') return run(args.slice(1));
  record({});
  if (args[0] === 'build') fs.writeFileSync(BUILT, '');
  if (args[0] === 'image' && args[1] === 'inspect' && !fs.existsSync(BUILT)) {
    process.stderr.write('Error: No such image: ' + args.slice(2).join(' ') + '\n');
    process.exitCode = 1;
  }
}

main();
`;
}
