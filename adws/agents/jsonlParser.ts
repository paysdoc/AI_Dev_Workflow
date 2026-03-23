/**
 * Backward-compatible re-export barrel.
 *
 * The JSONL parser has moved to adws/core/claudeStreamParser.ts —
 * it is a pure stream parser with no agent-specific logic.
 */
export {
  parseJsonlOutput,
  extractTextFromAssistantMessage,
  extractToolUseFromMessage,
  type ProgressInfo,
  type ProgressCallback,
  type JsonlParserState,
  type ContentBlock,
  type TextContentBlock,
  type ToolUseContentBlock,
  type ToolResultContentBlock,
  type JsonlMessage,
  type JsonlAssistantMessage,
  type JsonlResultMessage,
} from '../core/claudeStreamParser';
