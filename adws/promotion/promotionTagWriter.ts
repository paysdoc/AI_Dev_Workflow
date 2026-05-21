import type { TagState } from './types.ts';

function findTagBlockAbove(lines: string[], headerIdx: number): number {
  for (let i = headerIdx - 1; i >= 0; i--) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('@')) return i;
    if (trimmed.length > 0) break;
  }
  return -1;
}

function removeTokenFromTagLine(line: string, pattern: RegExp): string {
  if (!pattern.test(line)) return line;
  // Reset lastIndex since we use global regex
  pattern.lastIndex = 0;
  const leadingSpaces = line.match(/^(\s*)/)?.[1] ?? '';
  const cleaned = line.replace(pattern, '').replace(/\s{2,}/g, ' ').trimEnd();
  // If only whitespace remains after cleaning the tag content, return empty
  const content = cleaned.trim();
  if (content === '') return '';
  return leadingSpaces + content.trimStart();
}

function applyRemoval(
  lines: string[],
  headerIdx: number,
  pattern: RegExp,
): string[] {
  const result = [...lines];
  let offset = 0;

  for (let i = headerIdx - 1 - offset; i >= 0; ) {
    const trimmed = result[i].trimStart();
    if (trimmed.startsWith('@')) {
      const cleaned = removeTokenFromTagLine(result[i], pattern);
      if (cleaned === '' && pattern.test(result[i])) {
        result.splice(i, 1);
        // Adjust headerIdx for next iterations
        offset++;
        i--;
      } else {
        pattern.lastIndex = 0;
        result[i] = cleaned;
        i--;
      }
    } else if (trimmed.length > 0) {
      break;
    } else {
      i--;
    }
  }
  return result;
}

export function applyTagState(
  content: string,
  scenarioHeaderLine: number,
  state: TagState,
  today: string,
): string {
  const lines = content.split('\n');
  const headerIdx = scenarioHeaderLine - 1; // 1-based → 0-based

  if (state === 'add-suggestion') {
    const newTag = `@promotion-suggested-${today}`;
    const lastTagLineIdx = findTagBlockAbove(lines, headerIdx);

    if (lastTagLineIdx !== -1) {
      lines[lastTagLineIdx] = `${lines[lastTagLineIdx]} ${newTag}`;
    } else {
      const headerIndent = lines[headerIdx].match(/^(\s*)/)?.[1] ?? '';
      lines.splice(headerIdx, 0, `${headerIndent}${newTag}`);
    }

    return lines.join('\n');
  }

  if (state === 'remove-suggestion') {
    const pattern = /\s*@promotion-suggested-\d{4}-\d{2}-\d{2}\b/g;
    return applyRemoval(lines, headerIdx, pattern).join('\n');
  }

  if (state === 'strip-approval') {
    const pattern = /\s*@promotion\b(?!-suggested)/g;
    return applyRemoval(lines, headerIdx, pattern).join('\n');
  }

  throw new Error(`promotionTagWriter: unsupported state "${state as string}"`);
}
