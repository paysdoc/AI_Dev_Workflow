import * as fs from 'fs';
import * as path from 'path';
import { runScenariosByTag } from '../agents/bddScenarioRunner';
import { log, AgentStateManager, AGENTS_STATE_DIR, type LogLevel } from '../core';
import { isCheckConfigured, runShellCommand, type ProcessRunner } from '../core/checkRunner';
import {
  KILL_GRACE_MS,
  PROBE_INTERVAL_MS,
  devServerPort,
  isDevServerConfigured,
  withHealthyDevServer,
} from '../core/devServerLifecycle';
import { isPortAvailable } from '../core/portAllocator';
import { loadProjectConfig, type ProjectConfig } from '../core/projectConfig';
import {
  BaseScenarioOutcome,
  describeFailingScenario,
  scenarioMatchesCase,
  withRerunTag,
  type FailingScenario,
  type ScenarioRerun,
} from '../core/regressionTriage';
import { readJUnitReport } from '../core/testReportParser';
import { parse } from '../promotion/scenarioParser';
import { sharedBaseWorktree, type BaseCheckout, type BaseWorktreePort } from './baseWorktree';
import type { WorkflowConfig } from './workflowInit';

export const BASE_RERUN_TAG = 'adw-base-rerun';

const PORT_WAIT_MS = KILL_GRACE_MS * 2;

export interface BaseScenarioRerunDeps {
  readonly baseWorktree: BaseWorktreePort;
  readonly runProcess: ProcessRunner;
  readonly runScenariosByTag: typeof runScenariosByTag;
  readonly withHealthyDevServer: typeof withHealthyDevServer;
  readonly isPortAvailable: (port: number) => Promise<boolean>;
}

interface PreparedBase {
  readonly checkout: BaseCheckout;
  readonly project: ProjectConfig;
}

interface LocatedScenario {
  readonly file: string;
  readonly name: string;
  readonly headerLine: number;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function featureFilesUnder(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : featureFilesUnder(full);
    return entry.name.endsWith('.feature') ? [full] : [];
  });
}

function featureTitleOf(content: string): string | null {
  return content.match(/^[ \t]*Feature:[ \t]*(.*?)[ \t]*\r?$/m)?.[1] ?? null;
}

/** cucumber-js reports the bare feature name as the classname; other runners prefix it with a package path. */
function featureMatches(classname: string, title: string | null): boolean {
  return title !== null && title !== '' && (classname === title || classname.endsWith(`.${title}`));
}

function scenariosOf(content: string): ReturnType<typeof parse> {
  try {
    return parse(content);
  } catch {
    return [];
  }
}

function matchesInFile(file: string, scenario: FailingScenario): LocatedScenario[] {
  const content = fs.readFileSync(file, 'utf-8');
  if (scenario.feature !== undefined && !featureMatches(scenario.feature, featureTitleOf(content))) return [];
  return scenariosOf(content)
    .filter(candidate => scenarioMatchesCase(candidate.name, scenario.name))
    .map(candidate => ({ file, name: candidate.name, headerLine: candidate.headerLine }));
}

/** Of several scenarios a long case name can match, the one with the longest name is the most specific. */
function locateScenario(base: PreparedBase, scenario: FailingScenario): LocatedScenario | null {
  const directory = path.join(base.checkout.path, base.project.scenarios.scenarioDirectory);
  const matches = featureFilesUnder(directory).flatMap(file => matchesInFile(file, scenario));
  return matches.reduce<LocatedScenario | null>((best, match) => (best === null || match.name.length > best.name.length ? match : best), null);
}

function outcomeFromReport(reportPath: string): BaseScenarioOutcome {
  const report = readJUnitReport(reportPath);
  if (report === null) return BaseScenarioOutcome.NotRun;
  if (report.failed > 0) return BaseScenarioOutcome.Failed;
  return report.passed > 0 ? BaseScenarioOutcome.Passed : BaseScenarioOutcome.NotRun;
}

async function waitForFreePort(port: number, available: (port: number) => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + PORT_WAIT_MS;
  while (!(await available(port))) {
    if (Date.now() >= deadline) return false;
    await sleep(PROBE_INTERVAL_MS);
  }
  return true;
}

export function buildBaseScenarioRerun(config: WorkflowConfig, deps: Partial<BaseScenarioRerunDeps> = {}): ScenarioRerun {
  const baseWorktree = deps.baseWorktree ?? sharedBaseWorktree(config);
  const runProcess = deps.runProcess ?? runShellCommand;
  const runByTag = deps.runScenariosByTag ?? runScenariosByTag;
  const withServer = deps.withHealthyDevServer ?? withHealthyDevServer;
  const portAvailable = deps.isPortAvailable ?? ((port: number) => isPortAvailable(port));
  const baselineDir = path.join(AGENTS_STATE_DIR, config.adwId, 'baseline');

  let prepared: Promise<PreparedBase | null> | undefined;
  let runs = 0;
  const outcomes = new Map<string, Promise<BaseScenarioOutcome>>();

  function record(message: string, level: LogLevel): void {
    log(message, level);
    AgentStateManager.appendLog(config.orchestratorStatePath, message);
  }

  async function prepareBase(): Promise<PreparedBase | null> {
    const checkout = baseWorktree.ensure();
    const project = loadProjectConfig(checkout.path);
    const install = project.commands.installDeps;
    if (!isCheckConfigured(install)) return { checkout, project };

    const { exitCode, output } = await runProcess(install, checkout.path);
    if (exitCode === 0) return { checkout, project };
    record(`Base re-run: installing the dependencies of the base checkout failed (exit ${exitCode ?? 'none'}); no scenario is re-run there:\n${output.trimEnd()}`, 'warn');
    return null;
  }

  async function runTagged(base: PreparedBase): Promise<BaseScenarioOutcome> {
    runs += 1;
    const reportPath = path.join(baselineDir, `junit-${runs}.xml`);
    const proofDir = path.join(baselineDir, `artifacts-${runs}`);
    fs.mkdirSync(proofDir, { recursive: true });
    fs.rmSync(reportPath, { force: true });

    await runByTag(base.project.commands.runScenariosByTag, BASE_RERUN_TAG, base.checkout.path, {
      ADW_JUNIT_REPORT_PATH: reportPath,
      ADW_PROOF_DIR: proofDir,
    });
    return outcomeFromReport(reportPath);
  }

  async function runUnderServer(base: PreparedBase): Promise<BaseScenarioOutcome> {
    const { startDevServer, healthCheckPath } = base.project.commands;
    const port = devServerPort(config.applicationUrl);
    if (!(await waitForFreePort(port, portAvailable))) {
      record(`Base re-run: port ${port} stayed busy, so the base branch's dev server cannot start there`, 'warn');
      return BaseScenarioOutcome.NotRun;
    }

    const outcome = await withServer(
      { startCommand: startDevServer, port, healthPath: healthCheckPath || '/', cwd: base.checkout.path, outputPath: path.join(baselineDir, 'base-rerun-dev-server.log') },
      () => runTagged(base),
    );
    if (outcome.started) return outcome.result;
    record(`Base re-run: the base branch's dev server did not start; its output:\n${outcome.output.trimEnd()}`, 'warn');
    return BaseScenarioOutcome.NotRun;
  }

  // The checkout is disposable, so tagging a scenario in it changes nothing the run commits. The file is
  // restored all the same, so that the next re-run in this checkout sees no stale tag.
  async function runLocated(base: PreparedBase, located: LocatedScenario): Promise<BaseScenarioOutcome> {
    const original = fs.readFileSync(located.file);
    fs.writeFileSync(located.file, withRerunTag(original.toString('utf-8'), located.headerLine, BASE_RERUN_TAG));
    try {
      // The change's own server is stopped by a timer, so the run waits for the port before the base server
      // starts, and the base run's probe cannot be answered by the change's server.
      return isDevServerConfigured(base.project.commands.startDevServer) ? await runUnderServer(base) : await runTagged(base);
    } finally {
      fs.writeFileSync(located.file, original);
    }
  }

  async function rerunOnce(scenario: FailingScenario): Promise<BaseScenarioOutcome> {
    const name = describeFailingScenario(scenario);
    try {
      prepared ??= prepareBase();
      const base = await prepared;
      if (base === null) return BaseScenarioOutcome.NotRun;

      const located = locateScenario(base, scenario);
      if (located === null) {
        record(`Base re-run: "${name}" was not found on the base branch`, 'info');
        return BaseScenarioOutcome.NotRun;
      }
      return await runLocated(base, located);
    } catch (error) {
      record(`Base re-run of "${name}" failed: ${error}`, 'warn');
      return BaseScenarioOutcome.NotRun;
    }
  }

  return (scenario) => {
    const key = `${scenario.feature ?? ''}\u0000${scenario.name}`;
    const known = outcomes.get(key);
    if (known !== undefined) return known;
    const started = rerunOnce(scenario);
    outcomes.set(key, started);
    return started;
  };
}
