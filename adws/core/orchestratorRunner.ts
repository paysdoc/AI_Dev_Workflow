/**
 * Declarative orchestrator runner — define orchestrators as typed phase lists.
 *
 * Replaces per-orchestrator boilerplate (CLI parsing, initializeWorkflow(),
 * CostTracker lifecycle, try/catch, completeWorkflow()) with a single
 * defineOrchestrator() + runOrchestrator() call.
 *
 * Supports three phase execution variants:
 *   - Sequential (default): runs one phase at a time in declared order.
 *   - Parallel: runs a group of phases concurrently via Promise.all.
 *   - Optional: wraps a phase so errors are caught and logged without halting the pipeline.
 */

import type { OrchestratorIdType } from './constants';
import { CostTracker, runPhase, runPhasesParallel } from './phaseRunner';
import type { PhaseResult } from './phaseRunner';
import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier } from './orchestratorCli';
import { initializeWorkflow } from '../phases/workflowInit';
import type { WorkflowConfig } from '../phases/workflowInit';
import { completeWorkflow, handleWorkflowError } from '../phases/workflowCompletion';
import { PhaseResultStore } from '../types/workflowState';
import { log } from './utils';

/**
 * A phase function that receives the current WorkflowConfig and PhaseResultStore,
 * and returns a PhaseResult. The second argument allows phases to access prior
 * phase results without closure bindings.
 *
 * Backward compatible: existing single-argument phase functions are assignable
 * to this type since TypeScript allows functions with fewer parameters.
 */
export type DeclarativePhaseFn = (config: WorkflowConfig, results: PhaseResultStore) => Promise<PhaseResult>;

/**
 * A single sequential phase in a declarative orchestrator definition.
 */
export interface PhaseDefinition {
  readonly kind?: 'sequential';
  /** Display name used for skip-on-resume tracking and cost records. */
  readonly name: string;
  /** The phase function to execute. */
  readonly execute: DeclarativePhaseFn;
}

/**
 * A parallel group of phases in a declarative orchestrator definition.
 * All sub-phases run concurrently via Promise.all.
 * Costs from all sub-phases are accumulated in one shot.
 */
export interface ParallelPhaseDefinition {
  readonly kind: 'parallel';
  /** Display name for logging the parallel group. */
  readonly name: string;
  /** Phases to execute concurrently. Each sub-phase result is stored by its name. */
  readonly phases: ReadonlyArray<PhaseDefinition>;
}

/**
 * An optional phase in a declarative orchestrator definition.
 * Errors are caught and logged without halting the pipeline.
 */
export interface OptionalPhaseDefinition {
  readonly kind: 'optional';
  /** Display name used for skip-on-resume tracking and cost records. */
  readonly name: string;
  /** The phase function to execute. Errors are caught and logged. */
  readonly execute: DeclarativePhaseFn;
}

/**
 * Discriminated union of all phase entry types supported by the declarative runner.
 */
export type PhaseEntry = PhaseDefinition | ParallelPhaseDefinition | OptionalPhaseDefinition;

/**
 * Factory function for creating a parallel phase group.
 *
 * @param name - Display name for the parallel group.
 * @param phases - Phases to run concurrently.
 * @returns A ParallelPhaseDefinition with kind 'parallel'.
 */
export function parallel(name: string, phases: ReadonlyArray<PhaseDefinition>): ParallelPhaseDefinition {
  return { kind: 'parallel', name, phases };
}

/**
 * Factory function for wrapping a phase as optional (non-fatal).
 * If the phase throws, the error is logged and the pipeline continues.
 *
 * @param phase - The sequential phase definition to wrap.
 * @returns An OptionalPhaseDefinition with kind 'optional'.
 */
export function optional(phase: PhaseDefinition): OptionalPhaseDefinition {
  return { kind: 'optional', name: phase.name, execute: phase.execute };
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
  /** Ordered list of phase entries (sequential, parallel, or optional). */
  readonly phases: ReadonlyArray<PhaseEntry>;
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
 * phase execution (sequential, parallel, optional), completeWorkflow() on success,
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
    for (const entry of def.phases) {
      if (entry.kind === 'parallel') {
        const fns = entry.phases.map(
          (p): ((cfg: WorkflowConfig) => Promise<PhaseResult>) =>
            (cfg) => p.execute(cfg, results),
        );
        const parallelResults = await runPhasesParallel(config, tracker, fns);
        entry.phases.forEach((p, i) => results.set(p.name, parallelResults[i]));
      } else if (entry.kind === 'optional') {
        try {
          const result = await runPhase(config, tracker, (cfg) => entry.execute(cfg, results), entry.name);
          results.set(entry.name, result);
        } catch (error) {
          log(`Optional phase '${entry.name}' failed (non-fatal): ${error}`, 'warn');
          results.set(entry.name, { costUsd: 0, modelUsage: {} });
        }
      } else {
        const result = await runPhase(config, tracker, (cfg) => entry.execute(cfg, results), entry.name);
        results.set(entry.name, result);
      }
    }

    const metadata = def.completionMetadata?.(results) ?? {};
    await completeWorkflow(config, tracker.totalCostUsd, metadata, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}
