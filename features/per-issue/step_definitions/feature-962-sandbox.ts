/**
 * The throwaway place each job of a regression workflow run happens in. A runner gives a job a
 * fresh checkout of its own, so each job gets one, made like feature-939's (every file
 * `git ls-files --cached --others --exclude-standard` lists, as it stands in the working tree, and
 * no ignored file) and holding the narrowed suite. It has no `node_modules`: the `bun` shadow's
 * `bun install` links the ADW checkout's own, which is why a job that never installs finds none.
 *
 * Every step starts from an environment built from nothing, never from the cucumber process, as
 * feature-939's does.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { RunSandbox } from './feature-939-runner.ts';
import { copyWorkingTree, makeDirectory, realExecutable } from './feature-939-sandbox.ts';
import { writeStandIns } from './feature-962-standIns.ts';
import { writeNarrowedSuite, type SuiteKind } from './feature-962-suite.ts';

export interface JobSandbox extends RunSandbox {
  /** The directory that holds the checkout and everything else of the job. */
  readonly root: string;
  /** Where the `docker` stand-in records its calls. */
  readonly callsPath: string;
}

export interface JobSandboxRequest {
  readonly repoRoot: string;
  /** The directory the run keeps the sandboxes of its jobs in. */
  readonly runRoot: string;
  readonly name: string;
  /** `GITHUB_EVENT_NAME`. */
  readonly eventName: string;
  readonly suite: SuiteKind;
  readonly dockerExitStatus: number;
  /** Links `node_modules` before the first step, where a job's own `bun install` would. */
  readonly linkModules: boolean;
}

interface Layout {
  readonly checkoutDir: string;
  readonly homeDir: string;
  readonly runnerTemp: string;
  readonly binDir: string;
}

export function createRunRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adw-962-'));
}

function layOut(root: string): Layout {
  return {
    checkoutDir: makeDirectory(root, 'checkout'),
    homeDir: makeDirectory(root, 'home'),
    runnerTemp: makeDirectory(root, 'runner-temp'),
    binDir: makeDirectory(root, 'bin'),
  };
}

function environmentFor(layout: Layout, eventName: string, toolDirs: readonly string[]): Record<string, string> {
  return {
    PATH: [...new Set([layout.binDir, ...toolDirs])].join(path.delimiter),
    HOME: layout.homeDir,
    RUNNER_TEMP: layout.runnerTemp,
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKSPACE: layout.checkoutDir,
    GITHUB_EVENT_NAME: eventName,
  };
}

/** Without the ADW checkout's `node_modules` a run would find no tsx, and `bunx` would download it. */
function installedModules(repoRoot: string): string {
  const modules = path.join(repoRoot, 'node_modules');
  if (!fs.existsSync(modules)) throw new Error(`The scenarios need the installed dependencies of the ADW checkout: ${modules} does not exist`);
  return modules;
}

export function createJobSandbox(request: JobSandboxRequest): JobSandbox {
  const root = makeDirectory(request.runRoot, request.name);
  const layout = layOut(root);
  const modules = installedModules(request.repoRoot);
  const realBun = realExecutable('bun');
  const callsPath = path.join(root, 'docker-calls.jsonl');

  copyWorkingTree(request.repoRoot, layout.checkoutDir);
  writeNarrowedSuite(layout.checkoutDir, request.suite);
  if (request.linkModules) fs.symlinkSync(modules, path.join(layout.checkoutDir, 'node_modules'));
  writeStandIns({
    binDir: layout.binDir, realBun, modules, callsPath, builtPath: path.join(root, 'docker-built'), dockerExitStatus: request.dockerExitStatus,
  });

  const toolDirs = [path.dirname(realBun), path.dirname(realExecutable('node')), '/usr/bin', '/bin'];
  return {
    root,
    callsPath,
    checkoutDir: layout.checkoutDir,
    runnerTemp: layout.runnerTemp,
    environment: environmentFor(layout, request.eventName, toolDirs),
  };
}

/** The link to the ADW checkout's `node_modules` is removed on its own first, so that nothing can ever follow it. */
function unlinkModules(sandboxRoot: string): void {
  const link = path.join(sandboxRoot, 'checkout', 'node_modules');
  if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(link);
}

export function removeRunRoot(runRoot: string): void {
  if (!fs.existsSync(runRoot)) return;
  fs.readdirSync(runRoot).forEach(name => unlinkModules(path.join(runRoot, name)));
  fs.rmSync(runRoot, { recursive: true, force: true });
}
