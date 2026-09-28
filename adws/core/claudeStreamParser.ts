import type { ClaudeCodeResultMessage, RateLimitFacts } from '../types/agentTypes';
import { AgentStateManager } from './agentState';

/** The `system`/`api_retry` `error` enum documented in the Claude Code headless docs ("Handle API retries"). */
export enum ApiRetryErrorKind {
  AuthenticationFailed = 'authentication_failed',
  RateLimit = 'rate_limit',
  Overloaded = 'overloaded',
  ServerError = 'server_error',
}

export const HTTP_UNAUTHORIZED = 401;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_OVERLOADED = 529;

/** True for any 5xx other than the documented 529 (overloaded), which classifies separately. */
export function isServerErrorStatus(status: unknown): boolean {
  return typeof status === 'number' && status >= 500 && status < 600 && status !== HTTP_OVERLOADED;
}

/** Only server-error / unclassified `api_retry` signals keep the repeated-retry rule; auth, rate-limit and overload decide on any attempt. */
export const PAUSE_ON_RETRY_ATTEMPT = 2;

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

export interface JsonlParserState extends RateLimitFacts {
  lastResult: ClaudeCodeResultMessage | null;
  fullOutput: string;
  turnCount: number;
  toolCount: number;
  /** When set, token limit checks are filtered to only the primary model (e.g., 'opus'). */
  primaryModel?: string;
  /** Accumulates partial JSONL lines across `data` chunks. */
  lineBuffer: string;
  /**
   * Set by a documented `api_retry` `rate_limit`/429 on any attempt (including the first),
   * a terminal `result.api_error_status` of 429, or a rejected `rate_limit_event`.
   * `rateLimitType`/`resetsAt` are captured only from the rejected event — the enum/status
   * signals never carry them.
   */
  rateLimitDetected: boolean;
  /** Set by `authentication_failed`/401 on an `api_retry` (any attempt) or a terminal `result` 401. */
  authErrorDetected: boolean;
  /** Set by a `server_error`/other-5xx/unclassified `api_retry` on the second consecutive attempt, or a terminal `result` 5xx (excluding 529). */
  serverErrorDetected: boolean;
  /** Set by `overloaded`/529 on an `api_retry` (any attempt) or a terminal `result` 529. */
  overloadedErrorDetected: boolean;
  /** Set when a `system` `compact_boundary` is parsed. */
  compactionDetected: boolean;
  /** Count of tool results with `is_error: true` — includes permission denials from an injected deny rule. */
  deniedToolCallCount: number;
}

export function createJsonlParserState(primaryModel?: string): JsonlParserState {
  return {
    lastResult: null,
    fullOutput: '',
    turnCount: 0,
    toolCount: 0,
    ...(primaryModel !== undefined ? { primaryModel } : {}),
    lineBuffer: '',
    rateLimitDetected: false,
    authErrorDetected: false,
    serverErrorDetected: false,
    overloadedErrorDetected: false,
    compactionDetected: false,
    deniedToolCallCount: 0,
  };
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

/**
 * Ranks the documented `api_retry` enum and HTTP status against each other, applied
 * identically to the retry message and the terminal `result` envelope. A non-number
 * status (including `null` — "no HTTP response") never matches a status check.
 */
export function classifyApiSignal(error: unknown, status: unknown): 'auth' | 'rate_limit' | 'overloaded' | 'server_error' | undefined {
  if (error === ApiRetryErrorKind.AuthenticationFailed || status === HTTP_UNAUTHORIZED) return 'auth';
  if (error === ApiRetryErrorKind.RateLimit || status === HTTP_TOO_MANY_REQUESTS) return 'rate_limit';
  if (error === ApiRetryErrorKind.Overloaded || status === HTTP_OVERLOADED) return 'overloaded';
  if (error === ApiRetryErrorKind.ServerError || isServerErrorStatus(status)) return 'server_error';
  return undefined;
}

/** Only a rejected event marks the run rate-limited; only a rejected event's own facts are captured (the last rejected event in a stream wins). */
function applyRateLimitEvent(state: JsonlParserState, parsed: Record<string, unknown>): void {
  const info = parsed['rate_limit_info'] as Record<string, unknown> | undefined;
  if (info?.['status'] !== 'rejected') return;

  state.rateLimitDetected = true;
  if (typeof info['rateLimitType'] === 'string') {
    state.rateLimitType = info['rateLimitType'];
  }
  if (typeof info['resetsAt'] === 'number' && Number.isFinite(info['resetsAt'])) {
    state.resetsAt = info['resetsAt'];
  }
}

/**
 * Auth, rate-limit and overload decide on their own on any attempt (including the
 * first) — the CLI's own backoff already spaces retries, so a documented signal is
 * trusted immediately. Server-error and unclassified retries (billing_error,
 * invalid_request, unknown, ...) keep the repeated-retry rule: a single transient is
 * not distinguishable from a real outage until it recurs.
 */
function applyApiRetrySignal(state: JsonlParserState, parsed: Record<string, unknown>): void {
  const kind = classifyApiSignal(parsed['error'], parsed['error_status']);
  if (kind === 'auth') {
    state.authErrorDetected = true;
    return;
  }
  if (kind === 'rate_limit') {
    state.rateLimitDetected = true;
    return;
  }
  if (kind === 'overloaded') {
    state.overloadedErrorDetected = true;
    return;
  }
  // kind === 'server_error' or undefined (unclassified)
  const attempt = parsed['attempt'] as number | undefined;
  if (attempt !== undefined && attempt >= PAUSE_ON_RETRY_ATTEMPT) {
    state.serverErrorDetected = true;
  }
}

/** A terminal result is not a retry — the mapping fires immediately, with no attempt threshold. */
function applyResultSignal(state: JsonlParserState, parsed: Record<string, unknown>): void {
  const kind = classifyApiSignal(undefined, parsed['api_error_status']);
  if (kind === 'auth') state.authErrorDetected = true;
  else if (kind === 'rate_limit') state.rateLimitDetected = true;
  else if (kind === 'overloaded') state.overloadedErrorDetected = true;
  else if (kind === 'server_error') state.serverErrorDetected = true;
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
        applyRateLimitEvent(state, parsed as Record<string, unknown>);
      }

      if (parsed.type === 'system') {
        const subtype = (parsed as Record<string, unknown>).subtype as string | undefined;
        if (subtype === 'api_retry') {
          applyApiRetrySignal(state, parsed as Record<string, unknown>);
        }
        if (subtype === 'compact_boundary') {
          state.compactionDetected = true;
        }
      }

      if (parsed.type === 'result') {
        state.lastResult = parsed as unknown as ClaudeCodeResultMessage;
        applyResultSignal(state, parsed as Record<string, unknown>);
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
