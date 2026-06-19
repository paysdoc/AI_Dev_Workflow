import type { WorkflowStage } from '../types/workflowTypes';

/**
 * Stage classification taxonomy for recovery routing.
 *
 * Six classes cover every WorkflowStage literal. Each consumer maps a class to an
 * action independently — the same class can produce different decisions in cron vs.
 * takeover (see the isActiveStage bridge note in cronStageResolver.ts).
 *
 * This module is behavior-preserving: no stage is reclassified vs. the legacy
 * isActiveStage / isRetriableStage / isRunningStage predicates. Subsequent PRD slices
 * may reclassify specific stages (e.g. phase_timeout → resumable-with-resume-in-place).
 *
 * | Class         | Cron decision              | Takeover decision                          |
 * |---------------|----------------------------|--------------------------------------------|
 * | active        | exclude (in progress)      | SIGKILL-if-live → reset → reconcile → take |
 * | awaiting_merge| eligible → merge           | spawn_fresh                                |
 * | retriable     | eligible → spawn           | reset → reconcile → take (no kill)         |
 * | terminal      | exclude (inline checks)    | skip_terminal (release lock)               |
 * | human_gated   | exclude (inline check)     | spawn_fresh                                |
 * | resumable     | exclude (fallback)         | spawn_fresh                                |
 *
 * Dynamic-string rationale: phaseRunner writes workflowStage as `${phaseName}_running`
 * and `${phaseName}_completed` — values not present in the WorkflowStage union (e.g.
 * 'plan_running', 'step-def_running', 'test_completed'). classifyStageString handles
 * these via endsWith family matching before delegating to classifyStage.
 */
export type StageClass =
  | 'active'
  | 'awaiting_merge'
  | 'retriable'
  | 'resumable'
  | 'terminal'
  | 'human_gated';

/**
 * Exhaustive classifier over the closed WorkflowStage union.
 *
 * Every WorkflowStage literal maps to exactly one StageClass. The default branch
 * assigns stage to never — omitting a case is a tsc compile error.
 */
export function classifyStage(stage: WorkflowStage): StageClass {
  switch (stage) {
    case 'starting':
    case 'resuming':
    case 'build_running':
    case 'test_running':
    case 'review_running':
    case 'document_running':
    case 'install_running':
      return 'active';

    case 'awaiting_merge':
      return 'awaiting_merge';

    case 'abandoned':
      return 'retriable';

    case 'completed':
    case 'discarded':
    case 'paused':
    case 'paused_auth':
      return 'terminal';

    case 'merge_blocked':
      return 'human_gated';

    case 'classified':
    case 'branch_created':
    case 'plan_building':
    case 'plan_created':
    case 'planFile_created':
    case 'plan_committing':
    case 'build_progress':
    case 'build_completed':
    case 'build_committing':
    case 'pr_creating':
    case 'pr_created':
    case 'error':
    case 'test_failed':
    case 'test_resolving':
    case 'test_passed':
    case 'unverified':
    case 'stack_incoherent':
    case 'review_passed':
    case 'review_failed':
    case 'review_patching':
    case 'document_completed':
    case 'document_failed':
    case 'token_limit_recovery':
    case 'compaction_recovery':
    case 'test_compaction_recovery':
    case 'review_compaction_recovery':
    case 'plan_validating':
    case 'plan_validated':
    case 'plan_resolving':
    case 'plan_resolved':
    case 'plan_validation_failed':
    case 'plan_aligning':
    case 'plan_aligned':
    case 'install_completed':
    case 'install_failed':
    case 'resumed':
    case 'phase_timeout':
      return 'resumable';

    default: {
      const _exhaustive: never = stage;
      void _exhaustive;
      return 'resumable';
    }
  }
}

/**
 * String adapter for raw persisted stage values.
 *
 * Handles dynamic phaseRunner strings (`${phaseName}_running` / `${phaseName}_completed`)
 * that are not WorkflowStage literals, centralizing the endsWith family matching that was
 * previously scattered across three separate predicates.
 *
 * Precedence:
 *   1. endsWith('_running')   → 'active'    (covers literal *_running cases too)
 *   2. endsWith('_completed') → 'resumable' (covers dynamic phase completions)
 *   3. classifyStage cast     → never-guarded default returns 'resumable' for unknowns
 */
export function classifyStageString(stage: string): StageClass {
  if (stage.endsWith('_running')) return 'active';
  if (stage.endsWith('_completed')) return 'resumable';
  return classifyStage(stage as WorkflowStage);
}
