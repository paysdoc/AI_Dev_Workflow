/**
 * Schema strategy: full-contents writes only. Each edit entry specifies a
 * `path` (relative to the worktree root) and `contents` (the complete new
 * file contents). The interpreter writes every edit atomically before the
 * stub begins streaming.
 *
 * Side-effect boundary: the only intentional side effects are writing files
 * to `worktreePath` and the opt-in deletes and git actions a manifest names
 * (`deletes`, `stage`, `commits`, `commitAll`, `onCommitCommand`). All other
 * logic is pure — same inputs yield the same output or the same typed error.
 *
 * Env vars consumed by the stub (not this module):
 *   MOCK_MANIFEST_PATH  — absolute path to the manifest JSON file
 *   MOCK_WORKTREE_PATH  — absolute path to the target worktree (falls back to cwd)
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';
import { execSync, execFileSync } from 'child_process';

interface ManifestEdit {
  path: string;
  contents: string;
}

interface ManifestCommit {
  subject: string;
  date?: string;
}

export interface ManifestResponse {
  kind: 'rate-limited';
  /** Epoch seconds; defaults to now + 300 when absent. */
  resetsAt?: number;
  /** Defaults to 'five_hour'. */
  rateLimitType?: string;
  /** Reject only the first N invocations counted per worktree; absent means every invocation. */
  limitedInvocations?: number;
}

type CommitCommandBehaviour = 'stage-all-and-commit';

interface Manifest {
  jsonlPath: string;
  edits: ManifestEdit[];
  /** Removed after the edits are written; a path that is already gone is not an error. */
  deletes?: string[];
  /** Staged with `git add -- <paths>` after the edits and deletes, so a deletion is staged too. */
  stage?: string[];
  commits?: ManifestCommit[];
  /** After everything above, stages every change in the worktree and commits it — a planner that commits for itself. */
  commitAll?: ManifestCommit;
  /** Makes the stub answer /commit the way the real command does, instead of applying the edits. */
  onCommitCommand?: CommitCommandBehaviour;
  response?: ManifestResponse;
}

function isManifestEdit(v: unknown): v is ManifestEdit {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['path'] === 'string' &&
    typeof (v as Record<string, unknown>)['contents'] === 'string'
  );
}

function isManifestCommit(v: unknown): v is ManifestCommit {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj['subject'] !== 'string') return false;
  if ('date' in obj && typeof obj['date'] !== 'string') return false;
  return true;
}

function isManifestResponse(v: unknown): v is ManifestResponse {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (obj['kind'] !== 'rate-limited') return false;
  if ('resetsAt' in obj && typeof obj['resetsAt'] !== 'number') return false;
  if ('rateLimitType' in obj && typeof obj['rateLimitType'] !== 'string') return false;
  if ('limitedInvocations' in obj && typeof obj['limitedInvocations'] !== 'number') return false;
  return true;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function isManifest(v: unknown): v is Manifest {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj['jsonlPath'] !== 'string') return false;
  if (!Array.isArray(obj['edits'])) return false;
  if (!(obj['edits'] as unknown[]).every(isManifestEdit)) return false;
  if ('deletes' in obj && !isStringArray(obj['deletes'])) return false;
  if ('stage' in obj && !isStringArray(obj['stage'])) return false;
  if ('commits' in obj) {
    if (!Array.isArray(obj['commits'])) return false;
    if (!(obj['commits'] as unknown[]).every(isManifestCommit)) return false;
  }
  if ('commitAll' in obj && !isManifestCommit(obj['commitAll'])) return false;
  if ('onCommitCommand' in obj && obj['onCommitCommand'] !== 'stage-all-and-commit') return false;
  if ('response' in obj && !isManifestResponse(obj['response'])) return false;
  return true;
}

function writeEdit(absolutePath: string, contents: string): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, 'utf-8');
}

const COMMIT_COMMAND = /^\/commit(\s|$)/;
const COMMIT_COMMAND_PREFIX_ARG = /^\/commit\s+'([^']*)'/;

function stageAllAndCommit(worktreePath: string, subject: string): void {
  execFileSync('git', ['add', '-A'], { cwd: worktreePath });
  execFileSync('git', ['commit', '-q', '-m', subject], { cwd: worktreePath });
}

/** Steps 2 and 3 of `.claude/commands/commit.md`: `git add -A`, then `git commit`. Returns the subject committed. */
function standInForCommitCommand(worktreePath: string, prompt: string): string {
  const prefix = COMMIT_COMMAND_PREFIX_ARG.exec(prompt)?.[1] ?? 'stand-in';
  const subject = `${prefix}: commit every change in the worktree`;
  stageAllAndCommit(worktreePath, subject);
  return subject;
}

function applyWorktreeActions(manifest: Manifest, worktreePath: string): void {
  for (const relPath of manifest.deletes ?? []) {
    rmSync(resolve(worktreePath, relPath), { recursive: true, force: true });
  }
  if (manifest.stage && manifest.stage.length > 0) {
    execFileSync('git', ['add', '--', ...manifest.stage], { cwd: worktreePath });
  }
}

export interface ApplyManifestResult {
  /** Absolute paths of files written, in declaration order. */
  editsApplied: string[];
  /** Resolved absolute path of the JSONL payload to stream. */
  jsonlPath: string;
  commitsCreated: number;
  /** Present when the manifest asks the stub to answer rate-limited instead of streaming jsonlPath. */
  response?: ManifestResponse;
  /** Present when the stub stood in for /commit; the subject it committed under, which the stub answers with. */
  commitSubject?: string;
}

/**
 * @param prompt - The slash-command prompt the stub was invoked with. Only consulted when the
 *   manifest sets `onCommitCommand`.
 * @throws `Error` with `manifestInterpreter:` prefix for malformed manifests.
 * @throws `Error` with `conflicting edits` message for duplicate edit paths.
 */
export function applyManifest(
  manifestPath: string,
  worktreePath: string,
  prompt: string = '',
): ApplyManifestResult {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `manifestInterpreter: malformed manifest at ${manifestPath}: cannot read file — ${String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `manifestInterpreter: malformed manifest at ${manifestPath}: invalid JSON — ${String(err)}`,
    );
  }

  if (!isManifest(parsed)) {
    throw new Error(
      `manifestInterpreter: malformed manifest at ${manifestPath}: schema validation failed — expected { jsonlPath: string, edits: Array<{ path: string, contents: string }> }`,
    );
  }

  const jsonlPath = isAbsolute(parsed.jsonlPath)
    ? parsed.jsonlPath
    : resolve(worktreePath, parsed.jsonlPath);

  if (parsed.onCommitCommand && COMMIT_COMMAND.test(prompt)) {
    const commitSubject = standInForCommitCommand(worktreePath, prompt);
    return { editsApplied: [], jsonlPath, commitsCreated: 1, response: parsed.response, commitSubject };
  }

  const seenPaths = new Set<string>();
  for (const edit of parsed.edits) {
    if (seenPaths.has(edit.path)) {
      throw new Error(
        `manifestInterpreter: conflicting edits for ${edit.path}`,
      );
    }
    seenPaths.add(edit.path);
  }

  const editsApplied: string[] = [];
  for (const edit of parsed.edits) {
    const absolutePath = resolve(worktreePath, edit.path);
    writeEdit(absolutePath, edit.contents);
    editsApplied.push(absolutePath);
  }

  applyWorktreeActions(parsed, worktreePath);

  // Apply synthetic commits (optional — produces git history for loadPromotionStats)
  let commitsCreated = 0;
  if (parsed.commits && parsed.commits.length > 0) {
    for (const commit of parsed.commits) {
      const dateFlag = commit.date ? `--date="${commit.date}"` : '';
      const subject = commit.subject.replace(/"/g, '\\"');
      execSync(
        `git commit --allow-empty ${dateFlag} -m "${subject}"`,
        { cwd: worktreePath, encoding: 'utf-8' },
      );
      commitsCreated++;
    }
  }

  if (parsed.commitAll) {
    stageAllAndCommit(worktreePath, parsed.commitAll.subject);
    commitsCreated++;
  }

  return { editsApplied, jsonlPath, commitsCreated, response: parsed.response };
}
