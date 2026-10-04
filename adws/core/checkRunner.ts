import { spawn } from 'child_process';
import type { CommandsConfig } from './projectConfig';

export enum StaticCheckName {
  TypeCheck = 'type check',
  AdditionalTypeChecks = 'additional type checks',
  Lint = 'lint',
  Build = 'build',
}

export enum CheckStatus {
  Passed = 'passed',
  Failed = 'failed',
  Skipped = 'skipped',
}

export type StaticCheckCommands = Pick<CommandsConfig, 'typeCheck' | 'additionalTypeChecks' | 'runLinter' | 'runBuild'>;

export interface ProcessOutcome {
  readonly exitCode: number | null;
  readonly output: string;
}

export type ProcessRunner = (command: string, cwd: string) => Promise<ProcessOutcome>;

export interface CheckVerdict {
  readonly check: StaticCheckName;
  readonly command: string;
  readonly status: CheckStatus;
  readonly exitCode: number | null;
  readonly output: string;
}

interface StaticCheckSpec {
  readonly check: StaticCheckName;
  readonly commandKey: keyof StaticCheckCommands;
}

export const STATIC_CHECKS: readonly StaticCheckSpec[] = [
  { check: StaticCheckName.TypeCheck, commandKey: 'typeCheck' },
  { check: StaticCheckName.AdditionalTypeChecks, commandKey: 'additionalTypeChecks' },
  { check: StaticCheckName.Lint, commandKey: 'runLinter' },
  { check: StaticCheckName.Build, commandKey: 'runBuild' },
];

const NOT_APPLICABLE = 'n/a';

export function isCheckConfigured(command: string): boolean {
  const normalised = command.trim().toLowerCase();
  return normalised !== '' && normalised !== NOT_APPLICABLE;
}

export function runShellCommand(command: string, cwd: string): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const proc = spawn(command, [], { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });

    // One buffer in arrival order: callers compare a check's whole output from one run to the next.
    const chunks: string[] = [];
    const collect = (data: Buffer): void => {
      chunks.push(data.toString());
    };
    proc.stdout.on('data', collect);
    proc.stderr.on('data', collect);

    // A command that cannot be spawned (a missing directory, say) reports here, and a close event
    // may follow it; the first of the two settles the promise.
    proc.on('error', (error) => resolve({ exitCode: null, output: [...chunks, String(error)].join('') }));
    proc.on('close', (exitCode) => resolve({ exitCode, output: chunks.join('') }));
  });
}

async function execute(runProcess: ProcessRunner, command: string, cwd: string): Promise<ProcessOutcome> {
  try {
    return await runProcess(command, cwd);
  } catch (error) {
    return { exitCode: null, output: String(error) };
  }
}

async function runCheck(spec: StaticCheckSpec, command: string, cwd: string, runProcess: ProcessRunner): Promise<CheckVerdict> {
  if (!isCheckConfigured(command)) {
    return { check: spec.check, command, status: CheckStatus.Skipped, exitCode: null, output: '' };
  }
  const { exitCode, output } = await execute(runProcess, command, cwd);
  const status = exitCode === 0 ? CheckStatus.Passed : CheckStatus.Failed;
  return { check: spec.check, command, status, exitCode, output };
}

export async function runStaticChecks(
  commands: StaticCheckCommands,
  cwd: string,
  runProcess: ProcessRunner = runShellCommand,
): Promise<readonly CheckVerdict[]> {
  const verdicts: CheckVerdict[] = [];
  // The checks must not overlap, and their order is part of the contract.
  for (const spec of STATIC_CHECKS) {
    verdicts.push(await runCheck(spec, commands[spec.commandKey], cwd, runProcess));
  }
  return verdicts;
}
