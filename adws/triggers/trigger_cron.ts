/**
 * CRON trigger for ADW (AI Developer Workflow).
 *
 * Acts as a backlog sweeper: polls for deferred, missed, or newly-eligible
 * issues and processes them oldest-first with grace period, dependency,
 * and concurrency checks.
 * Start with: bunx tsx adws/triggers/trigger_cron.ts
 */

import { execSync, spawn } from 'child_process';
import { log, GRACE_PERIOD_MS } from '../core';
import { getRepoInfo, fetchPRList, hasUnaddressedComments, isClearComment, activateGitHubAppAuth, refreshTokenIfNeeded } from '../github';
import { resolveIssueWorkflowStage, isActiveStage, isRetriableStage } from './cronStageResolver';

import { clearIssueComments } from '../adwClearComments';
import { checkIssueEligibility } from './issueEligibility';
import { classifyAndSpawnWorkflow } from './webhookGatekeeper';
import { registerAndGuard } from './cronProcessGuard';
import { scanPauseQueue } from './pauseQueueScanner';
import { resolveCronRepo, buildCronTargetRepoArgs } from './cronRepoResolver';

const POLL_INTERVAL_MS = 20_000;
const PR_POLL_INTERVAL_MS = 60_000;
const processedIssues = new Set<number>();
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

// Activate GitHub App auth before any gh CLI calls (pass target repo so the
// correct installation token is obtained when running for a non-local repo).
activateGitHubAppAuth(cronRepoInfo.owner, cronRepoInfo.repo);

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


/** Filter result for explaining why an issue was excluded. */
interface FilterResult {
  eligible: boolean;
  reason?: string;
}

/** Determines if an issue should be processed by the cron backlog sweeper. */
function evaluateIssue(issue: RawIssue, now: number): FilterResult {
  if (processedIssues.has(issue.number)) {
    return { eligible: false, reason: 'processed' };
  }

  const resolution = resolveIssueWorkflowStage(issue.comments);
  // Prefer state file phase timestamp; fall back to issue.updatedAt for fresh issues
  const activityMs = resolution.lastActivityMs ?? new Date(issue.updatedAt).getTime();
  if (now - activityMs < GRACE_PERIOD_MS) {
    return { eligible: false, reason: 'grace_period' };
  }

  const { stage } = resolution;
  if (stage === null) {
    // No adw-id in comments, or no state file — fresh issue, eligible
    return { eligible: true };
  }
  if (stage === 'completed') {
    return { eligible: false, reason: 'completed' };
  }
  // Paused workflows are handled exclusively by the pause queue scanner
  // (pauseQueueScanner.ts), not the backlog sweeper. Including paused here
  // would spawn a brand-new workflow while the scanner tries to resume the original.
  if (stage === 'paused') {
    return { eligible: false, reason: 'paused' };
  }
  if (isActiveStage(stage)) {
    return { eligible: false, reason: 'active' };
  }
  if (isRetriableStage(stage)) {
    return { eligible: true };
  }
  // Unknown stage — exclude
  return { eligible: false, reason: `adw_stage:${stage}` };
}

/**
 * Filters and sorts issues for backlog sweep processing.
 * Returns eligible issues sorted oldest-first.
 * Builds an annotation map of excluded issues for verbose logging.
 */
function filterEligibleIssues(
  issues: RawIssue[],
  now: number = Date.now(),
): { eligible: RawIssue[]; filteredAnnotations: string[] } {
  const eligible: RawIssue[] = [];
  const filteredAnnotations: string[] = [];

  for (const issue of issues) {
    const result = evaluateIssue(issue, now);
    if (result.eligible) {
      eligible.push(issue);
    } else {
      filteredAnnotations.push(`#${issue.number}(${result.reason})`);
    }
  }

  eligible.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return { eligible, filteredAnnotations };
}

/** Checks for eligible issues and triggers ADW workflows for each. */
async function checkAndTrigger(): Promise<void> {
  cycleCount += 1;

  // Scan pause queue every PROBE_INTERVAL_CYCLES cycles
  await scanPauseQueue(cycleCount);

  const now = Date.now();
  const issues = fetchOpenIssues();
  const { eligible: candidates, filteredAnnotations } = filterEligibleIssues(issues, now);

  const candidateList = candidates.map(i => `#${i.number}`).join(', ') || 'none';
  const filteredList = filteredAnnotations.join(', ') || 'none';
  log(`POLL: ${issues.length} open, ${candidates.length} candidate(s) [${candidateList}], filtered: ${filteredList}`);

  const repoInfo = cronRepoInfo;
  const targetRepoArgs = buildTargetRepoArgs();

  for (const issue of candidates) {
    // Check eligibility (dependencies + concurrency)
    const eligibility = await checkIssueEligibility(issue.number, issue.body || '', repoInfo);
    if (!eligibility.eligible) {
      if (eligibility.reason === 'open_dependencies') {
        log(`Issue #${issue.number} deferred: open dependencies [${eligibility.blockingIssues?.join(', ')}]`);
      } else {
        log(`Issue #${issue.number} deferred: ${eligibility.reason}`);
      }
      // Don't add dependency-deferred issues to processedIssues — re-check next cycle
      continue;
    }

    // Only add to processedIssues when actually spawning
    processedIssues.add(issue.number);

    // Handle clear directive before spawning
    const latestComment = issue.comments.length > 0 ? issue.comments[issue.comments.length - 1] : null;
    if (latestComment && isClearComment(latestComment.body)) {
      log(`Clear directive on issue #${issue.number}, clearing comments before spawning`);
      const clearResult = clearIssueComments(issue.number, repoInfo);
      log(`Cleared ${clearResult.deleted}/${clearResult.total} comments on issue #${issue.number}`);
    }

    log(`Triggering ADW workflow for backlog issue #${issue.number}`, 'success');
    await classifyAndSpawnWorkflow(issue.number, repoInfo, targetRepoArgs);
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
