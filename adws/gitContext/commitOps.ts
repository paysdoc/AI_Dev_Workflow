/**
 * Package-private commit/push operation orchestration for GitContext.
 */

type Runner = (command: string, cwd: string) => string;

type ExecError = { stderr?: unknown; stdout?: unknown; message?: unknown };

export function isLeaseRejection(error: unknown): boolean {
  const e = error as ExecError;
  const text = [e.stderr, e.stdout, e.message]
    .map((v) => (v == null ? '' : String(v)))
    .join('\n');
  return text.includes('stale info') || text.includes('remote ref updated since checkout');
}

function leaseErrorMessage(branch: string, error: unknown): string {
  const e = error as ExecError;
  return (
    `force-with-lease push rejected for branch "${branch}": the remote was moved ` +
    `underneath ADW — the origin has commits ADW has never seen and must not be ` +
    `auto-resumed into the same push. ` +
    `Manual remedy: git fetch && git log origin/${branch} — if the local tip ` +
    `is correct, push manually with: git push --force-with-lease origin ${branch}. ` +
    `Original error: ${String(e.stderr ?? e.message ?? error)}`
  );
}

function commitChanges(run: Runner, message: string, cwd: string): boolean {
  const status = run('git status --porcelain', cwd);
  if (!status.trim()) return false;
  run('git add -A', cwd);
  run(`git commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
  return true;
}

function pushBranch(run: Runner, branch: string, cwd: string): void {
  try {
    run(`git fetch origin "${branch}"`, cwd);
  } catch {
    // first push — no remote ref yet, proceed
  }
  try {
    run(`git push --force-with-lease --force-if-includes -u origin "${branch}"`, cwd);
  } catch (error) {
    if (isLeaseRejection(error)) {
      throw new Error(leaseErrorMessage(branch, error));
    }
    throw error;
  }
}

function getHeadTreeHash(run: Runner, cwd: string): string {
  return run('git rev-parse "HEAD^{tree}"', cwd);
}

function hasUncommittedChanges(run: Runner, cwd: string): boolean {
  return run('git status --porcelain', cwd).trim().length > 0;
}

export const commitOps = {
  commitChanges,
  pushBranch,
  getHeadTreeHash,
  hasUncommittedChanges,
};
