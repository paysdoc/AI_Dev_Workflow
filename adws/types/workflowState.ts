/**
 * Structured workflow state types — namespaced per-phase output interfaces.
 *
 * Each phase produces a typed state object capturing its semantic output.
 * The aggregate WorkflowState and WorkflowPhaseState collect them under
 * namespaced keys. All interfaces are JSON-serializable: no functions,
 * class instances, or circular references.
 *
 * The PhaseResultStore class provides a runtime mechanism for orchestrators
 * to access phase results with type safety via a bounded generic accessor.
 */

import type { IssueClassSlashCommand } from './issueTypes';
import type { PhaseResult } from '../core/phaseRunner';

/**
 * Semantic output of the Install phase.
 * Captures the cached project context string injected into subsequent agents.
 */
export interface InstallPhaseState {
  /** The cached project context string, or undefined if install failed or produced no context. */
  installContext?: string;
}

/**
 * Semantic output of the Plan phase.
 * Captures plan file path, branch name, and output written to config.ctx after plan completes.
 */
export interface PlanPhaseState {
  /** The issue type classified during the plan phase. */
  issueType?: IssueClassSlashCommand;
  /** Branch name created for this workflow. */
  branchName?: string;
  /** Path to the generated plan file (relative to worktree). */
  planPath?: string;
  /** Raw plan output captured from the plan agent. */
  planOutput?: string;
}

/**
 * Semantic output of the Build phase.
 * Captures the primary output and progress written to config.ctx after build completes.
 */
export interface BuildPhaseState {
  /** Build output summary, or undefined if not captured. */
  buildOutput?: string;
  /** Build progress snapshot at phase completion. */
  buildProgress?: {
    turnCount: number;
    toolCount: number;
    lastToolName?: string;
    lastText?: string;
  };
}

/**
 * Semantic output of the Test phase.
 * Captures unit test results from the executeTestPhase() return value.
 */
export interface TestPhaseState {
  /** Whether unit tests passed. */
  unitTestsPassed?: boolean;
  /** Total number of test retry attempts. */
  totalRetries?: number;
}

/**
 * Semantic output of the PR phase.
 * Captures PR URL and number written to config.ctx after PR creation.
 */
export interface PRPhaseState {
  /** URL of the created pull request, or undefined if creation failed. */
  prUrl?: string;
  /** Number of the created pull request, or undefined if creation failed. */
  prNumber?: number;
}

/**
 * Namespaced per-phase state for declarative orchestrators.
 * Replaces flat WorkflowContext for orchestrators that opt in via the
 * declarative runner. Each namespace holds only phase-produced data —
 * init-time data (issue, adwId, worktreePath, branchName, projectConfig)
 * stays on WorkflowConfig.
 *
 * All types are JSON-serializable (primitives, plain objects, arrays only).
 */
export interface WorkflowPhaseState {
  install: Partial<InstallPhaseState>;
  plan: Partial<PlanPhaseState>;
  build: Partial<BuildPhaseState>;
  test: Partial<TestPhaseState>;
  pr: Partial<PRPhaseState>;
}

/**
 * Returns an empty WorkflowPhaseState with all namespaces initialized.
 */
export function createEmptyPhaseState(): WorkflowPhaseState {
  return {
    install: {},
    plan: {},
    build: {},
    test: {},
    pr: {},
  };
}

/**
 * Semantic output of the Diff Evaluation phase.
 * Captures the LLM diff evaluator verdict used for branch routing.
 */
export interface DiffEvalPhaseState {
  /** The diff evaluation verdict: 'safe' for auto-merge, 'regression_possible' for escalation. */
  readonly verdict: 'safe' | 'regression_possible';
}

/**
 * Aggregate workflow state collecting optional per-phase output.
 * Properties are optional because phases execute incrementally —
 * a phase's section is populated only after that phase completes.
 *
 * JSON-serializable: no functions, class instances, or circular references.
 *
 * @deprecated Use WorkflowPhaseState with createEmptyPhaseState() for new orchestrators.
 */
export interface WorkflowState {
  readonly install?: InstallPhaseState;
  readonly plan?: PlanPhaseState;
  readonly build?: BuildPhaseState;
  readonly test?: TestPhaseState;
  readonly pr?: PRPhaseState;
  readonly diffEval?: DiffEvalPhaseState;
}

/**
 * Typed wrapper around a heterogeneous map of phase results.
 *
 * Allows orchestrator completionMetadata callbacks to retrieve phase-specific
 * return fields with type safety, without using `any`. The caller provides
 * an explicit type parameter at the call site — the orchestrator author
 * knows which phase produces which result type.
 *
 * @example
 * const store = new PhaseResultStore();
 * store.set('test', testResult);
 * const result = store.get<TestPhaseResult>('test');
 * if (result) console.log(result.unitTestsPassed);
 */
export class PhaseResultStore {
  private readonly _store = new Map<string, PhaseResult>();

  /**
   * Stores a phase result under the given phase name.
   * @param name - The phase name used as the key.
   * @param result - The phase result to store.
   */
  set(name: string, result: PhaseResult): void {
    this._store.set(name, result);
  }

  /**
   * Retrieves a phase result cast to the requested type.
   * Returns undefined if no result exists for the given phase name.
   *
   * The caller is responsible for providing the correct type parameter
   * matching the phase function's return type.
   *
   * @param name - The phase name to look up.
   * @returns The phase result cast to T, or undefined if not found.
   */
  get<T extends PhaseResult>(name: string): T | undefined {
    return this._store.get(name) as T | undefined;
  }
}
