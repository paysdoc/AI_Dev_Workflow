/**
 * The re-run of `@regression` and `@adw-{issue}` on a branch that has the base branch merged in. It runs inside the merge
 * orchestrator, which has no `WorkflowConfig`, no allocated port and no orchestrator state, so it assembles what the scenario
 * test phase reads from the merged worktree itself. It never throws: a failure of its own is a red verdict, and the merge
 * orchestrator must not crash-loop at `awaiting_merge`.
 */

import type { IssueTracker } from '@paysdoc/devplatform';
import { AgentStateManager, OrchestratorId, loadProjectConfig, log, type LogLevel, type ProjectConfig } from '../core';
import type { ApplicationProfile } from '../core/applicationType';
import { isCheckConfigured, runShellCommand, type ProcessRunner } from '../core/checkRunner';
import { allocateRandomPort } from '../core/portAllocator';
import { postMergeVerdict, type PostMergeFailure, type PostMergeVerdict } from '../core/postMergeVerdict';
import { resolveScenarioRunner } from '../core/scenarioRunner';
import { readDeclaredApplicationType } from './applicationTypeGate';
import { shouldRunScenarioProof } from './scenarioProof';
import { executeScenarioTestPhase, type ScenarioTestPhaseConfig, type ScenarioTestPhaseResult } from './scenarioTestPhase';

export interface PostMergeScenarioRun {
  readonly issueNumber: number;
  readonly adwId: string;
  readonly worktreePath: string;
  readonly logsDir: string;
}

export interface PostMergeRerunDeps {
  readonly loadProjectConfig: (worktreePath: string) => ProjectConfig;
  readonly runProcess: ProcessRunner;
  readonly allocatePort: () => Promise<number>;
  readonly runScenarioTests: (config: ScenarioTestPhaseConfig) => Promise<Pick<ScenarioTestPhaseResult, 'scenarioProof' | 'devServer'>>;
  readonly issueTracker: Pick<IssueTracker, 'commentOnIssue'>;
}

const GREEN: PostMergeVerdict = { kind: 'green' };
const NO_RUNNER = 'N/A';

export function buildPostMergeRerunDeps(issueTracker: Pick<IssueTracker, 'commentOnIssue'>): PostMergeRerunDeps {
  return {
    loadProjectConfig,
    runProcess: runShellCommand,
    allocatePort: allocateRandomPort,
    runScenarioTests: executeScenarioTestPhase,
    issueTracker,
  };
}

function note(message: string, level: LogLevel = 'info'): void {
  log(`Post-merge scenario re-run: ${message}`, level);
}

function red(failure: PostMergeFailure): PostMergeVerdict {
  return { kind: 'red', failures: [failure] };
}

function missingApplicationType(found: string | null): PostMergeVerdict {
  const seen = found === null ? 'is missing' : `says "${found}", which ADW does not know`;
  return red({
    title: 'application type',
    detail: `\`## Application Type\` in \`.adw/project.md\` ${seen} on the branch merged with the base branch, so ADW cannot tell how to run its scenarios.`,
  });
}

async function install(command: string, cwd: string, runProcess: ProcessRunner): Promise<PostMergeFailure | null> {
  note(`installing the dependencies: ${command}`);
  const { exitCode, output } = await runProcess(command, cwd);
  if (exitCode === 0) return null;
  return { title: `install failed: ${command} (exit ${exitCode ?? 'none'})`, detail: output };
}

// The merged-in commits may have added dependencies, so a failed install means the scenarios cannot be run on this code at all.
async function installDependencies(commands: readonly string[], cwd: string, runProcess: ProcessRunner): Promise<PostMergeFailure | null> {
  for (const command of commands) {
    const failure = await install(command, cwd, runProcess);
    if (failure !== null) return failure;
  }
  return null;
}

function phaseConfig(run: PostMergeScenarioRun, projectConfig: ProjectConfig, applicationProfile: ApplicationProfile, port: number, deps: PostMergeRerunDeps): ScenarioTestPhaseConfig {
  return {
    adwId: run.adwId,
    issueNumber: run.issueNumber,
    worktreePath: run.worktreePath,
    logsDir: run.logsDir,
    orchestratorStatePath: AgentStateManager.initializeState(run.adwId, OrchestratorId.Merge),
    applicationUrl: `http://localhost:${port}`,
    projectConfig,
    applicationProfile,
    ctx: { issueNumber: run.issueNumber, adwId: run.adwId },
    repoContext: { issueTracker: deps.issueTracker },
  };
}

function reportFailures(verdict: PostMergeVerdict): PostMergeVerdict {
  if (verdict.kind === 'green') return verdict;
  note(`${verdict.failures.length} failure(s) on the branch merged with the base branch:`, 'error');
  verdict.failures.forEach(({ title, detail }) => note(`${title}\n${detail}`, 'error'));
  return verdict;
}

async function rerun(run: PostMergeScenarioRun, deps: PostMergeRerunDeps): Promise<PostMergeVerdict> {
  const projectConfig = deps.loadProjectConfig(run.worktreePath);
  if (!shouldRunScenarioProof(projectConfig.scenariosMd)) {
    note('no scenarios configured — nothing to re-run');
    return GREEN;
  }

  const declared = readDeclaredApplicationType(projectConfig);
  if (declared.kind === 'unknown') return missingApplicationType(declared.declared);

  const runner = resolveScenarioRunner(declared.profile.runnerMode, projectConfig);
  if (runner.runByTagCommand.trim() === NO_RUNNER) {
    note('the scenario runner is N/A — nothing to re-run');
    return GREEN;
  }

  const installCommands = [projectConfig.commands.installDeps, runner.installCommand ?? ''].filter(isCheckConfigured);
  const failedInstall = await installDependencies(installCommands, run.worktreePath, deps.runProcess);
  if (failedInstall !== null) return red(failedInstall);

  const port = await deps.allocatePort();
  note(`running @regression and @adw-${run.issueNumber} on the branch merged with the base branch (port ${port})`);
  const result = await deps.runScenarioTests(phaseConfig(run, projectConfig, declared.profile, port, deps));
  const verdict = postMergeVerdict(result);
  if (verdict.kind === 'green') note('both suites passed on the branch merged with the base branch', 'success');
  return verdict;
}

export async function rerunScenariosOnMergedBranch(run: PostMergeScenarioRun, deps: PostMergeRerunDeps): Promise<PostMergeVerdict> {
  try {
    return reportFailures(await rerun(run, deps));
  } catch (error) {
    note(`failed before it could tell: ${error}`, 'error');
    return red({ title: 'scenario re-run', detail: String(error) });
  }
}
