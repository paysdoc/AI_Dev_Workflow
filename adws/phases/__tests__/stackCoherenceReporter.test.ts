import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ADW_UNVERIFIED_LABEL } from '../../core/adwLabels';
import { ADW_PLAYWRIGHT_RUN_BY_TAG } from '../../core/adwPlaywrightProject';
import { APPLICATION_TYPE_PROFILES, type ApplicationProfile } from '../../core/applicationType';
import { getDefaultProjectConfig, type CommandsConfig, type ScenariosConfig } from '../../core/projectConfig';
import { reportStackCoherence } from '../stackCoherenceReporter';
import type { WorkflowConfig } from '../workflowInit';

const stateDirs: string[] = [];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of stateDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Reported {
  readonly config: WorkflowConfig;
  readonly applyLabel: ReturnType<typeof vi.fn>;
  readonly commentOnIssue: ReturnType<typeof vi.fn>;
}

function configFor(
  applicationProfile: ApplicationProfile,
  commands: Partial<CommandsConfig>,
  scenarios: Partial<ScenariosConfig>,
): Reported {
  const defaults = getDefaultProjectConfig();
  const applyLabel = vi.fn();
  const commentOnIssue = vi.fn();
  const orchestratorStatePath = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-stack-coherence-'));
  stateDirs.push(orchestratorStatePath);
  const config = {
    issueNumber: 992,
    adwId: 'stack-coherence-test',
    orchestratorStatePath,
    ctx: { issueNumber: 992, adwId: 'stack-coherence-test' },
    repoContext: { issueTracker: { applyLabel, commentOnIssue } },
    applicationProfile,
    projectConfig: {
      ...defaults,
      commands: { ...defaults.commands, ...commands },
      scenarios: { ...defaults.scenarios, ...scenarios },
    },
  } as unknown as WorkflowConfig;
  return { config, applyLabel, commentOnIssue };
}

// What adw_init writes for a Python web application: its own unit-test stack, and ADW's Node project for the scenarios.
const PYTHON_WEB_COMMANDS: Partial<CommandsConfig> = {
  testFramework: 'pytest',
  runTests: 'pytest --junitxml=$ADW_UNIT_TEST_REPORT_PATH',
  runScenariosByTag: ADW_PLAYWRIGHT_RUN_BY_TAG,
};
const PYTHON_WEB_SCENARIOS: Partial<ScenariosConfig> = { bddFramework: 'playwright-bdd', stepDefDirectory: 'features/steps' };

describe("reportStackCoherence — a web repository's scenario stack is ADW's own", () => {
  it("does not label a Python application as incoherent because ADW's Node project runs its scenarios", () => {
    const { config, applyLabel, commentOnIssue } = configFor(APPLICATION_TYPE_PROFILES.web, PYTHON_WEB_COMMANDS, PYTHON_WEB_SCENARIOS);

    reportStackCoherence(config);

    expect(applyLabel).not.toHaveBeenCalled();
    expect(commentOnIssue).not.toHaveBeenCalled();
    expect(config.ctx.coherenceWarnings).toBeUndefined();
  });

  it('does not read the descriptors for the scenario stack at all, so a stale cucumber-js descriptor is no warning either', () => {
    const { config, applyLabel } = configFor(
      APPLICATION_TYPE_PROFILES.web,
      { testFramework: 'pytest', runTests: 'pytest', runScenariosByTag: 'cucumber-js --tags "@{tag}"' },
      { bddFramework: 'cucumber-js' },
    );

    reportStackCoherence(config);

    expect(applyLabel).not.toHaveBeenCalled();
  });
});

describe("reportStackCoherence — a cli repository's descriptors are read as before", () => {
  it('labels the issue and posts a comment when the descriptors span several languages', () => {
    const { config, applyLabel, commentOnIssue } = configFor(APPLICATION_TYPE_PROFILES.cli, PYTHON_WEB_COMMANDS, PYTHON_WEB_SCENARIOS);

    reportStackCoherence(config);

    expect(applyLabel).toHaveBeenCalledWith(992, ADW_UNVERIFIED_LABEL);
    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    expect(config.ctx.coherenceWarnings?.join(' ')).toContain('multiple languages');
  });

  it('warns when the BDD framework is not a Gherkin runner', () => {
    const { config, applyLabel } = configFor(
      APPLICATION_TYPE_PROFILES.cli,
      { testFramework: 'vitest', runTests: 'bun run test', runScenariosByTag: 'bunx mocha' },
      { bddFramework: 'mocha' },
    );

    reportStackCoherence(config);

    expect(applyLabel).toHaveBeenCalledWith(992, ADW_UNVERIFIED_LABEL);
    expect(config.ctx.coherenceWarnings?.join(' ')).toContain("BDD framework 'mocha' is not a recognized Gherkin-based runner");
  });

  it('stays quiet for a coherent stack', () => {
    const { config, applyLabel, commentOnIssue } = configFor(
      APPLICATION_TYPE_PROFILES.cli,
      { testFramework: 'vitest', runTests: 'bun run test:unit', runScenariosByTag: 'bunx cucumber-js --tags "@{tag}"' },
      { bddFramework: 'cucumber-js' },
    );

    reportStackCoherence(config);

    expect(applyLabel).not.toHaveBeenCalled();
    expect(commentOnIssue).not.toHaveBeenCalled();
  });
});

describe('reportStackCoherence — a config without an application profile', () => {
  it('throws instead of assuming a type', () => {
    const { config } = configFor(APPLICATION_TYPE_PROFILES.cli, {}, {});
    delete config.applicationProfile;

    expect(() => reportStackCoherence(config)).toThrow(/requireApplicationProfile/);
  });
});
