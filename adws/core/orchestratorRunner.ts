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
import { log } from './utils';

/**
 * A single sequential phase in a declarative orchestrator definition.
 */
export interface PhaseDefinition {
  /** Discriminant — absent or 'phase' for regular sequential phases. */
  readonly type?: 'phase';
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
 * A conditional branch node in a declarative orchestrator definition.
 * After the preceding phase completes, the runner evaluates the predicate
 * against the accumulated PhaseResultStore and executes the matching branch.
 */
export interface BranchPhaseDefinition {
  /** Discriminant — must be 'branch' to distinguish from PhaseDefinition. */
  readonly type: 'branch';
  /** Display name for the branch decision point (used in logs). */
  readonly name: string;
  /** Evaluates to true to take the true branch, false to take the false branch. */
  readonly predicate: (results: PhaseResultStore) => boolean;
  /** Phases to execute when predicate returns true. */
  readonly trueBranch: ReadonlyArray<PhaseDefinition>;
  /** Phases to execute when predicate returns false. */
  readonly falseBranch: ReadonlyArray<PhaseDefinition>;
}

/**
 * A discriminated union of the two valid phase entry types.
 * Use PhaseDefinition for sequential phases, BranchPhaseDefinition for conditional branches.
 */
export type PhaseEntry = PhaseDefinition | BranchPhaseDefinition;

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
  /** Ordered list of phases (sequential or branch) to execute. */
  readonly phases: ReadonlyArray<PhaseEntry>;
  /**
   * Optional callback to derive completion metadata from phase results.
   * Called only on the success path, before completeWorkflow().
   * Return value is merged into the workflow completion state.
   */
  readonly completionMetadata?: (results: PhaseResultStore) => Record<string, unknown>;
}

/**
 * Type guard — returns true if the entry is a BranchPhaseDefinition.
 */
function isBranchPhase(entry: PhaseEntry): entry is BranchPhaseDefinition {
  return entry.type === 'branch';
}

/**
 * Ergonomic helper for constructing a BranchPhaseDefinition at the call site.
 *
 * @param name - Display name for the branch decision point (shown in logs).
 * @param predicate - Evaluates the PhaseResultStore; true → trueBranch, false → falseBranch.
 * @param trueBranch - Phases to run when predicate returns true.
 * @param falseBranch - Phases to run when predicate returns false.
 * @returns A fully typed BranchPhaseDefinition.
 */
export function branch(
  name: string,
  predicate: (results: PhaseResultStore) => boolean,
  trueBranch: ReadonlyArray<PhaseDefinition>,
  falseBranch: ReadonlyArray<PhaseDefinition>,
): BranchPhaseDefinition {
  return { type: 'branch', name, predicate, trueBranch, falseBranch };
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
    for (const entry of def.phases) {
      if (isBranchPhase(entry)) {
        const predicateResult = entry.predicate(results);
        const selectedBranch = predicateResult ? entry.trueBranch : entry.falseBranch;
        const path = predicateResult ? 'true' : 'false';
        log(`Branch '${entry.name}': took ${path} path`, 'info');
        for (const phase of selectedBranch) {
          const result = phase.onTokenLimit
            ? await runPhaseWithContinuation(config, tracker, phase.execute, phase.onTokenLimit, phase.name)
            : await runPhase(config, tracker, phase.execute, phase.name);
          results.set(phase.name, result);
        }
      } else {
        const result = entry.onTokenLimit
          ? await runPhaseWithContinuation(config, tracker, entry.execute, entry.onTokenLimit, entry.name)
          : await runPhase(config, tracker, entry.execute, entry.name);
        results.set(entry.name, result);
      }
    }

    const metadata = def.completionMetadata?.(results) ?? {};
    await completeWorkflow(config, tracker.totalCostUsd, metadata, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}
