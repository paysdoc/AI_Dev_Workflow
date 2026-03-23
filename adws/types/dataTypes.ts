/**
 * Backward-compatible re-export barrel.
 *
 * This aggregator is kept for backward compatibility — consumers should prefer
 * importing directly from the canonical source files (issueTypes.ts, agentTypes.ts,
 * workflowTypes.ts, issueRouting.ts). The types/index.ts already re-exports everything
 * from those files.
 */
export * from './issueTypes';
export * from './issueRouting';
export * from './agentTypes';
export * from './workflowTypes';
