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
 * Semantic output of the Scenario phase.
 */
export interface ScenarioPhaseState {
  /** Path to the generated scenarios file, or undefined if not produced. */
  readonly scenariosPath: string | undefined;
}

/**
 * Semantic output of the Step Definition phase.
 */
export interface StepDefPhaseState {
  /** Path to the generated step definitions file, or undefined if not produced. */
  readonly stepDefsPath: string | undefined;
}

/**
 * Semantic output of the Alignment phase.
 */
export interface AlignmentPhaseState {
  /** Whether the plan was successfully aligned against scenarios. */
  readonly aligned: boolean;
}

/**
 * Semantic output of the Review phase.
 * Captures review results for downstream phases (document, KPI) to consume
 * via PhaseResultStore instead of closure bindings.
 */
export interface ReviewPhaseState {
  /** Whether the review passed. */
  readonly reviewPassed: boolean;
  /** Total number of review-patch retry iterations. */
  readonly totalRetries: number;
  /** URLs of screenshots uploaded to R2 (web apps only). */
  readonly screenshotUrls: readonly string[];
  /** Local paths to all captured screenshots. */
  readonly allScreenshots: readonly string[];
  /** Review summaries from all attempts. */
  readonly allSummaries: readonly string[];
  /** Non-blocker issues identified during review. */
  readonly nonBlockerIssues: readonly unknown[];
}

/**
 * Semantic output of the Document phase.
 */
export interface DocumentPhaseState {
  /** Path to the generated documentation file, or undefined if not produced. */
  readonly docPath: string | undefined;
}

/**
 * Semantic output of the KPI phase.
 */
export interface KpiPhaseState {
  /** Whether KPI tracking completed successfully. */
  readonly tracked: boolean;
}

/**
 * Semantic output of the AutoMerge phase.
 */
export interface AutoMergePhaseState {
  /** Whether the PR was successfully merged. */
  readonly merged: boolean;
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
 */
export interface WorkflowState {
  readonly install?: InstallPhaseState;
  readonly plan?: PlanPhaseState;
  readonly scenario?: ScenarioPhaseState;
  readonly stepDef?: StepDefPhaseState;
  readonly alignment?: AlignmentPhaseState;
  readonly build?: BuildPhaseState;
  readonly test?: TestPhaseState;
  readonly review?: ReviewPhaseState;
  readonly document?: DocumentPhaseState;
  readonly pr?: PRPhaseState;
  readonly kpi?: KpiPhaseState;
  readonly autoMerge?: AutoMergePhaseState;
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
