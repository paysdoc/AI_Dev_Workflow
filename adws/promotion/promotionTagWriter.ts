import type { TagState } from './types.ts';

const SUGGESTION_DATE_RE = /@promotion-suggested-(\d{4}-\d{2}-\d{2})/;

// Returns the [firstIdx, lastIdx] span of the contiguous @-tag block that
// sits immediately before the scenario header (walking backward, stopping
// on any non-empty non-tag line). null when no such block exists.
function findTagBlockBounds(
  lines: string[],
  headerIdx: number,
): { firstIdx: number; lastIdx: number } | null {
  let nearestIdx = -1;
  let farthestIdx = -1;
  for (let i = headerIdx - 1; i >= 0; i--) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('@')) {
      if (nearestIdx === -1) nearestIdx = i;
      farthestIdx = i;
    } else if (trimmed.length > 0) {
      break;
    }
  }
  if (nearestIdx === -1) return null;
  return { firstIdx: farthestIdx, lastIdx: nearestIdx };
}

export function detectExistingSuggestionDate(
  content: string,
  scenarioHeaderLine: number,
): string | null {
  const lines = content.split('\n');
  const bounds = findTagBlockBounds(lines, scenarioHeaderLine - 1);
  if (!bounds) return null;
  for (let i = bounds.firstIdx; i <= bounds.lastIdx; i++) {
    const match = SUGGESTION_DATE_RE.exec(lines[i]);
    if (match) return match[1];
  }
  return null;
}

export function applyTagState(
  content: string,
  scenarioHeaderLine: number,
  state: TagState,
  today: string,
): string {
  const lines = content.split('\n');
  const headerIdx = scenarioHeaderLine - 1;

  if (state === 'add-suggestion') {
    const newTag = `@promotion-suggested-${today}`;
    const bounds = findTagBlockBounds(lines, headerIdx);
    if (bounds !== null) {
      lines[bounds.lastIdx] = `${lines[bounds.lastIdx]} ${newTag}`;
    } else {
      const headerIndent = lines[headerIdx].match(/^(\s*)/)?.[1] ?? '';
      lines.splice(headerIdx, 0, `${headerIndent}${newTag}`);
    }
    return lines.join('\n');
  }

  if (state === 'refresh-date') {
    const bounds = findTagBlockBounds(lines, headerIdx);
    if (bounds) {
      for (let i = bounds.firstIdx; i <= bounds.lastIdx; i++) {
        if (SUGGESTION_DATE_RE.test(lines[i])) {
          lines[i] = lines[i].replace(SUGGESTION_DATE_RE, `@promotion-suggested-${today}`);
          return lines.join('\n');
        }
      }
    }
    throw new Error('promotionTagWriter: refresh-date requires an existing @promotion-suggested-* tag');
  }

  // idempotent: remove-suggestion is a no-op when no existing tag is found
  if (state === 'remove-suggestion') {
    const bounds = findTagBlockBounds(lines, headerIdx);
    if (!bounds) return content;
    for (let i = bounds.firstIdx; i <= bounds.lastIdx; i++) {
      if (!SUGGESTION_DATE_RE.test(lines[i])) continue;
      const line = lines[i];
      const leadingIndent = line.match(/^(\s*)/)?.[1] ?? '';
      const tokens = line.trimStart().split(/\s+/).filter(t => t.length > 0);
      const remaining = tokens.filter(t => !SUGGESTION_DATE_RE.test(t));
      if (remaining.length === 0) {
        lines.splice(i, 1);
      } else {
        lines[i] = leadingIndent + remaining.join(' ');
      }
      return lines.join('\n');
    }
    return content;
  }

  throw new Error(`promotionTagWriter: unsupported state "${String(state)}"`);
}
