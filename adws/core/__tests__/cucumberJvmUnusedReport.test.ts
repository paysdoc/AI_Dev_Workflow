// Re-capture the reports from the repository root with cucumber-jvm 8.0.4, run offline from the host's Gradle cache. The dry
// run and the plugin are passed as system properties, as the Gradle dry run passes them to cucumber:
//   F=adws/core/__tests__/fixtures/cucumberJvmUnused; G=~/.gradle/caches/modules-2/files-2.1
//   CP=$(find $G/io.cucumber $G/org.apiguardian $G/org.jspecify $G/org.picocontainer -name '*.jar' | tr '\n' ':'); T=$(mktemp -d)
//   javac -cp "$CP" -d "$T" $(find "$F/java" -name '*.java')
//   java -Dcucumber.execution.dry-run=true -Dcucumber.plugin="unused:$F/unused.txt" -cp "$T:$CP" io.cucumber.core.cli.Main --glue fixture.steps --monochrome "$F/features"
//   java -Dcucumber.execution.dry-run=true -Dcucumber.plugin="unused:$F/all-used.txt" -cp "$T:$CP" io.cucumber.core.cli.Main --glue fixture.steps --monochrome "$F/features" "$F/everyStepUsed"
//   rm -rf "$T"
// org.picocontainer is on the classpath because the cache holds cucumber-picocontainer, whose object factory cucumber loads.
// The Kotlin step definitions are not compiled: they declare the classes and methods of the Java ones, which cucumber-jvm
// names the same way.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { locateJvmStepDefinition, parseCucumberJvmUnusedReport, type CucumberJvmUnusedRow } from '../cucumberJvmUnusedReport';
import { readStepDefinitionSources } from '../stepDefinitionSources';
import { REPORT_PATH_PLACEHOLDER, resolveStepUsageReader, type StepDefinitionSource, type StepUsageReader, type UnusedStepDefinition } from '../unusedStepReport';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = 'adws/core/__tests__/fixtures/cucumberJvmUnused';
const REAL_REPORT = readFileSync(join(REPO_ROOT, FIXTURE, 'unused.txt'), 'utf-8');
const ALL_USED_REPORT = readFileSync(join(REPO_ROOT, FIXTURE, 'all-used.txt'), 'utf-8');
const KOTLIN_ORDERS = `${FIXTURE}/kotlin/fixture/steps/OrderSteps.kt`;
const KOTLIN_INVOICES = `${FIXTURE}/kotlin/fixture/steps/InvoiceSteps.kt`;
const JAVA_ORDERS = `${FIXTURE}/java/fixture/steps/OrderSteps.java`;
const JAVA_INVOICES = `${FIXTURE}/java/fixture/steps/InvoiceSteps.java`;
const ORDER_IS_REJECTED = 'fixture.steps.OrderSteps.theOrderIsRejected()';
const KOTLIN_EXTENSIONS = ['.kt', '.java'];

function sourcesUnder(directory: string): readonly StepDefinitionSource[] {
  return readStepDefinitionSources(REPO_ROOT, [`${FIXTURE}/${directory}`], KOTLIN_EXTENSIONS);
}

function fixtureText(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf-8');
}

function cucumberJvm(): StepUsageReader {
  const lookup = resolveStepUsageReader('cucumber-jvm');
  if (lookup.kind !== 'supported') throw new Error('expected the cucumber-jvm reader');
  return lookup.reader;
}

function unusedOf(report: string, sources: readonly StepDefinitionSource[]): readonly UnusedStepDefinition[] {
  const read = cucumberJvm().read(report, sources);
  if (read.kind !== 'read_unused') throw new Error(read.kind === 'unreadable' ? read.detail : 'expected an unused-steps report');
  return read.unused;
}

function rowsOf(report: string): readonly CucumberJvmUnusedRow[] {
  const parsed = parseCucumberJvmUnusedReport(report);
  if (parsed.kind !== 'parsed') throw new Error(parsed.detail);
  return parsed.rows;
}

/** The real report, changed line by line: a report cucumber-jvm would write for a slightly different repository. */
function variantOf(change: (lines: string[]) => string[]): string {
  return change(REAL_REPORT.split('\n')).join('\n');
}

function unreadableDetail(report: string): string {
  const parsed = parseCucumberJvmUnusedReport(report);
  if (parsed.kind !== 'unreadable') throw new Error(`expected an unreadable report, read ${parsed.rows.length} row(s)`);
  return parsed.detail;
}

const source = (file: string, lines: readonly string[]): StepDefinitionSource => ({ file, text: lines.join('\n') });

describe('parseCucumberJvmUnusedReport', () => {
  it('reads the real report of a dry run in which every definition is used as no unused definition', () => {
    expect(parseCucumberJvmUnusedReport(ALL_USED_REPORT)).toEqual({ kind: 'parsed', rows: [] });
  });

  it('shows each pattern as the report prints it: a cucumber expression as written and a regular expression without slashes', () => {
    const withExpression = variantOf((lines) => [
      ...lines.map((line) => line.replace('3 unused', '4 unused')),
      'fixture.steps.OrderSteps.aCustomerOrders(int,java.lang.String) # a customer orders {int} {string}',
    ]);

    expect(rowsOf(REAL_REPORT).map((row) => row.pattern)).toEqual(['the order is rejected', '^the shop closes at (\\d+)$', 'a returning customer']);
    expect(rowsOf(withExpression).map((row) => row.pattern)).toContain('a customer orders {int} {string}');
  });

  it('reads a report that carries ANSI colour codes as the same report', () => {
    const coloured = variantOf((lines) => lines.map((line) => line.replace(/^(\d+ unused)/, '\u001b[1;33m$1\u001b[0m').replace(/# (.*)$/, '# \u001b[36m$1\u001b[0m')));

    expect(coloured).not.toEqual(REAL_REPORT);
    expect(rowsOf(coloured)).toEqual(rowsOf(REAL_REPORT));
  });

  it('reports text without the "<n> unused step definition(s)" line, with a row count that differs from n, or with a row without a "# " expression as unreadable, naming the line', () => {
    const withoutCount = variantOf((lines) => lines.filter((line) => !line.includes('unused step definition(s)')));
    const miscounted = variantOf((lines) => lines.map((line) => line.replace('3 unused', '4 unused')));
    const withoutExpression = variantOf((lines) => lines.map((line) => (line.includes('aReturningCustomer') ? line.replace(' # ', '   ') : line)));

    expect(unreadableDetail(withoutCount)).toMatch(/^line 3 .*"Location/);
    expect(unreadableDetail(miscounted)).toMatch(/^line 2 .*counts 4 .*but 3/);
    expect(unreadableDetail(withoutExpression)).toMatch(/^line 7 .*aReturningCustomer/);

    // cucumber-jvm writes its count line even when nothing is unused, so empty text cannot be its report.
    expect(ALL_USED_REPORT.trim()).toBe('0 unused step definition(s)');
    for (const empty of ['', '\n', '  \n\n']) expect(unreadableDetail(empty)).toContain('empty');
  });
});

describe('the cucumber-jvm reader', () => {
  it('reads every unused step definition of the real cucumber-jvm dry-run unused report, located by file and method line in the Kotlin step definitions', () => {
    expect(unusedOf(REAL_REPORT, sourcesUnder('kotlin'))).toEqual([
      { file: KOTLIN_INVOICES, line: 11, pattern: 'a returning customer' },
      { file: KOTLIN_ORDERS, line: 18, pattern: 'the order is rejected' },
      { file: KOTLIN_ORDERS, line: 21, pattern: '^the shop closes at (\\d+)$' },
    ]);
    expect(unusedOf(ALL_USED_REPORT, sourcesUnder('kotlin'))).toEqual([]);
  });

  it('leaves a definition unlocated, with file unknown and line 0, when no source declares its class (library glue), when two sources declare it, or when its class declares the method twice (an overload) or not at all', () => {
    const orders = source(KOTLIN_ORDERS, [fixtureText(KOTLIN_ORDERS)]);
    const invoices = source(KOTLIN_INVOICES, [fixtureText(KOTLIN_INVOICES)]);
    const duplicate = source('scenarios/src/test/kotlin/copy/OrderSteps.kt', [fixtureText(KOTLIN_ORDERS)]);
    const overloaded = source(KOTLIN_ORDERS, [fixtureText(KOTLIN_ORDERS).replace('fun theShopIsOpen() {}', 'fun theOrderIsRejected(reason: String) {}')]);
    const withoutMethod = source(KOTLIN_ORDERS, [fixtureText(KOTLIN_ORDERS).replace('fun theOrderIsRejected() {}', 'fun theOrderIsLost() {}')]);
    const libraryGlue = variantOf((lines) => [...lines.map((line) => line.replace('3 unused', '4 unused')), 'io.cucumber.library.CommonSteps.aStep() # a library step']);
    const rejected = (sources: readonly StepDefinitionSource[]) => unusedOf(REAL_REPORT, sources).find((definition) => definition.pattern === 'the order is rejected');

    expect(rejected([orders, invoices])).toEqual({ file: KOTLIN_ORDERS, line: 18, pattern: 'the order is rejected' });
    expect(unusedOf(libraryGlue, [orders, invoices])).toContainEqual({ file: 'unknown', line: 0, pattern: 'a library step' });
    for (const sources of [[invoices], [orders, duplicate, invoices], [overloaded, invoices], [withoutMethod, invoices]]) {
      expect(rejected(sources)).toEqual({ file: 'unknown', line: 0, pattern: 'the order is rejected' });
    }
  });

  it('returns the unused definitions sorted by file and then line, whatever order the report holds them in', () => {
    const reversed = variantOf((lines) => [...lines.slice(0, 4), ...lines.slice(4, 7).reverse(), ...lines.slice(7)]);

    expect(reversed).not.toEqual(REAL_REPORT);
    expect(unusedOf(reversed, sourcesUnder('kotlin'))).toEqual(unusedOf(REAL_REPORT, sourcesUnder('kotlin')));
  });
});

describe('locateJvmStepDefinition', () => {
  it('locates the same definitions in the Java step definitions the report was captured from', () => {
    const located = rowsOf(REAL_REPORT).map((row) => locateJvmStepDefinition(row.location, sourcesUnder('java')));

    expect(located).toEqual([
      { file: JAVA_ORDERS, line: 20 },
      { file: JAVA_ORDERS, line: 23 },
      { file: JAVA_INVOICES, line: 13 },
    ]);
  });

  it('locates a class by the package its source declares, wherever the file lies under the step-definition directory', () => {
    const moved = source('scenarios/src/test/kotlin/misc/AllTheSteps.kt', [fixtureText(KOTLIN_ORDERS)]);
    const otherPackage = source('scenarios/src/test/kotlin/fixture/steps/OrderSteps.kt', [fixtureText(KOTLIN_ORDERS).replace('package fixture.steps', 'package fixture.other')]);

    expect(locateJvmStepDefinition(ORDER_IS_REJECTED, [moved, otherPackage])).toEqual({ file: moved.file, line: 18 });
    expect(locateJvmStepDefinition(ORDER_IS_REJECTED, [otherPackage])).toBeNull();
  });

  it("leaves a definition whose location is not a method reference, such as a lambda's Steps.kt:12 or a URI, unlocated", () => {
    const sources = sourcesUnder('kotlin');
    const notMethods = [
      'fixture.steps.OrderSteps.<init>(OrderSteps.kt:12)',
      'fixture.steps.OrderSteps.lambda$new$0(OrderSteps.java:12)',
      'OrderSteps.kt:12',
      'classpath:fixture/steps/OrderSteps.kt',
      'file:///work/scenarios/src/test/kotlin/fixture/steps/OrderSteps.kt:18',
      '',
    ];

    expect(locateJvmStepDefinition(ORDER_IS_REJECTED, sources)).toEqual({ file: KOTLIN_ORDERS, line: 18 });
    for (const location of notMethods) expect(locateJvmStepDefinition(location, sources), location).toBeNull();
  });

  it('locates a nested class by its outer class and a Kotlin method declared with a backtick name', () => {
    const nested = source('scenarios/src/test/kotlin/fixture/steps/Outer.kt', [
      'package fixture.steps',
      '',
      'import io.cucumber.java.en.Given',
      '',
      'class Outer {',
      '    class Inner {',
      '        @Given("an order is cancelled")',
      '        fun `an order is cancelled`() {}',
      '    }',
      '}',
    ]);

    expect(locateJvmStepDefinition('fixture.steps.Outer$Inner.an order is cancelled()', [nested])).toEqual({ file: nested.file, line: 8 });
  });

  it('locates a class in the default package, which has no package declaration', () => {
    const lines = ['import io.cucumber.java.en.Given', '', 'class RootSteps {', '    @Given("the shop is open")', '    fun theShopIsOpen() {}', '}'];
    const rootSteps = source('scenarios/src/test/kotlin/RootSteps.kt', lines);
    const packaged = source('scenarios/src/test/kotlin/fixture/RootSteps.kt', ['package fixture', ...lines]);

    expect(locateJvmStepDefinition('RootSteps.theShopIsOpen()', [packaged, rootSteps])).toEqual({ file: rootSteps.file, line: 5 });
    expect(locateJvmStepDefinition('fixture.RootSteps.theShopIsOpen()', [packaged, rootSteps])).toEqual({ file: packaged.file, line: 6 });
  });
});

describe('the cucumber-jvm dry-run command', () => {
  const dryRun = (command: string): string | null => cucumberJvm().dryRunCommand(command);
  const DRY_RUN_PROPERTIES = `-Dcucumber.execution.dry-run=true -Dcucumber.plugin=unused:${REPORT_PATH_PLACEHOLDER}`;

  it("derives the cucumber-jvm dry run from ADW's mobile:kotlincm run-by-tag command: ./gradlew :scenarios:test --rerun -Dcucumber.execution.dry-run=true -Dcucumber.plugin=unused:{report}", () => {
    expect(dryRun('./gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@{tag}"')).toBe(
      './gradlew :scenarios:test --rerun -Dcucumber.execution.dry-run=true -Dcucumber.plugin=unused:{report}',
    );
  });

  it('replaces a -Dcucumber.filter.tags filter given in double quotes, single quotes or bare, with a tag expression around {tag}, and keeps the rest of the command', () => {
    const filters = [
      '-Dcucumber.filter.tags="@{tag}"',
      `-Dcucumber.filter.tags='@{tag}'`,
      '-Dcucumber.filter.tags=@{tag}',
      '-Dcucumber.filter.tags="@{tag} and not @wip"',
      `-Dcucumber.filter.tags='(@{tag} or @smoke) and not @wip'`,
    ];
    for (const filter of filters) expect(dryRun(`./gradlew :scenarios:test ${filter}`), filter).toBe(`./gradlew :scenarios:test ${DRY_RUN_PROPERTIES}`);
    expect(dryRun('cd app && ./gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}" --info --rerun')).toBe(`cd app && ./gradlew :scenarios:test ${DRY_RUN_PROPERTIES} --info --rerun`);
  });

  it('returns no cucumber-jvm command for an empty command, N/A, a filter without {tag}, a --tags option, or a command that already sets cucumber.plugin or cucumber.execution.dry-run', () => {
    const commands = [
      '',
      '   ',
      'N/A',
      'n/a',
      './gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@regression"',
      './gradlew :scenarios:test --tags "@{tag}"',
      'mvn test -Dcucumber.options="--tags @{tag}"',
      './gradlew :scenarios:test -Dcucumber.plugin=pretty -Dcucumber.filter.tags="@{tag}"',
      './gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}" "-Dcucumber.execution.dry-run=false"',
    ];
    for (const command of commands) expect(dryRun(command), command).toBeNull();
  });
});
