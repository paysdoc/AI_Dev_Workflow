/**
 * Declarative orchestrator runner — define orchestrators as typed phase lists.
 *
 * Replaces per-orchestrator boilerplate (CLI parsing, initializeWorkflow(),
 * CostTracker lifecycle, try/catch, completeWorkflow()) with a single
 * defineOrchestrator() + runOrchestrator() call.
 *
 * Only sequential phase execution is supported in this slice.
 * Parallel execution can be added as a future PhaseDefinition variant.
 */

import type { OrchestratorIdType } from './constants';
import { CostTracker, runPhase, runPhaseWithContinuation } from './phaseRunner';
import type { PhaseFn, PhaseResult } from './phaseRunner';
import type { WorkflowConfig } from '../phases/workflowInit';
import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier } from './orchestratorCli';
import { initializeWorkflow } from '../phases/workflowInit';
import { completeWorkflow, handleWorkflowError } from '../phases/workflowCompletion';
import { PhaseResultStore } from '../types/workflowState';

/**
 * A single sequential phase in a declarative orchestrator definition.
 */
export interface PhaseDefinition {
  /** Display name used for skip-on-resume tracking and cost records. */
  readonly name: string;
  /** The phase function to execute. */
  readonly execute: PhaseFn;
  /**
   * Optional callback invoked by runPhaseWithContinuation() when the phase returns
   * tokenLimitExceeded. Returns a continuation prompt string that is set on
   * config.continuationPrompt before the next invocation.
   * Phases without this callback receive the tokenLimitExceeded result as-is.
   */
  readonly onTokenLimit?: (config: WorkflowConfig, previousResult: PhaseResult) => string;
}

/**
 * A declarative orchestrator definition.
 * Pass to runOrchestrator() to execute the workflow.
 */
export interface OrchestratorDefinition {
  /** Orchestrator identifier used for state tracking and log context. */
  readonly id: OrchestratorIdType;
  /** Script filename (without path), used in usage messages. */
  readonly scriptName: string;
  /** CLI usage pattern printed by --help and on arg errors. */
  readonly usagePattern: string;
  /** Ordered list of phases to execute sequentially. */
  readonly phases: ReadonlyArray<PhaseDefinition>;
  /**
   * Optional callback to derive completion metadata from phase results.
   * Called only on the success path, before completeWorkflow().
   * Return value is merged into the workflow completion state.
   */
  readonly completionMetadata?: (results: PhaseResultStore) => Record<string, unknown>;
}

/**
 * Identity function for definition-site type checking.
 * Returns the definition unchanged. Use this when defining an orchestrator
 * to get TypeScript to validate the full definition shape at the call site.
 *
 * @param def - The orchestrator definition to validate and return.
 * @returns The same definition, typed as OrchestratorDefinition.
 */
export function defineOrchestrator(def: OrchestratorDefinition): OrchestratorDefinition {
  return def;
}

/**
 * Executes a declarative orchestrator definition end-to-end.
 *
 * Handles: CLI arg parsing, initializeWorkflow(), CostTracker lifecycle,
 * sequential phase execution via runPhase(), completeWorkflow() on success,
 * and handleWorkflowError() on failure.
 *
 * @param def - The orchestrator definition to run.
 */
export async function runOrchestrator(def: OrchestratorDefinition): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: def.scriptName,
    usagePattern: def.usagePattern,
    supportsCwd: false,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, def.id, {
    issueType: providedIssueType ?? undefined,
    targetRepo: targetRepo ?? undefined,
    repoId,
  });

  const tracker = new CostTracker();
  const results = new PhaseResultStore();

  try {
    for (const phase of def.phases) {
      const result = phase.onTokenLimit
        ? await runPhaseWithContinuation(config, tracker, phase.execute, phase.onTokenLimit, phase.name)
        : await runPhase(config, tracker, phase.execute, phase.name);
      results.set(phase.name, result);
    }

    const metadata = def.completionMetadata?.(results) ?? {};
    await completeWorkflow(config, tracker.totalCostUsd, metadata, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}
