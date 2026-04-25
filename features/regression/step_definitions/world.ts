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
import type { MockContext, RecordedRequest } from '../../../test/mocks/types.ts';

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

  /** Branch name set via G2 for assertion in T4 / T11. */
  targetBranch: string = '';

  /**
   * Env vars overlaid on process.env for subprocess invocations.
   * Populated by Given steps (G3, G9, G11) and consumed by When steps.
   */
  harnessEnv: Record<string, string> = {};

  constructor(options: IWorldOptions) {
    super(options);
  }

  /** Convenience: recorded requests from the mock GitHub API server. */
  getRecordedRequests(): RecordedRequest[] {
    return this.mockContext?.getRecordedRequests() ?? [];
  }
}

setWorldConstructor(RegressionWorld);
