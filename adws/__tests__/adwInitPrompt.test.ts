import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { ADW_YML_TEMPLATE } from '../core/adwYmlConfig';
import { APPLICATION_TYPE_PROFILES } from '../core/applicationType';

/**
 * `adw_init.md` is a prompt, so it cannot import the texts it must reproduce in a target
 * repository, nor the application types ADW knows. These tests compare it with their sources
 * so a drift fails here instead of surfacing as a stale `.github/adw.yml` or guideline, or as
 * an application type the mapping would park, in every target.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const ADW_INIT_PATH = path.join(REPO_ROOT, '.claude/commands/adw_init.md');
const CODING_GUIDELINES_PATH = path.join(REPO_ROOT, '.adw/coding_guidelines.md');
const HEREDOC_OPENER = "cat > .github/adw.yml <<'EOF'";
const COMMENTS_ENTRY_PREFIX = '- **Comments** —';
const APPLICATION_TYPE_SECTION = '## Application Type';
const APPLICATION_TYPE_BULLET_PREFIX = `- \`${APPLICATION_TYPE_SECTION}\``;

function readLines(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf-8').split('\n');
}

/** The lines of step 3, which writes `.adw/project.md`: from its heading up to the heading of step 4. */
function projectMdStep(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => /^3\. \*\*/.test(line));
  const end = lines.findIndex((line) => /^4\. \*\*/.test(line));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end);
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

  it('offers exactly the application types the mapping knows', () => {
    const bullet = projectMdStep(readLines(ADW_INIT_PATH)).map((line) => line.trim()).find((line) => line.startsWith(APPLICATION_TYPE_BULLET_PREFIX));
    expect(bullet).toBeDefined();

    const offered = [...(bullet ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1]).filter((token) => token !== APPLICATION_TYPE_SECTION);

    expect([...offered].sort()).toEqual(Object.keys(APPLICATION_TYPE_PROFILES).sort());
  });

  it('says to leave the section out when detection cannot decide, so that no default is ever written', () => {
    expect(projectMdStep(readLines(ADW_INIT_PATH)).join('\n')).toContain('leave the section out');
  });

  it('says to preserve a type the owner set by hand, so that an upgrade does not drop it', () => {
    expect(projectMdStep(readLines(ADW_INIT_PATH)).join('\n')).toContain('preserve it verbatim');
  });
});
