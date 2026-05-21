import type { TagState } from './types.ts';

export function applyTagState(
  content: string,
  scenarioHeaderLine: number,
  state: TagState,
  today: string,
): string {
  if (state !== 'add-suggestion') {
    throw new Error('promotionTagWriter: only "add-suggestion" is supported in this slice');
  }

  const lines = content.split('\n');
  const headerIdx = scenarioHeaderLine - 1; // 1-based → 0-based

  const newTag = `@promotion-suggested-${today}`;

  // Walk backward from header to find a contiguous tag line block
  let lastTagLineIdx = -1;
  for (let i = headerIdx - 1; i >= 0; i--) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('@')) {
      lastTagLineIdx = i;
      break;
    }
    // Stop if we hit a non-empty, non-tag line
    if (trimmed.length > 0) break;
  }

  if (lastTagLineIdx !== -1) {
    // Append to existing tag line
    lines[lastTagLineIdx] = `${lines[lastTagLineIdx]} ${newTag}`;
  } else {
    // Determine indentation from the header line
    const headerIndent = lines[headerIdx].match(/^(\s*)/)?.[1] ?? '';
    lines.splice(headerIdx, 0, `${headerIndent}${newTag}`);
  }

  return lines.join('\n');
}
