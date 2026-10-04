import type { GitContext } from '@paysdoc/devplatform/git';
import { log, AgentStateManager, emptyModelUsageMap, mergeModelUsageMaps } from '../core';
import { runResolveTestAgent, type TestResult } from '../agents/testAgent';
import { buildCommitPrefix } from '../agents/gitAgent';
import type { CheckVerdict } from '../core/checkRunner';
import type { FixRoundPort, FixRoundResult } from '../core/staticCheckFixLoop';
import type { AgentResult } from '../types/agentTypes';
import type { WorkflowConfig } from './workflowInit';
import { requireWorkflowGitContext, workflowLaunchContext } from './workflowRepoIdentity';

/** Per check; the prompt travels as one argument, and four outputs of this size stay far below the operating system's limit for one. */
export const MAX_FIX_PROMPT_OUTPUT_CHARS = 20_000;

const AGENT_NAME = 'static-check-fix-agent';
const NO_OUTPUT = '(no output)';

export interface StaticCheckFixRoundDeps {
  readonly git: Pick<GitContext, 'headShort' | 'pushBranch' | 'commitChanges' | 'diff' | 'fetchAndResetToRemote'>;
  readonly runResolveTestAgent: typeof runResolveTestAgent;
}

function cappedOutput(output: string): string {
  const text = output.trimEnd();
  if (text === '') return NO_OUTPUT;
  if (text.length <= MAX_FIX_PROMPT_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_FIX_PROMPT_OUTPUT_CHARS)}\n[output cut after ${MAX_FIX_PROMPT_OUTPUT_CHARS} characters; run the command to see the rest]`;
}

function describeFailingCheck(verdict: CheckVerdict): string {
  return [`## ${verdict.check}`, `Command: ${verdict.command}`, `Exit code: ${verdict.exitCode ?? 'none'}`, 'Output:', cappedOutput(verdict.output)].join('\n');
}

/** The one input of a round's agent run: every failing check at once, so that the round's diff is what that one run changed. */
export function toStaticCheckFailure(failed: readonly CheckVerdict[], round: number): TestResult {
  return {
    test_name: `static-checks-round-${round}`,
    passed: false,
    execution_command: failed.map(verdict => verdict.command).join('\n'),
    test_purpose: `Static checks that must pass: ${failed.map(verdict => verdict.check).join(', ')}. Each passes when its command exits with code 0.`,
    error: failed.map(describeFailingCheck).join('\n\n'),
  };
}

/** `headShort` abbreviates to the shortest unambiguous prefix, which can grow while objects are added. */
function sameCommit(first: string, second: string): boolean {
  return first.startsWith(second) || second.startsWith(first);
}

/**
 * Only typed `GitContext` operations are used, and the three invariants of a round hold:
 *  - the round base is pushed before the agent runs, so the remote branch is the point a round is restored to;
 *  - everything the round changed is committed before it is diffed, so a file the agent created is judged too;
 *  - a discard fails closed when the branch is not back at the round base afterwards.
 */
export function buildStaticCheckFixRoundPort(config: WorkflowConfig, deps: Partial<StaticCheckFixRoundDeps> = {}): FixRoundPort {
  const git = deps.git ?? requireWorkflowGitContext(config);
  const resolveAgent = deps.runResolveTestAgent ?? runResolveTestAgent;
  const { worktreePath, branchName } = config;
  const roundBases = new Map<number, string>();
  const commitPrefix = buildCommitPrefix(AGENT_NAME, config.issueType);

  function runAgent(failed: readonly CheckVerdict[], round: number): Promise<AgentResult> {
    return resolveAgent(
      toStaticCheckFailure(failed, round),
      config.logsDir,
      AgentStateManager.initializeState(config.adwId, AGENT_NAME, config.orchestratorStatePath),
      worktreePath,
      config.issue.body,
      workflowLaunchContext(config),
    );
  }

  function restoreRoundBase(round: number): void {
    const base = roundBases.get(round);
    if (base === undefined) throw new Error(`Static-check fix round ${round} was never started, so there is no base to restore`);
    git.fetchAndResetToRemote(branchName, worktreePath);
    const head = git.headShort(worktreePath);
    if (sameCommit(head, base)) return;
    throw new Error(
      `Discarding static-check fix round ${round} left ${branchName} at ${head} instead of the round's base ${base}: ` +
        'the fix agent pushed a commit of its own, and a pushed change cannot be undone from here. The rejected change may be on the remote branch.',
    );
  }

  function bestEffort(what: string, action: () => unknown): void {
    try {
      action();
    } catch (error) {
      log(`Static-check fix: could not ${what}: ${error}`, 'error');
    }
  }

  /** The commit comes first: a reset removes a file only once it is tracked, and the round may have created files. */
  function abandonRound(round: number): void {
    bestEffort(`commit what interrupted fix round ${round} left behind`, () => git.commitChanges(`${commitPrefix}: interrupted fix round ${round}`, worktreePath));
    bestEffort(`reset the worktree after interrupted fix round ${round}`, () => restoreRoundBase(round));
  }

  async function changesOfRound(failed: readonly CheckVerdict[], round: number, base: string): Promise<FixRoundResult> {
    const agent = await runAgent(failed, round);
    log(`Static-check fix round ${round}: the fix agent ${agent.success ? 'finished' : 'reported a failure'}`, agent.success ? 'info' : 'warn');
    git.commitChanges(`${commitPrefix}: fix round ${round} for failing static checks (${failed.map(verdict => verdict.check).join(', ')})`, worktreePath);
    return {
      diff: git.diff(`--no-renames ${base} HEAD`, worktreePath),
      costUsd: agent.totalCostUsd ?? 0,
      modelUsage: mergeModelUsageMaps(emptyModelUsageMap(), agent.modelUsage ?? {}),
    };
  }

  return {
    async fix(failed, round) {
      const base = git.headShort(worktreePath);
      roundBases.set(round, base);
      git.pushBranch(branchName, worktreePath);
      try {
        return await changesOfRound(failed, round, base);
      } catch (error) {
        abandonRound(round);
        throw error;
      }
    },
    async keep() {
      git.pushBranch(branchName, worktreePath);
    },
    async discard(round) {
      restoreRoundBase(round);
    },
  };
}
