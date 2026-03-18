/**
 * Orchestrator identifier constants.
 *
 * Replaces magic string literals for orchestrator names across the codebase.
 * Each value corresponds to an entry in the AgentIdentifier union type.
 */
/** Maximum number of auto-merge retry attempts before posting a failure comment. */
export const MAX_AUTO_MERGE_ATTEMPTS = 3;

export const OrchestratorId = {
  Plan: 'plan-orchestrator',
  Build: 'build-orchestrator',
  Test: 'test-orchestrator',
  Review: 'review-orchestrator',
  Document: 'document-orchestrator',
  PR: 'pr-orchestrator',
  Patch: 'patch-orchestrator',
  Init: 'init-orchestrator',
  ClearComments: 'clear-comments-orchestrator',
  HealthCheck: 'health-check-orchestrator',
  Sdlc: 'sdlc-orchestrator',
  PlanBuild: 'plan-build-orchestrator',
  PlanBuildTest: 'plan-build-test-orchestrator',
  PlanBuildDocument: 'plan-build-document-orchestrator',
  PlanBuildReview: 'plan-build-review-orchestrator',
  PlanBuildTestReview: 'plan-build-test-review-orchestrator',
  PrReview: 'pr-review-orchestrator',
} as const;

export type OrchestratorIdType = typeof OrchestratorId[keyof typeof OrchestratorId];
