import { describe, it, expect } from 'vitest';
import { resolveScenarioRunner, type ScenarioRunnerConfig } from '../scenarioRunner';
import { RunnerMode } from '../applicationType';
import {
  ADW_PLAYWRIGHT_INSTALL_COMMAND,
  ADW_PLAYWRIGHT_RUN_BY_TAG,
  ADW_PLAYWRIGHT_STEP_DEF_DIR,
} from '../adwPlaywrightProject';
import { getDefaultCommandsConfig, getDefaultScenariosConfig } from '../projectConfig';

function configWith(commands: Partial<ScenarioRunnerConfig['commands']>, scenarios: Partial<ScenarioRunnerConfig['scenarios']>): ScenarioRunnerConfig {
  return {
    commands: { ...getDefaultCommandsConfig(), ...commands },
    scenarios: { ...getDefaultScenariosConfig(), ...scenarios },
  };
}

const CUCUMBER = configWith(
  { runScenariosByTag: 'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"' },
  { bddFramework: 'cucumber-js', stepDefDirectory: 'features/step_definitions' },
);
const BEHAVE = configWith({ runScenariosByTag: 'behave --tags @{tag}', testFramework: 'pytest' }, { bddFramework: 'behave', stepDefDirectory: 'features/steps' });
const EMPTY_FRAMEWORK = configWith({ runScenariosByTag: 'N/A' }, { bddFramework: '', stepDefDirectory: 'e2e/steps' });

/** The value Playwright builds its RegExp from, as the shell hands it over: the quoted argument of `--grep`. */
function grepValueFor(tag: string): string {
  const command = ADW_PLAYWRIGHT_RUN_BY_TAG.replace(/\{tag\}/g, tag);
  const match = command.match(/--grep "([^"]*)"/);
  if (!match) throw new Error(`no --grep value in: ${command}`);
  return match[1];
}

function grepSelects(tag: string, title: string): boolean {
  return new RegExp(grepValueFor(tag), 'gi').test(title);
}

describe('resolveScenarioRunner — descriptor mode', () => {
  it("returns today's values from .adw/commands.md and .adw/scenarios.md", () => {
    const runner = resolveScenarioRunner(RunnerMode.Descriptor, CUCUMBER);

    expect(runner.runByTagCommand).toBe('NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"');
    expect(runner.stepDefDirectory).toBe('features/step_definitions');
    expect(runner.stepDefExtensions).toEqual(['.ts', '.js']);
    expect(runner.proofDirPerTag).toBe(false);
    expect(runner.installCommand).toBeNull();
    expect(runner.stackSignals).toEqual({ bddFramework: 'cucumber-js', runScenariosByTag: 'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"' });
  });

  it('takes the step definition extensions from the framework: behave gives .py', () => {
    const runner = resolveScenarioRunner(RunnerMode.Descriptor, BEHAVE);

    expect(runner.stepDefExtensions).toEqual(['.py']);
    expect(runner.stepDefDirectory).toBe('features/steps');
    expect(runner.runByTagCommand).toBe('behave --tags @{tag}');
  });

  it('defaults an empty framework to .ts, as stepDefExtensionsFor does', () => {
    const runner = resolveScenarioRunner(RunnerMode.Descriptor, EMPTY_FRAMEWORK);

    expect(runner.stepDefExtensions).toEqual(['.ts']);
  });

  it('passes an N/A command through, which only a descriptor runner can say', () => {
    expect(resolveScenarioRunner(RunnerMode.Descriptor, EMPTY_FRAMEWORK).runByTagCommand).toBe('N/A');
  });
});

describe('resolveScenarioRunner — adw_playwright mode', () => {
  it("returns the Playwright project's constants", () => {
    const runner = resolveScenarioRunner(RunnerMode.AdwPlaywright, CUCUMBER);

    expect(runner.runByTagCommand).toBe(ADW_PLAYWRIGHT_RUN_BY_TAG);
    expect(runner.stepDefDirectory).toBe(ADW_PLAYWRIGHT_STEP_DEF_DIR);
    expect(runner.stepDefExtensions).toEqual(['.ts']);
    expect(runner.installCommand).toBe(ADW_PLAYWRIGHT_INSTALL_COMMAND);
  });

  it('gives each tag its own proof directory, since Playwright empties its output directory at the start of a run', () => {
    expect(resolveScenarioRunner(RunnerMode.AdwPlaywright, CUCUMBER).proofDirPerTag).toBe(true);
  });

  it("says nothing about the repository's stack, so a Python application is not read as two languages", () => {
    expect(resolveScenarioRunner(RunnerMode.AdwPlaywright, BEHAVE).stackSignals).toEqual({ bddFramework: '', runScenariosByTag: '' });
  });

  it('ignores the descriptors: two different configs give the same runner', () => {
    expect(resolveScenarioRunner(RunnerMode.AdwPlaywright, CUCUMBER)).toEqual(resolveScenarioRunner(RunnerMode.AdwPlaywright, BEHAVE));
    expect(resolveScenarioRunner(RunnerMode.AdwPlaywright, EMPTY_FRAMEWORK)).toEqual(resolveScenarioRunner(RunnerMode.AdwPlaywright, CUCUMBER));
  });
});

describe('one runner per mode', () => {
  it.each(Object.values(RunnerMode))('%s resolves to a runner with a command and a step definition directory', (mode) => {
    const runner = resolveScenarioRunner(mode, CUCUMBER);

    expect(runner.runByTagCommand.length).toBeGreaterThan(0);
    expect(runner.stepDefDirectory.length).toBeGreaterThan(0);
    expect(runner.stepDefExtensions.length).toBeGreaterThan(0);
  });
});

describe('the tag the adw_playwright command selects', () => {
  it('substitutes the issue tag into a --grep value in double quotes', () => {
    expect(ADW_PLAYWRIGHT_RUN_BY_TAG.replace('{tag}', 'adw-99')).toContain('--grep "@adw-99\\b"');
  });

  it.each([
    ['the tag alone', 'The home page shows its title @adw-99'],
    ['the tag among others', 'The home page shows its title @adw-99 @adw-abc123-slug'],
    ['the tag first', '@adw-99 The home page shows its title'],
  ])('selects %s for @adw-99', (_name, title) => {
    expect(grepSelects('adw-99', title)).toBe(true);
  });

  it('does not select the scenarios of issue 992 for the tag of issue 99', () => {
    expect(grepSelects('adw-99', 'The home page shows its title @adw-992')).toBe(false);
    expect(grepSelects('adw-99', 'The home page shows its title @adw-992 @adw-abc123-slug')).toBe(false);
  });

  it('does not select @regressionx for @regression', () => {
    expect(grepSelects('regression', 'Some scenario @regressionx')).toBe(false);
    expect(grepSelects('regression', 'Some scenario @regression')).toBe(true);
  });
});
