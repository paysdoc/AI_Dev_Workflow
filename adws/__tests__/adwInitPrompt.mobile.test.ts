import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { APPLICATION_TYPE_PROFILES, Platform } from '../core/applicationType';
import { runShellCommand } from '../core/checkRunner';
import { parseMarkdownSections } from '../core/markdownSections';
import { inferStackLanguages, stackCoherenceCheck } from '../core/stackCoherenceCheck';
import { isGherkinFramework, stepDefExtensionsFor } from '../core/stepDefDetection';
import { parseJUnitXml, readJUnitReport } from '../core/testReportParser';
import { ADW_INIT_PATH, SCENARIO_RUN_CONTRACT_SECTION, fencedBlockAfter, projectMdStep, readLines, stepLines } from './adwInitPrompt.helpers';

/**
 * `adw_init.md` writes the descriptors of a type that only a repository's owner sets, and a prompt cannot import the code that
 * reads them. These tests compare what the prompt writes with that code.
 */
const MOBILE = 'mobile:kotlincm';
const GRADLE_RUN_TESTS = `./gradlew test -x :scenarios:test --continue; exit_code=$?; { echo '<testsuites>'; find . -path ./scenarios -prune -o -path '*/build/test-results/*' -name 'TEST-*.xml' -exec sed 's/<?xml[^?]*?>//' {} +; echo '</testsuites>'; } > "$ADW_UNIT_TEST_REPORT_PATH"; exit $exit_code`;
const GRADLE_RUN_BUILD =
  "if [ -e gradlew ] || [ -e settings.gradle.kts ] || [ -e settings.gradle ]; then ./gradlew build -x test; else echo 'No Gradle build yet: nothing to build'; fi";
const GRADLE_RUN_BY_TAG = './gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@{tag}"';
const GRADLE_RUN_REGRESSION = GRADLE_RUN_BY_TAG.replace('{tag}', 'regression');
const BDD_FRAMEWORK = 'cucumber-jvm';
const STEP_DEF_DIRECTORY = 'scenarios/src/test/kotlin';
/** Each device-source section of `.adw/project.md` and the start of the default it gets when absent. */
const DEVICE_SOURCES = [
  ['## Android System Image', 'system-images;'],
  ['## Android Device Profile', ''],
  ['## iOS Device Type', 'com.apple.CoreSimulator.SimDeviceType.'],
  ['## iOS Runtime', 'com.apple.CoreSimulator.SimRuntime.'],
] as const;

describe('adw_init.md writes the commands of a mobile:kotlincm repository, whatever the manifests show and also when there are none', () => {
  const step2 = (): string[] => stepLines(readLines(ADW_INIT_PATH), 2);
  const step2Line = (...texts: string[]): string | undefined => step2().find((line) => texts.every((text) => line.includes(text)));

  it('is a type the mapping knows, and one whose scenarios run on devices', () => {
    expect(Object.keys(APPLICATION_TYPE_PROFILES)).toContain(MOBILE);
    expect(APPLICATION_TYPE_PROFILES[MOBILE].platforms.length).toBeGreaterThan(0);
  });

  it('writes a Gradle unit-test command that leaves out the scenarios and gathers every module report into the one file ADW reads', () => {
    expect(GRADLE_RUN_TESTS).toContain('"$ADW_UNIT_TEST_REPORT_PATH"');
    expect(GRADLE_RUN_TESTS).toContain('-x :scenarios:test');

    const line = step2Line(GRADLE_RUN_TESTS);
    expect(line, 'step 2, "## Run Tests": the Gradle unit-test command, as it stands').toBeDefined();
    expect(line).toContain(`\`${MOBILE}\``);
    expect(line).toContain('no manifest');
  });

  it('replaces an N/A that an earlier run wrote while the repository had no manifest, and still preserves any other command', () => {
    const step = step2().join('\n');

    expect(step, 'step 2, "## Run Tests": a section that holds only N/A counts as absent').toMatch(/no command but `N\/A`/);
    expect(step).toContain('preserve it verbatim');
  });

  it('writes a Gradle build command', () => {
    const line = step2Line(GRADLE_RUN_BUILD);

    expect(line, 'step 2, "## Run Build": the Gradle build command, as it stands').toBeDefined();
    expect(line).toContain(`\`${MOBILE}\``);
  });

  it('keys the dev server on the type step 3 writes, and gives mobile:kotlincm none', () => {
    expect(step2().join('\n')).toContain('the application type step 3 writes');

    const line = step2Line('→ `N/A`', '`cli`');
    expect(line, 'step 2, "## Start Dev Server": the bullet that gives N/A to cli').toBeDefined();
    expect(line).toContain(`\`${MOBILE}\``);
  });

  it('names the :scenarios module as the scenario tool of mobile:kotlincm in the note about the scenario commands', () => {
    const note = step2Line('`## Run Scenarios by Tag`', 'consistent with the scenario tool');

    expect(note, 'step 2: the note that ties the scenario commands to step 8').toBeDefined();
    expect(note).toContain('`:scenarios`');
    expect(note).toContain(`\`${MOBILE}\``);
  });
});

describe('the Gradle commands adw_init.md writes, run in the root of a checkout with a stand-in for the wrapper', () => {
  let workDir = '';

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-gradle-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const stubWrapper = (script: string): void => {
    fs.writeFileSync(path.join(workDir, 'gradlew'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  };

  describe('the unit-test command, as the test agent runs it', () => {
    const reportPath = (): string => path.join(workDir, 'junit-unit.xml');

    /** Gradle's report of one class: an XML declaration, then the suite. */
    const writeResult = (module: string, cases: readonly string[]): void => {
      const directory = path.join(workDir, module, 'build/test-results/test');
      fs.mkdirSync(directory, { recursive: true });
      const body = cases.map((name) => `  <testcase name="${name}" classname="${module}.Test" time="0.01"/>`).join('\n');
      fs.writeFileSync(path.join(directory, `TEST-${module}.Test.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${module}.Test" tests="${cases.length}">\n${body}\n</testsuite>\n`);
    };

    const runUnitTests = (): Promise<{ exitCode: number | null; output: string }> =>
      runShellCommand(`export ADW_UNIT_TEST_REPORT_PATH='${reportPath()}'; ${GRADLE_RUN_TESTS}`, workDir);

    it('gathers the report of every module but :scenarios into the one file ADW reads', async () => {
      stubWrapper('exit 0');
      writeResult('app', ['starts', 'stops']);
      writeResult('lib', ['parses']);
      writeResult('scenarios', ['runs a scenario']);

      const outcome = await runUnitTests();

      expect(outcome.exitCode).toBe(0);
      expect(readJUnitReport(reportPath())?.cases.map(({ name }) => name).sort()).toEqual(['parses', 'starts', 'stops']);
    });

    it('exits with the code of Gradle, after the reports of the modules that ran are gathered', async () => {
      stubWrapper('exit 3');
      writeResult('app', ['starts']);

      const outcome = await runUnitTests();

      expect(outcome.exitCode).toBe(3);
      expect(readJUnitReport(reportPath())?.total).toBe(1);
    });

    it('leaves ADW with no report to read when no test ran, so that the verdict is unverified and not a failure of zero cases', async () => {
      stubWrapper('exit 0');

      const outcome = await runUnitTests();

      expect(outcome.exitCode).toBe(0);
      expect(fs.existsSync(reportPath())).toBe(true);
      expect(readJUnitReport(reportPath())).toBeNull();
    });
  });

  describe('the build command, as the baseline runs it in a checkout of the base branch', () => {
    it('passes while the repository has no Gradle build yet, so that the baseline of the issue that bootstraps it is green', async () => {
      const outcome = await runShellCommand(GRADLE_RUN_BUILD, workDir);

      expect(outcome.exitCode).toBe(0);
      expect(outcome.output).toContain('No Gradle build yet');
    });

    it.each(['settings.gradle.kts', 'settings.gradle'])('fails once the repository has %s but no wrapper, so that a deleted wrapper is no vacuous pass', async (settings) => {
      fs.writeFileSync(path.join(workDir, settings), '');

      const outcome = await runShellCommand(GRADLE_RUN_BUILD, workDir);

      expect(outcome.exitCode).not.toBe(0);
    });

    it('runs the wrapper with build and without the test tasks once the repository has one', async () => {
      stubWrapper('printf "%s" "$*" > .gradle-arguments');

      const outcome = await runShellCommand(GRADLE_RUN_BUILD, workDir);

      expect(outcome.exitCode).toBe(0);
      expect(fs.readFileSync(path.join(workDir, '.gradle-arguments'), 'utf-8')).toBe('build -x test');
    });
  });
});

describe('adw_init.md writes the scenario descriptors of a mobile:kotlincm repository, whatever scenario tooling it has', () => {
  const step8 = (): string[] => stepLines(readLines(ADW_INIT_PATH), 8);
  const contract = (): string[] => fencedBlockAfter(step8(), `\`${SCENARIO_RUN_CONTRACT_SECTION}\` →`);

  it('writes cucumber-jvm, the Kotlin step definition directory, the Gradle commands of the :scenarios module and the contract', () => {
    const step = step8().join('\n');

    expect(step, 'step 8, "## BDD Framework"').toContain(`\`${BDD_FRAMEWORK}\``);
    expect(step, 'step 8, "## Step Def Directory"').toContain(`\`${STEP_DEF_DIRECTORY}\``);
    expect(step, 'step 8, "## Run Scenarios by Tag"').toContain(GRADLE_RUN_BY_TAG);
    expect(step, 'step 8, "## Run Regression Scenarios"').toContain(GRADLE_RUN_REGRESSION);
    expect(step, `step 8, "${SCENARIO_RUN_CONTRACT_SECTION}"`).toContain(`\`${SCENARIO_RUN_CONTRACT_SECTION}\``);
  });

  it('puts the branch after the web branch and before the Cypress and Cucumber branches, which apply otherwise', () => {
    const step = step8().join('\n');
    const branch = `**\`${MOBILE}\`**`;

    expect(step.indexOf('`web`')).toBeGreaterThan(-1);
    expect(step.indexOf('`web`')).toBeLessThan(step.indexOf(branch));
    expect(step.indexOf(branch)).toBeGreaterThan(-1);
    expect(step.indexOf(branch)).toBeLessThan(step.indexOf('**Cypress**'));
    expect(step.indexOf('**Cypress**')).toBeLessThan(step.indexOf('**Cucumber**'));
  });

  it('names a BDD framework that the Gherkin registry counts, and whose step definitions are Kotlin files', () => {
    expect(isGherkinFramework(BDD_FRAMEWORK)).toBe(true);
    expect(stepDefExtensionsFor(BDD_FRAMEWORK)).toContain('.kt');
  });

  it('reads as one JVM stack with the Gradle unit-test command, and warns about nothing', () => {
    const stack = { testFramework: '', bddFramework: BDD_FRAMEWORK, runTests: GRADLE_RUN_TESTS, runScenariosByTag: GRADLE_RUN_BY_TAG };

    expect(stackCoherenceCheck(stack)).toEqual({ ok: true, warnings: [] });
    expect([...inferStackLanguages(stack)]).toEqual(['jvm']);
  });

  describe('the scenario run contract', () => {
    it('names the variables ADW passes the run', () => {
      const text = contract().join('\n');

      for (const variable of ['ADW_JUNIT_REPORT_PATH', 'ADW_PROOF_DIR', 'ADW_ANDROID_AVD', 'ADW_ANDROID_SERIAL', 'ADW_IOS_UDID']) {
        expect(text, `the contract names ${variable}`).toContain(`\`${variable}\``);
      }
    });

    it('says how the report names a screenshot and a scenario, so that ADW attributes an image to its scenario', () => {
      const text = contract().join('\n');

      expect(text).toContain('[[ATTACHMENT|<path>]]');
      expect(text).toContain('relative to the directory that holds the report');
      expect(text).toContain('identical title');
    });

    it('says what the :scenarios module is handed and runs', () => {
      const text = contract().join('\n');

      for (const name of ['cucumber.filter.tags', 'features/', STEP_DEF_DIRECTORY]) expect(text, `the contract names ${name}`).toContain(`\`${name}\``);
    });

    it.each(Object.values(Platform))('names the %s/ directory under ADW_PROOF_DIR, where ADW reads the platform of an image', (platform) => {
      expect(contract().join('\n')).toContain(`\`${platform}/\``);
    });

    it('documents an attachment line that the JUnit parser reads, relative to the report', () => {
      const line = /\[\[ATTACHMENT\|<path>\]\]/.exec(contract().join('\n'))?.[0];
      expect(line, 'the contract documents the attachment line').toBeDefined();

      const report = parseJUnitXml(`<testsuite><testcase name="t"><system-out>${line?.replace('<path>', 'android/screen.png')}</system-out></testcase></testsuite>`);

      expect(report?.cases[0].attachments).toEqual(['android/screen.png']);
    });

    it('reads as one section of .adw/scenarios.md, so that the sections around it keep their values', () => {
      expect(Object.keys(parseMarkdownSections(`${SCENARIO_RUN_CONTRACT_SECTION}\n${contract().join('\n')}`))).toEqual(['scenario run contract']);
    });
  });
});

describe('adw_init.md writes the device sources of a mobile:kotlincm repository to .adw/project.md', () => {
  const step3 = (): string[] => projectMdStep(readLines(ADW_INIT_PATH));

  it.each(DEVICE_SOURCES)('gives %s a default when the section is absent', (heading, prefix) => {
    const line = step3().find((candidate) => candidate.includes(`\`${heading}\` →`));
    expect(line, `step 3, "${heading}": a bullet gives the default`).toBeDefined();

    const value = /→ `([^`]+)`/.exec(line ?? '')?.[1];
    expect(value, `step 3, "${heading}": the default is a code span after the arrow`).toBeDefined();
    expect(value?.startsWith(prefix), `step 3, "${heading}": the default starts with "${prefix}"`).toBe(true);
  });

  it('keeps the value an owner set, and writes the sections for no other type', () => {
    const step = step3().join('\n');

    expect(step, 'step 3: a value the section already holds is kept').toContain('preserve the value verbatim');
    expect(step, 'step 3: any other type gets none of the sections').toContain('leave them out');
    expect(step, 'step 3: the sections follow the type step 3 writes').toContain(`when the \`## Application Type\` this step writes is \`${MOBILE}\``);
  });

  it('lists .adw/scenarios.md under Relevant Files for the planner, which reads the contract there', () => {
    const lines = step3();
    const relevantFiles = lines.findIndex((line) => line.trimStart().startsWith('- `## Relevant Files`'));
    const nextSection = lines.findIndex((line, index) => index > relevantFiles && line.trimStart().startsWith('- `## '));
    const pointer = lines.findIndex((line) => line.includes('`.adw/scenarios.md`') && line.includes(`\`${SCENARIO_RUN_CONTRACT_SECTION}\``));

    expect(relevantFiles, 'step 3 writes "## Relevant Files"').toBeGreaterThanOrEqual(0);
    expect(pointer, 'step 3, "## Relevant Files": a line names .adw/scenarios.md and its contract').toBeGreaterThan(relevantFiles);
    expect(pointer).toBeLessThan(nextSection);
  });
});

describe('adw_init.md reports what it wrote for a mobile:kotlincm repository', () => {
  it('names the contract, each device source as a default or preserved, and what became of the unit-test command', () => {
    const step = stepLines(readLines(ADW_INIT_PATH), 11).join('\n');

    expect(step, 'step 11').toContain(`\`${MOBILE}\``);
    expect(step, 'step 11').toContain(`\`${SCENARIO_RUN_CONTRACT_SECTION}\``);
    for (const [heading] of DEVICE_SOURCES) expect(step, `step 11 reports ${heading}`).toContain(`\`${heading}\``);
    expect(step).toContain('`default`');
    expect(step).toContain('`preserved`');
  });
});
