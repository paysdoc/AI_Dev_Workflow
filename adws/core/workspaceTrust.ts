/**
 * Grants Claude Code workspace trust for a target-repo workspace path in
 * `~/.claude.json` (issue #846).
 *
 * Claude Code refuses to honour a target repo's `.claude/settings.json`
 * `permissions.allow` entries until the workspace has been opened
 * interactively and the trust dialog accepted, or until
 * `projects[<repoRoot>].hasTrustDialogAccepted` is `true` in `~/.claude.json`.
 * There is no CLI flag or env var for this. ADW runs unattended, so this
 * module writes that entry itself, once per repo, at workspace-ensure time.
 *
 * This lives in `adws/core/` (the ADW-side wrapper), not in
 * `adws/gitContext/repoWorkspace.ts` — workspace trust is a Claude-Code
 * concern, not a git one, and that library is deleted by #840 — and not on
 * the per-spawn path in `adws/agents/claudeAgent.ts`. `~/.claude.json` is
 * read-modify-written by every live Claude Code session (interactive or
 * spawned), so writing once per repo at ensure time — before any agent for
 * that repo exists — keeps the race window with a concurrently running
 * interactive session at zero, and the tmp+rename below guarantees the file
 * is never left partial even if that race is hit.
 *
 * The key written is the EXACT `workspacePath` string the caller passes in —
 * never realpath'd, resolved, or trailing-slash-trimmed — because that is
 * the string Claude Code itself names in its trust warning.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log as defaultLog, type LogLevel } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const CLAUDE_CONFIG_FILENAME = '.claude.json';

export type WorkspaceTrustFs = Pick<typeof fs, 'readFileSync' | 'writeFileSync' | 'renameSync'>;

export interface WorkspaceTrustDeps {
  /** Home directory resolver; defaults to os.homedir. Injectable for tests. */
  homedir?: () => string;
  /** Filesystem seam; defaults to real fs. */
  fsDeps?: WorkspaceTrustFs;
  /** Log function; defaults to the core logger. */
  log?: (message: string, level?: LogLevel) => void;
}

export type WorkspaceTrustResult =
  | { action: 'already_trusted' }
  | { action: 'trusted' }
  | { action: 'skipped'; reason: string };

type JsonObject = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type ConfigReadResult = { ok: true; config: JsonObject } | { ok: false; reason: string };

function readConfig(file: string, fsDeps: WorkspaceTrustFs): ConfigReadResult {
  let raw: string;
  try {
    raw = fsDeps.readFileSync(file, 'utf-8') as string;
  } catch (err) {
    return { ok: false, reason: `cannot read ${file}: ${errorMessage(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `cannot parse ${file}: ${errorMessage(err)}` };
  }

  if (!isJsonObject(parsed)) {
    return { ok: false, reason: `${file} is not a JSON object` };
  }

  return { ok: true, config: parsed };
}

function isWorkspaceTrusted(config: JsonObject, workspacePath: string): boolean {
  if (!isJsonObject(config.projects)) return false;
  const project = config.projects[workspacePath];
  return isJsonObject(project) && project.hasTrustDialogAccepted === true;
}

/** Pure — returns a new config; never mutates `config` or any nested object it holds. */
function withTrustedProject(config: JsonObject, workspacePath: string): JsonObject {
  const projects = isJsonObject(config.projects) ? config.projects : {};
  const existing = isJsonObject(projects[workspacePath]) ? projects[workspacePath] : {};
  return {
    ...config,
    projects: {
      ...projects,
      [workspacePath]: { ...existing, hasTrustDialogAccepted: true },
    },
  };
}

function atomicWriteJson(file: string, data: JsonObject, fsDeps: WorkspaceTrustFs): void {
  const tmp = `${file}.tmp`;
  fsDeps.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fsDeps.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves the `~/.claude.json` path. `homedir` defaults to `os.homedir` —
 * never read `$HOME` directly here, so Windows resolution stays correct.
 */
export function claudeConfigPath(homedir: () => string = os.homedir): string {
  return path.join(homedir(), CLAUDE_CONFIG_FILENAME);
}

/**
 * Grants Claude Code workspace trust for `workspacePath` in `~/.claude.json`.
 *
 * Never throws. A missing, unreadable, unparseable, or non-object config
 * file, a non-object `projects` value, or a failed tmp-write/rename all
 * yield `{ action: 'skipped', reason }` plus a `warn` log — the caller (the
 * workspace ensure) must proceed exactly as it does today in every case.
 * Already-trusted performs no write. Otherwise writes atomically (tmp file
 * in the same directory, then rename) and returns `{ action: 'trusted' }`.
 */
export function ensureWorkspaceTrusted(workspacePath: string, deps: WorkspaceTrustDeps = {}): WorkspaceTrustResult {
  const homedir = deps.homedir ?? os.homedir;
  const fsDeps = deps.fsDeps ?? fs;
  const log = deps.log ?? defaultLog;
  const file = claudeConfigPath(homedir);

  const skip = (reason: string): WorkspaceTrustResult => {
    log(`Skipping workspace trust for ${workspacePath}: ${reason}`, 'warn');
    return { action: 'skipped', reason };
  };

  const read = readConfig(file, fsDeps);
  if (!read.ok) return skip(read.reason);
  const { config } = read;

  if (config.projects !== undefined && !isJsonObject(config.projects)) {
    return skip('projects is not an object');
  }

  if (isWorkspaceTrusted(config, workspacePath)) {
    return { action: 'already_trusted' };
  }

  try {
    atomicWriteJson(file, withTrustedProject(config, workspacePath), fsDeps);
  } catch (err) {
    return skip(`cannot write ${file}: ${errorMessage(err)}`);
  }

  log(`Trusted workspace ${workspacePath} in ${file}`, 'info');
  return { action: 'trusted' };
}
