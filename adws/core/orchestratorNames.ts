/**
 * Static orchestrator name / script mappings.
 *
 * Extracted from orchestratorLib.ts so that stateHelpers.ts can import
 * these pure functions without pulling in orchestratorLib's transitive
 * dependencies (gitContextFactory), which would create a circular
 * import through the core barrel.
 */

const ORCHESTRATOR_SCRIPT_BY_NAME: Record<string, string> = {
  'sdlc-orchestrator': 'adwSdlc',
  'plan-orchestrator': 'adwPlan',
  'chore-orchestrator': 'adwChore',
  'plan-build-orchestrator': 'adwPlanBuild',
  'plan-build-test-orchestrator': 'adwPlanBuild',
  'plan-build-review-orchestrator': 'adwPlanBuildReview',
  'plan-build-test-review-orchestrator': 'adwPlanBuildTestReview',
  'plan-build-document-orchestrator': 'adwPlanBuildDocument',
  'build-orchestrator': 'adwBuild',
  'patch-orchestrator': 'adwPatch',
  'test-orchestrator': 'adwTest',
  'pr-review-orchestrator': 'adwPrReview',
  'feature-orchestrator': 'adwSdlc',
  'merge-orchestrator': 'adwMerge',
};

export function deriveOrchestratorScript(orchestratorName: string): string {
  return `adws/${ORCHESTRATOR_SCRIPT_BY_NAME[orchestratorName] ?? 'adwSdlc'}.tsx`;
}

export function orchestratorNamesForScript(orchestratorScript: string): string[] {
  return Object.entries(ORCHESTRATOR_SCRIPT_BY_NAME)
    .filter(([, script]) => `adws/${script}.tsx` === orchestratorScript)
    .map(([name]) => name);
}
