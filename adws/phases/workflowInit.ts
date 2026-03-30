/**
 * Workflow initialization: sets up worktree, fetches issue, classifies type,
 * detects recovery mode, and returns a WorkflowConfig for all subsequent phases.
 */

import { execSync } from 'child_process';
import { accessSync, constants as fsConstants } from 'fs';
import {
  log,
  setLogAdwId,
  ensureLogsDirectory,
  generateAdwId,
  resolveClaudeCodePath,
  type IssueClassSlashCommand,
  type GitHubIssue,
  AgentStateManager,
  type AgentState,
  type AgentIdentifier,
  type RecoveryState,
  hasUncommittedChanges,
  getNextStage,
  allocateRandomPort,
  type TargetRepoInfo,
  ensureTargetRepoWorkspace,
  type ProjectConfig,
  type ModelUsageMap,
  loadProjectConfig,
} from '../core';
import type { WorkflowPhaseState } from '../types/workflowState';
import {
  fetchGitHubIssue,
  type WorkflowContext,
  detectRecoveryState,
  getRepoInfo,
  type RepoInfo,
  activateGitHubAppAuth,
} from '../github';
import {
  ensureWorktree,
  getWorktreeForBranch,
  mergeLatestFromDefaultBranch,
  copyEnvToWorktree,
  findWorktreeForIssue,
  fetchAndResetToRemote,
} from '../vcs';
import { getDefaultBranch } from '../vcs/branchOperations';
import type { RepoContext, RepoIdentifier } from '../providers/types';
import { Platform } from '../providers/types';
import { createRepoContext } from '../providers/repoContext';
import { runGenerateBranchNameAgent } from '../agents';
import { classifyGitHubIssue } from '../core/issueClassifier';
import { copyClaudeCommandsToWorktree } from './worktreeSetup';
import { postIssueStageComment } from './phaseCommentHelpers';

// Re-export worktree setup helpers so imports from this module still work
export { ensureGitignoreEntry, ensureGitignoreEntries, copyClaudeCommandsToWorktree, copyTargetSkillsAndCommands } from './worktreeSetup';

/**
 * Configuration shared across all workflow phase functions.
 * Created by initializeWorkflow() and passed to every phase.
 */
export interface WorkflowConfig {
  issueNumber: number;
  adwId: string;
  issue: GitHubIssue;
  issueType: IssueClassSlashCommand;
  worktreePath: string;
  defaultBranch: string;
  logsDir: string;
  orchestratorStatePath: string;
  orchestratorName: AgentIdentifier;
  recoveryState: RecoveryState;
  ctx: WorkflowContext;
  branchName: string;
  applicationUrl: string;
  targetRepo?: TargetRepoInfo;
  repoContext?: RepoContext;
  projectConfig: ProjectConfig;
  totalModelUsage?: ModelUsageMap;
  installContext?: string;
  /** Phase names already completed in a previous run (populated on pause/resume). */
  completedPhases?: string[];
  /** Structured per-phase state. Set by declarative runner; undefined for non-migrated orchestrators. */
  phaseState?: WorkflowPhaseState;
}

/**
 * Initializes a workflow: fetches issue, classifies type, sets up worktree,
 * initializes state, and detects recovery mode.
 * @param issueNumber - The GitHub issue number to process
 * @param adwId - Optional ADW workflow ID (recovered from prior run or generated if null)
 * @param orchestratorName - Identifier for the orchestrator agent running the workflow
 * @param options - Optional configuration overrides
 * @param options.cwd - Optional working directory override
 * @param options.issueType - Optional pre-classified issue type
 * @param options.targetRepo - Optional target repository info for operating on an external git repository
 */
export async function initializeWorkflow(
  issueNumber: number,
  adwId: string | null,
  orchestratorName: AgentIdentifier,
  options?: { cwd?: string; issueType?: IssueClassSlashCommand; targetRepo?: TargetRepoInfo; repoId?: RepoIdentifier }
): Promise<WorkflowConfig> {
  // Pre-flight: verify Claude CLI is present and executable before starting the pipeline
  const claudePath = resolveClaudeCodePath();
  try {
    accessSync(claudePath, fsConstants.X_OK);
    log(`Pre-flight check passed: Claude CLI found at ${claudePath}`, 'info');
  } catch {
    throw new Error(
      `Pre-flight check failed: Claude CLI not found or not executable at ${claudePath}. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env.`
    );
  }

  // Resolve target repo context for API calls
  const targetRepo = options?.targetRepo;
  const repoInfo: RepoInfo | undefined = targetRepo
    ? { owner: targetRepo.owner, repo: targetRepo.repo }
    : undefined;

  // Activate GitHub App auth to generate a fresh token for this process.
  // Ensures child processes spawned by triggers don't rely on stale inherited GH_TOKEN.
  const resolvedRepoForAuth = repoInfo ?? getRepoInfo();
  activateGitHubAppAuth(resolvedRepoForAuth.owner, resolvedRepoForAuth.repo);

  // Fetch issue (targeting external repo if specified)
  log('Fetching GitHub issue...', 'info');
  const issue = await fetchGitHubIssue(issueNumber, repoInfo ?? getRepoInfo());
  log(`Fetched issue: ${issue.title}`, 'success');

  // Detect recovery state early to reuse existing ADW ID and branch name
  const recoveryState = detectRecoveryState(issue.comments);

  // Resolve ADW ID: use provided, recovered from prior workflow, or generate new
  const resolvedAdwId = adwId ?? recoveryState.adwId ?? generateAdwId(issue.title);
  setLogAdwId(resolvedAdwId);

  log('===================================', 'info');
  log(`${orchestratorName}`, 'info');
  log(`Issue: #${issueNumber}`, 'info');
  log(`ADW ID: ${resolvedAdwId}`, 'info');
  try {
    const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    log(`ADW version: ${commitHash}`, 'info');
  } catch {
    // Not in a git repo or git unavailable — skip version logging
  }
  log('===================================', 'info');

  // Classify issue type
  let issueType: IssueClassSlashCommand;
  if (options?.issueType) {
    log(`Using pre-classified issue type: ${options.issueType}`, 'info');
    issueType = options.issueType;
  } else {
    log('Classifying issue type...', 'info');
    const classificationResult = await classifyGitHubIssue(issue);
    issueType = classificationResult.issueType;
    log(`Issue classified as: ${issueType}`, classificationResult.success ? 'success' : 'info');
  }

  // Initialize logs early so agents can use the directory
  const logsDir = ensureLogsDirectory(resolvedAdwId);

  // Setup target repo workspace if targeting an external repository
  let targetRepoWorkspacePath: string | undefined;
  if (targetRepo) {
    log(`Setting up target repo workspace for ${targetRepo.owner}/${targetRepo.repo}...`, 'info');
    targetRepoWorkspacePath = ensureTargetRepoWorkspace(targetRepo);
    targetRepo.workspacePath = targetRepoWorkspacePath;
    log(`Target repo workspace: ${targetRepoWorkspacePath}`, 'success');
  }

  // Setup worktree with branch sync
  // When targeting an external repo, get default branch from that repo's workspace
  const defaultBranchCwd = targetRepoWorkspacePath || undefined;
  const defaultBranch = getDefaultBranch(defaultBranchCwd);
  let worktreePath: string;
  let branchName = '';
  if (options?.cwd) {
    mergeLatestFromDefaultBranch(defaultBranch, options.cwd);
    worktreePath = options.cwd;
    log('Using provided worktree (merged latest code)', 'info');
  } else if (targetRepoWorkspacePath) {
    // For external repos, create worktrees within the target repo workspace
    if (recoveryState.branchName) {
      branchName = recoveryState.branchName;
      log(`Reusing branch from previous workflow: ${branchName}`, 'info');
    } else {
      const branchResult = await runGenerateBranchNameAgent(issueType, issue, logsDir);
      branchName = branchResult.branchName;
      log(`Branch name generated: ${branchName}`, 'success');
    }
    worktreePath = ensureWorktree(branchName, defaultBranch, targetRepoWorkspacePath);
    copyClaudeCommandsToWorktree(worktreePath);
    log(`Worktree path (target repo): ${worktreePath}`, 'info');
  } else {
    // Try to find an existing worktree by issue type and number first
    const issueWorktree = findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath);
    if (issueWorktree) {
      branchName = issueWorktree.branchName;
      worktreePath = issueWorktree.worktreePath;
      mergeLatestFromDefaultBranch(defaultBranch, worktreePath);
      copyEnvToWorktree(worktreePath, targetRepoWorkspacePath);
      log(`Reusing existing worktree found by issue pattern at ${worktreePath}`, 'info');
    } else {
      if (recoveryState.branchName) {
        branchName = recoveryState.branchName;
        log(`Reusing branch from previous workflow: ${branchName}`, 'info');
      } else {
        const branchResult = await runGenerateBranchNameAgent(issueType, issue, logsDir);
        branchName = branchResult.branchName;
        log(`Branch name generated: ${branchName}`, 'success');
      }
      const existingWorktree = getWorktreeForBranch(branchName);
      if (existingWorktree) {
        log(`Reusing existing worktree at ${existingWorktree}`, 'info');
        mergeLatestFromDefaultBranch(defaultBranch, existingWorktree);
        copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath);
        worktreePath = existingWorktree;
      } else {
        worktreePath = ensureWorktree(branchName, defaultBranch);
        copyClaudeCommandsToWorktree(worktreePath);
        fetchAndResetToRemote(defaultBranch, worktreePath);
      }
    }
    log(`Worktree path: ${worktreePath}`, 'info');
  }

  const orchestratorStatePath = AgentStateManager.initializeState(resolvedAdwId, orchestratorName);
  log(`State: ${orchestratorStatePath}`, 'info');
  log(`Logs: ${logsDir}`, 'info');

  const initialState: Partial<AgentState> = {
    adwId: resolvedAdwId,
    issueNumber,
    agentName: orchestratorName,
    pid: process.pid,
    execution: AgentStateManager.createExecutionState('running'),
  };
  AgentStateManager.writeState(orchestratorStatePath, initialState);
  AgentStateManager.appendLog(orchestratorStatePath, `Starting ${orchestratorName} workflow for issue #${issueNumber}`);

  // Create RepoContext for provider-agnostic operations
  let repoContext: RepoContext | undefined;
  try {
    const repoIdForContext = options?.repoId ?? (() => {
      const resolvedRepoInfo = repoInfo ?? getRepoInfo();
      return { owner: resolvedRepoInfo.owner, repo: resolvedRepoInfo.repo, platform: Platform.GitHub };
    })();
    repoContext = createRepoContext({
      repoId: repoIdForContext,
      cwd: worktreePath,
    });
  } catch (error) {
    log(`Failed to create RepoContext (falling back to direct API calls): ${error}`, 'info');
  }

  // Initialize workflow context
  const ctx: WorkflowContext = {
    issueNumber,
    adwId: resolvedAdwId,
    issueType,
  };

  // Read completedPhases from existing orchestrator state (populated by pause mechanism)
  let completedPhases: string[] | undefined;
  if (recoveryState.adwId) {
    const { findOrchestratorStatePath } = await import('../core/stateHelpers');
    const existingStatePath = findOrchestratorStatePath(recoveryState.adwId);
    if (existingStatePath) {
      const existingState = AgentStateManager.readState(existingStatePath);
      const meta = existingState?.metadata as Record<string, unknown> | undefined;
      if (Array.isArray(meta?.completedPhases) && meta.completedPhases.length > 0) {
        completedPhases = meta.completedPhases as string[];
        log(`Resume: found ${completedPhases.length} completed phase(s): ${completedPhases.join(', ')}`, 'info');
      }
    }
  }

  // Handle recovery mode
  if (recoveryState.canResume && recoveryState.lastCompletedStage) {
    log(`Recovery mode active: last completed stage was '${recoveryState.lastCompletedStage}'`, 'info');
    if (hasUncommittedChanges(worktreePath)) {
      log('Warning: There are uncommitted changes in the working directory', 'info');
    }
    if (recoveryState.branchName) ctx.branchName = recoveryState.branchName;
    if (recoveryState.planPath) ctx.planPath = recoveryState.planPath;
    if (recoveryState.prUrl) ctx.prUrl = recoveryState.prUrl;
    const nextStage = getNextStage(recoveryState.lastCompletedStage);
    ctx.resumeFrom = nextStage;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'resuming', ctx);
    }
  } else {
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'starting', ctx);
    }
  }

  // Load project configuration from target repo's .adw/ directory
  const projectConfig = loadProjectConfig(worktreePath);
  if (projectConfig.hasAdwDir) {
    log('Loaded project config from .adw/ directory', 'info');
  } else {
    log('No .adw/ directory found, using default project config', 'info');
  }

  // Allocate a random port for the dedicated dev server instance
  const port = await allocateRandomPort();
  const applicationUrl = `http://localhost:${port}`;
  log(`Allocated port ${port} for dev server (${applicationUrl})`, 'info');
  AgentStateManager.appendLog(orchestratorStatePath, `Allocated port ${port} for dev server`);

  return {
    issueNumber,
    adwId: resolvedAdwId,
    issue,
    issueType,
    worktreePath,
    defaultBranch,
    logsDir,
    orchestratorStatePath,
    orchestratorName,
    recoveryState,
    ctx,
    branchName,
    applicationUrl,
    targetRepo,
    repoContext,
    projectConfig,
    completedPhases,
  };
}
