/**
 * Claude Code agent runner for executing AI agents.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log, AgentStateManager, getSafeSubprocessEnv, type ModelUsageMap, type TokenUsageSnapshot, resolveClaudeCodePath, clearClaudeCodePathCache } from '../core';
import type { ProgressCallback } from './jsonlParser';
import { handleAgentProcess } from './agentProcessHandler';

// Backward-compatible re-exports
export { computeTotalTokens, computePrimaryModelTokens, isModelMatch } from '../core/tokenManager';
export type { TokenTotals } from '../core/tokenManager';
export { parseJsonlOutput, extractTextFromAssistantMessage, extractToolUseFromMessage } from './jsonlParser';
export type {
  ProgressInfo, ProgressCallback, JsonlParserState,
  ContentBlock, TextContentBlock, ToolUseContentBlock, ToolResultContentBlock,
  JsonlMessage, JsonlAssistantMessage, JsonlResultMessage,
} from './jsonlParser';

export interface AgentResult {
  success: boolean;
  output: string;
  sessionId?: string;
  totalCostUsd?: number;
  /** Per-model token usage breakdown from the Claude CLI. */
  modelUsage?: ModelUsageMap;
  /** The state path if state tracking was enabled */
  statePath?: string;
  /** True when the agent was terminated due to approaching the token limit. */
  tokenLimitExceeded?: boolean;
  /** Token usage snapshot at the time of interruption. */
  tokenUsage?: TokenUsageSnapshot;
  /** Partial output captured before token limit termination. */
  partialOutput?: string;
}

/**
 * Saves the prompt to a file in the agent's state directory for replay and audit.
 * Extracts the slash command name from the prompt start for the filename.
 */
function savePrompt(prompt: string, statePath: string): void {
  const promptsDir = path.join(statePath, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });

  const match = prompt.match(/^\/(\w+)/);
  const filename = match ? `${match[1]}.txt` : 'prompt.txt';

  fs.writeFileSync(path.join(promptsDir, filename), prompt, 'utf-8');
}

/** Delay helper for retry logic. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a Claude Code agent with a slash command.
 * The command is passed as a CLI argument rather than via stdin.
 *
 * @param command - The slash command to invoke (e.g., '/implement', '/feature')
 * @param args - Arguments to pass to the command. A string replaces $ARGUMENTS; an array passes each element as a separate positional argument ($1, $2, $3, ...).
 * @param agentName - Human-readable name for logging
 * @param outputFile - Path to write JSONL output
 * @param model - The model to use ('opus', 'sonnet', 'haiku')
 * @param effort - Optional reasoning effort level ('low' | 'medium' | 'high' | 'max')
 * @param onProgress - Optional callback for progress updates
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runClaudeAgentWithCommand(
  command: string,
  args: string | readonly string[],
  agentName: string,
  outputFile: string,
  model: string = 'sonnet',
  effort?: string,
  onProgress?: ProgressCallback,
  statePath?: string,
  cwd?: string
): Promise<AgentResult> {
  // Build the prompt as "command 'args'" for the CLI
  // Each arg is single-quoted to preserve formatting
  const escapeArg = (a: string): string => `'${a.replace(/'/g, "'\\''")}'`;
  const quotedArgs = typeof args === 'string'
    ? escapeArg(args)
    : args.map(escapeArg).join(' ');
  const prompt = `${command} ${quotedArgs}`;

  // Write initial state if state path provided
  if (statePath) {
    AgentStateManager.appendLog(statePath, `Starting ${agentName} agent with command: ${command}`, prompt);
    AgentStateManager.appendLog(statePath, `Model: ${model}`);
    if (effort) AgentStateManager.appendLog(statePath, `Reasoning effort: ${effort}`);
    savePrompt(prompt, statePath);
  }

  const cliArgs = [
    '--print',
    '--verbose',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--model', model,
    ...(effort ? ['--effort', effort] : []),
    prompt
  ];

  const resolvedPath = resolveClaudeCodePath();
  log(`Starting ${agentName} agent...`, 'info');
  log(`  Command: ${resolvedPath} ${cliArgs.slice(0, -1).join(' ')} "<prompt>"`, 'info');
  log(`  Slash command: ${command}`, 'info');
  log(`  Model: ${model}`, 'info');
  if (effort) log(`  Reasoning effort: ${effort}`, 'info');
  log(`  Output file: ${outputFile}`, 'info');
  log(`  Args length: ${Array.isArray(args) ? `${args.length} elements` : `${args.length} characters`}`, 'info');

  const spawnOptions = { cwd: cwd || process.cwd(), env: getSafeSubprocessEnv(), stdio: ['ignore' as const, 'pipe' as const, 'pipe' as const] };
  const claude = spawn(resolvedPath, cliArgs, spawnOptions);

  const result = await handleAgentProcess(claude, agentName, outputFile, onProgress, statePath, model);

  // Retry once on ENOENT (transient path resolution failure)
  if (!result.success && result.output.includes('ENOENT')) {
    log(`Claude CLI not found at ${resolvedPath}, retrying after re-resolving path...`, 'warn');
    clearClaudeCodePathCache();
    await delay(1000);

    const retryPath = resolveClaudeCodePath();
    const retryProcess = spawn(retryPath, cliArgs, spawnOptions);

    return handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);
  }

  return result;
}

/**
 * Runs a Claude Code agent with /install priming before executing the given slash command.
 * Composes a two-step prompt that first runs /install to prime project context, then
 * executes the actual command — all in the same CLI invocation so both share context.
 *
 * @param command - The slash command to invoke after priming (e.g., '/feature', '/scenario_writer')
 * @param args - Arguments to pass to the command
 * @param agentName - Human-readable name for logging
 * @param outputFile - Path to write JSONL output
 * @param model - The model to use ('opus', 'sonnet', 'haiku')
 * @param effort - Optional reasoning effort level ('low' | 'medium' | 'high' | 'max')
 * @param onProgress - Optional callback for progress updates
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runPrimedClaudeAgentWithCommand(
  command: string,
  args: string | readonly string[],
  agentName: string,
  outputFile: string,
  model: string = 'sonnet',
  effort?: string,
  onProgress?: ProgressCallback,
  statePath?: string,
  cwd?: string
): Promise<AgentResult> {
  const escapeArg = (a: string): string => `'${a.replace(/'/g, "'\\''")}'`;
  const quotedArgs = typeof args === 'string'
    ? escapeArg(args)
    : args.map(escapeArg).join(' ');
  const commandPart = quotedArgs ? `${command} ${quotedArgs}` : command;
  const primedPrompt = `/install\n\nOnce /install completes, run: ${commandPart}`;

  return runClaudeAgentWithCommand(primedPrompt, [], agentName, outputFile, model, effort, onProgress, statePath, cwd);
}
