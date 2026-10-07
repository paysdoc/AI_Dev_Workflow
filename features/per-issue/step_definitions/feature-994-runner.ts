/**
 * The stand-in scenario runner of the feature-994 scenarios: the programs on disk, the script that says what they report, and
 * the record of the tags they were asked for. No hooks and no steps: any step file may import it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { runnerProgramSource } from './feature-994-runner-source.ts';

const IMAGE_BYTES_PREFIX = 'image bytes of ';

/** The bytes the stand-in runner writes for an image or any other attachment, so that an upload can be traced to the file. */
export function imageBytes(fileName: string): Buffer {
  return Buffer.from(`${IMAGE_BYTES_PREFIX}${fileName}`);
}

export type CaseOutcome = 'passed' | 'failed' | 'skipped';

export interface ScriptedCase {
  readonly name: string;
  readonly classname: string;
  readonly tags: readonly string[];
  readonly outcome: CaseOutcome;
  /** File names; the runner writes each under the proof directory of the run. */
  readonly attachments: readonly string[];
}

/** What a run of one tag does instead of reporting the cases that carry it. */
export interface TagBehaviour {
  readonly exitCode: number;
  readonly stdout: string;
  /** `empty` is a report without a test case; `none` writes no report. */
  readonly report: 'empty' | 'none';
}

export interface RunnerScript {
  readonly cases: readonly ScriptedCase[];
  /** By tag, with the `@`. */
  readonly overrides: Readonly<Record<string, TagBehaviour>>;
  /** Files every run leaves in its proof directory, attached to no test case. */
  readonly strays: readonly string[];
}

export const EMPTY_SCRIPT: RunnerScript = { cases: [], overrides: {}, strays: [] };

export interface StandInRunner {
  readonly rootDir: string;
  readonly binDir: string;
  /** The program `.adw/commands.md` names for a cli repository. */
  readonly scenarioCommand: string;
  readonly scriptFile: string;
  readonly callsFile: string;
}

const PROGRAMS = ['npm', 'npx', 'scenario-command'] as const;

export function createRunner(): StandInRunner {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-994-runner-'));
  const binDir = path.join(rootDir, 'bin');
  fs.mkdirSync(binDir);
  const runner: StandInRunner = {
    rootDir,
    binDir,
    scenarioCommand: path.join(binDir, 'scenario-command'),
    scriptFile: path.join(rootDir, 'script.json'),
    callsFile: path.join(rootDir, 'calls.jsonl'),
  };
  const source = runnerProgramSource({ scriptFile: runner.scriptFile, callsFile: runner.callsFile, bytesPrefix: IMAGE_BYTES_PREFIX });
  PROGRAMS.forEach(program => fs.writeFileSync(path.join(binDir, program), source, { mode: 0o755 }));
  writeScript(runner, EMPTY_SCRIPT);
  return runner;
}

export function writeScript(runner: StandInRunner, script: RunnerScript): void {
  fs.writeFileSync(runner.scriptFile, JSON.stringify(script));
}

export function disposeRunner(runner: StandInRunner): void {
  fs.rmSync(runner.rootDir, { recursive: true, force: true });
}

/** The tags the runner was asked for, with the `@`, in the order it was asked. */
export function tagsAskedFor(runner: StandInRunner): string[] {
  if (!fs.existsSync(runner.callsFile)) return [];
  const calls = fs.readFileSync(runner.callsFile, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { tag?: string });
  return calls.flatMap(call => (call.tag === undefined ? [] : [`@${call.tag}`]));
}

/** Runs the runner as a repository's scenario command would, for a step that stands for a run that has already happened. */
export function runForTag(runner: StandInRunner, tag: string, reportPath: string, proofDirectory: string): void {
  execFileSync(runner.scenarioCommand, [tag.replace(/^@/, '')], {
    env: { ...process.env, NODE_OPTIONS: '', ADW_JUNIT_REPORT_PATH: reportPath, ADW_PROOF_DIR: proofDirectory },
    stdio: 'ignore',
  });
}

/**
 * The Cucumber run sets `NODE_OPTIONS="--import tsx"`, which every Node child of the code under test inherits and resolves from its
 * own working directory, where tsx is not installed; and `PATH` leads with the runner's programs only while `run` does, so that
 * nothing outside the code under test finds them.
 */
export async function withRunnerOnPath<T>(runner: StandInRunner, run: () => Promise<T>): Promise<T> {
  const savedPath = process.env.PATH;
  const savedOptions = process.env.NODE_OPTIONS;
  process.env.PATH = `${runner.binDir}${path.delimiter}${savedPath ?? ''}`;
  delete process.env.NODE_OPTIONS;
  try {
    return await run();
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedOptions !== undefined) process.env.NODE_OPTIONS = savedOptions;
  }
}
