import { vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AGENTS_STATE_DIR } from '../../core/config';
import { APPLICATION_TYPE_PROFILES, type ApplicationProfile } from '../../core/applicationType';
import { getDefaultProjectConfig, type CommandsConfig } from '../../core/projectConfig';
import type { CheckVerdict, ProcessOutcome, ProcessRunner, StaticCheckCommands } from '../../core/checkRunner';
import type { FixRoundPort } from '../../core/staticCheckFixLoop';
import type { ModelUsageMap } from '../../cost';
import type { TestRetryResult } from '../../agents/testRetry';
import type { UnitTestPhaseDeps } from '../unitTestPhase';
import type { WorkflowConfig } from '../workflowInit';

export class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

export const CHECK_COMMANDS: StaticCheckCommands = {
  typeCheck: 'tc',
  additionalTypeChecks: 'atc',
  runLinter: 'lint',
  runBuild: 'build',
};

export const ALL_CHECKS_RAN = ['check:tc', 'check:atc', 'check:lint', 'check:build'];

export const PASSING_TEST_RUN: TestRetryResult = {
  passed: true,
  reportPresent: true,
  hasFailures: false,
  testcaseCount: 2,
  costUsd: 0,
  totalRetries: 0,
  failedTests: [],
  modelUsage: {},
  contextResetCount: 0,
};

export const GREEN: ProcessOutcome = { exitCode: 0, output: '' };
export const RED_LINT: ProcessOutcome = { exitCode: 1, output: 'lint error in src/a.ts' };
export const RED_BUILD: ProcessOutcome = { exitCode: 2, output: 'build error in src/b.ts' };

export const CLEAN_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-let total = 0;', '+const total = 0;'].join('\n');
export const SUPPRESSING_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', ' let total = 0;', '+// @ts-ignore'].join('\n');
export const ACME_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', ' let total = 0;', '+// @acme-off'].join('\n');

const tempDirs: string[] = [];
const adwIds: string[] = [];
let savedReportPath: string | undefined;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export interface Workflow {
  readonly config: WorkflowConfig;
  /** The bodies of the comments posted on the issue, oldest first. */
  readonly comments: () => string[];
}

export function makeWorkflow(
  unitTests: boolean,
  commands: Partial<CommandsConfig> = CHECK_COMMANDS,
  applicationProfile: ApplicationProfile = APPLICATION_TYPE_PROFILES.cli,
): Workflow {
  const projectConfig = getDefaultProjectConfig();
  const adwId = `unit-test-phase-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  adwIds.push(adwId);
  const commentOnIssue = vi.fn();
  const config = {
    issueNumber: 42,
    adwId,
    issue: { number: 42, title: 'Unit-test phase', body: 'issue body' },
    worktreePath: '/worktrees/unit-test-phase',
    logsDir: tempDir('adw-unit-test-phase-logs-'),
    orchestratorStatePath: tempDir('adw-unit-test-phase-state-'),
    ctx: { issueNumber: 42, adwId },
    repoContext: { issueTracker: { moveToStatus: vi.fn(async () => undefined), commentOnIssue, applyLabel: vi.fn() } },
    projectConfig: { ...projectConfig, commands: { ...projectConfig.commands, ...commands } },
    adwYmlConfig: { hitl: false, unitTests },
    applicationProfile,
  } as unknown as WorkflowConfig;
  return { config, comments: () => commentOnIssue.mock.calls.map(([, body]) => String(body)) };
}

export function makeConfig(
  unitTests: boolean,
  commands: Partial<CommandsConfig> = CHECK_COMMANDS,
  applicationProfile: ApplicationProfile = APPLICATION_TYPE_PROFILES.cli,
): WorkflowConfig {
  return makeWorkflow(unitTests, commands, applicationProfile).config;
}

/** A command's outcomes in the order it is run; the last one repeats once the queue is spent. */
export type Outcomes = Readonly<Record<string, readonly ProcessOutcome[]>>;

export function scriptedProcessRunner(events: string[], outcomes: Outcomes = {}): ProcessRunner {
  const timesRun: Record<string, number> = {};
  return async (command) => {
    events.push(`check:${command}`);
    const queue = outcomes[command] ?? [GREEN];
    const run = timesRun[command] ?? 0;
    timesRun[command] = run + 1;
    return queue[Math.min(run, queue.length - 1)];
  };
}

export function recordingProcessRunner(events: string[], outcomes: Readonly<Record<string, ProcessOutcome>> = {}): ProcessRunner {
  return scriptedProcessRunner(events, Object.fromEntries(Object.entries(outcomes).map(([command, outcome]) => [command, [outcome]])));
}

export function recordingTestRun(events: string[], result: Partial<TestRetryResult> = {}): UnitTestPhaseDeps['runUnitTestsWithRetry'] {
  return async () => {
    events.push('tests');
    return { ...PASSING_TEST_RUN, ...result };
  };
}

export interface ScriptedFixRound {
  readonly diff?: string;
  readonly costUsd?: number;
  readonly modelUsage?: ModelUsageMap;
  readonly error?: Error;
}

/** The n-th `fix` call, across every run of the phase that uses the port, gets the n-th scripted round. */
export function scriptedFixRounds(events: string[], ...rounds: ScriptedFixRound[]) {
  const fixed: { readonly failed: readonly CheckVerdict[]; readonly round: number }[] = [];
  const kept: number[] = [];
  const discarded: number[] = [];
  const port: FixRoundPort = {
    async fix(failed, round) {
      const scripted = rounds[fixed.length] ?? {};
      fixed.push({ failed, round });
      events.push(`fix:${fixed.length}`);
      if (scripted.error) throw scripted.error;
      return { diff: scripted.diff ?? CLEAN_DIFF, costUsd: scripted.costUsd ?? 0, modelUsage: scripted.modelUsage ?? {} };
    },
    keep: (round) => {
      events.push(`keep:${round}`);
      kept.push(round);
    },
    discard: (round) => {
      events.push(`discard:${round}`);
      discarded.push(round);
    },
  };
  return { port, fixed, kept, discarded };
}

export function executionLog(config: WorkflowConfig): string {
  return fs.readFileSync(path.join(config.orchestratorStatePath, 'execution.log'), 'utf-8');
}

export function parkComments(workflow: Workflow): string[] {
  return workflow.comments().filter(body => body.includes('ADW Parked'));
}

/** Registers the per-test setup and teardown shared by every unit-test-phase test file. */
export function useUnitTestPhaseSandbox(): void {
  beforeEach(() => {
    savedReportPath = process.env.ADW_UNIT_TEST_REPORT_PATH;
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedReportPath === undefined) delete process.env.ADW_UNIT_TEST_REPORT_PATH;
    else process.env.ADW_UNIT_TEST_REPORT_PATH = savedReportPath;
    tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
    adwIds.splice(0).forEach(adwId => fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true }));
  });
}
