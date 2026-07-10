/**
 * Pure parse/serialize of the on-file promotion markers `@promotion-suggested-<date>`
 * and `@promotion-declined`, modelling the terminal state machine
 * `none -> suggested -> declined` (a decline always wins over a lingering
 * suggestion — rejecting a promotion is durable, matching PRD user stories
 * 16-17). No I/O; every function returns a new value and never mutates its
 * input. Marker regex/token patterns adapted from `adws/promotion/promotionTagWriter.ts`
 * (not imported — that module is slated for deletion in a later PRD slice).
 */

export type PromotionTagState = 'none' | 'suggested' | 'declined';

const DECLINED_TOKEN = '@promotion-declined';
const SUGGESTED_TOKEN_RE = /^@promotion-suggested-\d{4}-\d{2}-\d{2}$/;

function lineTokens(line: string): string[] {
  return line.trim().split(/\s+/).filter(t => t.length > 0);
}

/** A "tag line" is non-empty and every whitespace-separated token starts with `@`. */
function isTagLine(line: string): boolean {
  const tokens = lineTokens(line);
  return tokens.length > 0 && tokens.every(t => t.startsWith('@'));
}

function isMarkerToken(token: string): boolean {
  return token === DECLINED_TOKEN || SUGGESTED_TOKEN_RE.test(token);
}

function allTagTokens(content: string): string[] {
  return content.split('\n').filter(isTagLine).flatMap(lineTokens);
}

/**
 * Parses the promotion state from a feature file's full text. Considers only
 * tag lines (feature-level or scenario-level, placement-agnostic) — never
 * prose — so a Feature description or step that merely mentions a marker as
 * literal text is not matched. `declined` is terminal and wins when both
 * markers are present (a malformed/partially-written file).
 */
export function parsePromotionTagState(content: string): PromotionTagState {
  const tokens = allTagTokens(content);
  if (tokens.includes(DECLINED_TOKEN)) return 'declined';
  if (tokens.some(t => SUGGESTED_TOKEN_RE.test(t))) return 'suggested';
  return 'none';
}

/** Exempt from the age-based sweep only while a promotion is actively suggested. */
export function isPromotionExempt(state: PromotionTagState): boolean {
  return state === 'suggested';
}

function findFeatureLineIndex(lines: string[]): number {
  return lines.findIndex(line => /^\s*Feature:/.test(line));
}

/** Contiguous tag-line block directly above the `Feature:` line, walking backward. */
function findFeatureTagBlockBounds(lines: string[], featureIdx: number): { first: number; last: number } | null {
  let first = -1;
  let last = -1;
  for (let i = featureIdx - 1; i >= 0; i--) {
    if (isTagLine(lines[i])) {
      if (last === -1) last = i;
      first = i;
    } else if (lines[i].trim().length > 0) {
      break;
    }
  }
  return last === -1 ? null : { first, last };
}

function buildTargetTokens(existing: string[], target: PromotionTagState, date?: string): string[] {
  const nonMarkers = existing.filter(t => !isMarkerToken(t));
  if (target === 'none') return nonMarkers;
  if (target === 'declined') return [...nonMarkers, DECLINED_TOKEN];
  return [...nonMarkers, `@promotion-suggested-${date}`];
}

/**
 * Applies `target` to the feature-level tag block (the tag line(s) directly
 * above `Feature:`), preserving every non-marker token and all other file
 * bytes. Idempotent: re-applying the same target (same `opts.date` for
 * `suggested`) yields byte-identical output. Creates a tag line above
 * `Feature:` (matching its indentation) when none exists and the target
 * requires one; removes the tag line entirely when it would end up empty.
 */
export function serializePromotionTagState(
  content: string,
  target: PromotionTagState,
  opts?: { date?: string },
): string {
  if (target === 'suggested' && !opts?.date) {
    throw new Error('serializePromotionTagState: target "suggested" requires opts.date');
  }

  const lines = content.split('\n');
  const featureIdx = findFeatureLineIndex(lines);
  if (featureIdx === -1) return content;

  const bounds = findFeatureTagBlockBounds(lines, featureIdx);
  const existingTokens = bounds ? lines.slice(bounds.first, bounds.last + 1).flatMap(lineTokens) : [];
  const targetTokens = buildTargetTokens(existingTokens, target, opts?.date);
  const indent = bounds
    ? (lines[bounds.first].match(/^(\s*)/)?.[1] ?? '')
    : (lines[featureIdx].match(/^(\s*)/)?.[1] ?? '');

  const blockStart = bounds ? bounds.first : featureIdx;
  const blockLength = bounds ? bounds.last - bounds.first + 1 : 0;
  const replacement = targetTokens.length > 0 ? [`${indent}${targetTokens.join(' ')}`] : [];

  const result = [...lines];
  result.splice(blockStart, blockLength, ...replacement);
  return result.join('\n');
}
