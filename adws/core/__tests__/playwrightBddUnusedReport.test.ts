// Re-capture the output from the repository root with playwright-bdd 9.2.1, installed from npm into a scratch project laid out
// the way ADW installs its Playwright project. The export runs no test, so no browser is installed:
//   F=adws/core/__tests__/fixtures/playwrightBddUnused
//   capture() { T=$(mktemp -d); mkdir -p "$T/features/steps"; cp templates/playwright/playwright.config.ts.template "$T/features/playwright.config.ts"; cp templates/playwright/package.json.template "$T/features/package.json"; cp "$F"/features/*.feature "$@" "$T/features/"; for s in "$F"/steps/*.ts.template; do cp "$s" "$T/features/steps/$(basename "$s" .template)"; done; (cd "$T/features" && npm install --no-audit --no-fund >/dev/null 2>&1 && npx bddgen export --unused-steps); rm -rf "$T"; }
//   capture > "$F/export-unused.txt"; capture "$F/everyStepUsed/every-step.feature" > "$F/export-all-used.txt"
// The step files carry a .template suffix so that ADW's own type check and linter, which have no playwright-bdd, skip them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ADW_PLAYWRIGHT_INSTALL_COMMAND, ADW_PLAYWRIGHT_RUN_BY_TAG } from '../adwPlaywrightProject';
import { parsePlaywrightBddUnusedReport } from '../playwrightBddUnusedReport';
import { resolveStepUsageReader, type StepUsageReader, type UnusedStepDefinition } from '../unusedStepReport';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/playwrightBddUnused');
const REAL_OUTPUT = readFileSync(join(FIXTURE, 'export-unused.txt'), 'utf-8');
const ALL_USED_OUTPUT = readFileSync(join(FIXTURE, 'export-all-used.txt'), 'utf-8');

function playwrightBdd(): StepUsageReader {
  const lookup = resolveStepUsageReader('playwright-bdd');
  if (lookup.kind !== 'supported') throw new Error('expected the playwright-bdd reader');
  return lookup.reader;
}

function rowsOf(output: string): readonly UnusedStepDefinition[] {
  const parsed = parsePlaywrightBddUnusedReport(output);
  if (parsed.kind !== 'parsed') throw new Error(parsed.detail);
  return parsed.rows;
}

/** The real output, changed line by line: what the export would print for a slightly different project. */
function variantOf(change: (lines: string[]) => string[]): string {
  return change(REAL_OUTPUT.split('\n')).join('\n');
}

function unreadableDetail(output: string): string {
  const parsed = parsePlaywrightBddUnusedReport(output);
  if (parsed.kind !== 'unreadable') throw new Error(`expected unreadable output, read ${parsed.rows.length} row(s)`);
  return parsed.detail;
}

describe('the playwright-bdd reader', () => {
  it('reads every unused step definition of the real bddgen export --unused-steps output, with its file under features/ and its line', () => {
    expect(playwrightBdd().read(REAL_OUTPUT)).toEqual({
      kind: 'read_unused',
      unused: [
        { file: 'features/steps/invoices.steps.ts', line: 6, pattern: 'a returning customer' },
        { file: 'features/steps/orders.steps.ts', line: 8, pattern: 'the order is rejected' },
        { file: 'features/steps/orders.steps.ts', line: 9, pattern: '^the shop closes at (\\d+)$' },
      ],
    });
    expect(playwrightBdd().read(ALL_USED_OUTPUT)).toEqual({ kind: 'read_unused', unused: [] });
  });
});

describe('parsePlaywrightBddUnusedReport', () => {
  it('keeps each pattern without the Given, When or Then keyword the export prints before it, and a regular expression as printed', () => {
    const withWhen = variantOf((lines) => lines.map((line) => line.replace('Then the order is rejected', 'When the order is rejected')));

    expect(REAL_OUTPUT).toContain('│ Given a returning customer ');
    expect(rowsOf(REAL_OUTPUT)).toEqual([
      { file: 'steps/invoices.steps.ts', line: 6, pattern: 'a returning customer' },
      { file: 'steps/orders.steps.ts', line: 8, pattern: 'the order is rejected' },
      { file: 'steps/orders.steps.ts', line: 9, pattern: '^the shop closes at (\\d+)$' },
    ]);
    expect(rowsOf(withWhen).map((row) => row.pattern)).toContain('the order is rejected');
  });

  it('reads the real output of a project whose steps are all used as no unused definition', () => {
    expect(parsePlaywrightBddUnusedReport(ALL_USED_OUTPUT)).toEqual({ kind: 'parsed', rows: [] });
  });

  it('ignores the "Using config:" line and the table\'s column-header row', () => {
    const [usingConfig] = REAL_OUTPUT.split('\n');
    const withoutConfigLine = variantOf((lines) => lines.slice(1));
    const moreBeforeCount = variantOf((lines) => ['Warning: a feature file has no scenarios', ...lines]);

    expect(usingConfig).toBe('Using config: playwright.config.ts');
    expect(REAL_OUTPUT).toMatch(/│ Pattern \/ Text +│ Location +│/);
    expect(rowsOf(withoutConfigLine)).toEqual(rowsOf(REAL_OUTPUT));
    expect(rowsOf(moreBeforeCount)).toEqual(rowsOf(REAL_OUTPUT));
    expect(rowsOf(REAL_OUTPUT).map((row) => row.pattern)).not.toContain('Pattern / Text');
  });

  it('reports output without the "Unused steps (<n>):" line, an empty file included, with a row count that differs from n, or with a row whose location has no line, as unreadable, naming the line', () => {
    const withoutCount = variantOf((lines) => lines.filter((line) => !line.startsWith('Unused steps')));
    const miscounted = variantOf((lines) => lines.map((line) => line.replace('Unused steps (3):', 'Unused steps (4):')));
    const withoutLine = variantOf((lines) => lines.map((line) => line.replace('steps/orders.steps.ts:8', 'steps/orders.steps.ts  ')));

    expect(unreadableDetail(withoutCount)).toMatch(/"Unused steps \(<n>\):".*line 1 .*Using config/);
    expect(unreadableDetail('')).toContain('empty');
    expect(unreadableDetail(miscounted)).toMatch(/^line 2 .*counts 4 .*lists 3/);
    expect(unreadableDetail(withoutLine)).toMatch(/^line 8 .*steps\/orders\.steps\.ts/);
  });
});

describe('the playwright-bdd dry-run command', () => {
  const dryRun = (command: string): string | null => playwrightBdd().dryRunCommand(command);
  const UNUSED_STEPS = 'cd features && (test -d node_modules || npm ci) && npx bddgen export --unused-steps > {report}';

  it("derives the playwright-bdd dry run from ADW's Playwright run-by-tag command: cd features && (test -d node_modules || npm ci) && npx bddgen export --unused-steps > {report}", () => {
    expect(dryRun(ADW_PLAYWRIGHT_RUN_BY_TAG)).toBe(UNUSED_STEPS);
    expect(dryRun(` ${ADW_PLAYWRIGHT_RUN_BY_TAG}\n`)).toBe(UNUSED_STEPS);
  });

  it("returns no playwright-bdd command for a run-by-tag command that is not ADW's Playwright project, or that has no {tag}", () => {
    const commands = [
      '',
      'N/A',
      'npx playwright test --grep "@{tag}"',
      'cd e2e && (test -d node_modules || npm ci) && npx bddgen && npx playwright test --grep "@{tag}\\b"',
      `${ADW_PLAYWRIGHT_INSTALL_COMMAND} && npx cucumber-js --tags "@{tag}"`,
      ADW_PLAYWRIGHT_RUN_BY_TAG.replace('{tag}', 'regression'),
    ];
    for (const command of commands) expect(dryRun(command), command).toBeNull();
  });
});
