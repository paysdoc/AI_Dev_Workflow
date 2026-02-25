/**
 * Claude Code agent runner for executing AI agents.
 */
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log, AgentStateManager, getSafeSubprocessEnv, type ModelUsageMap, type TokenUsageSnapshot, MAX_THINKING_TOKENS, TOKEN_LIMIT_THRESHOLD, resolveClaudeCodePath, clearClaudeCodePathCache } from '../core';
import { parseJsonlOutput, type JsonlParserState, type ProgressCallback } from './jsonlParser';
import { computeTotalTokens } from './tokenManager';

// Backward-compatible re-exports
export { computeTotalTokens, computePrimaryModelTokens, isModelMatch } from './tokenManager';
export type { TokenTotals } from './tokenManager';
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
 * Attaches stdout/stderr/close/error handlers to a spawned Claude process and
 * resolves the returned promise with an {@link AgentResult}.
 */
function handleAgentProcess(
  claude: ChildProcess,
  agentName: string,
  outputFile: string,
  onProgress: ProgressCallback | undefined,
  statePath: string | undefined,
  model: string,
): Promise<AgentResult> {
  return new Promise((resolve) => {
    const state: JsonlParserState = {
      lastResult: null,
      fullOutput: '',
      turnCount: 0,
      toolCount: 0,
      modelUsage: undefined,
      totalTokens: 0,
      primaryModel: model,
    };

    let tokenLimitReached = false;
    const tokenThreshold = MAX_THINKING_TOKENS * TOKEN_LIMIT_THRESHOLD;

    const outputStream = fs.createWriteStream(outputFile, { flags: 'a' });

    claude.stdout!.on('data', (data: Buffer) => {
      const text = data.toString();
      outputStream.write(text);
      parseJsonlOutput(text, state, onProgress, statePath);

      if (!tokenLimitReached && state.totalTokens >= tokenThreshold) {
        tokenLimitReached = true;
        log(`${agentName}: Token limit threshold reached (${state.totalTokens}/${MAX_THINKING_TOKENS} tokens, ${(TOKEN_LIMIT_THRESHOLD * 100).toFixed(0)}%). Terminating agent.`, 'info');
        if (statePath) {
          AgentStateManager.appendLog(statePath, `Token limit threshold reached: ${state.totalTokens}/${MAX_THINKING_TOKENS}`);
        }
        claude.kill('SIGTERM');
      }
    });

    claude.stderr!.on('data', (data: Buffer) => {
      const text = data.toString();
      outputStream.write(`[STDERR] ${text}`);
      log(`${agentName} stderr: ${text}`, 'error');
    });

    claude.on('close', (code) => {
      outputStream.end();

      // Log final summary
      log(`${agentName} agent finished:`, 'info');
      log(`  Exit code: ${code}`, 'info');
      log(`  Total turns: ${state.turnCount}`, 'info');
      log(`  Total tool calls: ${state.toolCount}`, 'info');

      if (onProgress) {
        onProgress({
          type: 'summary',
          turnCount: state.turnCount,
          toolCount: state.toolCount,
        });
      }

      // Write final state summary if statePath provided
      if (statePath) {
        AgentStateManager.appendLog(
          statePath,
          `Completed: exit code ${code}, turns: ${state.turnCount}, tools: ${state.toolCount}`
        );
      }

      if (tokenLimitReached) {
        log(`${agentName} terminated due to token limit`, 'info');
        const tokenTotals = state.modelUsage ? computeTotalTokens(state.modelUsage) : undefined;
        const snapshot: TokenUsageSnapshot | undefined = tokenTotals ? {
          totalInputTokens: tokenTotals.inputTokens,
          totalOutputTokens: tokenTotals.outputTokens,
          totalCacheCreationTokens: tokenTotals.cacheCreationTokens,
          totalTokens: tokenTotals.total,
          maxTokens: MAX_THINKING_TOKENS,
          thresholdPercent: TOKEN_LIMIT_THRESHOLD,
        } : undefined;
        resolve({
          success: true,
          tokenLimitExceeded: true,
          output: state.lastResult?.result || state.fullOutput,
          partialOutput: state.fullOutput,
          tokenUsage: snapshot,
          totalCostUsd: state.lastResult?.totalCostUsd,
          modelUsage: state.modelUsage,
          statePath,
        });
        return;
      }

      if (code === 0 && state.lastResult) {
        log(`${agentName} completed successfully`, 'success');
        if (state.lastResult.totalCostUsd) {
          log(`  Cost: $${state.lastResult.totalCostUsd.toFixed(4)}`, 'info');
        }
        if (state.modelUsage) {
          const modelNames = Object.keys(state.modelUsage);
          log(`  Models used: ${modelNames.join(', ')}`, 'info');
        }
        resolve({
          success: !state.lastResult.isError,
          output: state.lastResult.result || state.fullOutput,
          sessionId: state.lastResult.sessionId,
          totalCostUsd: state.lastResult.totalCostUsd,
          modelUsage: state.modelUsage,
          statePath
        });
      } else if (code === 0) {
        resolve({
          success: true,
          output: state.fullOutput,
          modelUsage: state.modelUsage,
          statePath
        });
      } else {
        log(`${agentName} exited with code ${code}`, 'error');
        resolve({
          success: false,
          output: state.fullOutput || 'Agent failed without output',
          modelUsage: state.modelUsage,
          statePath
        });
      }
    });

    claude.on('error', (error) => {
      outputStream.end();
      log(`${agentName} error: ${error.message}`, 'error');
      // Log error to state if statePath provided
      if (statePath) {
        AgentStateManager.appendLog(statePath, `Error: ${error.message}`);
      }
      resolve({
        success: false,
        output: error.message,
        statePath
      });
    });
  });
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
 * Runs a Claude Code agent with the given prompt.
 * Streams output to a log file and returns the result.
 *
 * @param prompt - The prompt to send to the agent
 * @param agentName - Human-readable name for logging
 * @param outputFile - Path to write JSONL output
 * @param model - The model to use (default: 'sonnet')
 * @param onProgress - Optional callback for progress updates
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runClaudeAgent(
  prompt: string,
  agentName: string,
  outputFile: string,
  model: string = 'sonnet',
  onProgress?: ProgressCallback,
  statePath?: string,
  cwd?: string
): Promise<AgentResult> {
  // Write initial state if state path provided
  if (statePath) {
    AgentStateManager.appendLog(statePath, `Starting ${agentName} agent`, prompt);
    AgentStateManager.appendLog(statePath, `Model: ${model}`);
    savePrompt(prompt, statePath);
  }

  const args = [
    '--print',
    '--verbose',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--model', model
  ];

  const resolvedPath = resolveClaudeCodePath();
  log(`Starting ${agentName} agent...`, 'info');
  log(`  Command: ${resolvedPath} ${args.join(' ')}`, 'info');
  log(`  Model: ${model}`, 'info');
  log(`  Output file: ${outputFile}`, 'info');
  log(`  Prompt length: ${prompt.length} characters`, 'info');

  const spawnOptions = { cwd: cwd || process.cwd(), env: getSafeSubprocessEnv() };
  const claude = spawn(resolvedPath, args, spawnOptions);

  // Write prompt to stdin and close it
  claude.stdin.write(prompt);
  claude.stdin.end();

  const result = await handleAgentProcess(claude, agentName, outputFile, onProgress, statePath, model);

  // Retry once on ENOENT (transient path resolution failure)
  if (!result.success && result.output.includes('ENOENT')) {
    log(`Claude CLI not found at ${resolvedPath}, retrying after re-resolving path...`, 'warn');
    clearClaudeCodePathCache();
    await delay(1000);

    const retryPath = resolveClaudeCodePath();
    const retryProcess = spawn(retryPath, args, spawnOptions);
    retryProcess.stdin.write(prompt);
    retryProcess.stdin.end();

    return handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);
  }

  return result;
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
    savePrompt(prompt, statePath);
  }

  const cliArgs = [
    '--print',
    '--verbose',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--model', model,
    prompt
  ];

  const resolvedPath = resolveClaudeCodePath();
  log(`Starting ${agentName} agent...`, 'info');
  log(`  Command: ${resolvedPath} ${cliArgs.slice(0, -1).join(' ')} "<prompt>"`, 'info');
  log(`  Slash command: ${command}`, 'info');
  log(`  Model: ${model}`, 'info');
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
