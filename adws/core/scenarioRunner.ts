import { RunnerMode } from './applicationType';
import {
  ADW_PLAYWRIGHT_INSTALL_COMMAND,
  ADW_PLAYWRIGHT_RUN_BY_TAG,
  ADW_PLAYWRIGHT_STEP_DEF_DIR,
} from './adwPlaywrightProject';
import type { ProjectConfig } from './projectConfig';
import type { StackCoherenceInput } from './stackCoherenceCheck';
import { stepDefExtensionsFor } from './stepDefDetection';

export interface ScenarioRunner {
  /** `{tag}` placeholder; run from the worktree root. */
  readonly runByTagCommand: string;
  /** Relative to the worktree. */
  readonly stepDefDirectory: string;
  readonly stepDefExtensions: readonly string[];
  readonly proofDirPerTag: boolean;
  /** Prepares a fresh worktree for the run; null when the repository's own install covers it. */
  readonly installCommand: string | null;
  readonly stackSignals: Pick<StackCoherenceInput, 'bddFramework' | 'runScenariosByTag'>;
}

export type ScenarioRunnerConfig = Pick<ProjectConfig, 'commands' | 'scenarios'>;

function descriptorRunner({ commands, scenarios }: ScenarioRunnerConfig): ScenarioRunner {
  return {
    runByTagCommand: commands.runScenariosByTag,
    stepDefDirectory: scenarios.stepDefDirectory,
    stepDefExtensions: stepDefExtensionsFor(scenarios.bddFramework),
    proofDirPerTag: false,
    installCommand: null,
    stackSignals: { bddFramework: scenarios.bddFramework, runScenariosByTag: commands.runScenariosByTag },
  };
}

function adwPlaywrightRunner(): ScenarioRunner {
  return {
    runByTagCommand: ADW_PLAYWRIGHT_RUN_BY_TAG,
    stepDefDirectory: ADW_PLAYWRIGHT_STEP_DEF_DIR,
    stepDefExtensions: ['.ts'],
    // Playwright empties its output directory at the start of each run, so tags sharing one would delete each other's images.
    proofDirPerTag: true,
    installCommand: ADW_PLAYWRIGHT_INSTALL_COMMAND,
    // ADW's Node project is the same in every web repository and says nothing about the repository's own stack.
    stackSignals: { bddFramework: '', runScenariosByTag: '' },
  };
}

// A switch rather than a table keyed by RunnerMode: the core barrel reaches this module while applicationType.ts is still
// loading, so a key read at load time would find RunnerMode undefined. A new mode still fails to compile until it has a case.
export function resolveScenarioRunner(runnerMode: RunnerMode, config: ScenarioRunnerConfig): ScenarioRunner {
  switch (runnerMode) {
    case RunnerMode.Descriptor:
      return descriptorRunner(config);
    case RunnerMode.AdwPlaywright:
      return adwPlaywrightRunner();
  }
}
