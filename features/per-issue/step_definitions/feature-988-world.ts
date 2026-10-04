/**
 * What the feature-988 scenarios share: one scenario's state, the process runner both the check
 * runner and the unit-test phase are handed, and the hooks that reset and clean up around every
 * scenario of the feature.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { After, Before, type DataTable } from '@cucumber/cucumber';

import { runShellCommand, type CheckVerdict, type ProcessRunner } from '../../../adws/core/checkRunner.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';

import { world796, resetWorld } from './feature-796.steps.ts';
import { emptyBehaviour, type CliBehaviour, type InstalledCli } from './feature-929-compacting-cli.ts';
import type { Workflow929 } from './feature-929-workflow.ts';
import { COMMANDS_FILE, configuredChecksFrom, renderCommandsMd, type ConfiguredCheck } from './feature-988-commands.ts';

/** How a run of the unit-test phase ended: it returned, or it called `process.exit`. */
export interface PhaseOutcome {
  readonly completed: boolean;
  readonly exitCode: number | null;
  readonly error: unknown;
}

export interface State988 {
  /** Directories this feature created itself, removed after the scenario. */
  directories: string[];
  configured: ConfiguredCheck[];
  workingDirectory: string | null;
  /** The commands the process runner was asked to run, in the order it was asked. */
  ranCommands: string[];
  verdicts: readonly CheckVerdict[];
  workflow: Workflow929 | null;
  behaviour: CliBehaviour;
  cli: InstalledCli | null;
  /** How many agent runs the throwaway CLI had recorded when each static check finished. */
  agentRunsAtCheckEnd: number[];
  phase: PhaseOutcome | null;
  savedUnitReportPath: string | undefined;
}

function freshState(): State988 {
  return {
    directories: [],
    configured: [],
    workingDirectory: null,
    ranCommands: [],
    verdicts: [],
    workflow: null,
    behaviour: emptyBehaviour(),
    cli: null,
    agentRunsAtCheckEnd: [],
    phase: null,
    savedUnitReportPath: undefined,
  };
}

export const s: State988 = freshState();

export function resetState(): void {
  Object.assign(s, freshState());
}

export function removeDirectory(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true });
}

/** Writes the commands file the table describes into `root`, and remembers which check got which command. */
export function writeStaticChecks(root: string, relativePath: string, table: DataTable): void {
  assert.strictEqual(relativePath, COMMANDS_FILE, `Static checks are configured in ${COMMANDS_FILE}, not in ${relativePath}`);
  s.configured = configuredChecksFrom(table.hashes() as { check: string; command: string }[]);
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderCommandsMd(s.configured), 'utf-8');
}

/** Runs the command in the real shell, so the shell decides the exit code and the output. */
export function recordingProcessRunner(onFinished: () => void = () => undefined): ProcessRunner {
  return async (command, cwd) => {
    s.ranCommands.push(command);
    const outcome = await runShellCommand(command, cwd);
    onFinished();
    return outcome;
  };
}

function restoreUnitReportPath(): void {
  if (s.savedUnitReportPath === undefined) delete process.env['ADW_UNIT_TEST_REPORT_PATH'];
  else process.env['ADW_UNIT_TEST_REPORT_PATH'] = s.savedUnitReportPath;
}

function removeWorkflowState(): void {
  const world = world796();
  [...world.tempDirs, ...s.directories, ...(s.cli ? [s.cli.dir] : [])].forEach(removeDirectory);
  for (const adwId of world.usedAdwIds) {
    removeDirectory(path.join(AGENTS_STATE_DIR, adwId));
    removeDirectory(path.join(LOGS_DIR, adwId));
  }
}

Before({ tags: '@adw-988' }, function () {
  resetWorld();
  resetState();
  s.savedUnitReportPath = process.env['ADW_UNIT_TEST_REPORT_PATH'];
});

After({ tags: '@adw-988' }, async function () {
  s.cli?.restore();
  restoreUnitReportPath();

  // An agent's output stream flushes after its process closes; let it settle before its directory goes.
  if (s.cli) await new Promise(resolve => setTimeout(resolve, 250));

  removeWorkflowState();
  resetWorld();
  resetState();
});
