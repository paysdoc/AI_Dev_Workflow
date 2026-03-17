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
import { getRepoInfo, fetchPRList, hasUnaddressedComments, isClearComment, isAdwComment, activateGitHubAppAuth, refreshTokenIfNeeded, type RepoInfo } from '../github';

import { clearIssueComments } from '../adwClearComments';
import { checkIssueEligibility } from './issueEligibility';
import { classifyAndSpawnWorkflow } from './webhookGatekeeper';
import { registerAndGuard } from './cronProcessGuard';

const POLL_INTERVAL_MS = 20_000;
const PR_POLL_INTERVAL_MS = 60_000;
const processedIssues = new Set<number>();
const processedPRs = new Set<number>();

/** Raw issue data returned from the GitHub CLI. */
interface RawIssue {
  number: number;
  body: string;
  comments: { body: string }[];
  createdAt: string;
  updatedAt: string;
}

// Activate GitHub App auth before any gh CLI calls
activateGitHubAppAuth();

/** Resolved repo info for this cron process, derived from local git remote. */
const cronRepoInfo: RepoInfo = getRepoInfo();

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

/** Builds --target-repo args from the local repo info. */
function buildTargetRepoArgs(): string[] {
  const { owner, repo } = cronRepoInfo;
  const fullName = `${owner}/${repo}`;
  try {
    const cloneUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    return ['--target-repo', fullName, '--clone-url', cloneUrl];
  } catch {
    return ['--target-repo', fullName];
  }
}

/** Returns true if the issue has any ADW workflow comment (already picked up). */
function hasAdwWorkflowComment(issue: RawIssue): boolean {
  return issue.comments.some((c) => isAdwComment(c.body));
}

/** Returns true if the issue was updated within the grace period. */
function isWithinGracePeriod(issue: RawIssue, now: number = Date.now()): boolean {
  const updatedAt = new Date(issue.updatedAt).getTime();
  return now - updatedAt < GRACE_PERIOD_MS;
}

/**
 * Filters and sorts issues for backlog sweep processing.
 * Returns issues that:
 * 1. Have no ADW workflow comments (never picked up)
 * 2. Were not recently updated (grace period)
 * 3. Haven't been processed in this session
 * Sorted by createdAt ascending (oldest first).
 */
function filterEligibleIssues(issues: RawIssue[], now: number = Date.now()): RawIssue[] {
  return issues
    .filter((issue) => !processedIssues.has(issue.number))
    .filter((issue) => !hasAdwWorkflowComment(issue))
    .filter((issue) => !isWithinGracePeriod(issue, now))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** Checks for eligible issues and triggers ADW workflows for each. */
async function checkAndTrigger(): Promise<void> {
  log('Polling for backlog issues...');
  const issues = fetchOpenIssues();
  log(`Fetched ${issues.length} open issue(s)`);

  const candidates = filterEligibleIssues(issues);
  log(`Found ${candidates.length} candidate issue(s) after filtering`);

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
      continue;
    }

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

  if (candidates.length === 0) {
    log('No eligible backlog issues found');
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
