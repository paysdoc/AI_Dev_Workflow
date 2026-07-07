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

function pathspecSuffix(excludePaths?: readonly string[]): string {
  if (!excludePaths || excludePaths.length === 0) return '';
  const tokens = excludePaths.map(p => `':(exclude)${p}'`).join(' ');
  return ` -- '.' ${tokens}`;
}

/**
 * Returns the subset of `paths` that are already gitignored in `cwd`. `git check-ignore`
 * exits non-zero when none of the given paths are ignored, which the injected runner
 * surfaces as a throw — treat that (and any other failure) as "nothing ignored" so the
 * filter can never behave worse than passing every path through unfiltered.
 */
function gitignoredSubset(run: Runner, cwd: string, paths: readonly string[]): ReadonlySet<string> {
  if (paths.length === 0) return new Set();
  const tokens = paths.map(p => `'${p}'`).join(' ');
  try {
    const output = run(`git check-ignore ${tokens}`, cwd);
    return new Set(output.split('\n').map(line => line.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Filters `excludePaths` down to the paths that are safe to name in an `:(exclude)`
 * pathspec — i.e. not already gitignored. Naming an already-ignored path in an explicit
 * pathspec promotes `git add -A` to an explicit-pathspec add, which git then rejects
 * with exit 1 ("paths are ignored"). Dropping those entries is a no-op for what gets
 * staged (`git add -A` already skips ignored files) and removes the crash.
 */
function committableExcludePaths(run: Runner, cwd: string, excludePaths?: readonly string[]): readonly string[] {
  if (!excludePaths || excludePaths.length === 0) return [];
  const ignored = gitignoredSubset(run, cwd, excludePaths);
  return excludePaths.filter(p => !ignored.has(p));
}

function commitChanges(run: Runner, message: string, cwd: string, opts?: { excludePaths?: readonly string[] }): boolean {
  const suffix = pathspecSuffix(committableExcludePaths(run, cwd, opts?.excludePaths));
  const status = run(`git status --porcelain${suffix}`, cwd);
  if (!status.trim()) return false;
  run(`git add -A${suffix}`, cwd);
  run(`git commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
  return true;
}

/**
 * Removes `paths` from the index/working tree and, only if that staged something
 * for those exact pathspecs, commits scoped to `paths` — unrelated staged/dirty
 * state elsewhere in the tree is left untouched. `--ignore-unmatch` keeps the
 * removal idempotent when a path is already absent from the index.
 */
function removeAndCommitPaths(run: Runner, paths: readonly string[], message: string, cwd: string): boolean {
  if (paths.length === 0) return false;
  const tokens = paths.map(p => `'${p}'`).join(' ');
  run(`git rm -f --ignore-unmatch -- ${tokens}`, cwd);
  const status = run(`git status --porcelain -- ${tokens}`, cwd);
  if (!status.trim()) return false;
  run(`git commit -m "${message.replace(/"/g, '\\"')}" -- ${tokens}`, cwd);
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
  removeAndCommitPaths,
  pushBranch,
  getHeadTreeHash,
  hasUncommittedChanges,
};
