import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/logger';
import { getModelForCommand, getEffortForCommand } from '../core/modelRouting';
import { runClaudeAgentWithCommand, type AgentResult, type ProgressCallback, type AgentLaunchContext } from './claudeAgent';
import type { SlashCommand } from '../types/issueTypes';

const MAX_RETRIES = 10;
const MAX_CONSECUTIVE_IDENTICAL_ERRORS = 3;
const OUTPUT_CORRECTION_COMMAND: SlashCommand = '/correct_output';

/** Replaces bare throws so the retry loop can distinguish parse failures from code errors. */
export type ExtractionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export class OutputValidationError extends Error {
  readonly lastValidationError: string;
  constructor(lastValidationError: string) {
    super(`Output validation failed after ${MAX_RETRIES} retries: ${lastValidationError}`);
    this.name = 'OutputValidationError';
    this.lastValidationError = lastValidationError;
  }
}

export interface CommandAgentConfig<T = void> {
  command: SlashCommand;
  agentName: string;
  outputFileName: string;
  /**
   * Must return ExtractionResult<T> — never throw.
   * When omitted, parsed is undefined on the result and no retry loop runs.
   */
  extractOutput?: (output: string) => ExtractionResult<T>;
  /** When provided alongside extractOutput, the retry loop passes this schema to `/correct_output`. */
  outputSchema?: Record<string, unknown>;
}

export interface CommandAgentOptions {
  args: string | readonly string[];
  logsDir: string;
  issueBody?: string;
  onProgress?: ProgressCallback;
  statePath?: string;
  cwd?: string;
  contextPreamble?: string;
  phaseName?: string;
  /** Optional env overlay merged into the shared Claude launch environment — supplies per-command auth from the launch-boundary GitContext. */
  subprocessEnv?: NodeJS.ProcessEnv;
  /** Optional launch-boundary facts ({ selfHost, adwId }) for guardrails --settings injection. */
  launchContext?: AgentLaunchContext;
  /** Set only by a caller that restarts the agent when the result carries `compactionDetected`. */
  killOnCompaction?: boolean;
}

/** When T is void, parsed is undefined. */
export type CommandAgentResult<T> = AgentResult & { parsed: T };

function formatCommandArgs(args: string | readonly string[]): string {
  return typeof args === 'string' ? args : args.join(' ');
}

/** The path is absolute because the retry runs in the agent's cwd, which is often a worktree. */
function writeInvalidOutput(outputFile: string, retryNumber: number, output: string): string {
  const resolved = path.resolve(outputFile);
  const invalidOutputFile = path.join(
    path.dirname(resolved),
    `${path.basename(resolved, path.extname(resolved))}-invalid-output-${retryNumber}.txt`,
  );
  fs.mkdirSync(path.dirname(invalidOutputFile), { recursive: true });
  fs.writeFileSync(invalidOutputFile, output, 'utf-8');
  return invalidOutputFile;
}

async function runRetryLoop<T>(
  config: CommandAgentConfig<T>,
  options: CommandAgentOptions,
  outputFile: string,
  initialOutput: string,
): Promise<T> {
  const { command, agentName, extractOutput, outputSchema } = config;
  if (!extractOutput) {
    throw new Error('runRetryLoop called without extractOutput');
  }

  let lastError = '';
  let consecutiveIdenticalCount = 0;
  let currentOutput = initialOutput;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const extractionResult = extractOutput(currentOutput);

    if (extractionResult.success) {
      if (attempt > 0) {
        log(`${agentName}: output validation succeeded on retry attempt ${attempt}`, 'info');
      }
      return extractionResult.data;
    }

    const validationError = extractionResult.error;

    if (validationError === lastError) {
      consecutiveIdenticalCount++;
    } else {
      consecutiveIdenticalCount = 1;
      lastError = validationError;
    }

    if (consecutiveIdenticalCount >= MAX_CONSECUTIVE_IDENTICAL_ERRORS) {
      log(
        `${agentName}: validation error repeated ${consecutiveIdenticalCount} consecutive times — exiting retry loop early`,
        'warn',
      );
      throw new OutputValidationError(
        `${validationError} (repeated ${consecutiveIdenticalCount} consecutive times)`,
      );
    }

    if (attempt === MAX_RETRIES) {
      break;
    }

    log(
      `${agentName}: output validation failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${validationError}`,
      'warn',
    );

    const invalidOutputFile = writeInvalidOutput(outputFile, attempt + 1, currentOutput);
    const retryResult = await runClaudeAgentWithCommand(
      OUTPUT_CORRECTION_COMMAND,
      [command, formatCommandArgs(options.args), invalidOutputFile, validationError, JSON.stringify(outputSchema ?? {})],
      `${agentName} (retry ${attempt + 1})`,
      outputFile,
      getModelForCommand(OUTPUT_CORRECTION_COMMAND, options.issueBody),
      getEffortForCommand(OUTPUT_CORRECTION_COMMAND, options.issueBody),
      options.onProgress,
      options.statePath,
      options.cwd,
      undefined,
      undefined,
      options.subprocessEnv,
      options.launchContext,
    );

    currentOutput = retryResult.output;
  }

  throw new OutputValidationError(lastError);
}

export async function runCommandAgent<T = void>(
  config: CommandAgentConfig<T>,
  options: CommandAgentOptions,
): Promise<CommandAgentResult<T>> {
  const { command, agentName, outputFileName, extractOutput } = config;
  const { args, logsDir, issueBody, onProgress, statePath, cwd, contextPreamble, phaseName, subprocessEnv, launchContext, killOnCompaction } = options;

  const outputFile = path.join(logsDir, outputFileName);
  const model = getModelForCommand(command, issueBody);
  const effort = getEffortForCommand(command, issueBody);

  const result = await runClaudeAgentWithCommand(
    command,
    args,
    agentName,
    outputFile,
    model,
    effort,
    onProgress,
    statePath,
    cwd,
    contextPreamble,
    phaseName,
    subprocessEnv,
    launchContext,
    killOnCompaction,
  );

  // A run stopped on compaction is cut off by design and its caller restarts it, so its output is not validated.
  if (!extractOutput || result.compactionDetected) {
    return { ...result, parsed: undefined as T };
  }

  const parsed = await runRetryLoop(config, options, outputFile, result.output);
  return { ...result, parsed };
}
