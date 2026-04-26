/**
 * Manifest interpreter for the programmable claude-cli-stub.
 *
 * Schema strategy: full-contents writes only. Each edit entry specifies a
 * `path` (relative to the worktree root) and `contents` (the complete new
 * file contents). The interpreter writes every edit atomically before the
 * stub begins streaming.
 *
 * Side-effect boundary: the only intentional side effect is writing files
 * to `worktreePath`. All other logic is pure — same inputs yield the same
 * output or the same typed error.
 *
 * Env vars consumed by the stub (not this module):
 *   MOCK_MANIFEST_PATH  — absolute path to the manifest JSON file
 *   MOCK_WORKTREE_PATH  — absolute path to the target worktree (falls back to cwd)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

interface ManifestEdit {
  path: string;
  contents: string;
}

interface Manifest {
  jsonlPath: string;
  edits: ManifestEdit[];
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isManifestEdit(v: unknown): v is ManifestEdit {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['path'] === 'string' &&
    typeof (v as Record<string, unknown>)['contents'] === 'string'
  );
}

function isManifest(v: unknown): v is Manifest {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj['jsonlPath'] !== 'string') return false;
  if (!Array.isArray(obj['edits'])) return false;
  return (obj['edits'] as unknown[]).every(isManifestEdit);
}

// ---------------------------------------------------------------------------
// File-write helper (isolated side effect)
// ---------------------------------------------------------------------------

function writeEdit(absolutePath: string, contents: string): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ApplyManifestResult {
  /** Absolute paths of files written, in declaration order. */
  editsApplied: string[];
  /** Resolved absolute path of the JSONL payload to stream. */
  jsonlPath: string;
}

/**
 * Reads a manifest JSON file, validates its schema, applies declared file
 * edits to `worktreePath`, and returns the resolved JSONL path.
 *
 * @throws `Error` with `manifestInterpreter:` prefix for malformed manifests.
 * @throws `Error` with `conflicting edits` message for duplicate edit paths.
 */
export function applyManifest(
  manifestPath: string,
  worktreePath: string,
): ApplyManifestResult {
  // Parse
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

  // Check for conflicting edits (duplicate path values)
  const seenPaths = new Set<string>();
  for (const edit of parsed.edits) {
    if (seenPaths.has(edit.path)) {
      throw new Error(
        `manifestInterpreter: conflicting edits for ${edit.path}`,
      );
    }
    seenPaths.add(edit.path);
  }

  // Apply edits
  const editsApplied: string[] = [];
  for (const edit of parsed.edits) {
    const absolutePath = resolve(worktreePath, edit.path);
    writeEdit(absolutePath, edit.contents);
    editsApplied.push(absolutePath);
  }

  // Resolve jsonlPath
  const jsonlPath = isAbsolute(parsed.jsonlPath)
    ? parsed.jsonlPath
    : resolve(worktreePath, parsed.jsonlPath);

  return { editsApplied, jsonlPath };
}
