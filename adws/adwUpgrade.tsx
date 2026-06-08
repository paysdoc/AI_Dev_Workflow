#!/usr/bin/env bunx tsx
/**
 * ADW Upgrade Orchestrator — Performs framework regeneration for the versioned auto-(re)init system.
 *
 * Usage: bunx tsx adws/adwUpgrade.tsx <issueNumber> [adw-id] [--target-repo owner/repo] [--clone-url <url>]
 *
 * Workflow:
 * 1. Compute framework hash at runtime (not pinned to branch-name token)
 * 2. Derive claim branch name: adw-upgrade-<hash>
 * 3. Check out the existing remote claim branch (carrying the empty claim commit)
 * 4. Run /adw_init via the Claude CLI in the target worktree
 * 5. Write the runtime hash to .adw-version
 * 6. Commit the regenerated .adw/ + .adw-version as a single regen commit
 * 7. Push and open a PR linking the tracking issue
 * 8. Read .github/adw.yml from the worktree; if hitl: true, leave the PR open for human review;
 *    otherwise auto-merge the PR (best-effort — merge failure is non-fatal, PR is left open).
 *
 * On LLM failure: posts a non-workflow comment to the tracking issue and exits 0 (handled failure).
 * On success: opens and (by default) auto-merges the PR. If .github/adw.yml sets hitl: true,
 * the PR is left open for a human to review; the tracking issue auto-closes on merge via the
 * Implements #<N> linkage. The .github/adw.yml file lives outside .adw/ so /adw_init
 * regeneration cannot clobber the opt-in signal.
 *
 * Does NOT call initializeWorkflow() — joins the adwMerge.tsx exception list.
 * Uses runWithRawOrchestratorLifecycle (lock → heartbeat → run → cleanup).
 */

import * as path from 'path';
import { fileURLToPath } from 'node:url';

import { runWithRawOrchestratorLifecycle } from './phases/orchestratorLock';
import {
  parseTargetRepoArgs,
  parseOrchestratorArguments,
  buildRepoIdentifier,
  generateAdwId,
  log,
  ensureLogsDirectory,
  ensureTargetRepoWorkspace,
  buildClaimBranchName,
  computeFrameworkHash,
  writeAdwVersion,
  readAdwYmlConfig,
  type AdwYmlConfig,
} from './core';
import { commentOnIssue, mergePR, type RepoInfo } from './github';
import { ensureWorktree, commitChanges, pushBranch } from './vcs';
import { getDefaultBranch } from './vcs/branchOperations';
import { runClaudeAgentWithCommand } from './agents';
import { createGitHubCodeHost } from './providers/github/githubCodeHost';
import type { CreatePROptions, PullRequestResult, RepoIdentifier } from './providers/types';

// ── Result type ───────────────────────────────────────────────────────────────

/** Outcome of executeUpgrade. */
export interface UpgradeRunResult {
  readonly outcome: 'completed' | 'failed';
  readonly reason: string;
  readonly prUrl?: string;
}

// ── Deps interface ────────────────────────────────────────────────────────────

/** Parameters passed to the runInitCommand dep. */
export interface RunInitCommandParams {
  readonly worktreePath: string;
  readonly logPath: string;
  readonly issueNumber: number;
  readonly adwId: string;
  readonly issueJson: string;
  readonly frameworkRepoRoot: string;
}

/** Injectable dependencies for executeUpgrade — enables unit testing without I/O. */
export interface UpgradeDeps {
  readonly computeFrameworkHash: (frameworkRepoRoot: string) => string;
  readonly ensureWorktree: (branch: string, baseBranch: string, baseRepoPath: string) => string;
  readonly getDefaultBranch: (cwd: string) => string;
  readonly runInitCommand: (params: RunInitCommandParams) => Promise<{ success: boolean; error?: string }>;
  readonly writeAdwVersion: (worktreePath: string, hash: string) => void;
  readonly commitChanges: (message: string, cwd: string) => boolean;
  readonly pushBranch: (branch: string, cwd: string) => void;
  readonly createPullRequest: (options: CreatePROptions) => PullRequestResult;
  readonly commentOnIssue: typeof commentOnIssue;
  readonly ensureLogsDirectory: (adwId: string) => string;
  readonly log: typeof log;
  readonly readAdwYmlConfig: (worktreePath: string) => AdwYmlConfig;
  readonly mergePR: (prNumber: number, repoInfo: RepoInfo) => { success: boolean; error?: string };
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Builds the upgrade PR title. */
export function buildUpgradePrTitle(hash: string): string {
  return `chore: upgrade ADW framework config (${hash.slice(0, 12)})`;
}

/**
 * Builds the upgrade PR body. Begins with `Implements #<issueNumber>` so the
 * tracking issue auto-closes on merge and concurrencyGuard recognises the linked PR.
 */
export function buildUpgradePrBody(issueNumber: number, hash: string): string {
  return [
    `Implements #${issueNumber}`,
    '',
    'Regenerates the `.adw/` directory against the current ADW framework version and bumps `.adw-version`.',
    '',
    `**Framework hash:** \`${hash}\``,
  ].join('\n');
}

/**
 * Builds the LLM-failure comment body.
 *
 * MUST NOT start any line with `## :emoji_name: ` and MUST NOT contain
 * `<!-- adw-bot -->`, so that isAdwComment() returns false and concurrencyGuard
 * does not count the failed upgrade as an in-progress issue (User Story 22).
 */
export function buildUpgradeFailureComment(reason: string, adwId: string, issueNumber: number): string {
  return [
    'ADW upgrade regeneration failed.',
    '',
    `**Reason:** ${reason}`,
    '',
    `**ADW ID:** \`${adwId}\``,
    '',
    `To retry: \`bunx tsx adws/adwUpgrade.tsx ${issueNumber}\``,
  ].join('\n');
}

/**
 * Builds the HITL-deferred comment body (non-workflow, non-ADW).
 *
 * MUST NOT start any line with `## :emoji_name: ` and MUST NOT contain
 * `<!-- adw-bot -->` — same contract as buildUpgradeFailureComment.
 */
export function buildUpgradeHitlComment(prNumber: number, adwId: string): string {
  return [
    `This upgrade PR awaits human review per \`.github/adw.yml\` (\`hitl: true\`). Review and merge PR #${prNumber} to apply.`,
    '',
    `**ADW ID:** \`${adwId}\``,
  ].join('\n');
}

/**
 * Builds the merge-failed comment body (non-workflow, non-ADW).
 *
 * MUST NOT start any line with `## :emoji_name: ` and MUST NOT contain
 * `<!-- adw-bot -->` — same contract as buildUpgradeFailureComment.
 */
export function buildUpgradeMergeFailedComment(prNumber: number, reason: string, adwId: string): string {
  const truncatedReason = reason.length > 200 ? `${reason.slice(0, 200)}…` : reason;
  return [
    `ADW upgrade PR auto-merge failed (non-fatal). Merge PR #${prNumber} manually to apply the upgrade.`,
    '',
    `**Reason:** ${truncatedReason}`,
    '',
    `**ADW ID:** \`${adwId}\``,
  ].join('\n');
}

// ── Core orchestration ────────────────────────────────────────────────────────

/**
 * Core upgrade orchestration logic — exported for unit testing.
 * All side effects are injected via `deps`.
 */
export async function executeUpgrade(
  issueNumber: number,
  adwId: string,
  repoInfo: RepoInfo,
  baseRepoPath: string,
  frameworkRepoRoot: string,
  deps: UpgradeDeps,
): Promise<UpgradeRunResult> {
  // 1. Compute runtime framework hash (single source of truth for branch name + .adw-version)
  let hash: string;
  try {
    hash = deps.computeFrameworkHash(frameworkRepoRoot);
    if (!hash || !hash.trim()) throw new Error('computeFrameworkHash returned an empty hash');
  } catch (error) {
    deps.commentOnIssue(
      issueNumber,
      buildUpgradeFailureComment(String(error), adwId, issueNumber),
      repoInfo,
    );
    return { outcome: 'failed', reason: 'hash_error' };
  }

  // 2. Derive the claim branch name
  const branch = buildClaimBranchName(hash);
  const defaultBranch = deps.getDefaultBranch(baseRepoPath);

  // 3. Check out the existing remote claim branch
  let worktreePath: string;
  try {
    worktreePath = deps.ensureWorktree(branch, defaultBranch, baseRepoPath);
  } catch (error) {
    deps.commentOnIssue(
      issueNumber,
      buildUpgradeFailureComment(String(error), adwId, issueNumber),
      repoInfo,
    );
    return { outcome: 'failed', reason: 'worktree_error' };
  }

  // 4. Run /adw_init via the Claude CLI
  const logsDir = deps.ensureLogsDirectory(adwId);
  const issueJson = JSON.stringify({ number: issueNumber, title: '', body: '' });

  const initResult = await deps.runInitCommand({
    worktreePath,
    logPath: `${logsDir}/adw-upgrade-init.jsonl`,
    issueNumber,
    adwId,
    issueJson,
    frameworkRepoRoot,
  });

  // 5. LLM failure — post non-workflow comment; no PR, no .adw-version write
  if (!initResult.success) {
    deps.commentOnIssue(
      issueNumber,
      buildUpgradeFailureComment(initResult.error ?? 'unknown', adwId, issueNumber),
      repoInfo,
    );
    return { outcome: 'failed', reason: 'llm_failed' };
  }

  // 6. Write .adw-version, commit the regen, push
  deps.writeAdwVersion(worktreePath, hash);
  deps.commitChanges(`chore: regenerate .adw/ for framework upgrade ${hash.slice(0, 12)}`, worktreePath);
  deps.pushBranch(branch, worktreePath);

  // 7. Open PR — no workflow comment; the PR is the success signal
  const pr = deps.createPullRequest({
    title: buildUpgradePrTitle(hash),
    body: buildUpgradePrBody(issueNumber, hash),
    sourceBranch: branch,
    targetBranch: deps.getDefaultBranch(worktreePath),
    linkedIssueNumber: issueNumber,
  });

  deps.log(`adwUpgrade: PR opened at ${pr.url}`, 'success');

  // 8. Gated merge: read .github/adw.yml from the worktree to decide whether to auto-merge.
  //    hitl: true  → leave the PR open for human review.
  //    hitl: false (default, absent, or malformed) → auto-merge (best-effort, non-fatal).
  const cfg = deps.readAdwYmlConfig(worktreePath);

  if (cfg.hitl === true) {
    deps.log(`adwUpgrade: hitl opt-in via .github/adw.yml — leaving PR #${pr.number} for human review`, 'info');
    deps.commentOnIssue(issueNumber, buildUpgradeHitlComment(pr.number, adwId), repoInfo);
    return { outcome: 'completed', reason: 'pr_opened_hitl', prUrl: pr.url };
  }

  const merge = deps.mergePR(pr.number, repoInfo);
  if (merge.success) {
    deps.log(`adwUpgrade: PR #${pr.number} auto-merged`, 'success');
    return { outcome: 'completed', reason: 'pr_merged', prUrl: pr.url };
  }

  deps.log(`adwUpgrade: auto-merge failed for PR #${pr.number} (non-fatal): ${merge.error}`, 'warn');
  deps.commentOnIssue(issueNumber, buildUpgradeMergeFailedComment(pr.number, merge.error ?? 'unknown', adwId), repoInfo);
  return { outcome: 'completed', reason: 'merge_failed', prUrl: pr.url };
}

// ── Default deps factory ──────────────────────────────────────────────────────

async function runInitCommandDefault(params: RunInitCommandParams): Promise<{ success: boolean; error?: string }> {
  const result = await runClaudeAgentWithCommand(
    '/adw_init',
    [String(params.issueNumber), params.adwId, params.issueJson, params.frameworkRepoRoot],
    'adw-upgrade',
    params.logPath,
    'sonnet',
    undefined,
    undefined,
    undefined,
    params.worktreePath,
  );
  return {
    success: result.success,
    error: result.success ? undefined : (result.output || 'LLM command failed'),
  };
}

/** Builds the default UpgradeDeps using production implementations. */
function buildDefaultUpgradeDeps(repoId: RepoIdentifier): UpgradeDeps {
  const codeHost = createGitHubCodeHost(repoId);
  return {
    computeFrameworkHash,
    ensureWorktree,
    getDefaultBranch,
    runInitCommand: runInitCommandDefault,
    writeAdwVersion,
    commitChanges,
    pushBranch,
    createPullRequest: (options) => codeHost.createPullRequest(options),
    commentOnIssue,
    ensureLogsDirectory,
    log,
    readAdwYmlConfig,
    mergePR: (prNumber, info) => mergePR(prNumber, info),
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Main entry point. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId: parsedAdwId } = parseOrchestratorArguments(args, {
    scriptName: 'adwUpgrade.tsx',
    usagePattern: '<issueNumber> [adw-id] [--target-repo owner/repo] [--clone-url <url>]',
    supportsCwd: false,
    supportsIssueType: false,
  });

  const adwId = parsedAdwId ?? generateAdwId('adwupgrade');
  const repoId = buildRepoIdentifier(targetRepo);
  const repoInfo: RepoInfo = { owner: repoId.owner, repo: repoId.repo };
  const baseRepoPath = targetRepo ? ensureTargetRepoWorkspace(targetRepo) : process.cwd();
  const frameworkRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  let result: UpgradeRunResult | undefined;
  const acquired = await runWithRawOrchestratorLifecycle(repoInfo, issueNumber, adwId, async () => {
    result = await executeUpgrade(
      issueNumber,
      adwId,
      repoInfo,
      baseRepoPath,
      frameworkRepoRoot,
      buildDefaultUpgradeDeps(repoId),
    );
  });

  if (!acquired) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
  // Any returned UpgradeRunResult (completed or a handled failed) is a clean exit.
  // Reserve exit 1 for a genuine crash where the lifecycle produced no result.
  process.exit(result ? 0 : 1);
}

// Only run when executed directly — not when imported as a module (e.g. in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
