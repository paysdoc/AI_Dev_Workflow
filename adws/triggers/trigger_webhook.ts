#!/usr/bin/env bunx tsx

/**
 * Webhook trigger for ADW (AI Developer Workflow).
 *
 * Acts as a real-time gatekeeper: evaluates incoming issues against
 * dependency and concurrency checks before admitting them for processing.
 * Start with: bunx tsx adws/triggers/trigger_webhook.ts
 */

import * as http from 'http';
import { log, PullRequestWebhookPayload, allocateRandomPort, isPortAvailable, getTargetRepoWorkspacePath, setTargetRepo, revertIssueCostFile, rebuildProjectCostCsv, getProjectCsvPath } from '../core';
import { fetchExchangeRates } from '../core/costReport';
import { commitAndPushCostFiles, pullLatestCostBranch } from '../github/gitOperations';
import { isActionableComment, isClearComment, isAdwRunningForIssue, truncateText, getRepoInfoFromPayload } from '../github';
import { clearIssueComments } from '../adwClearComments';
import { removeWorktreesForIssue } from '../github/worktreeOperations';
import { handlePullRequestEvent, wasMergedViaPR } from './webhookHandlers';
import { validateWebhookSignature } from './webhookSignature';
import { checkIssueEligibility } from './issueEligibility';
import { spawnDetached, classifyAndSpawnWorkflow, handleIssueClosedDependencyUnblock, ensureCronProcess, logDeferral } from './webhookGatekeeper';
import { checkEnvironmentVariables, checkGitRepository, checkClaudeCodeCLI, checkGitHubCLI, checkDirectoryStructure, type CheckResult } from '../healthCheckChecks';

// Re-export for any external consumers
export { handlePullRequestEvent, extractIssueNumberFromPRBody } from './webhookHandlers';
export { classifyAndSpawnWorkflow, handleIssueClosedDependencyUnblock, ensureCronProcess } from './webhookGatekeeper';

const PR_REVIEW_COOLDOWN_MS = 60_000;
const recentPrReviewTriggers = new Map<number, number>();

export function shouldTriggerPrReview(prNumber: number): boolean {
  const now = Date.now();
  const lastTrigger = recentPrReviewTriggers.get(prNumber);
  if (lastTrigger !== undefined && now - lastTrigger < PR_REVIEW_COOLDOWN_MS) return false;
  recentPrReviewTriggers.set(prNumber, now);
  return true;
}

export function resetPrReviewTriggers(): void { recentPrReviewTriggers.clear(); }
export function getPrReviewTriggersMap(): Map<number, number> { return recentPrReviewTriggers; }

function jsonResponse(res: http.ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  if (statusCode >= 400) log(`HTTP ${statusCode}: ${JSON.stringify(body)}`, 'error');
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

interface HealthCheckResult { success: boolean; timestamp: string; checks: Record<string, CheckResult>; warnings: string[]; errors: string[] }

function extractTargetRepoArgs(body: Record<string, unknown>): string[] {
  const repository = body.repository as Record<string, unknown> | undefined;
  if (!repository) return [];
  const fullName = repository.full_name as string | undefined;
  const cloneUrl = (repository.clone_url as string | undefined) || (repository.html_url as string | undefined);
  if (!fullName || !cloneUrl) return [];
  return ['--target-repo', fullName, '--clone-url', cloneUrl];
}

export async function handleIssueCostRevert(issueNumber: number, repoName: string): Promise<void> {
  if (wasMergedViaPR(issueNumber)) { log(`Skipping cost revert for issue #${issueNumber}: already handled by merged PR`); return; }
  try { pullLatestCostBranch(); } catch (error) { log(`Failed to pull latest before cost revert: ${error}`, 'error'); }
  const reverted = revertIssueCostFile(process.cwd(), repoName, issueNumber);
  if (reverted.length > 0) {
    const rates = await fetchExchangeRates(['EUR']);
    rebuildProjectCostCsv(process.cwd(), repoName, rates['EUR'] ?? 0);
    commitAndPushCostFiles({ repoName, paths: [...reverted, getProjectCsvPath(repoName)] });
    log(`Reverted cost CSV for issue #${issueNumber} in ${repoName}`, 'success');
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    const result: HealthCheckResult = { success: true, timestamp: new Date().toISOString(), checks: {}, warnings: [], errors: [] };
    result.checks.environmentVariables = checkEnvironmentVariables();
    result.checks.gitRepository = checkGitRepository();
    result.checks.claudeCodeCLI = checkClaudeCodeCLI();
    result.checks.gitHubCLI = checkGitHubCLI();
    result.checks.directoryStructure = checkDirectoryStructure();
    for (const [name, check] of Object.entries(result.checks)) {
      if (check.error) result.errors.push(`${name}: ${check.error}`);
      if (check.warning) result.warnings.push(`${name}: ${check.warning}`);
      if (!check.success) result.success = false;
    }
    jsonResponse(res, 200, result as unknown as Record<string, unknown>);
    return;
  }
  if (req.url !== '/webhook') { jsonResponse(res, 404, { error: 'not found' }); return; }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); jsonResponse(res, 405, { error: 'method not allowed' }); return; }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret) {
      const sigResult = validateWebhookSignature(rawBody, webhookSecret, req.headers['x-hub-signature-256'] as string | undefined);
      if (!sigResult.valid) { jsonResponse(res, 401, { error: 'invalid signature' }); return; }
    }
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody.toString()); } catch { jsonResponse(res, 400, { error: 'invalid json' }); return; }
    const event = req.headers['x-github-event'] as string | undefined;

    if (event === 'pull_request_review_comment' || event === 'pull_request_review') {
      const prNumber = (body.pull_request as Record<string, unknown> | undefined)?.number as number | undefined;
      if (prNumber == null) { jsonResponse(res, 200, { status: 'ignored' }); return; }
      const action = (body.action as string) || '';
      if (action !== 'created' && action !== 'submitted') { jsonResponse(res, 200, { status: 'ignored' }); return; }
      if (!shouldTriggerPrReview(prNumber)) { jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' }); return; }
      const repoFullName = (body.repository as Record<string, unknown> | undefined)?.full_name as string | undefined;
      if (repoFullName) setTargetRepo(getRepoInfoFromPayload(repoFullName));
      spawnDetached('bunx', ['tsx', 'adws/adwPrReview.tsx', String(prNumber), ...extractTargetRepoArgs(body)]);
      jsonResponse(res, 200, { status: 'triggered', pr: prNumber });
      return;
    }

    if (event === 'issue_comment') {
      if ((body.action as string) !== 'created') { jsonResponse(res, 200, { status: 'ignored' }); return; }
      const commentBody = ((body.comment as Record<string, unknown> | undefined)?.body as string) || '';
      const issue = body.issue as Record<string, unknown> | undefined;
      const issueNumber = issue?.number as number | undefined;
      if (issueNumber == null) { jsonResponse(res, 200, { status: 'ignored' }); return; }
      log(`Checking comment on issue #${issueNumber}: "${truncateText(commentBody, 100)}"`);
      const repoFullName = (body.repository as Record<string, unknown> | undefined)?.full_name as string | undefined;
      const webhookRepoInfo = repoFullName ? getRepoInfoFromPayload(repoFullName) : undefined;
      if (webhookRepoInfo) setTargetRepo(webhookRepoInfo);
      if (isClearComment(commentBody)) {
        const r = clearIssueComments(issueNumber, webhookRepoInfo);
        jsonResponse(res, 200, { status: 'cleared', issue: issueNumber, deleted: r.deleted });
        return;
      }
      if (!isActionableComment(commentBody)) { jsonResponse(res, 200, { status: 'ignored' }); return; }
      const commentTargetRepoArgs = extractTargetRepoArgs(body);
      isAdwRunningForIssue(issueNumber)
        .then(async (running) => {
          if (running) { log(`ADW already running for issue #${issueNumber}, deferring`); return; }
          if (webhookRepoInfo) {
            const eligibility = await checkIssueEligibility(issueNumber, (issue?.body as string) || '', webhookRepoInfo);
            if (!eligibility.eligible) { logDeferral(issueNumber, eligibility); return; }
            ensureCronProcess(webhookRepoInfo, commentTargetRepoArgs);
          }
          await classifyAndSpawnWorkflow(issueNumber, webhookRepoInfo, commentTargetRepoArgs);
        })
        .catch((error) => {
          log(`Error handling comment on issue #${issueNumber}: ${error}`, 'error');
          spawnDetached('bunx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...commentTargetRepoArgs]);
        });
      jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
      return;
    }

    if (event === 'pull_request') {
      if ((body.action as string) === 'closed') {
        const repoFullName = (body.repository as Record<string, unknown> | undefined)?.full_name as string | undefined;
        if (repoFullName) setTargetRepo(getRepoInfoFromPayload(repoFullName));
        handlePullRequestEvent(body as unknown as PullRequestWebhookPayload).catch((e) => log(`Error handling PR close: ${e}`, 'error'));
        jsonResponse(res, 200, { status: 'processing' });
        return;
      }
      jsonResponse(res, 200, { status: 'ignored' });
      return;
    }

    if (event !== 'issues') { jsonResponse(res, 200, { status: 'ignored' }); return; }
    const action = (body.action as string) || '';
    const issue = body.issue as Record<string, unknown> | undefined;
    const issueNumber = issue?.number as number | undefined;
    if (issueNumber == null) { jsonResponse(res, 200, { status: 'ignored' }); return; }

    if (action === 'closed') {
      const closedRepoFullName = (body.repository as Record<string, unknown> | undefined)?.full_name as string | undefined;
      if (closedRepoFullName) setTargetRepo(getRepoInfoFromPayload(closedRepoFullName));
      const closedTargetRepoArgs = extractTargetRepoArgs(body);
      const parts = (closedTargetRepoArgs.length >= 2 ? closedTargetRepoArgs[1] : undefined)?.split('/');
      const cwd = parts?.length === 2 ? getTargetRepoWorkspacePath(parts[0], parts[1]) : undefined;
      const removed = removeWorktreesForIssue(issueNumber, cwd);
      log(`Removed ${removed} worktree(s) for issue #${issueNumber}`, 'success');
      const repoName = (body.repository as Record<string, unknown> | undefined)?.name as string | undefined;
      if (repoName) handleIssueCostRevert(issueNumber, repoName).catch((e) => log(`Cost revert failed: ${e}`, 'error'));
      const closedRepoInfo = closedRepoFullName ? getRepoInfoFromPayload(closedRepoFullName) : undefined;
      if (closedRepoInfo) handleIssueClosedDependencyUnblock(issueNumber, closedRepoInfo, closedTargetRepoArgs).catch((e) => log(`Dependency unblock failed: ${e}`, 'error'));
      jsonResponse(res, 200, { status: 'worktrees_cleaned', issue: issueNumber, removed });
      return;
    }

    if (action === 'opened') {
      log(`New issue #${issueNumber} detected, evaluating eligibility`);
      const issueTargetRepoArgs = extractTargetRepoArgs(body);
      const issueRepoFullName = (body.repository as Record<string, unknown> | undefined)?.full_name as string | undefined;
      const issueRepoInfo = issueRepoFullName ? getRepoInfoFromPayload(issueRepoFullName) : undefined;
      if (issueRepoInfo) setTargetRepo(issueRepoInfo);
      (async () => {
        try {
          if (issueRepoInfo) {
            const eligibility = await checkIssueEligibility(issueNumber, (issue?.body as string) || '', issueRepoInfo);
            if (!eligibility.eligible) { logDeferral(issueNumber, eligibility); return; }
            ensureCronProcess(issueRepoInfo, issueTargetRepoArgs);
          }
          await classifyAndSpawnWorkflow(issueNumber, issueRepoInfo, issueTargetRepoArgs);
        } catch (error) {
          log(`Error processing issue #${issueNumber}: ${error}`, 'error');
          spawnDetached('bunx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...issueTargetRepoArgs]);
        }
      })();
      jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
      return;
    }
    jsonResponse(res, 200, { status: 'ignored' });
  });
});

export async function resolveWebhookPort(preferredPort: number): Promise<number> {
  if (await isPortAvailable(preferredPort, '0.0.0.0')) return preferredPort;
  if (process.env.GITHUB_WEBHOOK_SECRET) throw new Error(`Port ${preferredPort} is in use and GITHUB_WEBHOOK_SECRET is set (tunnel mode).`);
  log(`Port ${preferredPort} is in use, allocating a random available port...`, 'warn');
  return allocateRandomPort();
}

async function startServer(): Promise<void> {
  if (!process.env.GITHUB_WEBHOOK_SECRET) log('GITHUB_WEBHOOK_SECRET not set — webhook signature validation disabled', 'warn');
  const preferredPort = parseInt(process.env.PORT || '8001', 10);
  const actualPort = await resolveWebhookPort(preferredPort);
  server.once('error', async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      const retryPort = await allocateRandomPort();
      server.listen(retryPort, '0.0.0.0', () => log(`Webhook server listening on 0.0.0.0:${retryPort}`));
    } else throw err;
  });
  server.listen(actualPort, '0.0.0.0', () => log(`Webhook server listening on 0.0.0.0:${actualPort}`));
}

startServer().catch((error) => log(`Fatal error starting webhook server: ${error}`, 'error'));
