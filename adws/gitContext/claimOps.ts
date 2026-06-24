/**
 * Package-private op module for the upgrade-claim distributed-lock git verbs.
 *
 * These four ops are NOT delegated to the standard GitContext worktree/commit/push
 * methods — doing so would silently break the winner/loser election:
 *
 *   - addDetachedWorktree: standard methods create a named local branch; the claim
 *     needs DETACHED HEAD at an arbitrary system-temp path with no local branch
 *     (a leftover named branch causes "already exists" on the next attempt, bypassing
 *     the loser path).
 *   - commitAllowEmpty: commitChanges() short-circuits on a clean tree; the claim
 *     always needs an empty commit carrying the unique nonce.
 *   - pushHeadToBranch: pushBranch() uses --force-with-lease; the claim push must
 *     NEVER be forced — the non-fast-forward rejection IS the atomic lock.
 *   - removeDetachedWorktree: best-effort cleanup that swallows errors (mirrors
 *     remoteOps.abortMerge).
 *
 * All errors except removeDetachedWorktree propagate to the caller.
 */

type Runner = (command: string, cwd: string) => string;

function addDetachedWorktree(run: Runner, worktreePath: string, ref: string, cwd: string): void {
  run(`git worktree add --detach "${worktreePath}" "${ref}"`, cwd);
}

function commitAllowEmpty(run: Runner, message: string, cwd: string): void {
  run(`git commit --allow-empty -m "${message.replace(/"/g, '\\"')}"`, cwd);
}

/**
 * Pushes HEAD to a remote branch ref WITHOUT any force flag.
 *
 * CRITICAL: This push MUST NOT carry --force or --force-with-lease.
 * The non-fast-forward rejection from the remote IS the distributed lock.
 * A force push would let a second claimant overwrite the winner's branch,
 * collapsing the exactly-one-winner election into a last-writer-wins race.
 */
function pushHeadToBranch(run: Runner, branch: string, cwd: string): void {
  run(`git push origin "HEAD:refs/heads/${branch}"`, cwd);
}

function removeDetachedWorktree(run: Runner, worktreePath: string, cwd: string): void {
  try {
    run(`git worktree remove --force "${worktreePath}"`, cwd);
  } catch { /* best-effort cleanup */ }
}

export const claimOps = { addDetachedWorktree, commitAllowEmpty, pushHeadToBranch, removeDetachedWorktree };
