import type { IssueClassSlashCommand, SlashCommand } from './issueTypes';
import type { OrchestratorIdType } from '../core/constants';

/**
 * Claude Code agent prompt configuration.
 */
export interface AgentPromptRequest {
  prompt: string;
  adwId: string;
  agentName: string;
  model: 'sonnet' | 'opus' | 'haiku';
  dangerouslySkipPermissions: boolean;
  outputFile: string;
}

/**
 * Claude Code agent response.
 */
export interface AgentPromptResponse {
  output: string;
  success: boolean;
  sessionId?: string | null;
}

/**
 * Claude Code agent template execution request.
 */
export interface AgentTemplateRequest {
  agentName: string;
  slashCommand: SlashCommand;
  args: string[];
  adwId: string;
  model: 'sonnet' | 'opus' | 'haiku';
}

/**
 * Claude Code JSONL result message (last line).
 */
export interface ClaudeCodeResultMessage {
  type: string;
  subtype: string;
  isError: boolean;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  result: string;
  sessionId: string;
  totalCostUsd: number;
  /** Per-model token usage breakdown from the Claude CLI (available in recent versions). */
  modelUsage?: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
  }>;
}

/**
 * Snapshot of cumulative token usage at a point in time.
 */
export interface TokenUsageSnapshot {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly thresholdPercent: number;
}

/**
 * Agent identifier for consistent naming across the state system.
 */
export type AgentIdentifier =
  | 'orchestrator'
  | OrchestratorIdType
  | 'classifier'
  | 'plan-agent'
  | 'build-agent'
  | 'pr-review-plan-agent'
  | 'pr-review-build-agent'
  // Test workflow agents
  | 'test-agent'
  | 'test-resolver-agent'
  // Review workflow agents
  | 'review-agent'
  | 'review-agent-1'
  | 'review-agent-2'
  | 'review-agent-3'
  | 'patch-agent'
  // Git workflow agents
  | 'branchName-agent'
  | 'commit-agent'
  // PR and document agents
  | 'pr-agent'
  | 'document-agent'
  // KPI tracking agent
  | 'kpi-agent'
  // Scenario agent
  | 'scenario-agent'
  // Plan validation agents
  | 'validation-agent'
  | 'resolution-agent'
  // Dependency extraction agent
  | 'dependency-extraction-agent';

/**
 * Execution status for tracking agent progress.
 */
export type AgentExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

/**
 * Agent execution state for tracking progress.
 */
export interface AgentExecutionState {
  /** Current execution status */
  status: AgentExecutionStatus;
  /** ISO 8601 timestamp when agent started */
  startedAt: string;
  /** ISO 8601 timestamp when agent completed (if applicable) */
  completedAt?: string;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Core agent state stored in state.json.
 * Contains all context needed for workflow execution and recovery.
 */
export interface AgentState {
  /** Unique ADW session identifier */
  adwId: string;
  /** GitHub issue number being addressed */
  issueNumber: number;
  /** Git branch name for the feature/fix */
  branchName?: string;
  /** Path to the implementation plan file */
  planFile?: string;
  /** Issue classification (slash command) */
  issueClass?: IssueClassSlashCommand;
  /** OS process ID of the orchestrator process (for liveness checks) */
  pid?: number;
  /** Agent identifier */
  agentName: AgentIdentifier;
  /** Parent agent identifier (for nested agents) */
  parentAgent?: AgentIdentifier;
  /** Execution state */
  execution: AgentExecutionState;
  /** Agent-specific output or summary */
  output?: string;
  /** Additional metadata for agent-specific data */
  metadata?: Record<string, unknown>;
}
