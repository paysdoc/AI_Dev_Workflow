
/**
 * JSONL stream parsing logic for Claude Code agent output.
 * Handles parsing of streamed JSONL messages, extracting text content,
 * tool usage, and result information.
 *
 * Moved from adws/agents/jsonlParser.ts to adws/core/ — it is a pure parser
 * with no agent-specific logic, making core/ the correct home.
 */

import type { ClaudeCodeResultMessage } from '../types/agentTypes';
import { AgentStateManager } from './agentState';

// ---------------------------------------------------------------------------
// Content block types – discriminated union replacing `any` usage
// ---------------------------------------------------------------------------

/** A text content block within an assistant message. */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/** A tool-use content block within an assistant message. */
export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown> | string;
}

/** A tool-result content block within an assistant message. */
export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

/**
 * Discriminated union of all possible content blocks returned by Claude.
 */
export type ContentBlock = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock;

// ---------------------------------------------------------------------------
// JSONL message types – discriminated union replacing `any` usage
// ---------------------------------------------------------------------------

/** An assistant-type JSONL message containing content blocks. */
export interface JsonlAssistantMessage {
  type: 'assistant';
  message: {
    content: ContentBlock[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** A result-type JSONL message returned at the end of an agent run. */
export interface JsonlResultMessage {
  type: 'result';
  [key: string]: unknown;
}

/**
 * Discriminated union of all known JSONL message types emitted by Claude Code.
 * Unknown types are captured by the fallback interface.
 */
export type JsonlMessage = JsonlAssistantMessage | JsonlResultMessage | { type: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Progress callback types
// ---------------------------------------------------------------------------

/**
 * Progress information passed to the progress callback.
 */
export interface ProgressInfo {
  type: 'tool_use' | 'text' | 'summary';
  toolName?: string;
  toolInput?: string;
  text?: string;
  turnCount?: number;
  toolCount?: number;
  /** Real-time estimated token usage by model (injected by agentProcessHandler via the extractor). */
  tokenEstimate?: Record<string, Record<string, number>>;
}

/**
 * Callback function for progress updates during agent execution.
 */
export type ProgressCallback = (info: ProgressInfo) => void;

// ---------------------------------------------------------------------------
// Parser state
// ---------------------------------------------------------------------------

/**
 * Mutable state object tracked across calls to {@link parseJsonlOutput}.
 */
export interface JsonlParserState {
  lastResult: ClaudeCodeResultMessage | null;
  fullOutput: string;
  turnCount: number;
  toolCount: number;
  /** When set, token limit checks are filtered to only the primary model (e.g., 'opus'). */
  primaryModel?: string;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Extracts text content from Claude assistant messages.
 */
export function extractTextFromAssistantMessage(message: JsonlAssistantMessage['message'] | undefined): string {
  if (!message?.content) return '';
  return message.content
    .filter((block): block is TextContentBlock => block.type === 'text')
    .map(block => block.text + '\n')
    .join('');
}

/**
 * Extracts tool use information from an assistant message.
 */
export function extractToolUseFromMessage(message: JsonlAssistantMessage['message'] | undefined): { name: string; input: string }[] {
  if (!message?.content) return [];
  return message.content
    .filter((block): block is ToolUseContentBlock => block.type === 'tool_use')
    .map(block => ({
      name: block.name,
      input: typeof block.input === 'object'
        ? JSON.stringify(block.input).substring(0, 200)
        : String(block.input).substring(0, 200),
    }));
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parses JSONL output from Claude and extracts result information.
 */
export function parseJsonlOutput(
  text: string,
  state: JsonlParserState,
  onProgress?: ProgressCallback,
  statePath?: string
): void {
  const lines = text.split('\n').filter(line => line.trim());

  for (const line of lines) {
    try {
      const parsed: JsonlMessage = JSON.parse(line);

      // Write raw JSONL to state output file if statePath provided
      if (statePath) {
        AgentStateManager.writeRawOutput(statePath, 'output.jsonl', parsed, true);
      }

      if (parsed.type === 'result') {
        state.lastResult = parsed as unknown as ClaudeCodeResultMessage;
      }

      if (parsed.type === 'assistant') {
        state.turnCount++;
        const assistantMsg = parsed as JsonlAssistantMessage;
        state.fullOutput += extractTextFromAssistantMessage(assistantMsg.message);

        // Extract and report tool usage
        const toolUses = extractToolUseFromMessage(assistantMsg.message);
        toolUses.forEach(tool => {
          state.toolCount++;
          if (onProgress) {
            onProgress({
              type: 'tool_use',
              toolName: tool.name,
              toolInput: tool.input,
              turnCount: state.turnCount,
              toolCount: state.toolCount,
            });
          }
          // Log tool usage to state
          if (statePath) {
            AgentStateManager.appendLog(statePath, `[Turn ${state.turnCount}] Tool: ${tool.name}`);
          }
        });

        // Report text content if present (for status updates)
        const textContent = extractTextFromAssistantMessage(assistantMsg.message).trim();
        if (textContent && onProgress) {
          onProgress({
            type: 'text',
            text: textContent.substring(0, 500),
            turnCount: state.turnCount,
          });
        }
      }
    } catch {
      state.fullOutput += line + '\n';
    }
  }
}
