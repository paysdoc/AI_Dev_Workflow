/**
 * Shared command agent runner.
 *
 * Provides a generic `runCommandAgent<T>()` that handles the common pattern:
 * format args → call runClaudeAgentWithCommand() → extract structured output → return typed result.
 *
 * Thin wrapper agents (installAgent, documentAgent, etc.) use this to eliminate boilerplate.
 */

import * as path from 'path';
import { getModelForCommand, getEffortForCommand } from '../core/modelRouting';
import { runClaudeAgentWithCommand, type AgentResult, type ProgressCallback } from './claudeAgent';
import type { SlashCommand } from '../types/issueTypes';

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
   * When omitted, parsed is undefined on the result.
   */
  extractOutput?: (output: string) => T;
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
 * Runs a Claude command agent with the given configuration and options.
 *
 * Handles: output file setup, model/effort selection, runClaudeAgentWithCommand call,
 * and optional output extraction into a typed `parsed` field.
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

  const parsed = extractOutput ? extractOutput(result.output) : undefined as T;
  return { ...result, parsed };
}
