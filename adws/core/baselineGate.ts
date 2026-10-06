import {
  CheckStatus,
  STATIC_CHECKS,
  isCheckConfigured,
  runStaticChecks,
  type CheckVerdict,
  type ProcessOutcome,
  type ProcessRunner,
  type StaticCheckCommands,
} from './checkRunner';
import { parseMarkdownSections, type CommandsConfig } from './projectConfig';

export enum BaselineStatus {
  Passed = 'passed',
  Waived = 'waived',
}

export type BaselineRecord =
  | {
      readonly status: BaselineStatus.Passed;
      readonly baseBranch: string;
      readonly baseCommit: string;
      readonly recordedAt: string;
    }
  | {
      readonly status: BaselineStatus.Waived;
      readonly waivedPark: string;
      readonly recordedAt: string;
    };

export function isBaselineWaived(record: BaselineRecord | undefined): boolean {
  return record?.status === BaselineStatus.Waived;
}

export const INSTALL_DEPENDENCIES_CHECK = 'install dependencies';

/** Structurally a `ParkedCheck`; core does not import the forge. */
export interface BaseCommandFailure {
  readonly check: string;
  readonly command: string;
  readonly exitCode: number | null;
  readonly output: string;
}

export interface DevServerStartResult {
  readonly healthy: boolean;
  readonly output: string;
}

export type BaselineCommands = Pick<CommandsConfig, 'installDeps'> & StaticCheckCommands;

export type BaselineEvent =
  | { readonly kind: 'dependencies_installed'; readonly command: string; readonly exitCode: number | null; readonly output: string }
  | { readonly kind: 'checks_ran'; readonly verdicts: readonly CheckVerdict[] }
  | { readonly kind: 'dev_server_checked'; readonly result: DevServerStartResult };

export type BaselineVerdict =
  | { readonly kind: 'green' }
  | { readonly kind: 'checks_red'; readonly failed: readonly BaseCommandFailure[] }
  | { readonly kind: 'server_down'; readonly output: string };

export interface BaselineInput {
  readonly commands: BaselineCommands;
  readonly cwd: string;
  readonly runProcess: ProcessRunner;
  readonly startDevServer?: () => Promise<DevServerStartResult>;
  readonly report?: (event: BaselineEvent) => void;
}

/**
 * Read from the raw file: the parsed config fills a missing or empty section with `bun run dev`, and the
 * baseline starts only a server the repository declares.
 */
export function declaredDevServerCommand(commandsMd: string): string | null {
  const section = parseMarkdownSections(commandsMd)['start dev server'];
  return section !== undefined && isCheckConfigured(section) ? section : null;
}

async function execute(runProcess: ProcessRunner, command: string, cwd: string): Promise<ProcessOutcome> {
  try {
    return await runProcess(command, cwd);
  } catch (error) {
    return { exitCode: null, output: String(error) };
  }
}

function needsInstall({ commands, startDevServer }: BaselineInput): boolean {
  if (!isCheckConfigured(commands.installDeps)) return false;
  const anyCheckConfigured = STATIC_CHECKS.some(spec => isCheckConfigured(commands[spec.commandKey]));
  return anyCheckConfigured || startDevServer !== undefined;
}

async function installDependencies(input: BaselineInput): Promise<BaseCommandFailure | null> {
  if (!needsInstall(input)) return null;
  const command = input.commands.installDeps;
  const { exitCode, output } = await execute(input.runProcess, command, input.cwd);
  input.report?.({ kind: 'dependencies_installed', command, exitCode, output });
  return exitCode === 0 ? null : { check: INSTALL_DEPENDENCIES_CHECK, command, exitCode, output };
}

function failedChecksOf(verdicts: readonly CheckVerdict[]): readonly BaseCommandFailure[] {
  return verdicts
    .filter(verdict => verdict.status === CheckStatus.Failed)
    .map(({ check, command, exitCode, output }) => ({ check, command, exitCode, output }));
}

async function checkDevServer(
  startDevServer: () => Promise<DevServerStartResult>,
  report: BaselineInput['report'],
): Promise<BaselineVerdict> {
  const result = await startDevServer();
  report?.({ kind: 'dev_server_checked', result });
  return result.healthy ? { kind: 'green' } : { kind: 'server_down', output: result.output };
}

/**
 * The install is a precondition of running the checks in a fresh checkout, not a check of its own; a base branch
 * that does not install is red all the same. A server is started only once every check is green.
 */
export async function runBaselineChecks(input: BaselineInput): Promise<BaselineVerdict> {
  const installFailure = await installDependencies(input);
  if (installFailure) return { kind: 'checks_red', failed: [installFailure] };

  const verdicts = await runStaticChecks(input.commands, input.cwd, input.runProcess);
  input.report?.({ kind: 'checks_ran', verdicts });
  const failed = failedChecksOf(verdicts);
  if (failed.length > 0) return { kind: 'checks_red', failed };

  if (!input.startDevServer) return { kind: 'green' };
  return checkDevServer(input.startDevServer, input.report);
}
