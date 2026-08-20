/**
 * Workflow initialization: sets up worktree, fetches issue, classifies type,
 * detects recovery mode, and returns a WorkflowConfig for all subsequent phases.
 */

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
  readAdwYmlConfig,
  type AdwYmlConfig,
  buildLaunchBoundary,
  type LaunchBoundary,
  crossCheckRepoIdentity,
  sameRepoIdentity,
  branchPrefixMap,
  branchPrefixAliases,
} from '../core';
import type { RepoIdentity } from '../types/agentTypes';
import type { GitContext } from '../gitContext';
import {
  fetchGitHubIssue,
  type WorkflowContext,
  detectRecoveryState,
  getRepoInfo,
  type RepoInfo,
  isGitHubAppConfigured,
} from '../github';
import { GITHUB_PAT } from '../core/environment';
import { gitContextForSync } from '../github';
import type { BoundProviders, RepoContext, RepoIdentifier } from '../providers/types';
import { createRepoContext } from '../providers/repoContext';
import { classifyGitHubIssue } from '../core/issueClassifier';
import { resolveWorkflowBranchName, readPersistedBranchName } from './branchNameResolution';
import { findExistingBranchForIssue, recoverAdwIdForBranch } from './branchIdentityFallback';
import { deriveOrchestratorScript } from '../core/orchestratorLib';
import { copyClaudeAssetsToWorktree } from './worktreeSetup';
import { postIssueStageComment } from './phaseCommentHelpers';
import { runUpgradeGate, buildDefaultUpgradeGateDeps } from './upgradeGate';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Re-export worktree setup helpers so imports from this module still work
export { ensureGitignoreEntry, ensureGitignoreEntries, copyClaudeAssetsToWorktree } from './worktreeSetup';

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
  adwYmlConfig: AdwYmlConfig;
  totalModelUsage?: ModelUsageMap;
  installContext?: string;
  /** Phase names already completed in a previous run (populated on pause/resume). */
  completedPhases?: string[];
  /** Absolute path to the top-level workflow state file: agents/{adwId}/state.json */
  topLevelStatePath: string;
  /** Launch-boundary GitContext for this orchestrator process. Optional to avoid
   *  breaking existing phase-test fixtures; always present for new orchestrators. */
  gitContext?: GitContext;
}

/**
 * Resolves the provider set a workflow's RepoContext must use. The boundary is the
 * only source: with no caller-supplied identity, both the identity and the provider
 * instances come straight from the boundary — no repository is read a second time.
 * A caller-supplied identity that contradicts the boundary is refused rather than
 * served a second, ad-hoc-minted provider set naming a repository the boundary
 * never saw.
 * @throws when callerRepoId names a different repository than the boundary
 */
export function resolveWorkflowProviders(
  boundary: LaunchBoundary,
  callerRepoId?: RepoIdentifier,
): { repoId: RepoIdentifier; providers: BoundProviders } {
  const repoId = callerRepoId ?? boundary.repoId;
  if (!sameRepoIdentity(repoId, boundary.repoId)) {
    throw new Error(
      `resolveWorkflowProviders: caller-supplied repository ${repoId.owner}/${repoId.repo} does not match the launch boundary's ${boundary.repoId.owner}/${boundary.repoId.repo}`,
    );
  }
  return { repoId, providers: boundary.providers };
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

  const resolvedRepoForAuth = repoInfo ?? getRepoInfo();
  const gitCtx = gitContextForSync({ owner: resolvedRepoForAuth.owner, repo: resolvedRepoForAuth.repo, selfHost: !targetRepo });

  // Construct exactly one launch boundary for this orchestrator process — a GitContext
  // and the forge providers bound to that same identity. Graceful fallback: if
  // construction fails (e.g. test fixtures with fake git remotes), both remain
  // undefined — phases that require them must check.
  let boundary: LaunchBoundary | undefined;
  try {
    boundary = buildLaunchBoundary(targetRepo ?? null);
  } catch { /* non-fatal: phases inherit the context when available */ }
  const gitContext: import('../gitContext').GitContext | undefined = boundary?.gitContext;

  // Startup validation: GITHUB_PAT is required for PR approval when a GitHub App is configured.
  if (isGitHubAppConfigured() && !GITHUB_PAT) {
    throw new Error(
      'GitHub App is configured but GITHUB_PAT is not set. GITHUB_PAT is required for PR approval when using a GitHub App. Set GITHUB_PAT in your .env file.',
    );
  }

  // Fetch issue (targeting external repo if specified)
  log('Fetching GitHub issue...', 'info');
  const issue = await fetchGitHubIssue(issueNumber, repoInfo ?? getRepoInfo());
  log(`Fetched issue: ${issue.title}`, 'success');

  // Detect recovery state early to reuse existing ADW ID and branch name
  const recoveryState = detectRecoveryState(issue.comments);

  // Classify issue type early so the deterministic-branch fallback can use it.
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

  // Resolve ADW ID: use provided, recovered from prior workflow comment, deterministic
  // branch fallback (when comment recovery failed), or generate a fresh ID last.
  // Guard: the fallback is only reached when BOTH `adwId` and `recoveryState.adwId` are
  // absent so the normal recovery path is byte-for-byte unchanged.
  let resolvedAdwId: string;
  if (adwId) {
    resolvedAdwId = adwId;
  } else if (recoveryState.adwId) {
    resolvedAdwId = recoveryState.adwId;
  } else {
    // Deterministic-branch fallback: find an existing branch for this issue/classifier
    // and recover the adwId from the persisted state store.
    const existingBranch = findExistingBranchForIssue(issueType, issueNumber);
    const recoveredId = existingBranch ? recoverAdwIdForBranch(existingBranch) : null;
    if (recoveredId) {
      log(`Recovered adwId "${recoveredId}" from existing branch "${existingBranch}" (deterministic fallback)`, 'info');
      resolvedAdwId = recoveredId;
    } else {
      resolvedAdwId = generateAdwId(issue.title);
    }
  }
  setLogAdwId(resolvedAdwId);

  const frameworkRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  log('===================================', 'info');
  log(`${orchestratorName}`, 'info');
  log(`Issue: #${issueNumber}`, 'info');
  log(`ADW ID: ${resolvedAdwId}`, 'info');
  try {
    const commitHash = gitCtx.headShort(frameworkRepoRoot);
    log(`ADW version: ${commitHash}`, 'info');
  } catch {
    // Not in a git repo or git unavailable — skip version logging
  }
  log('===================================', 'info');

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

  // The launch boundary is the only source of providers from this point on. It is
  // unreachable in production for this call to fail here: buildLaunchBoundary (above)
  // constructs its GitContext from the same owner/repo, git identity and token-provider
  // composition that gitContextForSync just used to build gitCtx, and both run the
  // identical validate-and-discard credential probe — so if gitCtx's construction
  // succeeded, the boundary's could not have failed. The only way to reach this line
  // with no boundary is a test that mocks gitContextForSync but not buildLaunchBoundary.
  if (!boundary) {
    throw new Error('initializeWorkflow: launch boundary unavailable — providers cannot be resolved for this run');
  }

  // Resolve default branch early — used by both the upgrade gate (below) and worktree setup.
  const defaultBranch = boundary.providers.codeHost.getDefaultBranch();

  // Upgrade gate: detect framework hash mismatch and park the issue if the target
  // repo's .adw/ is stale. Runs BEFORE worktree setup so a stale reused worktree's
  // local .adw-version cannot produce a false mismatch — the authoritative source is
  // origin/<default>:.adw-version on the remote. Losers park without ever creating a
  // feature worktree; the winner's claim push uses a temp worktree created inside
  // targetRepoWorkspacePath (existing invariant from 94059b5, unchanged).
  if (targetRepo && targetRepoWorkspacePath) {
    const repoInfoForGate = repoInfo ?? getRepoInfo();
    const targetRepoArgs = [
      '--target-repo', `${targetRepo.owner}/${targetRepo.repo}`,
      ...(targetRepo.cloneUrl ? ['--clone-url', targetRepo.cloneUrl] : []),
    ];
    const outcome = await runUpgradeGate(
      {
        issueNumber,
        issueBody: issue.body,
        worktreePath: targetRepoWorkspacePath,
        defaultBranch,
        frameworkRepoRoot,
        repoInfo: repoInfoForGate,
        targetRepoArgs,
      },
      buildDefaultUpgradeGateDeps(boundary.providers, targetRepoWorkspacePath, (ref, filePath, cwd) => gitCtx.show(ref, filePath, cwd)),
    );
    if (outcome.action === 'parked') {
      log(
        `Upgrade gate: parked issue #${issueNumber} (${outcome.role}) on #${outcome.upgradeIssueNumber ?? '?'}; exiting before any workflow comment.`,
        'info',
      );
      process.exit(0);
    }
  }

  // Setup worktree with branch sync
  let worktreePath: string;
  let branchName = '';
  if (options?.cwd) {
    gitCtx.mergeLatestFromDefaultBranch(defaultBranch, options.cwd);
    worktreePath = options.cwd;
    log('Using provided worktree (merged latest code)', 'info');
  } else if (targetRepoWorkspacePath) {
    // For external repos, create worktrees within the target repo workspace
    branchName = await resolveWorkflowBranchName({ adwId: resolvedAdwId, issueType, issue, logsDir, recoveryState });
    worktreePath = gitCtx.ensureWorktree(branchName, defaultBranch);
    copyClaudeAssetsToWorktree(worktreePath, gitCtx);
    log(`Worktree path (target repo): ${worktreePath}`, 'info');
  } else {
    const persistedBranchName = readPersistedBranchName(resolvedAdwId);
    // Skip pattern discovery when a persisted name exists — never adopt a sibling worktree's branch.
    const issueWorktree = persistedBranchName ? null : gitCtx.findWorktreeForIssue([branchPrefixMap[issueType], ...branchPrefixAliases[issueType]], issueNumber);
    if (issueWorktree) {
      branchName = issueWorktree.branchName;
      worktreePath = issueWorktree.worktreePath;
      gitCtx.mergeLatestFromDefaultBranch(defaultBranch, worktreePath);
      gitCtx.copyEnvToWorktree(worktreePath);
      log(`Reusing existing worktree found by issue pattern at ${worktreePath}`, 'info');
    } else {
      branchName = await resolveWorkflowBranchName({ adwId: resolvedAdwId, issueType, issue, logsDir, recoveryState });
      const existingWorktree = gitCtx.getWorktreeForBranch(branchName);
      if (existingWorktree) {
        log(`Reusing existing worktree at ${existingWorktree}`, 'info');
        gitCtx.mergeLatestFromDefaultBranch(defaultBranch, existingWorktree);
        gitCtx.copyEnvToWorktree(existingWorktree);
        worktreePath = existingWorktree;
      } else {
        worktreePath = gitCtx.ensureWorktree(branchName, defaultBranch);
        copyClaudeAssetsToWorktree(worktreePath, gitCtx);
        gitCtx.fetchAndResetToRemote(defaultBranch, worktreePath);
      }
    }
    log(`Worktree path: ${worktreePath}`, 'info');
  }

  // Create RepoContext early so it is available to board setup and subsequent phases.
  // When the resolved repoId matches the launch boundary's identity, reuse the
  // boundary-minted providers instead of resolving a second set (#794).
  let repoContext: RepoContext | undefined;
  let repoIdForContext: RepoIdentifier | undefined;
  try {
    const resolved = resolveWorkflowProviders(boundary, options?.repoId);
    repoIdForContext = resolved.repoId;
    repoContext = createRepoContext({
      repoId: repoIdForContext,
      cwd: worktreePath,
      providers: resolved.providers,
    });
  } catch (error) {
    log(`Failed to create RepoContext (falling back to direct API calls): ${error}`, 'info');
  }

  const orchestratorStatePath = AgentStateManager.initializeState(resolvedAdwId, orchestratorName);
  const topLevelStatePath = AgentStateManager.getTopLevelStatePath(resolvedAdwId);
  log(`State: ${orchestratorStatePath}`, 'info');
  log(`Logs: ${logsDir}`, 'info');

  // Derive launch identity from the boundary GitContext; fall back to the already-resolved
  // launch repo info when the context is unavailable (e.g. test fixtures with fake remotes).
  const launchRepoIdentity: RepoIdentity = gitContext
    ? { owner: gitContext.owner, repo: gitContext.repo }
    : { owner: resolvedRepoForAuth.owner, repo: resolvedRepoForAuth.repo };

  // Cross-check (not source of truth): if a prior run persisted a divergent identity for
  // this adwId, fail closed before any worktree/gh work rather than operate on the wrong repo.
  const priorTopLevel = AgentStateManager.readTopLevelState(resolvedAdwId);
  crossCheckRepoIdentity(launchRepoIdentity, priorTopLevel?.repoIdentity);

  // Initialize top-level workflow state file
  AgentStateManager.writeTopLevelState(resolvedAdwId, {
    adwId: resolvedAdwId,
    issueNumber,
    workflowStage: 'starting',
    orchestratorScript: deriveOrchestratorScript(orchestratorName),
    repoIdentity: launchRepoIdentity,
    // Conditionally include branchName so options.cwd path never clobbers a persisted name.
    ...(branchName ? { branchName } : {}),
  });

  const initialState: Partial<AgentState> = {
    adwId: resolvedAdwId,
    issueNumber,
    agentName: orchestratorName,
    pid: process.pid,
    execution: AgentStateManager.createExecutionState('running'),
    // Mirror the top-level write so both stores agree on branchName for new runs (#530).
    ...(branchName ? { branchName } : {}),
  };
  AgentStateManager.writeState(orchestratorStatePath, initialState);
  AgentStateManager.appendLog(orchestratorStatePath, `Starting ${orchestratorName} workflow for issue #${issueNumber}`);

  // Fire-and-forget board setup — ensures the project board exists with all ADW columns
  if (repoContext?.boardManager) {
    const capturedBoardManager = repoContext.boardManager;
    const capturedRepoName = repoIdForContext?.repo ?? '';
    Promise.resolve().then(async () => {
      try {
        let boardId = await capturedBoardManager.findBoard();
        if (!boardId) {
          boardId = await capturedBoardManager.createBoard(capturedRepoName);
          log(`Created project board "${capturedRepoName}"`, 'success');
        }
        await capturedBoardManager.ensureColumns(boardId);
        log('Board columns verified', 'success');
      } catch (error) {
        log(`Board setup failed (non-blocking): ${error}`, 'warn');
      }
    });
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
    // Prefer top-level phases map (new format) over metadata string array (legacy format)
    const topLevelState = AgentStateManager.readTopLevelState(recoveryState.adwId);
    if (topLevelState?.phases && Object.keys(topLevelState.phases).length > 0) {
      const fromPhasesMap = Object.entries(topLevelState.phases)
        .filter(([, entry]) => entry.status === 'completed')
        .map(([name]) => name);
      if (fromPhasesMap.length > 0) {
        completedPhases = fromPhasesMap;
        log(`Resume: found ${completedPhases.length} completed phase(s) from top-level phases map: ${completedPhases.join(', ')}`, 'info');
      }
    }

    if (!completedPhases) {
      const { findOrchestratorStatePath } = await import('../core/stateHelpers');
      const existingStatePath = findOrchestratorStatePath(recoveryState.adwId);
      if (existingStatePath) {
        const existingState = AgentStateManager.readState(existingStatePath);
        const meta = existingState?.metadata as Record<string, unknown> | undefined;
        if (Array.isArray(meta?.completedPhases) && meta.completedPhases.length > 0) {
          completedPhases = meta.completedPhases as string[];
          log(`Resume: found ${completedPhases.length} completed phase(s) from legacy metadata: ${completedPhases.join(', ')}`, 'info');
        }
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

  // Read .github/adw.yml for the unit-test gate and upgrade auto-merge policy
  const adwYmlConfig = readAdwYmlConfig(worktreePath);
  log(`adw.yml unit-test gate: ${adwYmlConfig.unitTests ? 'enabled' : 'disabled'}`, 'info');

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
    adwYmlConfig,
    completedPhases,
    topLevelStatePath,
    gitContext,
  };
}
