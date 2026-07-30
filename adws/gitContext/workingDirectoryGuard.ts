/**
 * Diagnoses a spawn failure caused by a missing working directory and turns
 * it into an error naming the path and repository identity.
 *
 * Node resolves a spawn's cwd before exec'ing the shell, so a nonexistent
 * cwd surfaces as an ENOENT on the shell binary itself rather than on the
 * directory. The message differs by runtime (node: "spawnSync /bin/sh
 * ENOENT"; bun: "ENOENT: no such file or directory, posix_spawn '/bin/sh'")
 * but `code` does not (verified 2026-07-30) — detection keys off `code`,
 * never the message.
 *
 * Pure — no fs, no spawn. The existence probe is injected by the caller.
 */

/** The five facts the diagnostic message needs — deliberately no basePath/frameworkRepoRoot, so the message never classifies which kind of directory went missing. */
export interface WorkingDirectoryContext {
  cwd: string;
  command: string;
  owner: string;
  repo: string;
  selfHost: boolean;
}

const MAX_COMMAND_CHARS = 120;

function truncateCommand(command: string): string {
  if (command.length <= MAX_COMMAND_CHARS) return command;
  return `${command.slice(0, MAX_COMMAND_CHARS)}…`;
}

/**
 * Structural check for an ENOENT-coded failure — not `instanceof Error`, so
 * an injected ExecFn seam that throws a plain shaped object is still
 * diagnosed. Keys off `code` because the message text differs between node
 * and bun for the same failure.
 */
export function isSpawnEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** One message shape for every missing-working-directory case — basePath or an explicit worktree path alike. */
export function describeMissingWorkingDirectory(ctx: WorkingDirectoryContext): string {
  return `GitContext: working directory does not exist: ${ctx.cwd} (${ctx.owner}/${ctx.repo}, selfHost=${ctx.selfHost}) — has a workflow ever cloned this workspace on this host? [while running: ${truncateCommand(ctx.command)}]`;
}

/**
 * Returns the original error untouched in every case except a confirmed
 * missing cwd — never a blanket wrap. When it does fire, the returned error
 * preserves `code: 'ENOENT'` (plus `syscall`/`path`) and carries the
 * original as `cause`, so existing ENOENT handling keeps working while the
 * message gains the path, the repo, and the cause.
 */
export function rewrapMissingWorkingDirectory(
  error: unknown,
  ctx: WorkingDirectoryContext,
  exists: (path: string) => boolean,
): unknown {
  if (!isSpawnEnoent(error)) return error;
  if (exists(ctx.cwd)) return error;
  const original = error as NodeJS.ErrnoException;
  return Object.assign(new Error(describeMissingWorkingDirectory(ctx)), {
    code: 'ENOENT',
    syscall: original.syscall,
    path: original.path,
    cause: original,
  });
}
