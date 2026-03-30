/**
 * Structured workflow state types — namespaced per-phase output interfaces.
 *
 * Each phase produces a typed state object capturing its semantic output.
 * The aggregate WorkflowState collects them under optional namespaced keys.
 * All interfaces are JSON-serializable: no functions, class instances, or
 * circular references.
 *
 * The PhaseResultStore class provides a runtime mechanism for orchestrators
 * to access phase results with type safety via a bounded generic accessor.
 */

import type { PhaseResult } from '../core/phaseRunner';

/**
 * Semantic output of the Install phase.
 * Captures the cached project context string injected into subsequent agents.
 */
export interface InstallPhaseState {
  /** The cached project context string, or undefined if install failed or produced no context. */
  readonly installContext: string | undefined;
}

/**
 * Semantic output of the Plan phase.
 * Captures plan file path and branch name written to config.ctx after plan completes.
 */
export interface PlanPhaseState {
  /** Path to the generated plan file (relative to worktree). */
  readonly planPath: string | undefined;
  /** Branch name created for this workflow. */
  readonly branchName: string | undefined;
}

/**
 * Semantic output of the Build phase.
 * Captures the primary output written to config.ctx after build completes.
 */
export interface BuildPhaseState {
  /** Build output summary, or undefined if not captured. */
  readonly buildOutput: string | undefined;
}

/**
 * Semantic output of the Test phase.
 * Captures unit test results from the executeTestPhase() return value.
 */
export interface TestPhaseState {
  /** Whether unit tests passed. */
  readonly unitTestsPassed: boolean;
  /** Total number of test retry attempts. */
  readonly totalRetries: number;
}

/**
 * Semantic output of the PR phase.
 * Captures PR URL and number written to config.ctx after PR creation.
 */
export interface PRPhaseState {
  /** URL of the created pull request, or undefined if creation failed. */
  readonly prUrl: string | undefined;
  /** Number of the created pull request, or undefined if creation failed. */
  readonly prNumber: number | undefined;
}

/**
 * Aggregate workflow state collecting optional per-phase output.
 * Properties are optional because phases execute incrementally —
 * a phase's section is populated only after that phase completes.
 *
 * JSON-serializable: no functions, class instances, or circular references.
 */
export interface WorkflowState {
  readonly install?: InstallPhaseState;
  readonly plan?: PlanPhaseState;
  readonly build?: BuildPhaseState;
  readonly test?: TestPhaseState;
  readonly pr?: PRPhaseState;
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
