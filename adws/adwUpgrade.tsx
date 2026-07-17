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
 * `Closes #<N>` keyword in the PR body. The .github/adw.yml file lives outside .adw/ so /adw_init
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
  isPushRejectionError,
  writeAdwVersion,
  readAdwYmlConfig,
  type AdwYmlConfig,
  MAX_FAILURES,
  postSlack,
  countUpgradeFailureComments,
  UPGRADE_FAILURE_SIGNATURE,
  type IssueCommentRecord,
} from './core';
import { ADW_BLOCKED_LABEL } from './github/labelManager';
import { commentOnIssue, mergePR, type RepoInfo, gitContextFor } from './github';
import { defaultFindPRByBranch, hasWontFixLabel, type RawPR } from './github/prApi';
import type { GitContext } from './gitContext';
import { runClaudeAgentWithCommand } from './agents';
import { createGitHubCodeHost } from './providers/github/githubCodeHost';
import type { CreatePROptions, PullRequestResult, RepoIdentifier } from './providers/types';
import {
  copyAdwInitCommandToWorktree,
  verifyAdwRegen,
  copyStarterSettingsToWorktree,
  type StarterSettingsResult,
} from './phases/worktreeSetup';

// ── Result type ───────────────────────────────────────────────────────────────

/** Outcome of executeUpgrade. */
export interface UpgradeRunResult {
  readonly outcome: 'completed' | 'failed' | 'escalated';
  readonly reason: string;
  readonly prUrl?: string;
}

const TERMINAL_LABEL = ADW_BLOCKED_LABEL;

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
  readonly ensureWorktree: (branch: string, baseBranch: string) => string;
  /**
   * Reconciles the (possibly reused) upgrade worktree to the live remote claim tip
   * before regen: git fetch origin <branch> + git reset --hard origin/<branch>.
   * Fixes the stale-worktree non-fast-forward that #627 only parks. Hard reset is
   * safe — the upgrade worktree is a throwaway regen target with no un-pushed work.
   */
  readonly reconcileWorktreeToRemote: (worktreePath: string, branch: string) => void;
  readonly getDefaultBranch: () => string;
  readonly findPRByBranch: (branch: string, repoInfo: RepoInfo) => RawPR | null;
  readonly runInitCommand: (params: RunInitCommandParams) => Promise<{ success: boolean; error?: string }>;
  readonly copyInitCommandToWorktree: (worktreePath: string, frameworkRepoRoot: string) => void;
  readonly verifyAdwRegen: (worktreePath: string) => { ok: boolean; missing: readonly string[] };
  /** Copies the starter guardrails `settings.json` into the worktree, skipping if one already exists (#763). */
  readonly copyStarterSettings: (worktreePath: string, frameworkRepoRoot: string) => StarterSettingsResult;
  readonly writeAdwVersion: (worktreePath: string, hash: string) => void;
  readonly commitChanges: (message: string, cwd: string, opts?: { excludePaths?: readonly string[] }) => boolean;
  readonly pushBranch: (branch: string, cwd: string) => void;
  /** True when a push error is a non-fast-forward rejection (another orchestrator owns the claim branch). */
  readonly isPushRejection: (err: unknown) => boolean;
  readonly createPullRequest: (options: CreatePROptions) => PullRequestResult;
  readonly commentOnIssue: typeof commentOnIssue;
  readonly ensureLogsDirectory: (adwId: string) => string;
  readonly log: typeof log;
  readonly readAdwYmlConfig: (worktreePath: string) => AdwYmlConfig;
  readonly mergePR: (prNumber: number, repoInfo: RepoInfo) => { success: boolean; error?: string };
  readonly fetchIssueLabels: (issueNumber: number) => readonly string[];
  readonly fetchIssueComments: (issueNumber: number) => readonly IssueCommentRecord[];
  readonly ensureLabel: (name: string, color: string, description: string) => void;
  readonly applyLabel: (issueNumber: number, label: string) => void;
  readonly moveToStatus: (issueNumber: number, status: string) => boolean;
  readonly postSlack: (text: string) => Promise<void>;
  readonly maxFailures: number;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Builds the upgrade PR title. */
export function buildUpgradePrTitle(hash: string): string {
  return `chore: upgrade ADW framework config (${hash.slice(0, 12)})`;
}

/**
 * Builds the upgrade PR body.
 * - `Closes #<issueNumber>` — GitHub closing keyword; auto-closes the tracking issue on merge
 *   to the default branch and creates the linked-PR relationship Projects V2 renders.
 * - `Implements #<issueNumber>` — retained as the `linkedPrDetector` (`hasLinkedMergedOrClosedPR`)
 *   defense-in-depth backstop: if auto-close ever silently fails, the detector still recognises
 *   the merged PR so `concurrencyGuard` won't over-count and `cronLabelEligibility` won't re-spawn.
 */
export function buildUpgradePrBody(issueNumber: number, hash: string): string {
  return [
    `Implements #${issueNumber}`,
    `Closes #${issueNumber}`,
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
    UPGRADE_FAILURE_SIGNATURE,
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

/**
 * Builds the escalation comment body (non-workflow, non-ADW, non-failure-signature).
 * First line deliberately differs from UPGRADE_FAILURE_SIGNATURE so it cannot self-inflate
 * the failure count.
 */
export function buildUpgradeEscalationComment(adwId: string, issueNumber: number, maxFailures: number): string {
  return [
    'ADW upgrade escalated to human review.',
    '',
    `The upgrade lane has reached its failure cap (${maxFailures} bot-authored failure comments).`,
    '',
    'To re-arm: remove the `adw:blocked` label from this issue and clear the failure comments',
    '(or post `## Cancel` to clear all comments at once), then re-open the issue.',
    '',
    `**ADW ID:** \`${adwId}\``,
    `**Issue:** #${issueNumber}`,
  ].join('\n');
}

/**
 * Builds the escalation Slack alert.
 */
export function buildUpgradeEscalationSlack(repoInfo: RepoInfo, issueNumber: number, failureCount: number, maxFailures: number): string {
  return `:rotating_light: ADW upgrade escalated: *${repoInfo.owner}/${repoInfo.repo}* issue #${issueNumber} reached failure cap (${failureCount}/${maxFailures}). Remove \`adw:blocked\` label to re-arm.`;
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
  // Entry gate: if the terminal label is already present, this issue is already
  // escalated — exit immediately without any regen work (idempotent re-dispatch).
  const labels = deps.fetchIssueLabels(issueNumber);
  if (labels.includes(TERMINAL_LABEL)) {
    deps.log(`adwUpgrade: issue #${issueNumber} carries ${TERMINAL_LABEL}; already escalated — no work`, 'info');
    return { outcome: 'escalated', reason: 'already_escalated' };
  }

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

  // Idempotency guard: a claim branch that already has a PR (any state) has already reached
  // the PR stage — re-dispatch (cron routes adw:upgrade issues to this orchestrator every
  // tick) must not re-run regen or stack duplicate PRs. Only a claim with NO PR is genuinely
  // stalled (the orchestrator died before opening the PR) and safe to (re)build. This is what
  // makes that re-dispatch self-healing without a separate watchdog probe.
  const existingClaimPr = deps.findPRByBranch(branch, repoInfo);
  if (existingClaimPr && hasWontFixLabel(existingClaimPr)) {
    // Escape hatch for a flawed-but-merged upgrade: labeling the retired PR
    // `wontfix` disqualifies it from the guard so this hash can be rebuilt.
    // selectPreferredPR prefers OPEN, so once the rebuild opens a fresh PR the
    // guard below matches it again and idempotency self-heals. Reset (don't
    // delete) the claim branch first — ensureWorktree checks it out.
    deps.log(
      `adwUpgrade: claim branch ${branch} PR #${existingClaimPr.number} is labeled wontfix; rebuilding`,
      'info',
    );
  } else if (existingClaimPr) {
    deps.log(
      `adwUpgrade: claim branch ${branch} already has PR #${existingClaimPr.number} (${existingClaimPr.state}); no-op`,
      'info',
    );
    return { outcome: 'completed', reason: 'pr_already_exists' };
  }

  // Failure-cap escalation: placed after the PR-idempotency guard so a claim that
  // already has a PR returns pr_already_exists and never escalates.
  const failureCount = countUpgradeFailureComments(deps.fetchIssueComments(issueNumber));
  if (failureCount >= deps.maxFailures) {
    deps.ensureLabel(TERMINAL_LABEL, 'b60205', 'ADW lane escalated to human (terminal)');
    deps.applyLabel(issueNumber, TERMINAL_LABEL);   // durable idempotency signal first
    deps.moveToStatus(issueNumber, 'Blocked');        // best-effort; false on no board is non-fatal
    await deps.postSlack(buildUpgradeEscalationSlack(repoInfo, issueNumber, failureCount, deps.maxFailures));
    deps.commentOnIssue(issueNumber, buildUpgradeEscalationComment(adwId, issueNumber, deps.maxFailures), repoInfo);
    deps.log(`adwUpgrade: failure cap reached (${failureCount}/${deps.maxFailures}); escalated issue #${issueNumber}`, 'warn');
    return { outcome: 'escalated', reason: 'failure_cap_reached' };
  }

  const defaultBranch = deps.getDefaultBranch();

  // 3. Check out the existing remote claim branch, then reconcile it to the live
  //    remote claim tip. A reused worktree may sit on a superseded claim commit
  //    (a prior claim cycle re-created the branch with a new nonce); regenerating
  //    on that stale base produces a push that can never fast-forward (#627 then
  //    parks it). Resetting to origin/<claim-branch> makes the regen fast-forwardable.
  //    Hard reset is safe: the upgrade worktree is a throwaway regen target.
  let worktreePath: string;
  try {
    worktreePath = deps.ensureWorktree(branch, defaultBranch);
    deps.reconcileWorktreeToRemote(worktreePath, branch);
  } catch (error) {
    deps.commentOnIssue(
      issueNumber,
      buildUpgradeFailureComment(String(error), adwId, issueNumber),
      repoInfo,
    );
    return { outcome: 'failed', reason: 'worktree_error' };
  }

  // 4. Copy adw_init.md into the worktree so the /adw_init slash command resolves,
  //    then run it. The copy is gitignored so it stays out of the upgrade PR.
  deps.copyInitCommandToWorktree(worktreePath, frameworkRepoRoot);

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

  // 5b. Validity gate: verify that the six canonical .adw/ files are present and
  //     non-empty, and that features/regression/vocabulary.md exists.
  //     A legitimate no-op (byte-identical .adw/ regen) passes — the validity gate
  //     does not check authorship. No stamp + no PR = the next cron tick re-dispatches
  //     cleanly (idempotency guard sees no PR on the claim branch and re-runs regen).
  const verify = deps.verifyAdwRegen(worktreePath);
  if (!verify.ok) {
    deps.commentOnIssue(
      issueNumber,
      buildUpgradeFailureComment(
        `.adw/ regeneration incomplete: ${verify.missing.join(', ') || 'no .adw/ files produced'}`,
        adwId,
        issueNumber,
      ),
      repoInfo,
    );
    return { outcome: 'failed', reason: 'regen_incomplete' };
  }

  // 5c. Copy the starter guardrails settings.json into the worktree (skip if the target
  //     repo already has one) so it rides into the same regen commit as everything else.
  const starter = deps.copyStarterSettings(worktreePath, frameworkRepoRoot);
  deps.log(`adwUpgrade: starter guardrails settings ${starter.action} (${starter.destPath})`, 'info');

  // 6. Write .adw-version, commit the regen, push
  deps.writeAdwVersion(worktreePath, hash);
  try {
    deps.commitChanges(`chore: regenerate .adw/ for framework upgrade ${hash.slice(0, 12)}`, worktreePath, { excludePaths: ['.claude/commands/adw_init.md'] });
  } catch (error) {
    // A commit failure (e.g. the #729 gitignored-exclude class, or any other git error)
    // must not crash the orchestrator mid-run — that stops the heartbeat and leaves no
    // trace. Degrade to a handled, counted failure instead: the next cron redrive pass
    // re-invokes this same idempotency-guarded path.
    deps.commentOnIssue(
      issueNumber,
      buildUpgradeFailureComment(String(error), adwId, issueNumber),
      repoInfo,
    );
    return { outcome: 'failed', reason: 'commit_error' };
  }
  try {
    deps.pushBranch(branch, worktreePath);
  } catch (error) {
    // Non-fast-forward rejection: the remote claim branch advanced under us. Either a
    // concurrent claim cycle (different nonce) re-created it, or this worktree was reused
    // stale and built regen on a superseded claim commit. We must NOT force-push — that
    // clobbers the rightful claim owner. Park cleanly instead of crashing: the claim owner
    // carries the upgrade forward, and if it died the next cron re-dispatch finds no PR on
    // the branch and rebuilds (idempotency guard above). No comment — matches the silent
    // pr_already_exists "someone else owns this" path.
    if (deps.isPushRejection(error)) {
      deps.log(
        `adwUpgrade: push to claim branch ${branch} rejected (non-fast-forward) — another orchestrator owns this claim; parking as loser`,
        'warn',
      );
      return { outcome: 'completed', reason: 'claim_lost' };
    }
    // A genuine (non-rejection) push failure — auth, network, remote 500, etc. Same
    // handled-failure idiom as the commit-error path above: return, don't crash.
    deps.commentOnIssue(
      issueNumber,
      buildUpgradeFailureComment(String(error), adwId, issueNumber),
      repoInfo,
    );
    return { outcome: 'failed', reason: 'push_error' };
  }

  // 7. Open PR — no workflow comment; the PR is the success signal
  const pr = deps.createPullRequest({
    title: buildUpgradePrTitle(hash),
    body: buildUpgradePrBody(issueNumber, hash),
    sourceBranch: branch,
    targetBranch: deps.getDefaultBranch(),
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
    undefined,
    undefined,
    undefined,
    { selfHost: false, adwId: params.adwId },
  );
  return {
    success: result.success,
    error: result.success ? undefined : (result.output || 'LLM command failed'),
  };
}

function parseLabelNames(json: string): readonly string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return [];
    const arr = (parsed as Record<string, unknown>)['labels'];
    if (!Array.isArray(arr)) return [];
    return arr.map((l: unknown) => (typeof l === 'object' && l !== null && 'name' in l ? String((l as Record<string, unknown>)['name']) : '')).filter(Boolean);
  } catch {
    return [];
  }
}

function parseIssueComments(json: string): readonly IssueCommentRecord[] {
  try {
    const arr = JSON.parse(json) as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr.map((c: unknown) => ({
      body: typeof c === 'object' && c !== null && 'body' in c ? String((c as Record<string, unknown>)['body'] ?? '') : '',
      author: typeof c === 'object' && c !== null && 'user' in c && (c as Record<string, unknown>)['user'] !== null && typeof (c as Record<string, unknown>)['user'] === 'object' && 'login' in ((c as Record<string, unknown>)['user'] as object) ? String(((c as Record<string, unknown>)['user'] as Record<string, unknown>)['login'] ?? '') : '',
    }));
  } catch {
    return [];
  }
}

/** Builds the default UpgradeDeps using production implementations. */
function buildDefaultUpgradeDeps(repoId: RepoIdentifier, gitCtx: GitContext): UpgradeDeps {
  const codeHost = createGitHubCodeHost(repoId);
  return {
    computeFrameworkHash,
    ensureWorktree: (branch, baseBranch) => gitCtx.ensureWorktree(branch, baseBranch),
    reconcileWorktreeToRemote: (worktreePath, branch) => gitCtx.fetchAndResetToRemote(branch, worktreePath),
    getDefaultBranch: () => gitCtx.defaultBranch(),
    findPRByBranch: (branch, info) => defaultFindPRByBranch(branch, info),
    runInitCommand: runInitCommandDefault,
    copyInitCommandToWorktree: copyAdwInitCommandToWorktree,
    verifyAdwRegen,
    copyStarterSettings: copyStarterSettingsToWorktree,
    writeAdwVersion,
    commitChanges: (message, cwd, opts) => gitCtx.commitChanges(message, cwd, opts),
    pushBranch: (branch, cwd) => gitCtx.pushBranch(branch, cwd),
    isPushRejection: isPushRejectionError,
    createPullRequest: (options) => codeHost.createPullRequest(options),
    commentOnIssue,
    ensureLogsDirectory,
    log,
    readAdwYmlConfig,
    mergePR: (prNumber, info) => mergePR(prNumber, info),
    fetchIssueLabels: (issueNumber) => parseLabelNames(gitCtx.issueHasLabel(issueNumber, TERMINAL_LABEL)),
    fetchIssueComments: (issueNumber) => parseIssueComments(gitCtx.fetchIssueComments(issueNumber)),
    ensureLabel: (name, color, description) => gitCtx.createLabel(name, color, description),
    applyLabel: (issueNumber, label) => gitCtx.applyLabel(issueNumber, label),
    moveToStatus: (issueNumber, status) => gitCtx.moveIssueToStatus(issueNumber, status),
    postSlack,
    maxFailures: MAX_FAILURES,
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
  const gitCtx = await gitContextFor({ owner: repoId.owner, repo: repoId.repo, selfHost: !targetRepo });

  let result: UpgradeRunResult | undefined;
  const acquired = await runWithRawOrchestratorLifecycle(repoInfo, issueNumber, adwId, async () => {
    result = await executeUpgrade(
      issueNumber,
      adwId,
      repoInfo,
      baseRepoPath,
      frameworkRepoRoot,
      buildDefaultUpgradeDeps(repoId, gitCtx),
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
