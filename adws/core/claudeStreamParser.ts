import type { ClaudeCodeResultMessage } from '../types/agentTypes';
import { AgentStateManager } from './agentState';

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown> | string;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  /** True when the tool call failed — including a permission denial under an injected deny rule. */
  is_error?: boolean;
}

export type ContentBlock = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock;

export interface JsonlAssistantMessage {
  type: 'assistant';
  message: {
    content: ContentBlock[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JsonlResultMessage {
  type: 'result';
  [key: string]: unknown;
}

export type JsonlMessage = JsonlAssistantMessage | JsonlResultMessage | { type: string; [key: string]: unknown };

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

export type ProgressCallback = (info: ProgressInfo) => void;

export interface JsonlParserState {
  lastResult: ClaudeCodeResultMessage | null;
  fullOutput: string;
  turnCount: number;
  toolCount: number;
  /** When set, token limit checks are filtered to only the primary model (e.g., 'opus'). */
  primaryModel?: string;
  /** Accumulates partial JSONL lines across `data` chunks. */
  lineBuffer: string;
  /** Set when a `rate_limit_event` with `status === "rejected"` is parsed. */
  rateLimitRejected: boolean;
  /** Set when a `system` `api_retry` with `error === "authentication_error"` is parsed. */
  authErrorDetected: boolean;
  /** Set when a `system` `api_retry` with non-auth error and `attempt >= 2` is parsed. */
  serverErrorDetected: boolean;
  /** Set when a `system` `api_retry` with `error === "overloaded_error"` (HTTP 529) is parsed. */
  overloadedErrorDetected: boolean;
  /** Set when a `system` `compact_boundary` is parsed. */
  compactionDetected: boolean;
  /** Count of tool results with `is_error: true` — includes permission denials from an injected deny rule. */
  deniedToolCallCount: number;
}

export function extractTextFromAssistantMessage(message: JsonlAssistantMessage['message'] | undefined): string {
  if (!message?.content) return '';
  return message.content
    .filter((block): block is TextContentBlock => block.type === 'text')
    .map(block => block.text + '\n')
    .join('');
}

function countErroredToolResultBlocks(message: JsonlAssistantMessage['message'] | undefined): number {
  if (!message?.content) return 0;
  return message.content.filter(
    (block): block is ToolResultContentBlock => block.type === 'tool_result' && block.is_error === true,
  ).length;
}

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

export function parseJsonlOutput(
  text: string,
  state: JsonlParserState,
  onProgress?: ProgressCallback,
  statePath?: string
): void {
  const combined = state.lineBuffer + text;
  const segments = combined.split('\n');

  // If the chunk does not end with \n, the last segment is a partial line — buffer it
  if (!text.endsWith('\n')) {
    state.lineBuffer = segments.pop()!;
  } else {
    state.lineBuffer = '';
  }

  const lines = segments.filter(line => line.trim());

  for (const line of lines) {
    try {
      const parsed: JsonlMessage = JSON.parse(line);

      if (statePath) {
        AgentStateManager.writeRawOutput(statePath, 'output.jsonl', parsed, true);
      }

      // The CLI emits tool_result both as a top-level message (proven shape —
      // extractInstallContext() in installPhase.ts already reads is_error off it)
      // and nested inside an assistant message's content blocks.
      if (parsed.type === 'tool_result' && (parsed as Record<string, unknown>).is_error === true) {
        state.deniedToolCallCount++;
      }

      if (parsed.type === 'rate_limit_event') {
        const info = (parsed as Record<string, unknown>).rate_limit_info as Record<string, unknown> | undefined;
        if (info?.status === 'rejected') {
          state.rateLimitRejected = true;
        }
      }

      if (parsed.type === 'system') {
        const subtype = (parsed as Record<string, unknown>).subtype as string | undefined;
        if (subtype === 'api_retry') {
          const error = (parsed as Record<string, unknown>).error as string | undefined;
          const errorStatus = (parsed as Record<string, unknown>).error_status as number | undefined;
          if (errorStatus === 401 || (error !== undefined && error.startsWith('authentication'))) {
            state.authErrorDetected = true;
          } else if (error === 'overloaded_error') {
            state.overloadedErrorDetected = true;
          } else {
            const attempt = (parsed as Record<string, unknown>).attempt as number | undefined;
            if (attempt !== undefined && attempt >= 2) {
              state.serverErrorDetected = true;
            }
          }
        }
        if (subtype === 'compact_boundary') {
          state.compactionDetected = true;
        }
      }

      if (parsed.type === 'result') {
        state.lastResult = parsed as unknown as ClaudeCodeResultMessage;
      }

      if (parsed.type === 'assistant') {
        state.turnCount++;
        const assistantMsg = parsed as JsonlAssistantMessage;
        state.fullOutput += extractTextFromAssistantMessage(assistantMsg.message);
        state.deniedToolCallCount += countErroredToolResultBlocks(assistantMsg.message);

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
          if (statePath) {
            AgentStateManager.appendLog(statePath, `[Turn ${state.turnCount}] Tool: ${tool.name}`);
          }
        });

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
