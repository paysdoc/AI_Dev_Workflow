// Re-capture the fixture from the repository root: NODE_OPTIONS="--import tsx" bunx cucumber-js --config adws/core/__tests__/fixtures/cucumberJsUsage/cucumber.json --dry-run --format usage-json:adws/core/__tests__/fixtures/cucumberJsUsage/usage.json
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  REPORT_PATH_PLACEHOLDER,
  resolveStepUsageReader,
  stepFilesStillUsed,
  unusedStepDefinitions,
  type StepDefinitionUsage,
  type StepUsageReader,
} from '../unusedStepReport';

const REAL_REPORT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/cucumberJsUsage/usage.json'), 'utf-8');

const ROOT = 'adws/core/__tests__/fixtures/cucumberJsUsage';
const ORDERS_STEPS = `${ROOT}/step_definitions/orders.steps.ts`;
const INVOICES_STEPS = `${ROOT}/step_definitions/invoices.steps.ts`;
const LEGACY_STEPS = `${ROOT}/step_definitions/legacy.steps.ts`;
const ORDERS_FEATURE = `${ROOT}/features/orders.feature`;
const INVOICES_FEATURE = `${ROOT}/features/invoices.feature`;
const APPLES_STEP_LINE = 7;

interface RawMatch {
  line: number;
  text: string;
  uri: string;
}

interface RawEntry {
  matches: RawMatch[];
  code: string;
  line: number;
  pattern: string;
  patternType: string;
  uri: string;
}

function rawEntries(): RawEntry[] {
  return JSON.parse(REAL_REPORT) as RawEntry[];
}

function cucumberJs(): StepUsageReader {
  const lookup = resolveStepUsageReader('cucumber-js');
  if (lookup.kind !== 'supported') throw new Error('expected the cucumber-js reader');
  return lookup.reader;
}

function usagesOf(report: string): readonly StepDefinitionUsage[] {
  const read = cucumberJs().read(report);
  if (read.kind !== 'read') throw new Error(read.detail);
  return read.usages;
}

const realUsages = (): readonly StepDefinitionUsage[] => usagesOf(REAL_REPORT);

/** The real report, changed: a report cucumber would write for a slightly different repository. */
function variantOf(change: (entries: RawEntry[]) => unknown[]): readonly StepDefinitionUsage[] {
  return usagesOf(JSON.stringify(change(rawEntries())));
}

function withSharedPattern(pattern: string): (entries: RawEntry[]) => RawEntry[] {
  return (entries) => {
    const original = entries.find((entry) => entry.pattern === pattern);
    if (!original) throw new Error(`the real report has no definition "${pattern}"`);
    return [...entries, { ...original, uri: LEGACY_STEPS, line: 2 }];
  };
}

describe('reading a cucumber-js usage report', () => {
  it('reads every step definition of the real cucumber-js dry-run usage report with its file, line, pattern and the feature files that use it', () => {
    expect(realUsages()).toEqual([
      { file: INVOICES_STEPS, line: 3, pattern: 'the invoice is sent', usedBy: [INVOICES_FEATURE] },
      { file: INVOICES_STEPS, line: 4, pattern: 'a returning customer', usedBy: [] },
      { file: ORDERS_STEPS, line: 3, pattern: 'the shop is open', usedBy: [INVOICES_FEATURE, ORDERS_FEATURE] },
      { file: ORDERS_STEPS, line: 4, pattern: 'a customer orders {int} {string}', usedBy: [ORDERS_FEATURE] },
      { file: ORDERS_STEPS, line: 5, pattern: 'the order is accepted', usedBy: [ORDERS_FEATURE] },
      { file: ORDERS_STEPS, line: 6, pattern: 'the order is rejected', usedBy: [] },
      { file: ORDERS_STEPS, line: 7, pattern: '/^the shop closes at (\\d+)$/', usedBy: [] },
    ]);
  });

  it("lists the definitions that no feature file uses, with file and line: a cucumber expression, a regular expression and a whole file's only definition", () => {
    expect(unusedStepDefinitions(realUsages())).toEqual([
      { file: INVOICES_STEPS, line: 4, pattern: 'a returning customer' },
      { file: ORDERS_STEPS, line: 6, pattern: 'the order is rejected' },
      { file: ORDERS_STEPS, line: 7, pattern: '/^the shop closes at (\\d+)$/' },
    ]);
  });

  it('shows a regular-expression pattern between slashes and a cucumber expression as written', () => {
    const patterns = realUsages().map((usage) => usage.pattern);
    expect(rawEntries().find((entry) => entry.patternType === 'RegularExpression')?.pattern).toBe('^the shop closes at (\\d+)$');
    expect(patterns).toContain('/^the shop closes at (\\d+)$/');
    expect(patterns).toContain('a customer orders {int} {string}');
  });

  it('counts a definition used only by a Background step or a Scenario Outline row as used', () => {
    const orderLines = rawEntries().flatMap((entry) => entry.matches).filter((match) => match.uri === ORDERS_FEATURE).map((match) => match.line);
    expect(orderLines).toEqual(expect.arrayContaining([4, 11]));

    const outlineRowsOnly = variantOf((entries) =>
      entries.map((entry) => ({ ...entry, matches: entry.matches.filter((match) => !(match.uri === ORDERS_FEATURE && match.line === APPLES_STEP_LINE)) })),
    );
    const unusedPatterns = unusedStepDefinitions(outlineRowsOnly, [INVOICES_FEATURE]).map((definition) => definition.pattern);

    expect(unusedPatterns).not.toContain('the shop is open');
    expect(unusedPatterns).not.toContain('a customer orders {int} {string}');
  });

  it('lists a definition as unused once every feature file that uses it is removed, and keeps one that a remaining feature file still uses', () => {
    const unused = unusedStepDefinitions(realUsages(), [INVOICES_FEATURE]);

    expect(unused).toContainEqual({ file: INVOICES_STEPS, line: 3, pattern: 'the invoice is sent' });
    expect(unused.map((definition) => definition.pattern)).not.toContain('the shop is open');
    expect(unusedStepDefinitions(realUsages(), [INVOICES_FEATURE, ORDERS_FEATURE])).toHaveLength(7);
  });

  it('never lists a definition whose file is itself removed', () => {
    const unused = unusedStepDefinitions(realUsages(), [INVOICES_STEPS, INVOICES_FEATURE]);

    expect(unused.map((definition) => definition.file)).not.toContain(INVOICES_STEPS);
    expect(unused).toEqual([
      { file: ORDERS_STEPS, line: 6, pattern: 'the order is rejected' },
      { file: ORDERS_STEPS, line: 7, pattern: '/^the shop closes at (\\d+)$/' },
    ]);
  });

  it('never lists two definitions that share a pattern, because cucumber counts a step that matches both toward neither', () => {
    const usages = variantOf(withSharedPattern('the order is rejected'));

    expect(unusedStepDefinitions(usages).map((definition) => definition.pattern)).not.toContain('the order is rejected');
    expect(unusedStepDefinitions(usages)).toHaveLength(2);
  });

  it('returns the unused definitions sorted by file and then line, whatever order the report holds them in', () => {
    const reversed = variantOf((entries) => [...entries].reverse());

    expect(unusedStepDefinitions(reversed)).toEqual(unusedStepDefinitions(realUsages()));
    expect(reversed).toEqual(realUsages());
  });

  it('lists nothing for an empty report (a repository with no step definitions)', () => {
    expect(usagesOf('[]')).toEqual([]);
    expect(unusedStepDefinitions(usagesOf('[]'), [ORDERS_FEATURE])).toEqual([]);
  });

  it('finds the candidate step files that a remaining feature file still uses, and none once every feature file that uses them is removed', () => {
    const candidates = [ORDERS_STEPS, INVOICES_STEPS];

    expect(stepFilesStillUsed(realUsages(), candidates, [])).toEqual(candidates);
    expect(stepFilesStillUsed(realUsages(), candidates, [INVOICES_FEATURE])).toEqual([ORDERS_STEPS]);
    expect(stepFilesStillUsed(realUsages(), candidates, [INVOICES_FEATURE, ORDERS_FEATURE])).toEqual([]);
  });

  it('treats a candidate step file holding a shared pattern as still used', () => {
    const usages = variantOf(withSharedPattern('a returning customer'));

    expect(stepFilesStillUsed(usages, [LEGACY_STEPS, INVOICES_STEPS], [INVOICES_FEATURE, ORDERS_FEATURE])).toEqual([LEGACY_STEPS, INVOICES_STEPS]);
  });

  it("normalises Windows separators and a leading ./ in a definition's file and in the feature files that use it", () => {
    const windows = (uri: string): string => `.\\${uri.replace(/\//g, '\\')}`;
    const usages = variantOf((entries) =>
      entries.map((entry) => ({ ...entry, uri: windows(entry.uri), matches: entry.matches.map((match) => ({ ...match, uri: `./${match.uri}` })) })),
    );

    expect(usages).toEqual(realUsages());
  });

  it('reports text that is not JSON, JSON that is not an array, or an entry without uri, line, pattern, patternType or matches as unreadable, naming the entry', () => {
    expect(cucumberJs().read('not json')).toEqual({ kind: 'unreadable', detail: expect.stringContaining('not JSON') });
    expect(cucumberJs().read('{"matches": []}')).toEqual({ kind: 'unreadable', detail: expect.stringContaining('not a JSON array') });

    const faults: readonly (readonly [string, (entry: Record<string, unknown>) => void])[] = [
      ['uri', (entry) => delete entry.uri],
      ['line', (entry) => delete entry.line],
      ['line', (entry) => (entry.line = -1)],
      ['line', (entry) => (entry.line = 1.5)],
      ['pattern', (entry) => delete entry.pattern],
      ['patternType', (entry) => delete entry.patternType],
      ['matches', (entry) => delete entry.matches],
      ['uri', (entry) => (entry.matches = [{ line: 4, text: 'the shop is open' }])],
    ];
    for (const [named, breakEntry] of faults) {
      const entries = JSON.parse(REAL_REPORT) as Record<string, unknown>[];
      breakEntry(entries[2]);

      const read = cucumberJs().read(JSON.stringify(entries));
      expect(read.kind, named).toBe('unreadable');
      expect(read.kind === 'unreadable' && read.detail, named).toMatch(new RegExp(`entry 2\\b.*"${named}"`));
    }
  });
});

describe('resolveStepUsageReader', () => {
  it('resolveStepUsageReader finds the cucumber-js reader for "cucumber-js" in any case and with surrounding space', () => {
    for (const framework of ['cucumber-js', 'Cucumber-JS', '  cucumber-js \n']) {
      const lookup = resolveStepUsageReader(framework);
      expect(lookup.kind, framework).toBe('supported');
      expect(lookup.kind === 'supported' && lookup.reader.framework).toBe('cucumber-js');
    }
  });

  it('resolveStepUsageReader yields not supported for cucumber-jvm, playwright-bdd, behave, an empty framework and an unknown name, naming the framework', () => {
    for (const framework of ['cucumber-jvm', 'playwright-bdd', 'behave', '', 'constructor', 'gherkin-wizard']) {
      expect(resolveStepUsageReader(framework)).toEqual({ kind: 'not_supported', framework });
    }
  });
});

describe('the cucumber-js dry-run command', () => {
  const dryRun = (command: string): string | null => cucumberJs().dryRunCommand(command);
  const USAGE = `--dry-run --format usage-json:${REPORT_PATH_PLACEHOLDER}`;

  it(`derives ADW's own dry-run command: NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format usage-json:{report}`, () => {
    expect(REPORT_PATH_PLACEHOLDER).toBe('{report}');
    expect(dryRun('NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"')).toBe('NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format usage-json:{report}');
  });

  it('replaces a --tags or -t filter given in double quotes, single quotes, unquoted or with =, and a tag expression around {tag}', () => {
    const filters = [
      `--tags "@{tag}"`,
      `--tags '@{tag}'`,
      '--tags @{tag}',
      '--tags=@{tag}',
      '--tags="@{tag}"',
      `-t '@{tag}'`,
      '-t @{tag}',
      '--tags "@{tag} and not @wip"',
      `--tags '(@{tag} or @smoke) and not @wip'`,
    ];
    for (const filter of filters) expect(dryRun(`cucumber-js ${filter}`), filter).toBe(`cucumber-js ${USAGE}`);
  });

  it('keeps the rest of the command: a cd prefix, an npm run -- separator and other flags', () => {
    expect(dryRun('cd e2e && npx cucumber-js --tags "@{tag}" --format progress')).toBe(`cd e2e && npx cucumber-js ${USAGE} --format progress`);
    expect(dryRun('npm run test:e2e -- --tags "@{tag}"')).toBe(`npm run test:e2e -- ${USAGE}`);
    expect(dryRun('npx cucumber-js --profile ci -t=@{tag} --parallel 2')).toBe(`npx cucumber-js --profile ci ${USAGE} --parallel 2`);
  });

  it('returns no command for an empty command, N/A, or a command without a {tag} filter', () => {
    for (const command of ['', '   ', 'N/A', 'n/a', 'cucumber-js --tags "@regression"', 'npx playwright test --grep "{tag}"', 'cucumber-js features/{tag}.feature', 'cucumber-js --format-tags @{tag}']) {
      expect(dryRun(command), command).toBeNull();
    }
  });
});
