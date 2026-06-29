import { describe, it, expect } from 'vitest';
import { classifyStage, classifyStageString } from '../stageClassifier';
import type { StageClass } from '../stageClassifier';
import type { WorkflowStage } from '../../types/workflowTypes';

// ── Per-literal exhaustive map ────────────────────────────────────────────────
//
// Record<WorkflowStage, StageClass> forces a compile error if a WorkflowStage
// literal is added without a corresponding entry here — a second exhaustiveness
// backstop alongside the `never` guard in classifyStage itself. The type-check
// proof is Step 9 of the plan (bunx tsc --noEmit), not a runtime assertion.

const EXPECTED: Record<WorkflowStage, StageClass> = {
  // active
  starting:           'active',
  resuming:           'active',
  build_running:      'active',
  test_running:       'active',
  review_running:     'active',
  document_running:   'active',
  install_running:    'active',

  // awaiting_merge
  awaiting_merge:     'awaiting_merge',

  // retriable
  abandoned:          'retriable',

  // terminal
  completed:          'terminal',
  discarded:          'terminal',
  paused:             'terminal',
  paused_auth:        'terminal',

  // human_gated
  merge_blocked:      'human_gated',
  human_gated:        'human_gated',
  review_failed:      'human_gated',

  // resumable
  classified:              'resumable',
  branch_created:          'resumable',
  plan_building:           'resumable',
  plan_created:            'resumable',
  planFile_created:        'resumable',
  plan_committing:         'resumable',
  build_progress:          'resumable',
  build_completed:         'resumable',
  build_committing:        'resumable',
  pr_creating:             'resumable',
  pr_created:              'resumable',
  error:                   'resumable',
  test_failed:             'resumable',
  test_resolving:          'resumable',
  test_passed:             'resumable',
  unverified:              'resumable',
  stack_incoherent:        'resumable',
  review_passed:           'resumable',
  review_patching:         'resumable',
  document_completed:      'resumable',
  document_failed:         'resumable',
  token_limit_recovery:    'resumable',
  compaction_recovery:     'resumable',
  test_compaction_recovery:   'resumable',
  review_compaction_recovery: 'resumable',
  plan_validating:         'resumable',
  plan_validated:          'resumable',
  plan_resolving:          'resumable',
  plan_resolved:           'resumable',
  plan_validation_failed:  'resumable',
  plan_aligning:           'resumable',
  plan_aligned:            'resumable',
  install_completed:       'resumable',
  install_failed:          'resumable',
  resumed:                 'resumable',
  phase_timeout:           'resumable',
};

describe('classifyStage — one class per WorkflowStage literal', () => {
  for (const [stage, expected] of Object.entries(EXPECTED) as [WorkflowStage, StageClass][]) {
    it(`classifies '${stage}' as '${expected}'`, () => {
      expect(classifyStage(stage)).toBe(expected);
    });
  }
});

// ── classifyStageString — dynamic and edge-case strings ───────────────────────

describe('classifyStageString — dynamic phaseRunner strings', () => {
  it("routes '*_running' dynamic string to 'active'", () => {
    expect(classifyStageString('plan_running')).toBe('active');
  });

  it("routes 'step-def_running' dynamic string to 'active'", () => {
    expect(classifyStageString('step-def_running')).toBe('active');
  });

  it("routes '*_completed' dynamic string to 'resumable'", () => {
    expect(classifyStageString('plan_completed')).toBe('resumable');
  });

  it("routes 'test_completed' dynamic string to 'resumable'", () => {
    expect(classifyStageString('test_completed')).toBe('resumable');
  });

  it("routes 'review_completed' dynamic string to 'resumable'", () => {
    expect(classifyStageString('review_completed')).toBe('resumable');
  });
});

describe('classifyStageString — literal delegates to classifyStage', () => {
  it("routes 'starting' (active literal) to 'active'", () => {
    expect(classifyStageString('starting')).toBe('active');
  });

  it("routes 'abandoned' (retriable literal) to 'retriable'", () => {
    expect(classifyStageString('abandoned')).toBe('retriable');
  });

  it("routes 'completed' (terminal literal) to 'terminal'", () => {
    expect(classifyStageString('completed')).toBe('terminal');
  });

  it("routes 'merge_blocked' (human_gated literal) to 'human_gated'", () => {
    expect(classifyStageString('merge_blocked')).toBe('human_gated');
  });

  it("routes 'review_failed' (human_gated literal) to 'human_gated'", () => {
    expect(classifyStageString('review_failed')).toBe('human_gated');
  });

  it("routes 'awaiting_merge' to 'awaiting_merge'", () => {
    expect(classifyStageString('awaiting_merge')).toBe('awaiting_merge');
  });

  it("routes 'phase_timeout' (resumable literal) to 'resumable'", () => {
    expect(classifyStageString('phase_timeout')).toBe('resumable');
  });
});

describe('classifyStageString — edge cases', () => {
  it("routes empty string '' to 'resumable' (defensive fallback)", () => {
    expect(classifyStageString('')).toBe('resumable');
  });

  it("routes unknown future stage to 'resumable' (defensive fallback)", () => {
    expect(classifyStageString('some_unknown_future_stage')).toBe('resumable');
  });
});
