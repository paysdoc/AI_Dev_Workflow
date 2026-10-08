import { vi, type Mock } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AGENTS_STATE_DIR } from '../../core/config';
import type { DevServerStartResult } from '../../core/baselineGate';
import type { ProcessOutcome } from '../../core/checkRunner';
import type { BaseCheckout } from '../baseWorktree';
import type { BaselinePhaseDeps, DevServerStartSpec } from '../baselinePhase';
import type { WorkflowConfig } from '../workflowInit';

export class ExitSignal extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

export const BASE_BRANCH = 'trunk';
export const BASE_COMMIT = 'abc1234';
export const APPLICATION_URL = 'http://localhost:4123';
export const LINT_OUTPUT = 'lint broke on base';
export const LINT_FAILS: ProcessOutcome = { exitCode: 1, output: LINT_OUTPUT };

export function spyOnConsoleAndExit(): void {
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitSignal(code);
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
}

const CHECK_HEADINGS: Readonly<Record<string, string>> = {
  installDeps: 'Install Dependencies',
  typeCheck: 'Type Check',
  additionalTypeChecks: 'Additional Type Checks',
  runLinter: 'Run Linter',
  runBuild: 'Run Build',
  startDevServer: 'Start Dev Server',
  healthCheckPath: 'Health Check Path',
};

export type CommandsFile = Readonly<Partial<Record<keyof typeof CHECK_HEADINGS, string>>>;

/** Every check is N/A unless the test names it, so that a test states only the commands it cares about. */
export function renderCommands(commands: CommandsFile): string {
  const withDefaults: Record<string, string> = {
    installDeps: 'install-deps',
    typeCheck: 'N/A',
    additionalTypeChecks: 'N/A',
    runLinter: 'N/A',
    runBuild: 'N/A',
    ...commands,
  };
  return Object.entries(withDefaults).map(([key, value]) => `## ${CHECK_HEADINGS[key]}\n\n${value}\n`).join('\n');
}

export interface PhaseHarness {
  readonly config: WorkflowConfig;
  readonly adwId: string;
  readonly checkout: BaseCheckout;
  readonly statePath: string;
  readonly commentOnIssue: Mock;
  readonly baseWorktree: { ensure: Mock<() => BaseCheckout>; remove: Mock<() => void> };
  readonly worktreePath: string;
  executionLog(): string;
  cleanup(): void;
}

let sequence = 0;

export function setUpPhase(commands: CommandsFile | null): PhaseHarness {
  sequence += 1;
  const adwId = `baseline-phase-${Date.now().toString(36)}-${sequence}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-baseline-phase-'));
  const checkoutPath = path.join(root, 'base-checkout');
  const worktreePath = path.join(root, 'issue-worktree');
  const statePath = path.join(root, 'state');
  const logsDir = path.join(root, 'logs');
  [checkoutPath, worktreePath, statePath, logsDir].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
  if (commands !== null) {
    fs.mkdirSync(path.join(checkoutPath, '.adw'), { recursive: true });
    fs.writeFileSync(path.join(checkoutPath, '.adw', 'commands.md'), renderCommands(commands));
  }

  const commentOnIssue = vi.fn();
  const checkout: BaseCheckout = { path: checkoutPath, baseBranch: BASE_BRANCH, commit: BASE_COMMIT };
  const config = {
    adwId,
    issueNumber: 990,
    defaultBranch: BASE_BRANCH,
    worktreePath,
    logsDir,
    orchestratorStatePath: statePath,
    applicationUrl: APPLICATION_URL,
    repoContext: { issueTracker: { commentOnIssue } },
  } as unknown as WorkflowConfig;

  return {
    config,
    adwId,
    checkout,
    statePath,
    commentOnIssue,
    baseWorktree: { ensure: vi.fn(() => checkout), remove: vi.fn() },
    worktreePath,
    executionLog: () => fs.readFileSync(path.join(statePath, 'execution.log'), 'utf-8'),
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
    },
  };
}

type Script = Readonly<Record<string, ProcessOutcome>>;

/** A command the script does not name exits 0 with no output. */
export function scriptedRunner(script: Script = {}): { runProcess: BaselinePhaseDeps['runProcess']; calls: { command: string; cwd: string }[] } {
  const calls: { command: string; cwd: string }[] = [];
  return {
    calls,
    runProcess: async (command, cwd) => {
      calls.push({ command, cwd });
      return script[command] ?? { exitCode: 0, output: '' };
    },
  };
}

export function scriptedServer(result: DevServerStartResult): { startDevServer: BaselinePhaseDeps['startDevServer']; specs: DevServerStartSpec[] } {
  const specs: DevServerStartSpec[] = [];
  return {
    specs,
    startDevServer: async (spec) => {
      specs.push(spec);
      return result;
    },
  };
}
