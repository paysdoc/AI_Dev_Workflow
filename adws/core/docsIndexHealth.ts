/**
 * No I/O, no forge, no repo identity — the same module serves both the CI gate
 * (`checkLivingDocsIndex.ts`) and the cron sweep (`docsIndexSweep.ts`) so
 * they can never drift apart.
 *
 * Violations are computed on the REPAIRED registry, not the raw one: a
 * dropped dangling entry must not also count toward the band, and a pruned
 * dead glob must not also appear in an overlap.
 */

import {
  parseConditionalDocs,
  serializeConditionalDocs,
  matchesGlob,
  findOwningEntries,
  type ConditionalDocEntry,
  type ConditionalDocsRegistry,
} from './conditionalDocsRegistry';

export interface CountBand {
  readonly min: number;
  readonly max: number;
}

/**
 * 44 module docs + 2 READMEs + headroom for genuinely novel modules. The
 * lower bound is what catches a mass-deletion merge accident.
 */
export const DEFAULT_COUNT_BAND: CountBand = { min: 25, max: 60 };

export type DocsIndexRepair =
  | { readonly kind: 'drop-dangling-entry'; readonly docPath: string }
  | { readonly kind: 'prune-dead-glob'; readonly docPath: string; readonly glob: string };

export type DocsIndexViolation =
  | { readonly kind: 'non-canonical'; readonly firstDiffLine: number }
  | { readonly kind: 'duplicate-entry'; readonly docPath: string }
  | { readonly kind: 'orphan-doc'; readonly docPath: string }
  | { readonly kind: 'overlap'; readonly docPathA: string; readonly docPathB: string; readonly files: readonly string[] }
  | { readonly kind: 'count-out-of-band'; readonly count: number; readonly band: CountBand };

/** `files` are repo-root-relative posix paths — tracked files for the sweep, a filesystem walk for the gate. */
export interface DocsIndexHealthInputs {
  readonly content: string;
  readonly files: readonly string[];
}

export interface DocsIndexAssessment {
  readonly registry: ConditionalDocsRegistry;
  readonly repairs: readonly DocsIndexRepair[];
  readonly repaired: ConditionalDocsRegistry;
  readonly violations: readonly DocsIndexViolation[];
}

const FEATURE_DOC_RE = /^app_docs\/feature-[^/]+\.md$/;

/** True for a direct-child `app_docs/feature-*.md` path; excludes `app_docs/assets/**` and any other nesting. */
export function isFeatureDocPath(p: string): boolean {
  return FEATURE_DOC_RE.test(p);
}

function findDeadGlobRepairs(entry: ConditionalDocEntry, files: readonly string[]): DocsIndexRepair[] {
  return entry.ownedGlobs
    .filter((glob) => !files.some((f) => matchesGlob(glob, f)))
    .map((glob) => ({ kind: 'prune-dead-glob' as const, docPath: entry.docPath, glob }));
}

/**
 * Dangling = `docPath` absent from the file set, resolved against the repo
 * root — no `app_docs/` prefix is ever assumed. Dead glob = an `Owns:` glob
 * matching zero files. Legacy entries (no `Owns:`) can only ever produce a
 * `drop-dangling-entry` repair.
 */
export function findRepairs(registry: ConditionalDocsRegistry, files: readonly string[]): DocsIndexRepair[] {
  const fileSet = new Set(files);
  return registry.entries.flatMap((entry): DocsIndexRepair[] =>
    fileSet.has(entry.docPath)
      ? findDeadGlobRepairs(entry, files)
      : [{ kind: 'drop-dangling-entry', docPath: entry.docPath }],
  );
}

/**
 * Immutable: drops entries named by a `drop-dangling-entry` repair, filters
 * dead globs named by a `prune-dead-glob` repair. An entry whose every glob
 * dies keeps its `Conditions:` and becomes a legacy entry — it is never
 * dropped by a glob-only repair, only by its own dangling-entry repair.
 * Entry order is preserved; the input registry and its entries are never
 * mutated.
 */
export function applyRepairs(
  registry: ConditionalDocsRegistry,
  repairs: readonly DocsIndexRepair[],
): ConditionalDocsRegistry {
  const droppedDocPaths = new Set(
    repairs.filter((r) => r.kind === 'drop-dangling-entry').map((r) => r.docPath),
  );

  const deadGlobsByDoc = new Map<string, Set<string>>();
  for (const r of repairs) {
    if (r.kind !== 'prune-dead-glob') continue;
    const set = deadGlobsByDoc.get(r.docPath) ?? new Set<string>();
    set.add(r.glob);
    deadGlobsByDoc.set(r.docPath, set);
  }

  const entries = registry.entries
    .filter((e) => !droppedDocPaths.has(e.docPath))
    .map((e) => {
      const dead = deadGlobsByDoc.get(e.docPath);
      if (!dead) return e;
      return { ...e, ownedGlobs: e.ownedGlobs.filter((g) => !dead.has(g)) };
    });

  return { ...registry, entries };
}

/** Same first-diverging-line convention `checkLivingDocsIndex.ts` used. */
function findFirstDiffLine(a: string, b: string): number {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const maxLen = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < maxLen; i++) {
    if (linesA[i] !== linesB[i]) return i + 1;
  }
  return maxLen + 1;
}

function findDuplicateViolations(registry: ConditionalDocsRegistry): DocsIndexViolation[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const entry of registry.entries) {
    if (seen.has(entry.docPath)) dupes.add(entry.docPath);
    seen.add(entry.docPath);
  }
  return [...dupes].map((docPath) => ({ kind: 'duplicate-entry' as const, docPath }));
}

function findOrphanViolations(registry: ConditionalDocsRegistry, files: readonly string[]): DocsIndexViolation[] {
  const indexed = new Set(registry.entries.map((e) => e.docPath));
  return files
    .filter(isFeatureDocPath)
    .filter((docPath) => !indexed.has(docPath))
    .map((docPath) => ({ kind: 'orphan-doc' as const, docPath }));
}

/** NUL separates the pair because it can never occur in a path; keep it as the `\0` escape, never a raw byte, or git treats this file as binary. */
function overlapPairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/** All unordered pairs of entries that own `file`, docPath-sorted so pair order is stable regardless of owner order. */
function ownerPairsForFile(
  registry: ConditionalDocsRegistry,
  file: string,
): Array<{ docPathA: string; docPathB: string }> {
  const owners = findOwningEntries(registry, [file]);
  return owners.flatMap((ownerA, i) =>
    owners.slice(i + 1).map((ownerB) => {
      const [docPathA, docPathB] = [ownerA.docPath, ownerB.docPath].sort();
      return { docPathA, docPathB };
    }),
  );
}

/** One violation per unordered entry pair, aggregating every tracked file both entries own. Legacy entries (no globs) never participate — `findOwningEntries` already excludes them. */
function findOverlapViolations(registry: ConditionalDocsRegistry, files: readonly string[]): DocsIndexViolation[] {
  const fileOwnerPairs = files.flatMap((file) =>
    ownerPairsForFile(registry, file).map((pair) => ({ file, ...pair })),
  );

  const byPair = new Map<string, { docPathA: string; docPathB: string; files: string[] }>();
  for (const { file, docPathA, docPathB } of fileOwnerPairs) {
    const key = overlapPairKey(docPathA, docPathB);
    const existing = byPair.get(key) ?? { docPathA, docPathB, files: [] };
    existing.files.push(file);
    byPair.set(key, existing);
  }

  return [...byPair.values()].map((v) => ({ kind: 'overlap' as const, ...v }));
}

/**
 * Computed over `repaired` (never the raw registry) and `content` (the
 * original text, for the round-trip check) — so a dropped dangling entry no
 * longer counts toward the band and a pruned dead glob never appears in an
 * overlap. `band === null` skips the count check entirely (a target repo's
 * count is never policed).
 */
export function findViolations(
  content: string,
  repaired: ConditionalDocsRegistry,
  files: readonly string[],
  band: CountBand | null,
): DocsIndexViolation[] {
  const violations: DocsIndexViolation[] = [];

  const reserialized = serializeConditionalDocs(parseConditionalDocs(content));
  if (reserialized !== content) {
    violations.push({ kind: 'non-canonical', firstDiffLine: findFirstDiffLine(content, reserialized) });
  }

  violations.push(...findDuplicateViolations(repaired));
  violations.push(...findOrphanViolations(repaired, files));
  violations.push(...findOverlapViolations(repaired, files));

  if (band !== null) {
    const count = repaired.entries.length;
    if (count < band.min || count > band.max) {
      violations.push({ kind: 'count-out-of-band', count, band });
    }
  }

  return violations;
}

export function assessDocsIndexHealth(
  inputs: DocsIndexHealthInputs,
  band: CountBand | null = DEFAULT_COUNT_BAND,
): DocsIndexAssessment {
  const registry = parseConditionalDocs(inputs.content);
  const repairs = findRepairs(registry, inputs.files);
  const repaired = applyRepairs(registry, repairs);
  const violations = findViolations(inputs.content, repaired, inputs.files, band);
  return { registry, repairs, repaired, violations };
}

const OVERLAP_FILE_PREVIEW = 5;

export function formatRepair(repair: DocsIndexRepair): string {
  if (repair.kind === 'drop-dangling-entry') return `drop dangling entry: ${repair.docPath} (doc file not found)`;
  return `prune dead glob "${repair.glob}" from ${repair.docPath} (matches no tracked file)`;
}

export function formatViolation(violation: DocsIndexViolation): string {
  switch (violation.kind) {
    case 'non-canonical':
      return `non-canonical serialization: first divergence at line ${violation.firstDiffLine}`;
    case 'duplicate-entry':
      return `duplicate entry: ${violation.docPath}`;
    case 'orphan-doc':
      return `orphan doc (no entry indexes it): ${violation.docPath}`;
    case 'overlap': {
      const preview = violation.files.slice(0, OVERLAP_FILE_PREVIEW);
      const extra = violation.files.length > OVERLAP_FILE_PREVIEW ? ` … and ${violation.files.length - OVERLAP_FILE_PREVIEW} more` : '';
      return `overlap: ${violation.docPathA} and ${violation.docPathB} both own ${preview.join(', ')}${extra}`;
    }
    case 'count-out-of-band':
      return `entry count ${violation.count} outside band [${violation.band.min}, ${violation.band.max}]`;
  }
}
