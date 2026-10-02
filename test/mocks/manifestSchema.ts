/**
 * The shape of a stub manifest and the type guards that validate it. Pure: no I/O.
 * See manifestInterpreter.ts for what each field does when it is applied.
 */

export interface ManifestEdit {
  path: string;
  contents: string;
}

export interface ManifestCommit {
  subject: string;
  date?: string;
}

export interface RateLimitedManifestResponse {
  kind: 'rate-limited';
  /** Epoch seconds; defaults to now + 300 when absent. */
  resetsAt?: number;
  /** Defaults to 'five_hour'. */
  rateLimitType?: string;
  /** Reject only the first N invocations counted per worktree; absent means every invocation. */
  limitedInvocations?: number;
}

export interface ErrorManifestResponse {
  kind: 'error';
}

export type ManifestResponse = RateLimitedManifestResponse | ErrorManifestResponse;

export type CommitCommandBehaviour = 'stage-all-and-commit';

/** What the stub does for a prompt whose opening slash command the entry is keyed on. It applies alone: nothing of the top-level manifest runs. */
export interface ManifestCommandEntry {
  jsonlPath: string;
  edits?: ManifestEdit[];
  commits?: ManifestCommit[];
  response?: ManifestResponse;
}

export interface Manifest {
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
  /** Keyed on the slash command that opens the prompt, matched exactly; an entry replaces the top-level manifest for that prompt. */
  byCommand?: Record<string, ManifestCommandEntry>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function isManifestEdit(v: unknown): v is ManifestEdit {
  return isRecord(v) && typeof v['path'] === 'string' && typeof v['contents'] === 'string';
}

function isManifestCommit(v: unknown): v is ManifestCommit {
  if (!isRecord(v)) return false;
  if (typeof v['subject'] !== 'string') return false;
  if ('date' in v && typeof v['date'] !== 'string') return false;
  return true;
}

function isEditList(v: unknown): v is ManifestEdit[] {
  return Array.isArray(v) && v.every(isManifestEdit);
}

function isCommitList(v: unknown): v is ManifestCommit[] {
  return Array.isArray(v) && v.every(isManifestCommit);
}

function isRateLimitedResponse(obj: Record<string, unknown>): boolean {
  if ('resetsAt' in obj && typeof obj['resetsAt'] !== 'number') return false;
  if ('rateLimitType' in obj && typeof obj['rateLimitType'] !== 'string') return false;
  if ('limitedInvocations' in obj && typeof obj['limitedInvocations'] !== 'number') return false;
  return true;
}

function isManifestResponse(v: unknown): v is ManifestResponse {
  if (!isRecord(v)) return false;
  if (v['kind'] === 'error') return true;
  return v['kind'] === 'rate-limited' && isRateLimitedResponse(v);
}

function isManifestCommandEntry(v: unknown): v is ManifestCommandEntry {
  if (!isRecord(v)) return false;
  if (typeof v['jsonlPath'] !== 'string') return false;
  if ('edits' in v && !isEditList(v['edits'])) return false;
  if ('commits' in v && !isCommitList(v['commits'])) return false;
  if ('response' in v && !isManifestResponse(v['response'])) return false;
  return true;
}

function isByCommand(v: unknown): v is Record<string, ManifestCommandEntry> {
  if (!isRecord(v)) return false;
  return Object.entries(v).every(([command, entry]) => command.startsWith('/') && isManifestCommandEntry(entry));
}

export function isManifest(v: unknown): v is Manifest {
  if (!isRecord(v)) return false;
  if (typeof v['jsonlPath'] !== 'string') return false;
  if (!isEditList(v['edits'])) return false;
  if ('deletes' in v && !isStringArray(v['deletes'])) return false;
  if ('stage' in v && !isStringArray(v['stage'])) return false;
  if ('commits' in v && !isCommitList(v['commits'])) return false;
  if ('commitAll' in v && !isManifestCommit(v['commitAll'])) return false;
  if ('onCommitCommand' in v && v['onCommitCommand'] !== 'stage-all-and-commit') return false;
  if ('response' in v && !isManifestResponse(v['response'])) return false;
  if ('byCommand' in v && !isByCommand(v['byCommand'])) return false;
  return true;
}
