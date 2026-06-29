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

function show(run: Runner, ref: string, filePath: string, cwd: string): string {
  return run(`git show "${ref}:${filePath}"`, cwd);
}

/** Bounded flag vocabulary for git log --since reads; only assembles a log command. */
export interface LogSinceOptions {
  since: string;
  grep?: string;
  oneline?: boolean;
  patch?: boolean;
  pathspec?: string;
}

/** Bounded git log --since read; only assembles a log command. */
function logSince(run: Runner, opts: LogSinceOptions, cwd: string): string {
  const parts = ['git log', `--since="${opts.since}"`];
  if (opts.grep) parts.push(`--grep="${opts.grep}"`);
  parts.push('--no-merges');
  if (opts.oneline) parts.push('--oneline');
  if (opts.patch) parts.push('-p');
  const cmd = opts.pathspec ? `${parts.join(' ')} -- ${opts.pathspec}` : parts.join(' ');
  return run(cmd, cwd);
}

export const gitReadOps = { lsFiles, headShort, diff, log, show, logSince };
