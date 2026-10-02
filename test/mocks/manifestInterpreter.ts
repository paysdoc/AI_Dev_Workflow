/**
 * Schema strategy: full-contents writes only. Each edit entry specifies a
 * `path` (relative to the worktree root) and `contents` (the complete new
 * file contents). The interpreter writes every edit atomically before the
 * stub begins streaming.
 *
 * Per-command entries: `byCommand` is keyed on the slash command that opens the prompt, matched
 * exactly (`/implement-tdd` never selects `/implement`). A matching entry applies alone — its
 * edits, its commits, its jsonlPath and its response — and none of the top-level actions run.
 * A prompt no entry matches gets the top-level manifest.
 *
 * Response: `{ "kind": "error" }` makes the stub stream an `is_error` result and exit 1;
 * `{ "kind": "rate-limited" }` answers as a rate limit does.
 *
 * Refusal guard: before anything is written, every declared edit and delete — top-level and in every
 * entry, selected or not — is checked, and a manifest that would write `.adw/state.json`, anything
 * under `agents/` or anything beyond the worktree is refused whole (see manifestRefusalGuard.ts).
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
import { isManifest, type Manifest, type ManifestCommandEntry, type ManifestCommit, type ManifestEdit, type ManifestResponse } from './manifestSchema.ts';
import { findRefusedPaths, ManifestRefusalError } from './manifestRefusalGuard.ts';

export type { Manifest, ManifestCommandEntry, ManifestResponse } from './manifestSchema.ts';
export { findRefusedPaths, ManifestRefusalError };

function writeEdit(absolutePath: string, contents: string): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, 'utf-8');
}

const COMMIT_COMMAND = /^\/commit(\s|$)/;
const COMMIT_COMMAND_PREFIX_ARG = /^\/commit\s+'([^']*)'/;
const PROMPT_COMMAND = /^\/\S+/;

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
  /** Present when the manifest asks the stub to answer rate-limited or with an error instead of streaming jsonlPath. */
  response?: ManifestResponse;
  /** Present when the stub stood in for /commit; the subject it committed under, which the stub answers with. */
  commitSubject?: string;
}

function readManifest(manifestPath: string): Manifest {
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
      `manifestInterpreter: malformed manifest at ${manifestPath}: schema validation failed — expected { jsonlPath: string, edits: Array<{ path: string, contents: string }>, byCommand?: { "/command": { jsonlPath: string, edits?, commits?, response? } } }`,
    );
  }
  return parsed;
}

function resolveJsonlPath(jsonlPath: string, worktreePath: string): string {
  return isAbsolute(jsonlPath) ? jsonlPath : resolve(worktreePath, jsonlPath);
}

function assertNoConflictingEdits(edits: readonly ManifestEdit[]): void {
  const seenPaths = new Set<string>();
  for (const edit of edits) {
    if (seenPaths.has(edit.path)) {
      throw new Error(
        `manifestInterpreter: conflicting edits for ${edit.path}`,
      );
    }
    seenPaths.add(edit.path);
  }
}

function writeEdits(edits: readonly ManifestEdit[], worktreePath: string): string[] {
  return edits.map((edit) => {
    const absolutePath = resolve(worktreePath, edit.path);
    writeEdit(absolutePath, edit.contents);
    return absolutePath;
  });
}

/** Optional — produces git history for loadPromotionStats. */
function createAllowEmptyCommits(commits: readonly ManifestCommit[] | undefined, worktreePath: string): number {
  for (const commit of commits ?? []) {
    const dateFlag = commit.date ? `--date="${commit.date}"` : '';
    const subject = commit.subject.replace(/"/g, '\\"');
    execSync(
      `git commit --allow-empty ${dateFlag} -m "${subject}"`,
      { cwd: worktreePath, encoding: 'utf-8' },
    );
  }
  return commits?.length ?? 0;
}

function selectEntry(manifest: Manifest, prompt: string): ManifestCommandEntry | undefined {
  const command = PROMPT_COMMAND.exec(prompt)?.[0];
  return command === undefined ? undefined : manifest.byCommand?.[command];
}

function applyEntry(entry: ManifestCommandEntry, worktreePath: string): ApplyManifestResult {
  const edits = entry.edits ?? [];
  assertNoConflictingEdits(edits);
  const editsApplied = writeEdits(edits, worktreePath);
  const commitsCreated = createAllowEmptyCommits(entry.commits, worktreePath);
  return { editsApplied, jsonlPath: resolveJsonlPath(entry.jsonlPath, worktreePath), commitsCreated, response: entry.response };
}

function applyTopLevel(manifest: Manifest, worktreePath: string, prompt: string): ApplyManifestResult {
  const jsonlPath = resolveJsonlPath(manifest.jsonlPath, worktreePath);

  if (manifest.onCommitCommand && COMMIT_COMMAND.test(prompt)) {
    const commitSubject = standInForCommitCommand(worktreePath, prompt);
    return { editsApplied: [], jsonlPath, commitsCreated: 1, response: manifest.response, commitSubject };
  }

  assertNoConflictingEdits(manifest.edits);
  const editsApplied = writeEdits(manifest.edits, worktreePath);
  applyWorktreeActions(manifest, worktreePath);
  let commitsCreated = createAllowEmptyCommits(manifest.commits, worktreePath);

  if (manifest.commitAll) {
    stageAllAndCommit(worktreePath, manifest.commitAll.subject);
    commitsCreated++;
  }

  return { editsApplied, jsonlPath, commitsCreated, response: manifest.response };
}

/**
 * @param prompt - The slash-command prompt the stub was invoked with. Selects a `byCommand` entry,
 *   and is consulted for `onCommitCommand`.
 * @throws `Error` with `manifestInterpreter:` prefix for malformed manifests.
 * @throws `ManifestRefusalError` when the manifest declares a path it may not write; nothing is written.
 * @throws `Error` with `conflicting edits` message for duplicate edit paths.
 */
export function applyManifest(
  manifestPath: string,
  worktreePath: string,
  prompt: string = '',
): ApplyManifestResult {
  const manifest = readManifest(manifestPath);

  const refusedPaths = findRefusedPaths(manifest, worktreePath);
  if (refusedPaths.length > 0) throw new ManifestRefusalError(manifestPath, refusedPaths);

  const entry = selectEntry(manifest, prompt);
  return entry ? applyEntry(entry, worktreePath) : applyTopLevel(manifest, worktreePath, prompt);
}
