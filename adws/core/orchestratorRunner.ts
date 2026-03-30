/**
 * Declarative orchestrator runner.
 *
 * Replaces ~40 lines of boilerplate in every orchestrator with a concise
 * declarative definition. The runner owns: CLI arg parsing, initializeWorkflow(),
 * CostTracker lifecycle, sequential phase execution, try/catch,
 * completeWorkflow() / handleWorkflowError().
 */

import type { OrchestratorIdType } from './constants';
import type { PhaseFn, PhaseResult } from './phaseRunner';
import { CostTracker, runPhase } from './phaseRunner';
import {
  parseTargetRepoArgs,
  parseOrchestratorArguments,
  buildRepoIdentifier,
} from './orchestratorCli';
import { initializeWorkflow } from '../phases/workflowInit';
import { createEmptyPhaseState, PhaseResultStore } from '../types/workflowState';
import { completeWorkflow, handleWorkflowError } from '../phases/workflowCompletion';

/**
 * Describes a single sequential phase in a declarative orchestrator.
 */
export interface PhaseDescriptor {
  /** Discriminant — absent or 'phase' for regular sequential phases. */
  readonly type?: 'phase';
  /** Phase name used for resume-skip and cost-record tracking. */
  readonly name: string;
  /** The phase function to execute. */
  readonly execute: PhaseFn;
  /**
   * Optional extractor for phase-specific result fields to include in
   * completeWorkflow() metadata. Receives the PhaseResult returned by execute().
   */
  readonly completionMetadata?: (result: PhaseResult) => Record<string, unknown>;
}

/**
 * A conditional branch node — for orchestrators that need conditional execution.
 * Not supported in OrchestratorDefinition.phases directly; build branching logic
 * using the branch() helper outside the declarative runner if needed.
 */
export interface BranchPhaseDefinition {
  /** Discriminant — must be 'branch' to distinguish from PhaseDescriptor. */
  readonly type: 'branch';
  /** Display name for the branch decision point (used in logs). */
  readonly name: string;
  /** Evaluates to true to take the true branch, false to take the false branch. */
  readonly predicate: (results: PhaseResultStore) => boolean;
  /** Phases to execute when predicate returns true. */
  readonly trueBranch: ReadonlyArray<PhaseDescriptor>;
  /** Phases to execute when predicate returns false. */
  readonly falseBranch: ReadonlyArray<PhaseDescriptor>;
}

/**
 * A discriminated union of phase entry types.
 */
export type PhaseEntry = PhaseDescriptor | BranchPhaseDefinition;

/**
 * A validated, frozen orchestrator definition created by defineOrchestrator().
 */
export interface OrchestratorDefinition {
  /** Identifies the orchestrator for state tracking and logging. */
  readonly id: OrchestratorIdType;
  /** Script file name for usage messages (e.g. 'adwPlanBuild.tsx'). */
  readonly scriptName: string;
  /** Usage pattern for help output (e.g. '<issueNumber> [adw-id]'). */
  readonly usagePattern: string;
  /** Ordered list of phases (sequential PhaseDescriptor or conditional BranchPhaseDefinition) to execute. */
  readonly phases: ReadonlyArray<PhaseDescriptor | BranchPhaseDefinition>;
  /**
   * Optional callback to derive completion metadata from phase results.
   * Called only on the success path, before completeWorkflow().
   * Return value is merged into the workflow completion state.
   */
  readonly completionMetadata?: (results: PhaseResultStore) => Record<string, unknown>;
}

/**
 * Ergonomic helper for constructing a BranchPhaseDefinition.
 */
export function branch(
  name: string,
  predicate: (results: PhaseResultStore) => boolean,
  trueBranch: ReadonlyArray<PhaseDescriptor>,
  falseBranch: ReadonlyArray<PhaseDescriptor>,
): BranchPhaseDefinition {
  return { type: 'branch', name, predicate, trueBranch, falseBranch };
}

/**
 * Validates and returns a frozen OrchestratorDefinition.
 * Throws if the definition has no phases or duplicate phase names.
 */
export function defineOrchestrator(def: OrchestratorDefinition): OrchestratorDefinition {
  if (def.phases.length === 0) {
    throw new Error(`Orchestrator "${def.id}" must declare at least one phase.`);
  }
  const names = def.phases.map(p => p.name);
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Orchestrator "${def.id}" has duplicate phase names: ${duplicates.join(', ')}`);
  }
  return Object.freeze({ ...def, phases: Object.freeze([...def.phases]) });
}

/**
 * Runs a declarative orchestrator definition end-to-end:
 * CLI arg parsing → initializeWorkflow → CostTracker → sequential phases →
 * completeWorkflow / handleWorkflowError.
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

  config.phaseState = createEmptyPhaseState();

  const tracker = new CostTracker();
  const mergedMetadata: Record<string, unknown> = {};
  const results = new PhaseResultStore();

  try {
    for (const entry of def.phases) {
      if (entry.type === 'branch') {
        const branchEntry = entry as BranchPhaseDefinition;
        const predicateResult = branchEntry.predicate(results);
        const selectedBranch = predicateResult ? branchEntry.trueBranch : branchEntry.falseBranch;
        for (const phase of selectedBranch) {
          const result = await runPhase(config, tracker, phase.execute, phase.name);
          results.set(phase.name, result);
          if (phase.completionMetadata) {
            Object.assign(mergedMetadata, phase.completionMetadata(result));
          }
        }
      } else {
        const phase = entry as PhaseDescriptor;
        const result = await runPhase(config, tracker, phase.execute, phase.name);
        results.set(phase.name, result);
        if (phase.completionMetadata) {
          Object.assign(mergedMetadata, phase.completionMetadata(result));
        }
      }
    }
    // Top-level completionMetadata (legacy API) — merges on top of per-phase metadata
    if (def.completionMetadata) {
      Object.assign(mergedMetadata, def.completionMetadata(results));
    }
    await completeWorkflow(config, tracker.totalCostUsd, mergedMetadata, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

/**
 * @deprecated Use PhaseDescriptor instead.
 */
export type PhaseDefinition = PhaseDescriptor;

