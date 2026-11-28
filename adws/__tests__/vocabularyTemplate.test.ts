import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownSections } from '../core/markdownSections';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(__dirname, '../../templates/vocabulary.md.template');
const IN_PROCESS_PATTERNS = [
  'Three Permitted Execution Patterns',
  'Function/module import',
  'Mock query',
  'Phase import',
  'phase-import',
  'mock-query',
  'import a phase function directly',
  'without running a subprocess',
];
const FORBIDDEN_SHAPES = ['File shape', 'File content via substring match', 'Structural source-file assertions'];
const PHRASE_ROW = /^\|\s*\w+\s*\|\s*`[^`]+`\s*\|/;

const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
const sections = parseMarkdownSections(template);

/** The rows of the table under the `## <keyword> …` heading that hold a phrase as a code span. */
function phraseRowsUnder(keyword: string): string[] {
  const heading = Object.keys(sections).find((key) => key.startsWith(`${keyword.toLowerCase()} `));
  return (heading === undefined ? '' : sections[heading]).split('\n').filter((line) => PHRASE_ROW.test(line));
}

describe('templates/vocabulary.md.template', () => {
  it('keeps the rot-detection rubric with its three forbidden shapes', () => {
    const rubric = sections['rot-detection rubric'];

    expect(rubric, 'a ## Rot-Detection Rubric section').toBeDefined();
    for (const shape of FORBIDDEN_SHAPES) expect(rubric).toContain(shape);
  });

  it('keeps the observability-surfaces placeholder that adw_init replaces', () => {
    expect(sections['observability surfaces (examples)']).toContain('<!-- TODO (slice #3, issue ??):');
  });

  it('describes execution at a Real Boundary, pointing at the list in .adw/scenarios.md', () => {
    const execution = sections['execution at a real boundary'];

    expect(execution, 'a ## Execution at a Real Boundary section').toBeDefined();
    for (const phrase of ['Real Boundaries', '`## Real Boundaries`', '`.adw/scenarios.md`', 'inside the test process', 'unit tests']) {
      expect(execution).toContain(phrase);
    }
  });

  it.each(IN_PROCESS_PATTERNS)('lists no in-process execution pattern: no "%s"', (pattern) => {
    expect(template).not.toContain(pattern);
  });

  it('keeps Given, When and Then tables of seed phrases', () => {
    for (const keyword of ['Given', 'When', 'Then']) {
      expect(phraseRowsUnder(keyword), `a ## ${keyword} heading followed by a table with a phrase row`).not.toEqual([]);
    }
  });
});
