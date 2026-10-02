import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { ADW_YML_TEMPLATE } from '../core/adwYmlConfig';

/**
 * `adw_init.md` is a prompt, so it cannot import the texts it must reproduce in a target
 * repository. These tests compare it with their sources so a drift fails here instead of
 * surfacing as a stale `.github/adw.yml` or guideline in every target.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const ADW_INIT_PATH = path.join(REPO_ROOT, '.claude/commands/adw_init.md');
const CODING_GUIDELINES_PATH = path.join(REPO_ROOT, '.adw/coding_guidelines.md');
const HEREDOC_OPENER = "cat > .github/adw.yml <<'EOF'";
const COMMENTS_ENTRY_PREFIX = '- **Comments** —';

function readLines(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf-8').split('\n');
}

function findCommentsEntry(lines: readonly string[]): string | undefined {
  return lines.map((line) => line.trim()).find((line) => line.startsWith(COMMENTS_ENTRY_PREFIX));
}

describe('adw_init.md reproduces the texts it cannot import', () => {
  it('writes a .github/adw.yml heredoc byte-identical to ADW_YML_TEMPLATE', () => {
    const lines = readLines(ADW_INIT_PATH);
    const opener = lines.findIndex((line) => line.endsWith(HEREDOC_OPENER));
    expect(opener).toBeGreaterThanOrEqual(0);
    const closer = lines.indexOf('EOF', opener + 1);
    expect(closer).toBeGreaterThan(opener);

    const heredoc = `${lines.slice(opener + 1, closer).join('\n')}\n`;

    expect(heredoc).toBe(ADW_YML_TEMPLATE);
  });

  it("carries the Comments entry of ADW's own coding guidelines", () => {
    const fromPrompt = findCommentsEntry(readLines(ADW_INIT_PATH));
    const fromGuidelines = findCommentsEntry(readLines(CODING_GUIDELINES_PATH));

    expect(fromPrompt).toBeDefined();
    expect(fromGuidelines).toBeDefined();
    expect(fromPrompt).toBe(fromGuidelines);
  });
});
