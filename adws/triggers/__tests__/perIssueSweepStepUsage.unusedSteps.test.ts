import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolveScenarioDirectories } from '../../core/scenarioDirectories';
import { readStepDefinitionSources } from '../../core/stepDefinitionSources';
import type { UnusedStepIssueRef, UnusedStepIssueSpec } from '../../core/unusedStepIssueBody';
import { REPORT_PATH_PLACEHOLDER, resolveStepUsageReader, type StepUsageReader, type UnusedStepDefinition } from '../../core/unusedStepReport';
import { defaultReadStepUsage, reconcileUnusedStepDefinitions, runStepUsageReport, withoutUsedStepFiles, type StepUsageOutcome } from '../perIssueSweepStepUsage';

const CORE_FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../core/__tests__/fixtures');
const CUCUMBER_JS_USAGE_REPORT = path.join(CORE_FIXTURES, 'cucumberJsUsage/usage.json');
const JVM_UNUSED_REPORT = path.join(CORE_FIXTURES, 'cucumberJvmUnused/unused.txt');
const PLAYWRIGHT_UNUSED_OUTPUT = path.join(CORE_FIXTURES, 'playwrightBddUnused/export-unused.txt');
const KOTLIN_DIRECTORY = 'scenarios/src/test/kotlin';
const KOTLIN_ORDERS = `${KOTLIN_DIRECTORY}/fixture/steps/OrderSteps.kt`;
const KOTLIN_INVOICES = `${KOTLIN_DIRECTORY}/fixture/steps/InvoiceSteps.kt`;
const NO_INSTALL = { installDeps: 'N/A', runScenariosByTag: '' };
const LOCATED_KOTLIN_DEFINITIONS: readonly UnusedStepDefinition[] = [
  { file: KOTLIN_INVOICES, line: 11, pattern: 'a returning customer' },
  { file: KOTLIN_ORDERS, line: 18, pattern: 'the order is rejected' },
  { file: KOTLIN_ORDERS, line: 21, pattern: '^the shop closes at (\\d+)$' },
];

let worktree: string;

beforeEach(() => {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-unused-steps-test-'));
});

afterEach(() => {
  fs.rmSync(worktree, { recursive: true, force: true });
});

function readerOf(framework: string): StepUsageReader {
  const lookup = resolveStepUsageReader(framework);
  if (lookup.kind !== 'supported') throw new Error(`expected the ${framework} reader`);
  return lookup.reader;
}

/** The real reader of `framework`, with a dry run that copies a captured report to `{report}`. */
function readerCopying(framework: string, report: string): StepUsageReader {
  return { ...readerOf(framework), dryRunCommand: () => `cp '${report}' ${REPORT_PATH_PLACEHOLDER}` };
}

/** The Kotlin step definitions the captured cucumber-jvm report names, under the worktree's step-definition directory. */
function writeKotlinStepDefinitions(): void {
  const fixture = path.join(CORE_FIXTURES, 'cucumberJvmUnused/kotlin/fixture/steps');
  fs.mkdirSync(path.join(worktree, path.dirname(KOTLIN_ORDERS)), { recursive: true });
  fs.copyFileSync(path.join(fixture, 'OrderSteps.kt'), path.join(worktree, KOTLIN_ORDERS));
  fs.copyFileSync(path.join(fixture, 'InvoiceSteps.kt'), path.join(worktree, KOTLIN_INVOICES));
}

describe('runStepUsageReport with a reader of an unused-steps report', () => {
  it('runStepUsageReport hands an unused-steps reader the step-definition sources of the worktree for its extensions and returns the unused definitions it located', async () => {
    writeKotlinStepDefinitions();
    const readSources = vi.fn(readStepDefinitionSources);
    const directories = [KOTLIN_DIRECTORY, 'features/per-issue/step_definitions'];

    const outcome = await runStepUsageReport({ worktreePath: worktree, commands: NO_INSTALL, reader: readerCopying('cucumber-jvm', JVM_UNUSED_REPORT), stepDefinitionDirectories: directories, readSources });

    expect(readSources).toHaveBeenCalledWith(worktree, directories, ['.kt', '.java']);
    expect(outcome).toEqual({ kind: 'unused', framework: 'cucumber-jvm', unused: LOCATED_KOTLIN_DEFINITIONS });
  });

  it('runStepUsageReport reads no sources for a reader that asks for none', async () => {
    for (const [framework, report] of [['cucumber-js', CUCUMBER_JS_USAGE_REPORT], ['playwright-bdd', PLAYWRIGHT_UNUSED_OUTPUT]]) {
      const readSources = vi.fn(readStepDefinitionSources);

      await runStepUsageReport({ worktreePath: worktree, commands: NO_INSTALL, reader: readerCopying(framework, report), stepDefinitionDirectories: ['features/step_definitions'], readSources });

      expect(readSources, framework).not.toHaveBeenCalled();
    }
  });

  it('returns unavailable when an unused-steps report names a file that is not in the worktree, and accepts an unlocated definition', async () => {
    const missing = await runStepUsageReport({ worktreePath: worktree, commands: NO_INSTALL, reader: readerCopying('playwright-bdd', PLAYWRIGHT_UNUSED_OUTPUT) });
    const unlocated = await runStepUsageReport({ worktreePath: worktree, commands: NO_INSTALL, reader: readerCopying('cucumber-jvm', JVM_UNUSED_REPORT), stepDefinitionDirectories: [KOTLIN_DIRECTORY] });

    expect(missing).toEqual({ kind: 'unavailable', detail: expect.stringContaining("the usage report's paths are not relative to the repository root") });
    expect(missing.kind === 'unavailable' && missing.detail).toContain('features/steps/orders.steps.ts');
    expect(unlocated).toEqual({
      kind: 'unused',
      framework: 'cucumber-jvm',
      unused: ['the order is rejected', '^the shop closes at (\\d+)$', 'a returning customer'].map((pattern) => ({ file: 'unknown', line: 0, pattern })),
    });
  });

  it("names the dry run's exit code and the tail of its output when the report it wrote is unreadable and the dry run failed", async () => {
    const failedExport = `: > ${REPORT_PATH_PLACEHOLDER}; echo "Error: Cannot find module 'playwright-bdd'"; exit 4`;

    const outcome = await runStepUsageReport({ worktreePath: worktree, commands: NO_INSTALL, reader: { ...readerOf('playwright-bdd'), dryRunCommand: () => failedExport } });

    expect(outcome.kind).toBe('unavailable');
    const detail = outcome.kind === 'unavailable' ? outcome.detail : '';
    expect(detail).toContain('the bddgen export output is empty');
    expect(detail).toContain(`(the dry run \`${failedExport}\` exited 4)`);
    expect(detail).toContain("Error: Cannot find module 'playwright-bdd'");
  });
});

describe('an unused-steps report in the sweep', () => {
  const directories = resolveScenarioDirectories({ stepDefDirectory: KOTLIN_DIRECTORY });
  const unusedSteps = (...unused: UnusedStepDefinition[]): Extract<StepUsageOutcome, { kind: 'unused' }> => ({ kind: 'unused', framework: 'cucumber-jvm', unused });

  it('withoutUsedStepFiles keeps the step files outside the per-issue directory for an unused-steps report, which cannot tell which feature files use them', () => {
    const staleFeature = 'features/per-issue/feature-70.feature';
    const inside = 'features/per-issue/step_definitions/feature-70.kt';
    const outside = `${KOTLIN_DIRECTORY}/steps/feature-70.kt`;
    const usage = unusedSteps({ file: outside, line: 4, pattern: 'issue 70 has started' });

    expect(withoutUsedStepFiles([staleFeature, inside, outside], [staleFeature], usage, directories, vi.fn())).toEqual([staleFeature, inside]);
  });

  it("reconcileUnusedStepDefinitions files the chore for an unused-steps report's definitions in the step-definition directories, less those in files that landed and unlocated ones, naming the framework", () => {
    const fileRemovalIssue = vi.fn((_spec: UnusedStepIssueSpec): number => 77);
    const deps = { log: vi.fn(), fileRemovalIssue, listOpenRemovalIssues: (): UnusedStepIssueRef[] => [], defaultBranch: 'main' };
    const landedStepFile = `${KOTLIN_DIRECTORY}/steps/feature-70.kt`;
    const usage = unusedSteps(
      { file: `${KOTLIN_DIRECTORY}/steps/OrderSteps.kt`, line: 18, pattern: 'the order is rejected' },
      { file: landedStepFile, line: 4, pattern: 'issue 70 has started' },
      { file: 'unknown', line: 0, pattern: 'a library step' },
      { file: 'app/src/test/kotlin/AppSteps.kt', line: 7, pattern: 'an app step' },
    );

    reconcileUnusedStepDefinitions(usage, ['features/per-issue/feature-70.feature', landedStepFile], directories, deps);

    expect(fileRemovalIssue).toHaveBeenCalledTimes(1);
    const { body } = fileRemovalIssue.mock.calls[0][0];
    expect(body).toContain(`\`${KOTLIN_DIRECTORY}/steps/OrderSteps.kt:18\` — \`the order is rejected\``);
    expect(body).toContain('cucumber-jvm dry run on `main`');
    for (const left of ['issue 70 has started', 'a library step', 'an app step']) expect(body).not.toContain(left);
  });
});

describe('the default step usage', () => {
  it('the default step usage of a cucumber-jvm worktree runs the derived Gradle dry run and locates the reported definitions in its Kotlin step definitions', async () => {
    fs.mkdirSync(path.join(worktree, '.adw'));
    fs.writeFileSync(path.join(worktree, '.adw/scenarios.md'), `# Scenarios\n\n## BDD Framework\ncucumber-jvm\n\n## Step Def Directory\n${KOTLIN_DIRECTORY}\n`);
    fs.writeFileSync(
      path.join(worktree, '.adw/commands.md'),
      '# Commands\n\n## Install Dependencies\nN/A\n\n## Run Scenarios by Tag\n./gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@{tag}"\n',
    );
    const gradlew = [
      '#!/bin/sh',
      'case " $* " in *" -Dcucumber.execution.dry-run=true "*) ;; *) echo "not a dry run: $*" >&2; exit 1 ;; esac',
      'for arg in "$@"; do',
      `  case "$arg" in -Dcucumber.plugin=unused:*) cp '${JVM_UNUSED_REPORT}' "\${arg#-Dcucumber.plugin=unused:}" ;; esac`,
      'done',
    ];
    fs.writeFileSync(path.join(worktree, 'gradlew'), `${gradlew.join('\n')}\n`, { mode: 0o755 });
    writeKotlinStepDefinitions();

    const outcome = await defaultReadStepUsage(() => ({ worktreePath: worktree }), vi.fn())();

    expect(outcome).toEqual({ kind: 'unused', framework: 'cucumber-jvm', unused: LOCATED_KOTLIN_DEFINITIONS });
  });
});
