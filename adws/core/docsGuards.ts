// Module docs are current-state references; 400 lines is a generous ceiling
// signalling genuine bloat. Intentionally a defined constant — easy to retune.
export const DOC_BLOAT_THRESHOLD_LINES = 400;

import { type ConditionalDocEntry } from './conditionalDocsRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocSize {
  docPath: string;
  lineCount: number;
}

export interface BloatFlag {
  docPath: string;
  lineCount: number;
  threshold: number;
}

export interface RegrowthFlag {
  docPathA: string;
  docPathB: string;
  globA: string;
  globB: string;
}

export interface GuardFlags {
  bloat: BloatFlag[];
  regrowth: RegrowthFlag[];
}

// ---------------------------------------------------------------------------
// Glob-overlap core
// ---------------------------------------------------------------------------

// The leading path segments before the first segment containing a wildcard.
// E.g. "adws/vcs/**" → "adws/vcs"; "adws/core/foo.ts" → "adws/core/foo.ts"
function ownershipRoot(glob: string): string {
  const segments = glob.split('/');
  const wildcardIdx = segments.findIndex((s) => s.includes('*') || s.includes('?'));
  if (wildcardIdx === -1) return glob;
  return segments.slice(0, wildcardIdx).join('/');
}

// True iff a's /split segments are a leading subsequence of b's.
// "adws/core" is a prefix of "adws/core/foo.ts" but NOT "adws/coreutils/x.ts".
function isSegmentPrefix(a: string, b: string): boolean {
  if (a === '') return true;
  const aSegs = a.split('/');
  const bSegs = b.split('/');
  if (aSegs.length > bSegs.length) return false;
  return aSegs.every((seg, i) => seg === bSegs[i]);
}

export function globsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const rootA = ownershipRoot(a);
  const rootB = ownershipRoot(b);
  return isSegmentPrefix(rootA, rootB) || isSegmentPrefix(rootB, rootA);
}

// ---------------------------------------------------------------------------
// Guard functions
// ---------------------------------------------------------------------------

// At-threshold and below → no flag. Strictly greater than threshold → flag.
export function checkBloat(sizes: readonly DocSize[], threshold: number): BloatFlag[] {
  return sizes
    .filter((s) => s.lineCount > threshold)
    .map((s) => ({ docPath: s.docPath, lineCount: s.lineCount, threshold }));
}

function findPairOverlap(
  a: ConditionalDocEntry,
  b: ConditionalDocEntry,
): { globA: string; globB: string } | null {
  for (const globA of a.ownedGlobs) {
    for (const globB of b.ownedGlobs) {
      if (globsOverlap(globA, globB)) return { globA, globB };
    }
  }
  return null;
}

// Legacy entries (ownedGlobs: []) never participate — prevents ~190 false positives.
export function checkRegrowth(entries: readonly ConditionalDocEntry[]): RegrowthFlag[] {
  const active = entries.filter((e) => e.ownedGlobs.length > 0);
  const flags: RegrowthFlag[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const overlap = findPairOverlap(active[i], active[j]);
      if (overlap) {
        flags.push({
          docPathA: active[i].docPath,
          docPathB: active[j].docPath,
          globA: overlap.globA,
          globB: overlap.globB,
        });
      }
    }
  }
  return flags;
}

export function runDocsGuards(
  entries: readonly ConditionalDocEntry[],
  sizes: readonly DocSize[],
  threshold: number = DOC_BLOAT_THRESHOLD_LINES,
): GuardFlags {
  return {
    bloat: checkBloat(sizes, threshold),
    regrowth: checkRegrowth(entries),
  };
}
