/**
 * Pure decision module for region-overlap serialization.
 *
 * No I/O. All functions are deterministic over their inputs.
 * Side-effecting callers (signal sourcing, blocker registration) live in
 * regionOverlapSignals.ts.
 */

export interface RegionSignal {
  readonly issueNumber: number;
  readonly paths: string[];
  readonly inFlight: boolean;
}

export interface SerializationDecision {
  readonly serialize: boolean;
  readonly blockedBy?: number;
  readonly overlapPaths?: string[];
}

export interface InFlightIssue {
  readonly issueNumber: number;
  readonly relevantFiles: string[];
}

export interface OrderingRecommendation {
  readonly issueA: number;
  readonly issueB: number;
  readonly sharedPaths: string[];
}

/** Trim whitespace, strip surrounding backtick/quote chars, normalize path separators and case. */
export function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .trim();
}

/**
 * Extract file paths from a `## Relevant Files` or `## Touched Files` section.
 * Returns normalized, deduplicated paths.
 */
export function parseRelevantFilesSection(markdown: string): string[] {
  const headingPattern = /^##\s+(?:relevant files|touched files)\b/im;
  const match = markdown.match(headingPattern);
  if (!match || match.index === undefined) return [];

  const sectionStart = match.index + match[0].length;
  const rest = markdown.slice(sectionStart);
  const nextHeading = rest.match(/^##\s+/m);
  const section = nextHeading?.index !== undefined
    ? rest.slice(0, nextHeading.index)
    : rest;

  const paths = new Set<string>();

  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Bullet list items: - `path/to/file.ts` or - path/to/file.ts
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      // Take the first token only (strip trailing description after whitespace)
      const raw = bulletMatch[1]!
        .trim()
        .replace(/^[`'"]+|[`'"]+$/g, '')
        .split(/\s+/)[0] ?? '';
      if (raw && (raw.includes('/') || raw.includes('.'))) {
        paths.add(normalizePath(raw));
      }
      continue;
    }

    // Inline backtick code anywhere in the line
    for (const m of trimmed.matchAll(/`([^`]+)`/g)) {
      const raw = m[1]!.trim();
      if (raw.includes('/') || raw.includes('.')) {
        paths.add(normalizePath(raw));
      }
    }
  }

  return [...paths];
}

/**
 * Return whether two path sets share at least one normalized path,
 * along with the set of shared paths.
 */
export function pathsOverlap(
  a: readonly string[],
  b: readonly string[],
): { overlap: boolean; shared: string[] } {
  const normA = a.map(normalizePath);
  const normB = new Set(b.map(normalizePath));
  const shared = normA.filter(p => normB.has(p));
  return { overlap: shared.length > 0, shared };
}

/**
 * Determine whether a candidate issue should defer behind one of its siblings
 * due to region overlap.
 *
 * Tie-break (deadlock-free):
 *   1. If any sibling is in-flight, the candidate defers behind the
 *      lowest-numbered in-flight overlapping sibling.
 *   2. Otherwise the lowest issue number in the overlap cluster wins;
 *      every other member defers behind it.
 *
 * A candidate with an empty path signal is never serialized (no false positives).
 */
export function decideSerialization(
  candidate: RegionSignal,
  siblings: RegionSignal[],
): SerializationDecision {
  if (candidate.paths.length === 0) return { serialize: false };

  const overlappingSiblings = siblings.filter(s =>
    s.paths.length > 0 && pathsOverlap(candidate.paths, s.paths).overlap,
  );

  if (overlappingSiblings.length === 0) return { serialize: false };

  // Full cluster: candidate + all overlapping siblings.
  const cluster: RegionSignal[] = [candidate, ...overlappingSiblings];

  const inFlightMembers = cluster.filter(s => s.inFlight);
  const anchor = inFlightMembers.length > 0
    ? inFlightMembers.reduce((min, s) => s.issueNumber < min.issueNumber ? s : min, inFlightMembers[0]!)
    : cluster.reduce((min, s) => s.issueNumber < min.issueNumber ? s : min, cluster[0]!);

  if (anchor.issueNumber === candidate.issueNumber) return { serialize: false };

  const { shared } = pathsOverlap(candidate.paths, anchor.paths);
  return { serialize: true, blockedBy: anchor.issueNumber, overlapPaths: shared };
}

/**
 * Compare every pair of in-flight issues and return ordering recommendations
 * for pairs that share at least one relevant file. Advisory — never a hard block.
 */
export function scanPostPlanOverlaps(
  inflight: readonly InFlightIssue[],
): OrderingRecommendation[] {
  const recommendations: OrderingRecommendation[] = [];
  for (let i = 0; i < inflight.length; i++) {
    for (let j = i + 1; j < inflight.length; j++) {
      const a = inflight[i]!;
      const b = inflight[j]!;
      const { overlap, shared } = pathsOverlap(a.relevantFiles, b.relevantFiles);
      if (overlap) {
        recommendations.push({ issueA: a.issueNumber, issueB: b.issueNumber, sharedPaths: shared });
      }
    }
  }
  return recommendations;
}
