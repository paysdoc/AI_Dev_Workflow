/**
 * Public barrel for worktree operations.
 * Implementation is split by operation group — see sibling worktreeOps*.ts files.
 */

export { worktreePathFor, copyEnvToWorktree, noop as noopLogger } from './worktreeOpsHelpers';
export { createWorktree, createWorktreeForNewBranch, ensureWorktree } from './worktreeOpsCreate';
export { getWorktreeForBranch, listWorktrees, worktreeExists, findWorktreeForIssue } from './worktreeOpsQuery';
export { removeWorktree, removeWorktreesForIssue } from './worktreeOpsRemove';
export { resetWorktree } from './worktreeOpsReset';
