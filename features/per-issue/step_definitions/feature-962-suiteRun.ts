/**
 * The host job's command run on its own in a checkout, with every path of the checkout listed
 * before and after it. Its output goes to a file outside the checkout, so that keeping it adds no
 * path, and a run that outlives `timeoutMs` is killed with everything it started.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { waitForExit } from './feature-939-stepProcess.ts';
import type { JobSandbox } from './feature-962-sandbox.ts';

export const HOST_COMMAND = 'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"';

export interface SuiteRun {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly output: string;
  readonly pathsBefore: readonly string[];
  readonly pathsAfter: readonly string[];
}

/** Every path under `directory`, directories included, ignored or not. `node_modules` is listed, but never entered. */
export function listPaths(directory: string, prefix = ''): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    if (!entry.isDirectory() || entry.name === 'node_modules') return [relative];
    return [relative, ...listPaths(path.join(directory, entry.name), relative)];
  });
}

async function runCommand(sandbox: JobSandbox, timeoutMs: number): Promise<Pick<SuiteRun, 'exitCode' | 'timedOut' | 'output'>> {
  const outputPath = path.join(sandbox.root, 'suite-output.txt');
  const outputFd = fs.openSync(outputPath, 'w');
  try {
    const child = spawn('bash', ['-e', '-c', HOST_COMMAND], {
      cwd: sandbox.checkoutDir,
      env: sandbox.environment,
      detached: true,
      stdio: ['ignore', outputFd, outputFd],
    });
    const { exitCode, timedOut } = await waitForExit(child, timeoutMs);
    return { exitCode, timedOut, output: fs.readFileSync(outputPath, 'utf-8') };
  } finally {
    fs.closeSync(outputFd);
  }
}

export async function runSuite(sandbox: JobSandbox, timeoutMs: number): Promise<SuiteRun> {
  const pathsBefore = listPaths(sandbox.checkoutDir);
  const run = await runCommand(sandbox, timeoutMs);
  return { ...run, pathsBefore, pathsAfter: listPaths(sandbox.checkoutDir) };
}
