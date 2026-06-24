/**
 * Package-private git-read op module for GitContext.
 * Handles phase-level read commands: tracked-file listing, short HEAD hash,
 * branch diff, and commit-history log.
 *
 * All functions propagate errors — each call site handles its own try/catch.
 */

type Runner = (command: string, cwd: string) => string;

function lsFiles(run: Runner, cwd: string, prefix?: string): string[] {
  const cmd = prefix ? `git ls-files "${prefix}"` : 'git ls-files';
  return run(cmd, cwd).split('\n').filter(Boolean);
}

function headShort(run: Runner, cwd: string): string {
  return run('git rev-parse --short HEAD', cwd);
}

function diff(run: Runner, range: string, cwd: string): string {
  return run(`git diff ${range}`, cwd);
}

function log(run: Runner, branchName: string, cwd: string): string {
  return run(`git log "${branchName}" --format="%aI %s" --no-merges`, cwd);
}

export const gitReadOps = { lsFiles, headShort, diff, log };
