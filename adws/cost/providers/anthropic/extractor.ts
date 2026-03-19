/**
 * Anthropic streaming token usage extractor.
 * Parses Claude CLI JSONL output and extracts token usage from both per-turn
 * `assistant` messages (real-time estimates) and the final `result` message (actuals).
 *
 * Handles the mixed naming conventions in the CLI output:
 *   - Top-level cost field uses snake_case: total_cost_usd
 *   - modelUsage entries use camelCase: inputTokens, outputTokens, etc.
 *   - Per-turn message.usage uses snake_case: input_tokens, cache_creation_input_tokens, etc.
 */

import type { TokenUsageExtractor, ModelUsageMap, TokenUsageMap } from '../../types.ts';

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

/** Shape of the per-turn usage field in an assistant message. */
interface RawMessageUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Shape of the message field in an assistant JSONL message. */
interface RawAssistantMessageBody {
  id?: string;
  model?: string;
  usage?: RawMessageUsage;
  content?: Array<{ type: string; text?: string }>;
}

/** Shape of an assistant JSONL message. */
interface RawAssistantMessage {
  type: 'assistant';
  message: RawAssistantMessageBody;
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

/** Estimates output tokens from text content block character lengths (~4 chars/token). */
function estimateOutputTokens(content: Array<{ type: string; text?: string }> | undefined): number {
  if (!content) return 0;
  const totalChars = content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .reduce((sum, block) => sum + (block.text?.length ?? 0), 0);
  return Math.ceil(totalChars / 4);
}

/** Deep-clones a ModelUsageMap (one level of nesting). */
function cloneModelUsageMap(map: ModelUsageMap): ModelUsageMap {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { ...v }]));
}

/** Extracts token usage and cost from Claude CLI JSONL output. */
export class AnthropicTokenUsageExtractor implements TokenUsageExtractor {
  private lineBuffer = '';
  private modelUsage: ModelUsageMap = {};
  private finalized = false;
  private reportedCostUsd: number | undefined = undefined;

  /** Per-turn accumulated estimated usage, keyed by model. */
  private estimatedUsage: ModelUsageMap = {};
  /** Snapshot of estimatedUsage taken just before finalization. */
  private lastEstimatedUsage: ModelUsageMap = {};
  /** Tracks seen message IDs to deduplicate per-turn usage. */
  private readonly seenMessageIds = new Set<string>();
  /** Optional model hint used when the per-turn message does not include a model field. */
  private readonly modelHint: string | undefined;

  constructor(modelHint?: string) {
    this.modelHint = modelHint;
  }

  onChunk(chunk: string): void {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines[lines.length - 1] ?? '';

    for (const line of lines.slice(0, -1)) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (parsed === null || typeof parsed !== 'object') continue;
        const msg = parsed as Record<string, unknown>;

        if (msg['type'] === 'result') {
          this.handleResultMessage(parsed as RawResultMessage);
        } else if (msg['type'] === 'assistant') {
          this.handleAssistantMessage(parsed as RawAssistantMessage);
        }
      } catch {
        // silently skip invalid JSON lines
      }
    }
  }

  private handleAssistantMessage(msg: RawAssistantMessage): void {
    const body = msg.message;
    if (!body) return;

    // Determine the model key for accumulation
    const modelKey = body.model ?? this.modelHint ?? 'unknown';

    // Deduplicate by message.id
    if (body.id) {
      if (this.seenMessageIds.has(body.id)) {
        // Usage already counted for this message ID; still estimate output from content
        // (content blocks may arrive in separate messages with the same ID)
        // Actually per the plan: usage is deduplicated but all text blocks contribute to output estimation
        // We track per-id to avoid double-counting usage, but we do need to handle
        // that output estimation can be tricky with multiple content blocks.
        // Since the plan says "usage deduplicated, but all text blocks contribute to output estimation",
        // we skip the usage fields but still process content for output estimation.
        const outputEstimate = estimateOutputTokens(body.content);
        if (outputEstimate > 0) {
          const existing = this.estimatedUsage[modelKey] ?? {};
          this.estimatedUsage[modelKey] = {
            ...existing,
            output: (existing['output'] ?? 0) + outputEstimate,
          };
        }
        return;
      }
      this.seenMessageIds.add(body.id);
    }

    // Accumulate input and cache tokens from per-turn usage (these are accurate)
    const usage = body.usage;
    const existing = this.estimatedUsage[modelKey] ?? {};

    const outputEstimate = estimateOutputTokens(body.content);

    this.estimatedUsage[modelKey] = {
      input: (existing['input'] ?? 0) + (usage?.input_tokens ?? 0),
      cache_write: (existing['cache_write'] ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
      cache_read: (existing['cache_read'] ?? 0) + (usage?.cache_read_input_tokens ?? 0),
      output: (existing['output'] ?? 0) + outputEstimate,
    };
  }

  private handleResultMessage(msg: RawResultMessage): void {
    // Snapshot estimated usage before replacing with actuals
    this.lastEstimatedUsage = cloneModelUsageMap(this.estimatedUsage);

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
    if (this.finalized) {
      return { ...this.modelUsage };
    }
    return cloneModelUsageMap(this.estimatedUsage);
  }

  isFinalized(): boolean {
    return this.finalized;
  }

  getReportedCostUsd(): number | undefined {
    return this.reportedCostUsd;
  }

  getEstimatedUsage(): ModelUsageMap {
    if (this.finalized) {
      return cloneModelUsageMap(this.lastEstimatedUsage);
    }
    return cloneModelUsageMap(this.estimatedUsage);
  }
}
