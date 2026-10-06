/**
 * Stand-ins for `npm`, `npx`, a scenario command and a dev server, which lead `PATH` while the code under test runs, so
 * that no scenario but the fresh-repository one reaches the npm registry or downloads a browser. Each run of `npm`, `npx`
 * or the scenario command appends what it was given (argv, working directory, the `ADW_` variables, the packages the
 * `package.json` beside it names) to one file, which the scenarios read back. No hooks and no steps: any step file may import it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { syncDeclaredScenarioProject, type ScenarioProjectSyncResult } from '../../../adws/phases/scenarioProjectSetup.ts';

import { devServerSource, toolSource, type DevServerConfig } from './feature-992-standin-source.ts';

export interface StandInBehaviour {
  /** Tags (without the `@`) whose JUnit report carries one failing scenario. */
  failingTags: string[];
  playwrightExitCode: number;
  /** The health check path the stand-in `npx playwright test` asks the dev server for, before and after it holds. */
  probePath: string;
  holdMs: number;
  devServer: DevServerConfig;
}

export function defaultBehaviour(): StandInBehaviour {
  return {
    failingTags: [],
    playwrightExitCode: 0,
    probePath: '/health',
    holdMs: 300,
    devServer: { title: 'Stand-in application', healthPath: '/health', healthStatus: 200 },
  };
}

export interface StandIns {
  readonly rootDir: string;
  readonly binDir: string;
  readonly callsFile: string;
  readonly serverLog: string;
  readonly serverScript: string;
  readonly scenarioCommand: string;
}

/** One run of `npm`, `npx` or the scenario command. */
export interface RecordedCall {
  readonly tool: 'npm' | 'npx' | 'scenario-command';
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** The packages the `package.json` in the working directory named when the run started. */
  readonly packages: readonly string[];
  readonly tag?: string;
  /** What the dev server answered the stand-in `npx playwright test` before and after it held; absent when no address was given. */
  readonly probes?: readonly { readonly phase: 'start' | 'end'; readonly status: number | null }[];
}

/** Which `npm` and `npx` the code under test finds: the stand-ins, unless the fresh-repository scenario asked for the real ones. */
export const toolchain: { real: boolean; behaviour: StandInBehaviour } = { real: false, behaviour: defaultBehaviour() };

export function resetToolchain(): void {
  toolchain.real = false;
  toolchain.behaviour = defaultBehaviour();
}

let current: StandIns | null = null;

function createStandIns(): StandIns {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-992-standins-'));
  const binDir = path.join(rootDir, 'bin');
  fs.mkdirSync(binDir);
  return {
    rootDir,
    binDir,
    callsFile: path.join(rootDir, 'calls.jsonl'),
    serverLog: path.join(rootDir, 'dev-server.log'),
    serverScript: path.join(rootDir, 'dev-server.cjs'),
    scenarioCommand: path.join(binDir, 'scenario-command'),
  };
}

/** The scenario's stand-ins, made on first use so that their paths are known before the programs are written. */
export function standIns(): StandIns {
  current ??= createStandIns();
  return current;
}

export function disposeStandIns(): void {
  if (current) fs.rmSync(current.rootDir, { recursive: true, force: true });
  current = null;
}

/** Safe to call twice: a scenario that carries the tags of two features runs the hooks of both. */
export function disposeToolchain(): void {
  disposeStandIns();
  resetToolchain();
}

/** Writes the programs as `toolchain.behaviour` says; a scenario that changes the behaviour writes them again before the run. */
export function writeStandIns(): StandIns {
  const si = standIns();
  const { behaviour } = toolchain;
  for (const name of ['npm', 'npx', 'scenario-command']) {
    const program = path.join(si.binDir, name);
    fs.writeFileSync(program, toolSource({ callsFile: si.callsFile, failingTags: behaviour.failingTags, playwrightExitCode: behaviour.playwrightExitCode, probePath: behaviour.probePath, holdMs: behaviour.holdMs }), { mode: 0o755 });
  }
  fs.writeFileSync(si.serverScript, devServerSource(behaviour.devServer));
  return si;
}

/** The command `## Start Dev Server` names: the stand-in dev server on the port the dev server lifecycle substitutes. */
export function devServerCommand(): string {
  const si = standIns();
  return `"${process.execPath}" "${si.serverScript}" {PORT} "${si.serverLog}"`;
}

/**
 * The Cucumber run sets `NODE_OPTIONS="--import tsx"`, which every Node child of the code under test inherits and resolves from
 * its own working directory, where tsx is not installed. A child of `npm`, `npx` or a dev server would die on it, so it is
 * cleared while `run` does.
 */
async function withoutNodeOptions<T>(run: () => Promise<T>): Promise<T> {
  const saved = process.env.NODE_OPTIONS;
  delete process.env.NODE_OPTIONS;
  try {
    return await run();
  } finally {
    if (saved !== undefined) process.env.NODE_OPTIONS = saved;
  }
}

/** `PATH` leads with the stand-ins only while `run` does, so that nothing outside the code under test finds them. */
export function withStandInsOnPath<T>(si: StandIns, run: () => Promise<T>): Promise<T> {
  return withoutNodeOptions(async () => {
    const saved = process.env.PATH;
    process.env.PATH = `${si.binDir}${path.delimiter}${saved ?? ''}`;
    try {
      return await run();
    } finally {
      if (saved === undefined) delete process.env.PATH;
      else process.env.PATH = saved;
    }
  });
}

/** The real `npm` and `npx`, as the fresh-repository scenario runs them. */
export function withRealToolchain<T>(run: () => Promise<T>): Promise<T> {
  return withoutNodeOptions(run);
}

export function recordedCalls(): RecordedCall[] {
  if (!current || !fs.existsSync(current.callsFile)) return [];
  return fs.readFileSync(current.callsFile, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordedCall);
}

/** What the stand-in dev server logged: `listening <port>`, `GET <path>` for each request, `stopped`. */
export function devServerLog(logFile: string = standIns().serverLog): string[] {
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean) : [];
}

export function commandLine(call: RecordedCall): string {
  return [call.tool, ...call.argv].join(' ');
}

export function realPath(directory: string): string {
  return fs.realpathSync(directory);
}

/** The upgrade's sync of ADW's Playwright project, run as the scenario's toolchain says: under the stand-ins, or with the real `npm`. */
export function syncProjectUnderToolchain(worktreePath: string, frameworkRepoRoot: string): Promise<ScenarioProjectSyncResult> {
  const sync = (): Promise<ScenarioProjectSyncResult> => syncDeclaredScenarioProject(worktreePath, frameworkRepoRoot);
  return toolchain.real ? withRealToolchain(sync) : withStandInsOnPath(writeStandIns(), sync);
}
