import type { IssueClassSlashCommand, SlashCommand } from './issueTypes';
import type { OrchestratorIdType } from '../core/constants';
import type { LegacyModelUsageMap } from '../cost/types';

/**
 * Result returned by runClaudeAgentWithCommand.
 * Shared between claudeAgent.ts and agentProcessHandler.ts to avoid bidirectional coupling.
 */
export interface AgentResult {
  success: boolean;
  output: string;
  sessionId?: string;
  totalCostUsd?: number;
  /** Per-model token usage breakdown from the Claude CLI. */
  modelUsage?: LegacyModelUsageMap;
  /** The state path if state tracking was enabled */
  statePath?: string;
  /** True when the agent was terminated due to approaching the token limit. */
  tokenLimitExceeded?: boolean;
  /** True when the agent was terminated due to context compaction detection. */
  compactionDetected?: boolean;
  /** Token usage snapshot at the time of interruption. */
  tokenUsage?: TokenUsageSnapshot;
  /** Partial output captured before token limit termination. */
  partialOutput?: string;
  /**
   * Pre-finalization estimated usage snapshot (input + cache from per-turn streaming, output from estimation).
   * Available for estimate-vs-actual comparison when costSource is 'extractor_finalized'.
   */
  estimatedUsage?: Record<string, Record<string, number>>;
  /**
   * Actual usage from the extractor after finalization (mirrors result message data in snake_case format).
   * Only available when costSource is 'extractor_finalized'.
   */
  actualUsage?: Record<string, Record<string, number>>;
  /** Indicates whether cost data came from a finalized result message or from streaming estimates. */
  costSource?: 'extractor_finalized' | 'extractor_estimated';
  /** True when the agent was terminated due to an expired OAuth token or authentication failure. */
  authExpired?: boolean;
  /** True when the agent was terminated due to a rate limit, billing limit, or transient API outage. */
  rateLimited?: boolean;
}

/**
 * Thrown when a Claude agent encounters a rate limit, billing limit, or API outage.
 * Propagates through runPhase() to trigger pause-and-resume mechanics.
 */
export class RateLimitError extends Error {
  readonly phaseName: string;
  constructor(phaseName: string) {
    super(`Rate limit detected during phase: ${phaseName}`);
    this.name = 'RateLimitError';
    this.phaseName = phaseName;
  }
}

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
 * Cost fields are handled by AnthropicTokenUsageExtractor — not parsed here.
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
}

/**
 * Snapshot of cumulative token usage at a point in time.
 */
export interface TokenUsageSnapshot {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheCreationTokens: number;
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
  // Step definition agent
  | 'step-def-agent'
  // Install agent
  | 'install-agent'
  // Plan validation agents
  | 'validation-agent'
  | 'resolution-agent'
  // Single-pass alignment agent
  | 'alignment-agent'
  // Dependency extraction agent
  | 'dependency-extraction-agent';

/**
 * Execution status for tracking agent progress.
 */
export type AgentExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused';

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
 * Execution state for a single workflow phase.
 * Stored in the top-level state file's `phases` map.
 */
export interface PhaseExecutionState {
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** ISO 8601 timestamp when the phase started */
  startedAt: string;
  /** ISO 8601 timestamp when the phase completed (success or failure) */
  completedAt?: string;
  /** Optional output or summary captured from the phase */
  output?: string;
}

/**
 * Core agent state stored in state.json.
 * Contains all context needed for workflow execution and recovery.
 */
export interface AgentState {
  /** Unique ADW session identifier */
  adwId: string;
  /** GitHub issue number being addressed */
  issueNumber: number | null;
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
  /** Granular lifecycle stage of the workflow (e.g. "build_running", "completed") */
  workflowStage?: string;
  /** Per-phase execution state map: phaseName → PhaseExecutionState */
  phases?: Record<string, PhaseExecutionState>;
  /** Orchestrator script path (e.g. "adws/adwSdlc.tsx") */
  orchestratorScript?: string;
}
