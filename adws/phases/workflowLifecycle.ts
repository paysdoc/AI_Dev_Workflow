/**
 * Re-export barrel for backward compatibility.
 *
 * The original workflowLifecycle module has been split into:
 * - worktreeSetup.ts: gitignore helpers and slash-command copying
 * - workflowInit.ts: WorkflowConfig interface and initializeWorkflow()
 * - workflowCompletion.ts: completion, review phase, and error handling
 */

export {
  ensureGitignoreEntry,
  ensureGitignoreEntries,
  copyClaudeCommandsToWorktree,
} from './worktreeSetup';

export {
  type WorkflowConfig,
  initializeWorkflow,
} from './workflowInit';

export {
  completeWorkflow,
  executeReviewPhase,
  handleWorkflowError,
} from './workflowCompletion';
