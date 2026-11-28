/**
 * The Per-Issue Sweep's use of the scenario runner's usage report: the dry run that writes it in the sweep worktree, the
 * step files it keeps out of a removal batch, and the reconcile that files at most one removal chore per repository. None
 * throws: a sweep that cannot read the report, or cannot file the issue, still removes what it may.
 *
 * `loadProjectConfig` and the check runner are imported from their own modules, not the `../core` barrel, so that a test
 * mocking the barrel down to `log` still gets the real ones.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IssueTracker } from '@paysdoc/devplatform';
import type { LogLevel } from '../core';
import { isCheckConfigured, runShellCommand, type ProcessOutcome, type ProcessRunner } from '../core/checkRunner';
import { loadProjectConfig, type CommandsConfig } from '../core/projectConfig';
import {
  MAX_LISTED_UNUSED_DEFINITIONS,
  UNUSED_STEP_ISSUE_SEARCH,
  buildUnusedStepIssue,
  findOpenUnusedStepIssue,
  type UnusedStepIssueRef,
  type UnusedStepIssueSpec,
} from '../core/unusedStepIssueBody';
import { isWithinDirectory, type ScenarioDirectories } from '../core/scenarioDirectories';
import {
  REPORT_PATH_PLACEHOLDER,
  resolveStepUsageReader,
  stepFilesStillUsed,
  unusedStepDefinitions,
  type StepDefinitionUsage,
  type StepUsageReader,
  type UnusedStepDefinition,
} from '../core/unusedStepReport';
import type { SweepBase } from './perIssueSweepPersist';

export type StepUsageOutcome =
  | { readonly kind: 'usage'; readonly framework: string; readonly usages: readonly StepDefinitionUsage[] }
  | { readonly kind: 'not_supported'; readonly framework: string }
  | { readonly kind: 'unavailable'; readonly detail: string };

type Logger = (msg: string, level?: LogLevel) => void;

const LABEL = 'perIssueScenarioSweep';
const REPORT_FILE = 'usage.json';
const OUTPUT_TAIL_LINES = 20;
const OPEN_ISSUE_LIMIT = 100;
/** Where cucumber reports a step definition whose source location it could not determine. */
const UNKNOWN_LOCATION = 'unknown';
const MISSING_FILES_NAMED = 5;

export interface StepUsageReportInput {
  readonly worktreePath: string;
  readonly commands: Pick<CommandsConfig, 'installDeps' | 'runScenariosByTag'>;
  readonly reader: StepUsageReader;
  readonly runProcess?: ProcessRunner;
  readonly fileExists?: (absolutePath: string) => boolean;
}

function unavailable(detail: string): StepUsageOutcome {
  return { kind: 'unavailable', detail };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function outputTail(output: string): string {
  return output.trimEnd().split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
}

async function execute(runProcess: ProcessRunner, command: string, cwd: string): Promise<ProcessOutcome> {
  try {
    return await runProcess(command, cwd);
  } catch (error) {
    return { exitCode: null, output: String(error) };
  }
}

function readReport(reportPath: string): string | null {
  try {
    return fs.readFileSync(reportPath, 'utf-8');
  } catch {
    return null;
  }
}

/** A run-by-tag command that changes directory first reports paths relative to that directory, which name no file here. */
function filesNotInWorktree(usages: readonly StepDefinitionUsage[], worktreePath: string, fileExists: (absolutePath: string) => boolean): string[] {
  const files = [...new Set(usages.map((usage) => usage.file))].filter((file) => file !== UNKNOWN_LOCATION);
  return files.filter((file) => !fileExists(path.join(worktreePath, file)));
}

async function dryRun(input: StepUsageReportInput, command: string, reportDir: string): Promise<StepUsageOutcome> {
  const reportPath = path.join(reportDir, REPORT_FILE);
  const runnable = command.split(REPORT_PATH_PLACEHOLDER).join(shellQuote(reportPath));
  const { exitCode, output } = await execute(input.runProcess ?? runShellCommand, runnable, input.worktreePath);

  const report = readReport(reportPath);
  if (report === null) return unavailable(`the dry run \`${command}\` wrote no usage report (exit ${exitCode ?? 'none'}):\n${outputTail(output)}`);

  const read = input.reader.read(report);
  if (read.kind === 'unreadable') return unavailable(read.detail);

  const missing = filesNotInWorktree(read.usages, input.worktreePath, input.fileExists ?? fs.existsSync);
  if (missing.length > 0) {
    return unavailable(`the usage report's paths are not relative to the repository root: ${missing.slice(0, MISSING_FILES_NAMED).join(', ')} not found in the sweep worktree`);
  }
  return { kind: 'usage', framework: input.reader.framework, usages: read.usages };
}

async function readStepUsageIn(input: StepUsageReportInput): Promise<StepUsageOutcome> {
  const command = input.reader.dryRunCommand(input.commands.runScenariosByTag);
  if (command === null) return unavailable('`## Run Scenarios by Tag` has no `{tag}` filter to replace');

  const { installDeps } = input.commands;
  if (isCheckConfigured(installDeps)) {
    const install = await execute(input.runProcess ?? runShellCommand, installDeps, input.worktreePath);
    if (install.exitCode !== 0) return unavailable(`\`${installDeps}\` exited ${install.exitCode ?? 'without an exit code'}:\n${outputTail(install.output)}`);
  }

  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-step-usage-'));
  try {
    return await dryRun(input, command, reportDir);
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
}

/** Installs the dependencies, runs the reader's dry run in the worktree and reads the report it wrote. Never throws. */
export async function runStepUsageReport(input: StepUsageReportInput): Promise<StepUsageOutcome> {
  try {
    return await readStepUsageIn(input);
  } catch (error) {
    return unavailable(`reading the step usage failed: ${error}`);
  }
}

export interface ReconcileUnusedStepIssueDeps {
  readonly listOpenRemovalIssues: () => readonly UnusedStepIssueRef[];
  readonly fileRemovalIssue: (spec: UnusedStepIssueSpec) => number;
  readonly framework: string;
  readonly defaultBranch: string | null;
  readonly log: Logger;
}

type OpenRemovalIssue =
  | { readonly kind: 'none' }
  | { readonly kind: 'open'; readonly issue: UnusedStepIssueRef }
  | { readonly kind: 'unknown'; readonly error: string };

function findOpenRemovalIssue(listOpenRemovalIssues: () => readonly UnusedStepIssueRef[]): OpenRemovalIssue {
  try {
    const issue = findOpenUnusedStepIssue(listOpenRemovalIssues());
    return issue ? { kind: 'open', issue } : { kind: 'none' };
  } catch (error) {
    return { kind: 'unknown', error: String(error) };
  }
}

function fileRemovalIssue(unused: readonly UnusedStepDefinition[], deps: ReconcileUnusedStepIssueDeps): void {
  const spec = buildUnusedStepIssue({ definitions: unused, framework: deps.framework, defaultBranch: deps.defaultBranch });
  try {
    const issueNumber = deps.fileRemovalIssue(spec);
    const listed = Math.min(unused.length, MAX_LISTED_UNUSED_DEFINITIONS);
    deps.log(`${LABEL}: filed removal issue #${issueNumber} listing ${listed} unused step definition(s)`, 'success');
  } catch (error) {
    deps.log(`${LABEL}: filing the unused step definition removal issue failed (retried next sweep): ${error}`, 'error');
  }
}

/**
 * Files one removal chore for `unused` unless an open issue already carries the marker. A failed listing files nothing:
 * a duplicate issue is worse than a sweep that waits for the next cycle. Never throws.
 */
export function reconcileUnusedStepIssue(unused: readonly UnusedStepDefinition[], deps: ReconcileUnusedStepIssueDeps): void {
  if (unused.length === 0) {
    deps.log(`${LABEL}: no unused step definitions`, 'info');
    return;
  }

  const open = findOpenRemovalIssue(deps.listOpenRemovalIssues);
  if (open.kind === 'unknown') {
    deps.log(`${LABEL}: ${unused.length} unused step definition(s), but listing open issues failed (${open.error}) — not filing a removal issue this cycle`, 'warn');
    return;
  }
  if (open.kind === 'open') {
    deps.log(`${LABEL}: ${unused.length} unused step definition(s); removal issue #${open.issue.number} is still open — not filing another`, 'info');
    return;
  }
  fileRemovalIssue(unused, deps);
}

async function readOrUnavailable(readStepUsage: () => Promise<StepUsageOutcome>): Promise<StepUsageOutcome> {
  try {
    return await readStepUsage();
  } catch (error) {
    return unavailable(`reading the step usage threw: ${error}`);
  }
}

/** The outcome of `readStepUsage`, never a throw, logged when no report could be read. */
export async function readStepUsageOutcome(readStepUsage: () => Promise<StepUsageOutcome>, log: Logger): Promise<StepUsageOutcome> {
  const usage = await readOrUnavailable(readStepUsage);
  if (usage.kind === 'not_supported') {
    const framework = usage.framework === '' ? '(none declared)' : usage.framework;
    log(`${LABEL}: finding unused step definitions is not supported for BDD framework "${framework}" — skipped`, 'info');
  }
  if (usage.kind === 'unavailable') log(`${LABEL}: step usage report unavailable — ${usage.detail}`, 'warn');
  return usage;
}

/**
 * A target's configured step-definition directory is shared with its Regression Suite, and cucumber loads step files by
 * glob, so the gate cannot see a removal that leaves a remaining scenario with undefined steps. Only the usage report can
 * clear such a file; without it, nothing outside the per-issue directory is removed by name.
 */
export function withoutUsedStepFiles(
  paths: readonly string[],
  staleFeatures: readonly string[],
  usage: StepUsageOutcome,
  directories: ScenarioDirectories,
  log: Logger,
): readonly string[] {
  const stepFiles = paths.filter((file) => !staleFeatures.includes(file));
  const kept = usage.kind === 'usage'
    ? stepFilesStillUsed(usage.usages, stepFiles, staleFeatures)
    : stepFiles.filter((file) => !isWithinDirectory(file, directories.perIssue));
  if (kept.length === 0) return paths;

  const why = usage.kind === 'usage' ? 'that a remaining feature file still uses' : `outside ${directories.perIssue}, which no usage report could clear`;
  log(`${LABEL}: keeping ${kept.length} step-definition file(s) ${why}: ${kept.join(', ')}`, 'info');
  return paths.filter((file) => !kept.includes(file));
}

/** Reconciles the removal chore for the definitions in the step-definition directories that no feature file uses once `landed` is gone. */
export function reconcileUnusedStepDefinitions(
  usage: Extract<StepUsageOutcome, { kind: 'usage' }>,
  landed: readonly string[],
  directories: ScenarioDirectories,
  deps: Omit<ReconcileUnusedStepIssueDeps, 'framework'>,
): void {
  const inStepDefinitionDirectories = (file: string): boolean => directories.stepDefinitions.some((directory) => isWithinDirectory(file, directory));
  const unused = unusedStepDefinitions(usage.usages, landed).filter((definition) => inStepDefinitionDirectories(definition.file));
  reconcileUnusedStepIssue(unused, { ...deps, framework: usage.framework });
}

/** Reads `.adw/` from the sweep worktree, so the target's own framework and commands decide the dry run. */
export function defaultReadStepUsage(getBase: () => Pick<SweepBase, 'worktreePath'> | null, logger: Logger): () => Promise<StepUsageOutcome> {
  return async () => {
    const base = getBase();
    if (!base) return unavailable('no sweep worktree could be prepared');

    const { scenarios, commands } = loadProjectConfig(base.worktreePath);
    const lookup = resolveStepUsageReader(scenarios.bddFramework);
    if (lookup.kind === 'not_supported') return lookup;

    logger(`${LABEL}: reading step usage from a ${lookup.reader.framework} dry run in the sweep worktree`, 'info');
    return runStepUsageReport({ worktreePath: base.worktreePath, commands, reader: lookup.reader });
  };
}

/** Throws when the forge cannot list issues, so the reconcile can tell a failed listing from no open issue. */
export function defaultListOpenRemovalIssues(issueTracker: Pick<IssueTracker, 'listIssues'>): () => readonly UnusedStepIssueRef[] {
  return () =>
    issueTracker
      .listIssues({ fields: ['number', 'body', 'state'], state: 'open', search: UNUSED_STEP_ISSUE_SEARCH, limit: OPEN_ISSUE_LIMIT })
      .map((entry) => ({ number: entry.number, body: entry.body ?? '', state: entry.state }));
}

export function defaultFileRemovalIssue(issueTracker: Pick<IssueTracker, 'createIssue' | 'applyLabel'>): (spec: UnusedStepIssueSpec) => number {
  return (spec) => {
    const issueNumber = issueTracker.createIssue(spec.title, spec.body);
    spec.labels.forEach((label) => issueTracker.applyLabel(issueNumber, label));
    return issueNumber;
  };
}
