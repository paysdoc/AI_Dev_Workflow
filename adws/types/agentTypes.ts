import type { IssueClassSlashCommand, SlashCommand } from './issueTypes';
import type { OrchestratorIdType } from '../core/constants';
import type { LegacyModelUsageMap } from '../cost/types';

/**
 * Both fields come from the undocumented `rate_limit_info` object of a rejected
 * `rate_limit_event` — the CLI may drop that event in a future release. `resetsAt` is
 * Unix epoch seconds, exactly as the CLI emits it (no conversion at this boundary).
 * Both are absent whenever no rejected event was seen.
 */
export interface RateLimitFacts {
  rateLimitType?: string;
  resetsAt?: number;
}

/** Shared between claudeAgent.ts and agentProcessHandler.ts to avoid bidirectional coupling. */
export interface AgentResult extends RateLimitFacts {
  success: boolean;
  output: string;
  sessionId?: string;
  totalCostUsd?: number;
  modelUsage?: LegacyModelUsageMap;
  statePath?: string;
  tokenLimitExceeded?: boolean;
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
  costSource?: 'extractor_finalized' | 'extractor_estimated';
  authExpired?: boolean;
  /**
   * True when the agent was terminated for a documented rate-limit/overload/server-error
   * signal or a rejected `rate_limit_event`; `rateLimitType`/`resetsAt` are set when a
   * rejected event supplied them.
   */
  rateLimited?: boolean;
  /** Count of permission-denied (and other errored) tool calls observed in the run's stream. */
  deniedToolCallCount?: number;
}

/**
 * Thrown when a Claude agent encounters a rate limit, billing limit, or API outage.
 * Propagates through runPhase() to trigger pause-and-resume mechanics.
 */
export class RateLimitError extends Error {
  readonly phaseName: string;
  readonly rateLimitType?: string;
  readonly resetsAt?: number;
  constructor(phaseName: string, facts: RateLimitFacts = {}) {
    super(`Rate limit detected during phase: ${phaseName}`);
    this.name = 'RateLimitError';
    this.phaseName = phaseName;
    this.rateLimitType = facts.rateLimitType;
    this.resetsAt = facts.resetsAt;
  }
}

/** Caught by runPhase() which writes the phase as failed and calls handlePhaseTimeout (exit 0). */
export class AgentTimeoutError extends Error {
  readonly agentName: string;
  readonly phaseName: string | undefined;
  readonly timeoutMs: number;
  constructor(agentName: string, phaseName: string | undefined, timeoutMs: number) {
    super(`Agent timeout after ${timeoutMs} ms during phase: ${phaseName ?? 'unknown'} (agent: ${agentName})`);
    this.name = 'AgentTimeoutError';
    this.agentName = agentName;
    this.phaseName = phaseName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when a Claude agent encounters an authentication failure (HTTP 401 / OAuth expired).
 * Propagates to orchestrator main() which writes agents/.auth_gate and exits 0.
 */
export class AuthRequiredError extends Error {
  readonly agentName: string;
  constructor(agentName: string) {
    super(`Authentication required for agent: ${agentName}`);
    this.name = 'AuthRequiredError';
    this.agentName = agentName;
  }
}

export interface AgentPromptRequest {
  prompt: string;
  adwId: string;
  agentName: string;
  model: 'sonnet' | 'opus' | 'haiku';
  dangerouslySkipPermissions: boolean;
  outputFile: string;
}

export interface AgentPromptResponse {
  output: string;
  success: boolean;
  sessionId?: string | null;
}

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
  /**
   * The CLI emits these two fields as snake_case today; the camelCase fields above are a
   * known drift owned by the PRD's envelope-gate issue, not corrected here.
   */
  is_error?: boolean;
  api_error_status?: number | null;
}

export interface TokenUsageSnapshot {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly maxTokens: number;
  readonly thresholdPercent: number;
}

export type AgentIdentifier =
  | 'orchestrator'
  | OrchestratorIdType
  | 'classifier'
  | 'plan-agent'
  | 'build-agent'
  | 'pr-review-plan-agent'
  | 'pr-review-build-agent'
  | 'test-agent'
  | 'test-resolver-agent'
  | 'review-agent'
  | 'review-agent-1'
  | 'review-agent-2'
  | 'review-agent-3'
  | 'patch-agent'
  | 'branchName-agent'
  | 'commit-agent'
  | 'pr-agent'
  | 'document-agent'
  | 'scenario-agent'
  | 'step-def-agent'
  | 'install-agent'
  | 'validation-agent'
  | 'resolution-agent'
  | 'scenario-fidelity-agent'
  | 'alignment-agent'
  | 'dependency-extraction-agent'
  | 'review-patch'
  | 'scenario-fix'
  | 'refactor-agent';

export type AgentExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused';

export interface AgentExecutionState {
  status: AgentExecutionStatus;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

/** Stored in the top-level state file's `phases` map. */
export interface PhaseExecutionState {
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  output?: string;
  /** Canonical value: 'agent_timeout' (set by the watchdog path in phaseRunner.ts). */
  failureReason?: string;
}

/**
 * Repository identity (owner/repo) for a workflow. Persisted into top-level
 * state at initialization as a launch-boundary cross-check — NOT a source of
 * truth. A resuming process always uses its own launch identity; this value
 * exists only to detect (not silently resolve) a divergence. Distinct from
 * GitIdentity (git author/committer) and the provider RepoIdentifier.
 */
export interface RepoIdentity {
  owner: string;
  /** Repository name (without the owner prefix). */
  repo: string;
}

/** Core agent state stored in state.json. */
export interface AgentState {
  adwId: string;
  issueNumber: number | null;
  /** Assembled from the LLM-produced slug. */
  branchName?: string;
  planFile?: string;
  issueClass?: IssueClassSlashCommand;
  /** OS process ID of the orchestrator process (for liveness checks); paired with pidStartedAt for PID-reuse-safe liveness via processLiveness.isProcessLive. */
  pid?: number;
  /**
   * Platform start-time token recorded at orchestrator launch.
   * ISO 8601 when the platform supplies a normalised timestamp; otherwise the platform-native token:
   * Linux — `/proc/<pid>/stat` field 22 as a jiffies string.
   * macOS/BSD — `ps -o lstart=` output (e.g. "Sat Apr 20 10:00:00 2026").
   * Produced by processLiveness.getProcessStartTime; never re-normalised by the writer.
   */
  pidStartedAt?: string;
  /** ISO 8601 timestamp of the most recent heartbeat or phase-boundary write. */
  lastSeenAt?: string;
  agentName: AgentIdentifier;
  parentAgent?: AgentIdentifier;
  execution: AgentExecutionState;
  output?: string;
  metadata?: Record<string, unknown>;
  /** Granular lifecycle stage of the workflow (e.g. "build_running", "completed") */
  workflowStage?: string;
  /**
   * PR-resolution retry counter for the merge handoff (adwMerge). Incremented on each
   * `no_pr_found` miss; escalates to `merge_blocked` at `MAX_PR_RESOLUTION_ATTEMPTS`;
   * cleared on merge success and on `## Retry`.
   */
  mergeRetryCount?: number;
  /**
   * Resume-attempt counter for the bounded resume cap. Incremented on each automatic
   * resume of a `resumable` stage (`phase_timeout`); escalates to `human_gated` at
   * `MAX_RESUME_ATTEMPTS`; cleared (re-armed) on `## Retry`.
   */
  resumeAttempts?: number;
  phases?: Record<string, PhaseExecutionState>;
  /**
   * Repo identity (owner/repo) recorded at workflow init from the launch
   * boundary (GitContext). Read on resume as a cross-check only; the launch
   * boundary remains authoritative. Optional so state written before this
   * field existed resumes without backfill.
   */
  repoIdentity?: RepoIdentity;
  orchestratorScript?: string;
}
