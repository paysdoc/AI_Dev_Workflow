/**
 * Agent process handler for Claude Code agent output processing.
 *
 * Attaches stdout/stderr/close/error handlers to spawned Claude processes
 * and resolves the returned promise with an AgentResult.
 */

import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log, AgentStateManager, type TokenUsageSnapshot, MAX_THINKING_TOKENS, TOKEN_LIMIT_THRESHOLD } from '../core';
import { parseJsonlOutput, type JsonlParserState, type ProgressCallback, type ProgressInfo } from '../core/claudeStreamParser';
import { AnthropicTokenUsageExtractor, computeCost, getAnthropicPricing, type ModelUsageMap, computeTotalTokens } from '../cost';
import type { ModelUsageMap as CostModelUsageMap } from '../cost/types';
import type { AgentResult } from '../types/agentTypes';

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
      primaryModel: model,
    };

    const extractor = new AnthropicTokenUsageExtractor(model);

    let tokenLimitReached = false;
    let authErrorDetected = false;
    let compactionDetected = false;
    let rateLimitDetected = false;
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

      // Detect fatal authentication errors (e.g. expired OAuth tokens) and kill immediately
      // rather than letting Claude Code CLI retry for hours with exponential backoff.
      if (!authErrorDetected && text.includes('"subtype":"api_retry"') && text.includes('authentication_error')) {
        authErrorDetected = true;
        log(`${agentName}: Fatal authentication error detected — killing process to avoid hours of futile retries.`, 'error');
        if (statePath) {
          AgentStateManager.appendLog(statePath, 'Terminated: OAuth token expired or authentication failed');
        }
        claude.kill('SIGTERM');
      }

      // Rate limit / API outage detection.
      // Patterns must be specific enough to avoid false positives from agent output
      // (e.g., git log containing commit messages with these keywords).
      // "You've hit your limit" and "You're out of extra usage" are Claude CLI UI messages
      // that don't appear in tool output. The others use "type":"error" JSON prefix to
      // ensure we only match actual API error responses, not arbitrary text.
      if (!rateLimitDetected && (
        text.includes("You've hit your limit") ||
        text.includes("You're out of extra usage") ||
        (text.includes('"type":"error"') && (
          text.includes('"overloaded_error"') ||
          text.includes('502 Bad Gateway') ||
          text.includes('"Invalid authentication credentials"')
        ))
      )) {
        rateLimitDetected = true;
        log(`${agentName}: Rate limit / API outage detected — killing process to trigger pause.`, 'warn');
        if (statePath) {
          AgentStateManager.appendLog(statePath, 'Terminated: Rate limit or API outage detected');
        }
        claude.kill('SIGTERM');
      }

      if (!compactionDetected && text.includes('"subtype":"compact_boundary"')) {
        compactionDetected = true;
        log(`${agentName}: Context compaction detected — killing process to restart with fresh context.`, 'info');
        if (statePath) {
          AgentStateManager.appendLog(statePath, 'Terminated: Context compaction detected');
        }
        claude.kill('SIGTERM');
      }

      if (!tokenLimitReached) {
        const currentUsage = extractor.getCurrentUsage();
        const primaryModel = state.primaryModel;
        const currentTotalTokens = Object.entries(currentUsage)
          .filter(([m]) => !primaryModel || m.toLowerCase().includes(primaryModel.toLowerCase()))
          .reduce(
            (sum, [, tokens]) => sum + (tokens['output'] ?? 0),
            0,
          );
        if (currentTotalTokens >= tokenThreshold) {
          tokenLimitReached = true;
          log(`${agentName}: Output token limit threshold reached (${currentTotalTokens}/${MAX_THINKING_TOKENS} output tokens, ${(TOKEN_LIMIT_THRESHOLD * 100).toFixed(0)}%). Terminating agent.`, 'info');
          if (statePath) {
            AgentStateManager.appendLog(statePath, `Output token limit threshold reached: ${currentTotalTokens}/${MAX_THINKING_TOKENS}`);
          }
          claude.kill('SIGTERM');
        }
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

      // Convert extractor usage to old-format ModelUsageMap for orchestrator compatibility.
      const resolvedModelUsage: ModelUsageMap | undefined = Object.keys(extractorUsage).length > 0
        ? toOldModelUsageMap(extractorUsage)
        : undefined;

      const costSource: AgentResult['costSource'] = extractorFinalized
        ? 'extractor_finalized'
        : 'extractor_estimated';

      if (rateLimitDetected) {
        log(`${agentName} terminated due to rate limit / API outage`, 'warn');
        resolve({
          success: false,
          rateLimited: true,
          output: state.fullOutput || 'Rate limit or API outage detected',
          totalCostUsd,
          modelUsage: resolvedModelUsage,
          estimatedUsage,
          actualUsage: extractorFinalized ? extractorUsage : undefined,
          costSource,
          statePath,
        });
        return;
      }

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

      if (compactionDetected) {
        log(`${agentName} terminated due to context compaction`, 'info');
        resolve({
          success: true,
          compactionDetected: true,
          output: state.lastResult?.result || state.fullOutput,
          partialOutput: state.fullOutput,
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
          authExpired: authErrorDetected,
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
