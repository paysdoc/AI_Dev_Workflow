/**
 * CRON trigger for ADW (AI Developer Workflow).
 *
 * Polls GitHub every 20 seconds for qualifying issues and
 * spawns adwPlanBuild.tsx for each. Start with: npx tsx adws/triggers/trigger_cron.ts
 */

import { execSync, spawn } from 'child_process';
import { log } from '../core';
import { getRepoInfo, fetchPRList, hasUnaddressedComments, isActionableComment, isAdwRunningForIssue, truncateText } from '../github';
import { classifyIssueForTrigger, getWorkflowScript } from '../core/issueClassifier';

const POLL_INTERVAL_MS = 20_000;
const PR_POLL_INTERVAL_MS = 60_000;
const processedIssues = new Set<number>();
const processedPRs = new Set<number>();

interface RawIssue {
  number: number;
  comments: { body: string }[];
  createdAt: string;
}

/** Cached repo info for the current polling session. */
const repoInfo = getRepoInfo();

function fetchOpenIssues(): RawIssue[] {
  const { owner, repo } = repoInfo;
  try {
    const json = execSync(
      `gh issue list --repo ${owner}/${repo} --state open --json number,comments,createdAt`,
      { encoding: 'utf-8' }
    );
    return JSON.parse(json);
  } catch (error) {
    log(`Failed to fetch issues: ${error}`, 'error');
    return [];
  }
}

/** Builds --target-repo args from the local repo info for consistency with webhook triggers. */
function buildTargetRepoArgs(): string[] {
  const { owner, repo } = repoInfo;
  const fullName = `${owner}/${repo}`;
  try {
    const cloneUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    return ['--target-repo', fullName, '--clone-url', cloneUrl];
  } catch {
    return ['--target-repo', fullName];
  }
}

function isQualifyingIssue(issue: RawIssue): boolean {
  if (issue.comments.length === 0) {
    log(`Issue #${issue.number}: no comments, qualifies`);
    return true;
  }

  const latestComment = issue.comments[issue.comments.length - 1];

  if (isActionableComment(latestComment.body)) {
    log(`Issue #${issue.number}: latest comment contains "## Take action" directive, qualifies`);
    return true;
  }

  log(`Issue #${issue.number}: latest comment does not contain "## Take action" directive (${truncateText(latestComment.body, 100)}), does not qualify`);
  return false;
}

async function checkAndTrigger(): Promise<void> {
  log('Polling for new issues...');
  const issues = fetchOpenIssues();
  log(`Fetched ${issues.length} open issue(s)`);
  const qualifying = issues.filter(
    (issue) => isQualifyingIssue(issue) && !processedIssues.has(issue.number)
  );
  log(`Found ${qualifying.length} qualifying issue(s) out of ${issues.length} open`);

  for (const issue of qualifying) {
    const running = await isAdwRunningForIssue(issue.number);
    if (running) {
      log(`ADW workflow already running for issue #${issue.number}, deferring`);
      continue;
    }

    processedIssues.add(issue.number);

    const classification = await classifyIssueForTrigger(issue.number);
    const workflowScript = getWorkflowScript(classification.issueType, classification.adwCommand);

    log(
      `Triggering ADW workflow for issue #${issue.number} (${classification.issueType} -> ${workflowScript})`,
      'success'
    );

    const adwIdArgs = classification.adwId ? [classification.adwId] : [];
    const targetRepoArgs = buildTargetRepoArgs();
    const child = spawn('npx', ['tsx', workflowScript, String(issue.number), ...adwIdArgs, '--issue-type', classification.issueType, ...targetRepoArgs], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  if (qualifying.length === 0) {
    log('No new qualifying issues found');
  }
}

function checkPRsForReviewComments(): void {
  log('Polling for PRs with unaddressed review comments...');
  const prs = fetchPRList();

  for (const pr of prs) {
    if (processedPRs.has(pr.number)) continue;

    try {
      if (hasUnaddressedComments(pr.number)) {
        processedPRs.add(pr.number);
        log(`Triggering ADW PR Review for PR #${pr.number}`, 'success');

        const targetRepoArgs = buildTargetRepoArgs();
        const child = spawn('npx', ['tsx', 'adws/adwPrReview.tsx', String(pr.number), ...targetRepoArgs], {
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

log('CRON trigger started');
void checkAndTrigger();
setInterval(() => void checkAndTrigger(), POLL_INTERVAL_MS);
checkPRsForReviewComments();
setInterval(checkPRsForReviewComments, PR_POLL_INTERVAL_MS);
