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
  Chore: 'chore-orchestrator',
  Merge: 'merge-orchestrator',
} as const;

export type OrchestratorIdType = typeof OrchestratorId[keyof typeof OrchestratorId];
