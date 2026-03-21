/**
 * Agent process handler for Claude Code agent output processing.
 *
 * Attaches stdout/stderr/close/error handlers to spawned Claude processes
 * and resolves the returned promise with an AgentResult.
 */

import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log, AgentStateManager, type TokenUsageSnapshot, MAX_THINKING_TOKENS, TOKEN_LIMIT_THRESHOLD, type ModelUsageMap } from '../core';
import { parseJsonlOutput, type JsonlParserState, type ProgressCallback, type ProgressInfo } from './jsonlParser';
import { computeTotalTokens } from '../core/tokenManager';
import type { AgentResult } from './claudeAgent';
import { AnthropicTokenUsageExtractor, computeCost, getAnthropicPricing } from '../cost';
import type { ModelUsageMap as CostModelUsageMap } from '../cost/types';

/** Computes estimated total cost USD by summing across all models using Anthropic pricing. */
function computeEstimatedCostUsd(usage: CostModelUsageMap): number {
  return Object.entries(usage).reduce((total, [model, tokens]) => {
    return total + computeCost(tokens, getAnthropicPricing(model));
  }, 0);
}

/**
 * Converts the new-format ModelUsageMap (snake_case keys) to the old-format
 * ModelUsageMap (camelCase fields) for backward compatibility with existing cost reporting.
 */
function toOldModelUsageMap(usage: CostModelUsageMap): ModelUsageMap {
  return Object.fromEntries(
    Object.entries(usage).map(([model, tokens]) => [
      model,
      {
        inputTokens: tokens['input'] ?? 0,
        outputTokens: tokens['output'] ?? 0,
        cacheReadInputTokens: tokens['cache_read'] ?? 0,
        cacheCreationInputTokens: tokens['cache_write'] ?? 0,
        costUSD: computeCost(tokens, getAnthropicPricing(model)),
      },
    ]),
  );
}

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

    const extractor = new AnthropicTokenUsageExtractor(model);

    let tokenLimitReached = false;
    const tokenThreshold = MAX_THINKING_TOKENS * TOKEN_LIMIT_THRESHOLD;

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    const outputStream = fs.createWriteStream(outputFile, { flags: 'a' });

    // Wrap onProgress to inject real-time token estimate from the extractor
    const wrappedOnProgress: ProgressCallback | undefined = onProgress
      ? (info: ProgressInfo) => onProgress({ ...info, tokenEstimate: extractor.getCurrentUsage() })
      : undefined;

    claude.stdout!.on('data', (data: Buffer) => {
      const text = data.toString();
      outputStream.write(text);
      extractor.onChunk(text);
      parseJsonlOutput(text, state, wrappedOnProgress, statePath);

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
          tokenEstimate: extractor.getCurrentUsage(),
        });
      }

      // Write final state summary if statePath provided
      if (statePath) {
        AgentStateManager.appendLog(
          statePath,
          `Completed: exit code ${code}, turns: ${state.turnCount}, tools: ${state.toolCount}`
        );
      }

      // Build cost fields from extractor
      const extractorFinalized = extractor.isFinalized();
      const extractorUsage = extractor.getCurrentUsage();
      const estimatedUsage = extractor.getEstimatedUsage();

      const totalCostUsd = extractorFinalized
        ? extractor.getReportedCostUsd()
        : computeEstimatedCostUsd(extractorUsage);

      // Use old-format modelUsage from parseJsonlOutput when finalized (preserves costUSD per model),
      // otherwise convert extractor estimated data for failed/partial runs.
      const resolvedModelUsage: ModelUsageMap | undefined = state.modelUsage
        ?? (Object.keys(extractorUsage).length > 0 ? toOldModelUsageMap(extractorUsage) : undefined);

      const costSource: AgentResult['costSource'] = extractorFinalized
        ? 'extractor_finalized'
        : 'extractor_estimated';

      if (tokenLimitReached) {
        log(`${agentName} terminated due to token limit`, 'info');
        const tokenTotals = resolvedModelUsage ? computeTotalTokens(resolvedModelUsage) : undefined;
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
          totalCostUsd,
          modelUsage: resolvedModelUsage,
          estimatedUsage,
          actualUsage: extractorFinalized ? extractorUsage : undefined,
          costSource,
          statePath,
        });
        return;
      }

      if (code === 0 && state.lastResult) {
        log(`${agentName} completed successfully`, 'success');
        if (totalCostUsd) {
          log(`  Cost: $${totalCostUsd.toFixed(4)}`, 'info');
        }
        if (resolvedModelUsage) {
          const modelNames = Object.keys(resolvedModelUsage);
          log(`  Models used: ${modelNames.join(', ')}`, 'info');
        }
        resolve({
          success: !state.lastResult.isError,
          output: state.lastResult.result || state.fullOutput,
          sessionId: state.lastResult.sessionId,
          totalCostUsd,
          modelUsage: resolvedModelUsage,
          estimatedUsage,
          actualUsage: extractorFinalized ? extractorUsage : undefined,
          costSource,
          statePath,
        });
      } else if (code === 0) {
        if (state.turnCount === 0) {
          log(`${agentName}: Agent exited successfully but produced no output (0 turns). The slash command may not be available in the working directory.`, 'warn');
        }
        resolve({
          success: true,
          output: state.fullOutput,
          totalCostUsd,
          modelUsage: resolvedModelUsage,
          estimatedUsage,
          actualUsage: extractorFinalized ? extractorUsage : undefined,
          costSource,
          statePath,
        });
      } else {
        log(`${agentName} exited with code ${code}`, 'error');
        if (totalCostUsd !== undefined) {
          log(`  Accumulated cost (estimates): $${totalCostUsd.toFixed(4)}`, 'info');
        }
        resolve({
          success: false,
          output: state.fullOutput || 'Agent failed without output',
          totalCostUsd,
          modelUsage: resolvedModelUsage,
          estimatedUsage,
          actualUsage: extractorFinalized ? extractorUsage : undefined,
          costSource,
          statePath,
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
        statePath,
      });
    });
  });
}
