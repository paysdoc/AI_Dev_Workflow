/**
 * Typed Cucumber World for regression step definitions.
 *
 * Extends the base test-harness MockContext with regression-specific handles:
 *   - recorded git-mock invocations (populated by the git wrapper shell script)
 *   - the last subprocess exit code
 *   - the adwId → worktree mapping for the current scenario
 *   - the harness environment overlay (env vars injected into subprocess calls)
 */

import { setWorldConstructor, World, IWorldOptions } from '@cucumber/cucumber';
import type { MockContext, RecordedRequest, FixtureRepoContext } from '../../../test/mocks/types.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';

export interface GitInvocation {
  subcommand: string;
  args: string[];
  branch?: string;
}

export class RegressionWorld extends World {
  /** MockContext returned by setupMockInfrastructure(). Set in Before hook. */
  mockContext: MockContext | null = null;

  /** Exit code of the last orchestrator subprocess (W1, W10, W11). */
  lastExitCode: number = -1;

  /** adwId → temp worktree directory path. */
  worktreePaths: Map<string, string> = new Map();

  /**
   * branch name → PR number, recorded by the PR-fixture Given steps (G21).
   * Lets phase-import When steps resolve a branch to its PR without the gh CLI,
   * which the GitHub API mock cannot serve (no PR-list route). Consumed by
   * feature-530's injected findPRByBranch.
   */
  prsByBranch: Map<string, number> = new Map();

  /** Branch name set via G2 for assertion in T4 / T11. */
  targetBranch: string = '';

  /**
   * Env vars overlaid on process.env for subprocess invocations.
   * Populated by Given steps (G3, G9, G11) and consumed by When steps.
   */
  harnessEnv: Record<string, string> = {};

  /** Isolated fixture repo for the Python e2e scenario (@python-e2e). */
  pythonFixture?: FixtureRepoContext;

  /** Result from runScenarioProof over the Python fixture. */
  scenarioProofResult?: ScenarioProofResult;

  /** Temp directory used as proofDir for the Python e2e proof run. */
  proofDir?: string;

  /** Body captured by the injectable commenter in publishPrProof. */
  capturedProofComment?: string;

  constructor(options: IWorldOptions) {
    super(options);
  }

  /** Convenience: recorded requests from the mock GitHub API server. */
  getRecordedRequests(): RecordedRequest[] {
    return this.mockContext?.getRecordedRequests() ?? [];
  }
}

setWorldConstructor(RegressionWorld);
