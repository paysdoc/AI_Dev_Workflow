import { setWorldConstructor, World, IWorldOptions } from '@cucumber/cucumber';
import type { MockContext, RecordedRequest, FixtureRepoContext } from '../../../test/mocks/types.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';
import type { DepauditSetupResult } from '../../../adws/phases/depauditSetup.ts';

export interface GitInvocation {
  subcommand: string;
  args: string[];
  branch?: string;
}

export interface GitGhGuardResult {
  exitCode: number;
  output: string;
}

/** What W-S1 records: how the phase run ended. A `process.exit` the run made is `exitCode`, not `error`. */
export interface PhaseOutcome {
  adwId: string;
  orchestrator: string;
  phase: string;
  resolved: boolean;
  error?: unknown;
  exitCode?: number;
}

/** What W-S2 records: whether the workflow ran under the lifecycle, and who held the spawn lock while it did. */
export interface LifecycleOutcome {
  adwId: string;
  orchestrator: string;
  issueNumber: number;
  /** What `runWithOrchestratorLifecycle` returned; absent when it threw or exited. */
  returned?: boolean;
  ran: boolean;
  lockHolderPid: number | null;
  error?: unknown;
  exitCode?: number;
}

/** A command the dependency-audit setup asked to run, and where. W-S3 runs none of them. */
export interface RecordedExec {
  readonly command: string;
  readonly cwd: string;
}

/** What W-S3 records: the commands the setup asked to run, and what it returned or threw. */
export interface DepauditOutcome {
  adwId: string;
  execCalls: readonly RecordedExec[];
  result?: DepauditSetupResult;
  error?: unknown;
}

export type CleanupEntry = () => void | Promise<void>;

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

  gitGhGuardResult?: GitGhGuardResult;

  phaseOutcome?: PhaseOutcome;

  lifecycleOutcome?: LifecycleOutcome;

  depauditOutcome?: DepauditOutcome;

  /** Run last in, first out by the @regression After hook, each entry guarded, before the mock infrastructure is torn down. */
  cleanup: CleanupEntry[] = [];

  constructor(options: IWorldOptions) {
    super(options);
  }

  getRecordedRequests(): RecordedRequest[] {
    return this.mockContext?.getRecordedRequests() ?? [];
  }
}

setWorldConstructor(RegressionWorld);
