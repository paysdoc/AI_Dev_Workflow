import { expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

// Shared by the adw_init prompt tests, which read the prompt as lines.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');
export const ADW_INIT_PATH = path.join(REPO_ROOT, '.claude/commands/adw_init.md');
export const SCENARIO_RUN_CONTRACT_SECTION = '## Scenario Run Contract';

const CODE_FENCE = '```';

export function readLines(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf-8').split('\n');
}

/** The lines of step 3, which writes `.adw/project.md`: from its heading up to the heading of step 4. */
export function projectMdStep(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => /^3\. \*\*/.test(line));
  const end = lines.findIndex((line) => /^4\. \*\*/.test(line));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end);
}

/** The lines of step `n`: from its heading up to the heading of the next step, or the end of the prompt. */
export function stepLines(lines: readonly string[], n: number): string[] {
  const start = lines.findIndex((line) => line.startsWith(`${n}. **`));
  const end = lines.findIndex((line) => line.startsWith(`${n + 1}. **`));
  expect(start).toBeGreaterThanOrEqual(0);
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The values of the `hashInputs:` list in the prompt's frontmatter. */
export function hashInputs(lines: readonly string[]): string[] {
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  const frontmatter = lines.slice(1, closing);
  const key = frontmatter.findIndex((line) => line.startsWith('hashInputs:'));
  expect(key).toBeGreaterThanOrEqual(0);
  const items: string[] = [];
  for (const line of frontmatter.slice(key + 1)) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (!item) break;
    items.push(item[1].trim());
  }
  return items;
}

/**
 * The lines between the code fences that follow the first line holding `marker`, without the indentation of the
 * opening fence: the text a bullet of the prompt tells the agent to write verbatim.
 */
export function fencedBlockAfter(lines: readonly string[], marker: string): string[] {
  const markerAt = lines.findIndex((line) => line.includes(marker));
  expect(markerAt, `a line holds "${marker}"`).toBeGreaterThanOrEqual(0);
  const openAt = lines.findIndex((line, index) => index > markerAt && line.trim().startsWith(CODE_FENCE));
  expect(openAt, `a code fence opens after "${marker}"`).toBeGreaterThan(markerAt);
  const closeAt = lines.findIndex((line, index) => index > openAt && line.trim().startsWith(CODE_FENCE));
  expect(closeAt, `the code fence after "${marker}" closes`).toBeGreaterThan(openAt);

  const indentation = lines[openAt].length - lines[openAt].trimStart().length;
  return lines.slice(openAt + 1, closeAt).map((line) => line.slice(Math.min(indentation, line.length - line.trimStart().length)));
}
