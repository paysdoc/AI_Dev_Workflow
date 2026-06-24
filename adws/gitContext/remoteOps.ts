/**
 * Package-private remote-interaction and merge op module for GitContext.
 * Handles fetch from origin, ls-remote queries, merge a ref, and abort
 * an in-progress merge.
 *
 * All functions propagate errors except abortMerge (which swallows them
 * because aborting with no merge in progress is a benign no-op).
 */

type Runner = (command: string, cwd: string) => string;

function fetchRemote(run: Runner, branch: string, cwd: string): string {
  return run(`git fetch origin "${branch}"`, cwd);
}

function mergeBranch(
  run: Runner,
  ref: string,
  cwd: string,
  opts: { noCommit?: boolean; noFf?: boolean; noEdit?: boolean } = {},
): void {
  const flags = [
    opts.noCommit && '--no-commit',
    opts.noFf && '--no-ff',
    opts.noEdit && '--no-edit',
  ].filter(Boolean).join(' ');
  run(flags ? `git merge ${flags} "${ref}"` : `git merge "${ref}"`, cwd);
}

function abortMerge(run: Runner, cwd: string): void {
  try {
    run('git merge --abort', cwd);
  } catch { /* no merge in progress — ignore */ }
}

function lsRemote(run: Runner, branch: string, cwd: string): string {
  return run(`git ls-remote origin "${branch}"`, cwd);
}

export const remoteOps = { fetchRemote, mergeBranch, abortMerge, lsRemote };
