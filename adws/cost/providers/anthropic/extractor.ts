/**
 * Anthropic streaming token usage extractor.
 * Parses Claude CLI JSONL output and extracts token usage from the result message.
 *
 * Handles the mixed naming conventions in the CLI output:
 *   - Top-level cost field uses snake_case: total_cost_usd
 *   - modelUsage entries use camelCase: inputTokens, outputTokens, etc.
 */

import type { TokenUsageExtractor, ModelUsageMap, TokenUsageMap } from '../../types';

/** Shape of a per-model entry in the result message's modelUsage object. */
interface RawModelUsageEntry {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

/** Shape of the result JSONL message emitted by the Claude CLI. */
interface RawResultMessage {
  type: 'result';
  total_cost_usd?: number;
  modelUsage?: Record<string, RawModelUsageEntry>;
}

/** Converts a raw camelCase model usage entry to snake_case TokenUsageMap keys. */
function toTokenUsageMap(entry: RawModelUsageEntry): TokenUsageMap {
  const map: Record<string, number> = {};
  if (entry.inputTokens !== undefined) map['input'] = entry.inputTokens;
  if (entry.outputTokens !== undefined) map['output'] = entry.outputTokens;
  if (entry.cacheReadInputTokens !== undefined) map['cache_read'] = entry.cacheReadInputTokens;
  if (entry.cacheCreationInputTokens !== undefined) map['cache_write'] = entry.cacheCreationInputTokens;
  return map;
}

/** Extracts token usage and cost from Claude CLI JSONL output. */
export class AnthropicTokenUsageExtractor implements TokenUsageExtractor {
  private lineBuffer = '';
  private modelUsage: ModelUsageMap = {};
  private finalized = false;
  private reportedCostUsd: number | undefined = undefined;

  onChunk(chunk: string): void {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines[lines.length - 1] ?? '';

    for (const line of lines.slice(0, -1)) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          (parsed as Record<string, unknown>)['type'] === 'result'
        ) {
          this.handleResultMessage(parsed as RawResultMessage);
        }
      } catch {
        // silently skip invalid JSON lines
      }
    }
  }

  private handleResultMessage(msg: RawResultMessage): void {
    if (msg.total_cost_usd !== undefined) {
      this.reportedCostUsd = msg.total_cost_usd;
    }

    if (msg.modelUsage && typeof msg.modelUsage === 'object') {
      this.modelUsage = Object.fromEntries(
        Object.entries(msg.modelUsage).map(([model, entry]) => [model, toTokenUsageMap(entry)]),
      );
    }

    this.finalized = true;
  }

  getCurrentUsage(): ModelUsageMap {
    return { ...this.modelUsage };
  }

  isFinalized(): boolean {
    return this.finalized;
  }

  getReportedCostUsd(): number | undefined {
    return this.reportedCostUsd;
  }
}
