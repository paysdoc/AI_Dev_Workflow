/**
 * Shared command agent runner.
 *
 * Provides a generic `runCommandAgent<T>()` that handles the common pattern:
 * format args → call runClaudeAgentWithCommand() → extract structured output → return typed result.
 *
 * When outputSchema is provided alongside extractOutput, a retry loop validates
 * the output against the JSON Schema and re-invokes the agent with a corrective
 * Haiku prompt on failure (up to 10 retries, with early exit after 3 consecutive
 * identical validation errors).
 *
 * Thin wrapper agents (installAgent, documentAgent, etc.) use this to eliminate boilerplate.
 */

import * as path from 'path';
import { log } from '../core/logger';
import { getModelForCommand, getEffortForCommand } from '../core/modelRouting';
import { runClaudeAgentWithCommand, type AgentResult, type ProgressCallback } from './claudeAgent';
import type { SlashCommand } from '../types/issueTypes';

const MAX_RETRIES = 10;
const MAX_CONSECUTIVE_IDENTICAL_ERRORS = 3;

/**
 * Discriminated union returned by extractOutput functions.
 * Replaces bare throws so the retry loop can distinguish parse failures from code errors.
 */
export type ExtractionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Thrown when all retries are exhausted without a valid output.
 */
export class OutputValidationError extends Error {
  readonly lastValidationError: string;
  constructor(lastValidationError: string) {
    super(`Output validation failed after ${MAX_RETRIES} retries: ${lastValidationError}`);
    this.name = 'OutputValidationError';
    this.lastValidationError = lastValidationError;
  }
}

/**
 * Configuration for a command agent run.
 *
 * @template T - The type of structured output extracted from the raw agent output.
 */
export interface CommandAgentConfig<T = void> {
  /** The slash command to invoke (e.g. '/install', '/document'). */
  command: SlashCommand;
  /** Human-readable agent name for logging and output file naming. */
  agentName: string;
  /** Filename for the JSONL output log (e.g. 'install-agent.jsonl'). */
  outputFileName: string;
  /**
   * Optional function to extract structured data from raw agent output.
   * Must return ExtractionResult<T> — never throw.
   * When omitted, parsed is undefined on the result and no retry loop runs.
   */
  extractOutput?: (output: string) => ExtractionResult<T>;
  /**
   * Optional JSON Schema object for validating extractOutput results.
   * When provided alongside extractOutput, the retry loop uses this schema
   * in the corrective Haiku prompt.
   */
  outputSchema?: Record<string, unknown>;
}

/**
 * Options for a single command agent invocation.
 */
export interface CommandAgentOptions {
  /** Arguments forwarded to the slash command. */
  args: string | readonly string[];
  /** Directory for JSONL output log. */
  logsDir: string;
  /** Optional issue body for fast-mode model/effort selection. */
  issueBody?: string;
  /** Optional progress callback. */
  onProgress?: ProgressCallback;
  /** Optional agent state directory path. */
  statePath?: string;
  /** Optional working directory (worktree path). */
  cwd?: string;
  /** Optional context preamble prepended to the prompt. */
  contextPreamble?: string;
}

/**
 * Result returned by runCommandAgent.
 * Extends AgentResult with a `parsed` field containing extracted output.
 * When T is void, parsed is undefined.
 */
export type CommandAgentResult<T> = AgentResult & { parsed: T };

/**
 * Builds the corrective retry prompt for a failed output validation.
 */
function buildRetryPrompt(
  command: string,
  args: string | readonly string[],
  originalOutput: string,
  schema: Record<string, unknown>,
  validationError: string,
): string {
  const argsStr = typeof args === 'string' ? args : args.join(' ');
  return [
    `You were invoked with ${command} with arguments: ${argsStr}.`,
    `You returned the following output:`,
    originalOutput,
    ``,
    `This output failed validation against the expected JSON schema:`,
    JSON.stringify(schema, null, 2),
    ``,
    `Validation error: ${validationError}`,
    ``,
    `Return ONLY valid JSON matching the schema above.`,
  ].join('\n');
}

/**
 * Runs the output validation retry loop.
 * Returns the parsed data on success, throws OutputValidationError after exhausting retries.
 */
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

    // Track consecutive identical errors for early exit
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

    // Build corrective retry prompt and spawn a fresh Haiku session
    const schema = outputSchema ?? {};
    const retryPrompt = buildRetryPrompt(command, options.args, currentOutput, schema, validationError);

    const retryResult = await runClaudeAgentWithCommand(
      retryPrompt,
      [],
      `${agentName} (retry ${attempt + 1})`,
      outputFile,
      'haiku',
      undefined,
      options.onProgress,
      options.statePath,
      options.cwd,
    );

    currentOutput = retryResult.output;
  }

  throw new OutputValidationError(lastError);
}

/**
 * Runs a Claude command agent with the given configuration and options.
 *
 * Handles: output file setup, model/effort selection, runClaudeAgentWithCommand call,
 * and optional output extraction into a typed `parsed` field.
 *
 * When extractOutput is provided and outputSchema is set, the retry loop validates
 * output against the schema and retries with a corrective Haiku prompt on failure.
 *
 * @param config - Static command configuration (command, agentName, outputFileName, extractOutput).
 * @param options - Per-invocation options (args, logsDir, issueBody, etc.).
 * @returns AgentResult extended with `parsed` (if extractOutput provided).
 */
export async function runCommandAgent<T = void>(
  config: CommandAgentConfig<T>,
  options: CommandAgentOptions,
): Promise<CommandAgentResult<T>> {
  const { command, agentName, outputFileName, extractOutput } = config;
  const { args, logsDir, issueBody, onProgress, statePath, cwd, contextPreamble } = options;

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
  );

  if (!extractOutput) {
    return { ...result, parsed: undefined as T };
  }

  // Run the retry loop (handles both first attempt and subsequent retries)
  const parsed = await runRetryLoop(config, options, outputFile, result.output);
  return { ...result, parsed };
}
