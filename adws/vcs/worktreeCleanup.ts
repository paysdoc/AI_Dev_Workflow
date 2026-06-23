/**
 * Git worktree cleanup functions.
 *
 * Most operations have migrated to GitContext (#661).
 * killProcessesInDirectory re-exported from gitContext package for backward compatibility.
 */

export { killProcessesInDirectory } from '../gitContext';
