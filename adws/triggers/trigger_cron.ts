/**
 * CRON trigger for ADW (AI Developer Workflow).
 *
 * Acts as a backlog sweeper: polls for deferred, missed, or newly-eligible
 * issues and processes them oldest-first with grace period, dependency,
 * and concurrency checks.
 * Start with: bunx tsx adws/triggers/trigger_cron.ts
 */

import { execSync, spawn } from 'child_process';
import { log, GRACE_PERIOD_MS, JANITOR_INTERVAL_CYCLES, HEARTBEAT_STALE_THRESHOLD_MS, HUNG_DETECTOR_INTERVAL_CYCLES, getTargetRepoWorkspacePath } from '../core';
import { findHungOrchestrators, type HungDetectorDeps } from '../core/hungOrchestratorDetector';
import { AgentStateManager } from '../core/agentState';
import { getRepoInfo, fetchPRList, hasUnaddressedComments, isCancelComment, activateGitHubAppAuth, refreshTokenIfNeeded } from '../github';

import { resolveIssueWorkflowStage } from './cronStageResolver';
import { handleCancelDirective } from './cancelHandler';
import { checkIssueEligibility } from './issueEligibility';
import { classifyAndSpawnWorkflow } from './webhookGatekeeper';
import { registerAndGuard } from './cronProcessGuard';
import { scanPauseQueue } from './pauseQueueScanner';
import { runJanitorPass } from './devServerJanitor';
import { resolveCronRepo, buildCronTargetRepoArgs } from './cronRepoResolver';
import { filterEligibleIssues } from './cronIssueFilter';

const POLL_INTERVAL_MS = 20_000;
const PR_POLL_INTERVAL_MS = 60_000;
const processedSpawns = new Set<number>();
const processedMerges = new Set<number>();
const processedPRs = new Set<number>();
let cycleCount = 0;

/** Raw issue data returned from the GitHub CLI. */
interface RawIssue {
  number: number;
  body: string;
  comments: { body: string }[];
  createdAt: string;
  updatedAt: string;
}


// Resolve repo identity from --target-repo CLI args (or fall back to local git remote).
const { repoInfo: cronRepoInfo, targetRepo } = resolveCronRepo(process.argv.slice(2), getRepoInfo);

// Activate GitHub App auth before any gh CLI calls only when running as the cron script.
// Skipped when trigger_cron.ts is imported as a module (e.g. by BDD step definitions).
if (process.argv[1]?.replace(/\\/g, '/').includes('trigger_cron')) {
  activateGitHubAppAuth(cronRepoInfo.owner, cronRepoInfo.repo);
}

/** Fetches all open issues with body, comments, and timestamps. */
function fetchOpenIssues(): RawIssue[] {
  const { owner, repo } = cronRepoInfo;
  try {
    const json = execSync(
      `gh issue list --repo ${owner}/${repo} --state open --json number,body,comments,createdAt,updatedAt --limit 100`,
      { encoding: 'utf-8' },
    );
    return JSON.parse(json);
  } catch (error) {
    log(`Failed to fetch issues: ${error}`, 'error');
    return [];
  }
}

/** Builds --target-repo args to pass to spawned workflows. */
function buildTargetRepoArgs(): string[] {
  return buildCronTargetRepoArgs(
    cronRepoInfo,
    targetRepo,
    () => { try { return execSync('git remote get-url origin', { encoding: 'utf-8' }).trim(); } catch { return null; } },
  );
}

/**
 * Hung-orchestrator sweep: detect wedged orchestrators, SIGKILL each, rewrite state to abandoned.
 * Exported so that integration tests can invoke the sweep logic directly without the cycle gate.
 * The optional `deps` parameter lets tests inject fake filesystem/liveness deps.
 */
export function runHungDetectorSweep(now: number, deps?: HungDetectorDeps): void {
  const hung = deps !== undefined
    ? findHungOrchestrators(now, HEARTBEAT_STALE_THRESHOLD_MS, deps)
    : findHungOrchestrators(now, HEARTBEAT_STALE_THRESHOLD_MS);
  for (const entry of hung) {
    log(`Hung orchestrator detected: adwId=${entry.adwId} pid=${entry.pid} stage=${entry.workflowStage} lastSeenAt=${entry.lastSeenAt}`, 'warn');
    try {
      process.kill(entry.pid, 'SIGKILL');
    } catch (err) {
      log(`SIGKILL failed for pid=${entry.pid}: ${err}`, 'warn');
    }
    try {
      AgentStateManager.writeTopLevelState(entry.adwId, { workflowStage: 'abandoned' });
    } catch (err) {
      log(`State rewrite failed for adwId=${entry.adwId}: ${err}`, 'warn');
    }
  }
}

/** Checks for eligible issues and triggers ADW workflows for each. */
async function checkAndTrigger(): Promise<void> {
  cycleCount += 1;

  // Scan pause queue every PROBE_INTERVAL_CYCLES cycles
  await scanPauseQueue(cycleCount);

  // Detect and abandon hung orchestrators every HUNG_DETECTOR_INTERVAL_CYCLES cycles
  if (cycleCount % HUNG_DETECTOR_INTERVAL_CYCLES === 0) {
    runHungDetectorSweep(Date.now());
  }

  // Run dev server janitor every JANITOR_INTERVAL_CYCLES cycles
  if (cycleCount % JANITOR_INTERVAL_CYCLES === 0) {
    await runJanitorPass();
  }

  const now = Date.now();
  const cancelledThisCycle = new Set<number>();
  const issues = fetchOpenIssues();

  // Scan all fetched issues for ## Cancel before filterEligibleIssues.
  // Cancelled issues are recorded in a per-cycle set so they are skipped
  // in this cycle and naturally re-evaluated on the next cycle.
  const cancelCwd = targetRepo
    ? getTargetRepoWorkspacePath(cronRepoInfo.owner, cronRepoInfo.repo)
    : undefined;
  for (const issue of issues) {
    const latestComment = issue.comments.length > 0 ? issue.comments[issue.comments.length - 1] : null;
    if (latestComment && isCancelComment(latestComment.body)) {
      handleCancelDirective(issue.number, issue.comments, cronRepoInfo, cancelCwd, { spawns: processedSpawns, merges: processedMerges });
      cancelledThisCycle.add(issue.number);
    }
  }

  const { eligible: candidates, filteredAnnotations } = filterEligibleIssues(
    issues,
    now,
    { spawns: processedSpawns, merges: processedMerges },
    GRACE_PERIOD_MS,
    resolveIssueWorkflowStage,
    cancelledThisCycle,
  );

  const candidateList = candidates.map(c => `#${c.issue.number}`).join(', ') || 'none';
  const filteredList = filteredAnnotations.join(', ') || 'none';
  log(`POLL: ${issues.length} open, ${candidates.length} candidate(s) [${candidateList}], filtered: ${filteredList}`);

  const repoInfo = cronRepoInfo;
  const targetRepoArgs = buildTargetRepoArgs();

  for (const candidate of candidates) {
    const { issue, action, adwId } = candidate;

    // awaiting_merge: spawn merge orchestrator directly, skipping dependency/concurrency checks
    if (action === 'merge' && adwId) {
      processedMerges.add(issue.number);
      log(`Spawning merge orchestrator for issue #${issue.number} adwId=${adwId}`, 'success');
      const child = spawn(
        'bunx',
        ['tsx', 'adws/adwMerge.tsx', String(issue.number), adwId, ...targetRepoArgs],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();
      continue;
    }

    // Standard spawn path: check eligibility (dependencies + concurrency)
    const eligibility = await checkIssueEligibility(issue.number, issue.body || '', repoInfo);
    if (!eligibility.eligible) {
      if (eligibility.reason === 'open_dependencies') {
        log(`Issue #${issue.number} deferred: open dependencies [${eligibility.blockingIssues?.join(', ')}]`);
      } else {
        log(`Issue #${issue.number} deferred: ${eligibility.reason}`);
      }
      // Don't add dependency-deferred issues to processedSpawns — re-check next cycle
      continue;
    }

    // Only add to processedSpawns when actually spawning the SDLC workflow.
    // The merge dedup is tracked separately in processedMerges so that an issue
    // spawned by this process can still be picked up by the merge path once it
    // transitions into awaiting_merge.
    processedSpawns.add(issue.number);

    log(`Triggering ADW workflow for backlog issue #${issue.number}${adwId ? ` (resuming adwId=${adwId})` : ''}`, 'success');
    await classifyAndSpawnWorkflow(issue.number, repoInfo, targetRepoArgs, adwId);
  }
}

/** Checks open PRs for actionable review comments and triggers PR review workflows. */
function checkPRsForReviewComments(): void {
  log('Polling for PRs with unaddressed review comments...');
  const prs = fetchPRList(cronRepoInfo);

  for (const pr of prs) {
    if (processedPRs.has(pr.number)) continue;
    try {
      if (hasUnaddressedComments(pr.number, cronRepoInfo)) {
        processedPRs.add(pr.number);
        log(`Triggering ADW PR Review for PR #${pr.number}`, 'success');
        const targetRepoArgs = buildTargetRepoArgs();
        const child = spawn('bunx', ['tsx', 'adws/adwPrReview.tsx', String(pr.number), ...targetRepoArgs], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
    } catch (error) {
      log(`Error checking PR #${pr.number}: ${error}`, 'error');
    }
  }
}

// Only start the cron loop when running as the entry script.
// When imported by tests (e.g. BDD step definitions import runHungDetectorSweep),
// this guard prevents process.exit() from terminating the test runner.
if (process.argv[1]?.replace(/\\/g, '/').includes('trigger_cron')) {
  const cronRepoKey = `${cronRepoInfo.owner}/${cronRepoInfo.repo}`;
  const canProceed = registerAndGuard(cronRepoKey, process.pid);
  if (!canProceed) {
    log(`Another cron process is already running for ${cronRepoKey}, exiting duplicate`, 'warn');
    process.exit(0);
  }

  log('CRON trigger (backlog sweeper) started');
  void checkAndTrigger();
  setInterval(() => { refreshTokenIfNeeded(); void checkAndTrigger(); }, POLL_INTERVAL_MS);
  checkPRsForReviewComments();
  setInterval(checkPRsForReviewComments, PR_POLL_INTERVAL_MS);
}
