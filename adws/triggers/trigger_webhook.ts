#!/usr/bin/env bunx tsx

/**
 * Webhook trigger for ADW (AI Developer Workflow).
 *
 * Acts as a real-time gatekeeper: evaluates incoming issues against
 * dependency and concurrency checks before admitting them for processing.
 * Start with: bunx tsx adws/triggers/trigger_webhook.ts
 */

import * as http from 'http';
import { log, PullRequestWebhookPayload, allocateRandomPort, isPortAvailable, getTargetRepoWorkspacePath } from '../core';
import { isActionableComment, isCancelComment, isAdwRunningForIssue, truncateText, getRepoInfoFromPayload, getRepoInfo, fetchIssueCommentsRest, activateGitHubAppAuth, ensureAppAuthForRepo } from '../github';
import { handleCancelDirective } from './cancelHandler';
import { handlePullRequestEvent, handleIssueClosedEvent } from './webhookHandlers';
import { validateWebhookSignature } from './webhookSignature';
import { checkIssueEligibility } from './issueEligibility';
import { spawnDetached, classifyAndSpawnWorkflow, ensureCronProcess, logDeferral } from './webhookGatekeeper';
import { checkEnvironmentVariables, checkGitRepository, checkClaudeCodeCLI, checkGitHubCLI, checkDirectoryStructure, type CheckResult } from '../healthCheckChecks';

// Re-export for any external consumers
export { handlePullRequestEvent, handleIssueClosedEvent, extractIssueNumberFromBranch } from './webhookHandlers';
export { classifyAndSpawnWorkflow, handleIssueClosedDependencyUnblock, closeAbandonedDependents, ensureCronProcess } from './webhookGatekeeper';
export { shouldTriggerIssueWorkflow };

const PR_REVIEW_COOLDOWN_MS = 60_000;
const recentPrReviewTriggers = new Map<number, number>();

function shouldTriggerPrReview(prNumber: number): boolean {
  const now = Date.now();
  const lastTrigger = recentPrReviewTriggers.get(prNumber);
  if (lastTrigger !== undefined && now - lastTrigger < PR_REVIEW_COOLDOWN_MS) return false;
  recentPrReviewTriggers.set(prNumber, now);
  return true;
}

const ISSUE_COOLDOWN_MS = 60_000;
const recentIssueTriggers = new Map<number, number>();

function shouldTriggerIssueWorkflow(issueNumber: number): boolean {
  const now = Date.now();
  const lastTrigger = recentIssueTriggers.get(issueNumber);
  if (lastTrigger !== undefined && now - lastTrigger < ISSUE_COOLDOWN_MS) return false;
  recentIssueTriggers.set(issueNumber, now);
  return true;
}

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

    // Ensure app auth targets the correct repo/org for this request
    const webhookRepo = body.repository as Record<string, unknown> | undefined;
    if (webhookRepo) {
      const repoOwner = (webhookRepo.owner as Record<string, unknown> | undefined)?.login as string | undefined;
      const repoName = webhookRepo.name as string | undefined;
      if (repoOwner && repoName) ensureAppAuthForRepo(repoOwner, repoName);
    }

    const webhookRepoFullName = webhookRepo?.full_name as string | undefined;
    const webhookRepoInfo = webhookRepoFullName ? getRepoInfoFromPayload(webhookRepoFullName) : undefined;
    const webhookTargetRepoArgs = extractTargetRepoArgs(body);
    if (webhookRepoInfo) ensureCronProcess(webhookRepoInfo, webhookTargetRepoArgs);

    if (event === 'pull_request_review_comment') {
      const prNumber = (body.pull_request as Record<string, unknown> | undefined)?.number as number | undefined;
      if (prNumber == null) { jsonResponse(res, 200, { status: 'ignored' }); return; }
      if ((body.action as string) !== 'created') { jsonResponse(res, 200, { status: 'ignored' }); return; }
      if (!shouldTriggerPrReview(prNumber)) { jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' }); return; }
      spawnDetached('bunx', ['tsx', 'adws/adwPrReview.tsx', String(prNumber), ...webhookTargetRepoArgs]);
      jsonResponse(res, 200, { status: 'triggered', pr: prNumber });
      return;
    }

    if (event === 'pull_request_review') {
      const prNumber = (body.pull_request as Record<string, unknown> | undefined)?.number as number | undefined;
      if (prNumber == null) { jsonResponse(res, 200, { status: 'ignored' }); return; }
      if ((body.action as string) !== 'submitted') { jsonResponse(res, 200, { status: 'ignored' }); return; }
      const reviewState = ((body.review as Record<string, unknown> | undefined)?.state as string | undefined) || '';
      // Approved reviews are no-ops: merge is handled by cron + adwMerge.tsx
      if (reviewState === 'approved') { jsonResponse(res, 200, { status: 'ignored' }); return; }
      if (!shouldTriggerPrReview(prNumber)) { jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' }); return; }
      spawnDetached('bunx', ['tsx', 'adws/adwPrReview.tsx', String(prNumber), ...webhookTargetRepoArgs]);
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
      if (isCancelComment(commentBody)) {
        const cancelParts = (webhookTargetRepoArgs.length >= 2 ? webhookTargetRepoArgs[1] : undefined)?.split('/');
        const cancelCwd = cancelParts?.length === 2
          ? getTargetRepoWorkspacePath(cancelParts[0], cancelParts[1])
          : undefined;
        const allComments = webhookRepoInfo
          ? fetchIssueCommentsRest(issueNumber, webhookRepoInfo)
          : [];
        handleCancelDirective(issueNumber, allComments, webhookRepoInfo ?? getRepoInfo(), cancelCwd);
        jsonResponse(res, 200, { status: 'cancelled', issue: issueNumber });
        return;
      }
      if (!isActionableComment(commentBody)) { jsonResponse(res, 200, { status: 'ignored' }); return; }
      if (!shouldTriggerIssueWorkflow(issueNumber)) {
        log(`Issue #${issueNumber} cooldown active, ignoring duplicate webhook`);
        jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' });
        return;
      }
      isAdwRunningForIssue(issueNumber, webhookRepoInfo ?? getRepoInfo())
        .then(async (running) => {
          if (running) { log(`ADW already running for issue #${issueNumber}, deferring`); return; }
          if (webhookRepoInfo) {
            const eligibility = await checkIssueEligibility(issueNumber, (issue?.body as string) || '', webhookRepoInfo);
            if (!eligibility.eligible) { logDeferral(issueNumber, eligibility); return; }
          }
          await classifyAndSpawnWorkflow(issueNumber, webhookRepoInfo, webhookTargetRepoArgs);
        })
        .catch((error) => {
          log(`Error handling comment on issue #${issueNumber}: ${error}. Cron will retry.`, 'error');
        });
      jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
      return;
    }

    if (event === 'pull_request') {
      if ((body.action as string) === 'closed') {
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
      const parts = (webhookTargetRepoArgs.length >= 2 ? webhookTargetRepoArgs[1] : undefined)?.split('/');
      const cwd = parts?.length === 2 ? getTargetRepoWorkspacePath(parts[0], parts[1]) : undefined;
      handleIssueClosedEvent(issueNumber, webhookRepoInfo, cwd, webhookTargetRepoArgs)
        .then((result) => log(`Issue #${issueNumber} closed: worktrees=${result.worktreesRemoved}, branch=${result.branchDeleted}, status=${result.status}`))
        .catch((e) => log(`Issue close handler failed for #${issueNumber}: ${e}`, 'error'));
      jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
      return;
    }

    if (action === 'opened') {
      if (!shouldTriggerIssueWorkflow(issueNumber)) {
        jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' });
        return;
      }
      log(`New issue #${issueNumber} detected, evaluating eligibility`);
      (async () => {
        try {
          if (webhookRepoInfo) {
            const eligibility = await checkIssueEligibility(issueNumber, (issue?.body as string) || '', webhookRepoInfo);
            if (!eligibility.eligible) { logDeferral(issueNumber, eligibility); return; }
          }
          await classifyAndSpawnWorkflow(issueNumber, webhookRepoInfo, webhookTargetRepoArgs);
        } catch (error) {
          log(`Error processing issue #${issueNumber}: ${error}. Cron will retry.`, 'error');
        }
      })();
      jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
      return;
    }
    jsonResponse(res, 200, { status: 'ignored' });
  });
});

async function resolveWebhookPort(preferredPort: number): Promise<number> {
  if (await isPortAvailable(preferredPort, '0.0.0.0')) return preferredPort;
  if (process.env.GITHUB_WEBHOOK_SECRET) throw new Error(`Port ${preferredPort} is in use and GITHUB_WEBHOOK_SECRET is set (tunnel mode).`);
  log(`Port ${preferredPort} is in use, allocating a random available port...`, 'warn');
  return allocateRandomPort();
}

async function startServer(): Promise<void> {
  activateGitHubAppAuth();
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
