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
import { parseWorkflowStageFromComment } from '../core/workflowCommentParsing';

import { clearIssueComments } from '../adwClearComments';
import { checkIssueEligibility } from './issueEligibility';
import { classifyAndSpawnWorkflow } from './webhookGatekeeper';
import { registerAndGuard } from './cronProcessGuard';
import { scanPauseQueue } from './pauseQueueScanner';

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

/** Workflow stages that mean the issue is re-eligible for processing.
 *  Note: 'paused' is intentionally excluded — paused workflows are handled
 *  exclusively by the pause queue scanner (pauseQueueScanner.ts), not the
 *  backlog sweeper. Including it here would spawn a brand-new workflow from
 *  scratch while the scanner tries to resume the original. */
const RETRIABLE_STAGES = new Set(['error', 'review_failed', 'build_failed']);

/** Workflow stages that mean the issue is actively in-progress (exclude). */
const ACTIVE_STAGES = new Set([
  'starting', 'resuming', 'classified', 'branch_created',
  'plan_building', 'plan_created', 'planFile_created', 'plan_committing',
  'plan_validating', 'plan_aligning', 'implementing', 'build_progress',
  'implemented', 'implementation_committing', 'pr_creating',
  'review_running', 'review_patching', 'test_running', 'test_resolving',
  'document_running', 'install_running', 'resumed',
]);

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

/** Returns true if the issue was updated within the grace period. */
function isWithinGracePeriod(issue: RawIssue, now: number = Date.now()): boolean {
  const updatedAt = new Date(issue.updatedAt).getTime();
  return now - updatedAt < GRACE_PERIOD_MS;
}

/**
 * Returns the current ADW workflow stage for an issue by inspecting its latest ADW comment.
 * Returns null if the issue has no ADW comments.
 */
function getIssueWorkflowStage(issue: RawIssue): string | null {
  const adwComments = issue.comments.filter(c => isAdwComment(c.body));
  if (adwComments.length === 0) return null;
  const latest = adwComments[adwComments.length - 1];
  return parseWorkflowStageFromComment(latest.body);
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
  if (isWithinGracePeriod(issue, now)) {
    return { eligible: false, reason: 'grace_period' };
  }

  const stage = getIssueWorkflowStage(issue);
  if (stage === null) {
    // No ADW comment — fresh issue, eligible
    return { eligible: true };
  }
  if (stage === 'completed') {
    return { eligible: false, reason: 'completed' };
  }
  if (ACTIVE_STAGES.has(stage)) {
    return { eligible: false, reason: 'active' };
  }
  if (RETRIABLE_STAGES.has(stage)) {
    // Previously failed/paused — re-evaluate
    return { eligible: true };
  }
  // Any other ADW stage means in-flight or unknown — exclude
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
