/**
 * Agent process handler for Claude Code agent output processing.
 *
 * Attaches stdout/stderr/close/error handlers to spawned Claude processes
 * and resolves the returned promise with an AgentResult.
 */

import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import { log, AgentStateManager, type TokenUsageSnapshot, MAX_THINKING_TOKENS, TOKEN_LIMIT_THRESHOLD } from '../core';
import { parseJsonlOutput, type JsonlParserState, type ProgressCallback } from './jsonlParser';
import { computeTotalTokens } from '../core/tokenManager';
import type { AgentResult } from './claudeAgent';

/**
 * Attaches stdout/stderr/close/error handlers to a spawned Claude process and
 * resolves the returned promise with an {@link AgentResult}.
 */
export function handleAgentProcess(
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
        if (state.turnCount === 0) {
          log(`${agentName}: Agent exited successfully but produced no output (0 turns). The slash command may not be available in the working directory.`, 'warn');
        }
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
