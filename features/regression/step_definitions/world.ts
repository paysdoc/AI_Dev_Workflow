import { setWorldConstructor, World, IWorldOptions } from '@cucumber/cucumber';
import type { MockContext, RecordedRequest, FixtureRepoContext } from '../../../test/mocks/types.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';

export interface GitInvocation {
  subcommand: string;
  args: string[];
  branch?: string;
}

export class RegressionWorld extends World {
  /** Set in the @regression Before hook. */
  mockContext: MockContext | null = null;

  lastExitCode: number = -1;

  /** adwId → temp worktree directory path. */
  worktreePaths: Map<string, string> = new Map();

  /** Lets phase-import When steps resolve a branch to its PR without the gh CLI, which the GitHub API mock cannot serve (no PR-list route). */
  prsByBranch: Map<string, number> = new Map();

  targetBranch: string = '';

  /** Env vars overlaid on process.env for subprocess invocations. */
  harnessEnv: Record<string, string> = {};

  pythonFixture?: FixtureRepoContext;

  scenarioProofResult?: ScenarioProofResult;

  proofDir?: string;

  capturedProofComment?: string;

  constructor(options: IWorldOptions) {
    super(options);
  }

  getRecordedRequests(): RecordedRequest[] {
    return this.mockContext?.getRecordedRequests() ?? [];
  }
}

setWorldConstructor(RegressionWorld);
