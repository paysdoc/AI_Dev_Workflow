import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CheckStatus, StaticCheckName, type CheckVerdict } from '../../core/checkRunner';
import type { TestResult } from '../../agents/testAgent';
import type { AgentResult } from '../../types/agentTypes';
import type { StaticCheckFixRoundDeps } from '../staticCheckFixRound';
import type { WorkflowConfig } from '../workflowInit';

const tempDirs: string[] = [];

export function removeTempDirs(): void {
  tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
}

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function failing(check: StaticCheckName, command: string, output: string, exitCode: number | null = 1): CheckVerdict {
  return { check, command, status: CheckStatus.Failed, exitCode, output };
}

export const LINT = failing(StaticCheckName.Lint, 'bun run lint', 'src/app.ts: 2 problems\n');
export const BUILD = failing(StaticCheckName.Build, 'bun run build', "error: Could not resolve './missing'\n", 2);

export function makeConfig(): WorkflowConfig {
  return {
    issueNumber: 989,
    adwId: 'static-check-fix-round-test',
    issue: { number: 989, title: 'Fix loop', body: 'issue body' },
    issueType: '/feature',
    worktreePath: '/worktrees/fix-round',
    branchName: 'feature-issue-989-fix-loop',
    logsDir: tempDir('adw-fix-round-logs-'),
    orchestratorStatePath: tempDir('adw-fix-round-state-'),
  } as unknown as WorkflowConfig;
}

export interface Harness {
  readonly deps: StaticCheckFixRoundDeps;
  readonly calls: string[];
  readonly agentInputs: TestResult[];
  readonly agentArguments: unknown[][];
}

export interface HarnessOptions {
  readonly heads?: readonly string[];
  readonly commitResult?: boolean;
  readonly diffs?: readonly string[];
  readonly agent?: () => Promise<AgentResult>;
  readonly failOn?: Readonly<Partial<Record<'pushBranch' | 'commitChanges' | 'diff' | 'fetchAndResetToRemote', Error>>>;
}

const AGENT_RESULT: AgentResult = {
  success: true,
  output: '',
  totalCostUsd: 0.5,
  modelUsage: { 'model-a': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 } },
};

export function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const agentInputs: TestResult[] = [];
  const agentArguments: unknown[][] = [];
  const heads = [...(options.heads ?? ['aaaaaaa'])];
  const diffs = [...(options.diffs ?? ['diff --git a/src/a.ts b/src/a.ts'])];
  const failIf = (name: keyof NonNullable<HarnessOptions['failOn']>): void => {
    const failure = options.failOn?.[name];
    if (failure) throw failure;
  };

  const deps: StaticCheckFixRoundDeps = {
    git: {
      headShort: (cwd) => {
        calls.push(`headShort ${String(cwd)}`);
        return heads.length > 1 ? (heads.shift() as string) : heads[0];
      },
      pushBranch: (branch, cwd) => {
        calls.push(`pushBranch ${branch} ${cwd}`);
        failIf('pushBranch');
      },
      commitChanges: (message, cwd) => {
        calls.push(`commitChanges ${message} @ ${cwd}`);
        failIf('commitChanges');
        return options.commitResult ?? true;
      },
      diff: (range, cwd) => {
        calls.push(`diff ${range} @ ${cwd}`);
        failIf('diff');
        return diffs.length > 1 ? (diffs.shift() as string) : diffs[0];
      },
      fetchAndResetToRemote: (branch, cwd) => {
        calls.push(`fetchAndResetToRemote ${branch} ${cwd}`);
        failIf('fetchAndResetToRemote');
      },
    },
    runResolveTestAgent: async (...args: unknown[]) => {
      calls.push('agent');
      agentInputs.push(args[0] as TestResult);
      agentArguments.push(args);
      return options.agent ? options.agent() : AGENT_RESULT;
    },
  };
  return { deps, calls, agentInputs, agentArguments };
}
