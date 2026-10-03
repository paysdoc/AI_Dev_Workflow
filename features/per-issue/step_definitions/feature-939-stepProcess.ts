/**
 * One `run:` step the way a runner executes it: the script in a file, started by the shell that
 * GitHub's Linux runners use for it, its output kept in files, killed after 60 seconds, and then
 * what it left in the files that `$GITHUB_ENV`, `$GITHUB_OUTPUT` and `$GITHUB_PATH` name and in
 * the `::error` and `::warning` lines of its stdout.
 */

import { spawn, type ChildProcess } from 'child_process';
import { once } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import type { Shell } from './feature-939-workflow.ts';

export const STEP_TIMEOUT_MS = 60_000;

const SHELL_ARGUMENTS: Readonly<Record<Shell, readonly string[]>> = {
  default: ['-e'],
  bash: ['--noprofile', '--norc', '-eo', 'pipefail'],
};

export interface Annotation {
  readonly level: 'error' | 'warning';
  readonly title: string;
  readonly message: string;
}

export interface ScriptRequest {
  /** The script after its `${{ }}` expressions are expanded. */
  readonly script: string;
  readonly shell: Shell;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  /** Where the step keeps its files, named after `stem`. */
  readonly directory: string;
  readonly stem: string;
}

export interface ScriptOutcome {
  readonly passed: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly annotations: readonly Annotation[];
  readonly env: ReadonlyMap<string, string>;
  readonly outputs: ReadonlyMap<string, string>;
  /** One directory per line of `$GITHUB_PATH`, in file order. */
  readonly path: readonly string[];
}

interface StepFiles {
  readonly script: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly env: string;
  readonly output: string;
  readonly path: string;
}

function filesOf(directory: string, stem: string): StepFiles {
  const file = (extension: string): string => path.join(directory, `${stem}.${extension}`);
  return {
    script: file('sh'), stdout: file('stdout'), stderr: file('stderr'), env: file('env'), output: file('output'), path: file('path'),
  };
}

function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group is gone already.
  }
}

export interface Exit {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

/** Waits for `child` to close; its whole process group is killed once it has run for `timeoutMs`. */
export async function waitForExit(child: ChildProcess, timeoutMs = STEP_TIMEOUT_MS): Promise<Exit> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcessGroup(child.pid);
  }, timeoutMs);
  try {
    const [exitCode] = (await once(child, 'close')) as [number | null];
    return { exitCode, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/** Output goes to files, so a grandchild that outlives the shell can never keep the step waiting. */
async function startShell(args: readonly string[], cwd: string, environment: Readonly<Record<string, string>>, files: StepFiles): Promise<Exit> {
  const stdoutFd = fs.openSync(files.stdout, 'w');
  const stderrFd = fs.openSync(files.stderr, 'w');
  try {
    const child = spawn('bash', [...args], { cwd, env: environment, detached: true, stdio: ['ignore', stdoutFd, stderrFd] });
    return await waitForExit(child);
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf-8').split('\n').map(line => line.replace(/\r$/, '')).filter(line => line !== '');
}

function assignmentOf(source: string): (line: string) => [string, string] {
  return line => {
    const assignment = /^([A-Za-z_]\w*)=(.*)$/.exec(line);
    if (assignment === null) throw new Error(`Unsupported line in ${source}: ${line}`);
    return [assignment[1], assignment[2]];
  };
}

const decode = (value: string): string =>
  value.replace(/%0D/g, '\r').replace(/%0A/g, '\n').replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%25/g, '%');

function propertyOf(pair: string): [string, string] {
  const separator = pair.indexOf('=');
  return [pair.slice(0, separator).trim(), decode(pair.slice(separator + 1))];
}

const propertiesOf = (text: string): ReadonlyMap<string, string> =>
  new Map(text.split(',').filter(pair => pair.includes('=')).map(propertyOf));

const COMMAND = /^::(error|warning)(?: ([^:]*))?::(.*)$/;

function annotationOf(line: string): Annotation[] {
  const command = COMMAND.exec(line.replace(/\r$/, ''));
  if (command === null) return [];
  return [{ level: command[1] as Annotation['level'], title: propertiesOf(command[2] ?? '').get('title') ?? '', message: decode(command[3]) }];
}

export function annotationsIn(stdout: string): Annotation[] {
  return stdout.split('\n').flatMap(annotationOf);
}

export async function runScript(request: ScriptRequest): Promise<ScriptOutcome> {
  const files = filesOf(request.directory, request.stem);
  fs.writeFileSync(files.script, request.script);
  [files.env, files.output, files.path].forEach(file => fs.writeFileSync(file, ''));

  const environment = { ...request.environment, GITHUB_ENV: files.env, GITHUB_OUTPUT: files.output, GITHUB_PATH: files.path };
  const { exitCode, timedOut } = await startShell([...SHELL_ARGUMENTS[request.shell], files.script], request.cwd, environment, files);

  const stdout = fs.readFileSync(files.stdout, 'utf-8');
  const killed = timedOut ? `\nThe runner killed the step after ${STEP_TIMEOUT_MS / 1000} seconds.\n` : '';
  return {
    passed: exitCode === 0 && !timedOut,
    stdout,
    stderr: fs.readFileSync(files.stderr, 'utf-8') + killed,
    annotations: annotationsIn(stdout),
    env: new Map(readLines(files.env).map(assignmentOf('$GITHUB_ENV'))),
    outputs: new Map(readLines(files.output).map(assignmentOf('$GITHUB_OUTPUT'))),
    path: readLines(files.path),
  };
}
