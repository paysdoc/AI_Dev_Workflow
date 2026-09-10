#!/usr/bin/env bunx tsx

/**
 * Webhook trigger for ADW (AI Developer Workflow).
 *
 * Acts as a real-time gatekeeper: evaluates incoming issues against
 * dependency and concurrency checks before admitting them for processing.
 * Start with: bunx tsx adws/triggers/trigger_webhook.ts
 */

// Load .env explicitly at the entrypoint so secrets (SLACK_WEBHOOK_URL, …) are
// present regardless of runtime (node vs bun) or import ordering. Note: `.env`
// is already loaded transitively via the `../core` import below
// (config.ts → environment.ts → dotenv.config()); this line codifies that
// implicit contract at the entrypoint (issue #647, fix #3 — defensive only).
import '../core/environment';
import * as http from 'http';
import { log, PullRequestWebhookPayload, allocateRandomPort, isPortAvailable, getTargetRepoWorkspacePath, assertCwdIsRepoRoot, getGuardrailsProbeVerdict, type ProbeVerdict } from '../core';
import { isActionableComment, isCancelComment, isRetryComment, truncateText } from '../core/workflowCommentParsing';
import { isAdwRunningForIssue } from '../forge/workflowCommentsBase';
import { handleCancelDirective } from './cancelHandler';
import { handleRetryDirective } from './retryHandler';
import { handlePullRequestEvent, handleIssueClosedEvent, resolvePrReviewSpawn, defaultPrClosedDeps } from './webhookHandlers';
import { validateWebhookSignature } from './webhookSignature';
import { checkIssueEligibility } from './issueEligibility';
import { spawnDetached, classifyAndSpawnWorkflow, ensureCronProcess, logDeferral } from './webhookGatekeeper';
import { extractPayloadLabelNames, routeIssueOpened } from './issueOpenedRouter';
import { resolveWebhookRepo, buildEventBoundary, selfHostBoundary } from './webhookRepoResolver';
import type { LaunchBoundary } from '../core';
import type { TargetRepoInfo } from '../types/issueTypes';
import { checkEnvironmentVariables, checkGitRepository, checkClaudeCodeCLI, checkGitHubCLI, checkDirectoryStructure, type CheckResult } from '../healthCheckChecks';
import { readAuthGate, writeAuthGate } from '../core/authGate';
import { AuthRequiredError } from '../types/agentTypes';
import { describeWebhookEvent, reportWebhookEventFailure, safeParseWebhookBody } from './webhookEventBoundary';

// Re-export for any external consumers
export { handlePullRequestEvent, handleIssueClosedEvent, extractIssueNumberFromBranch } from './webhookHandlers';
export { classifyAndSpawnWorkflow, closeAbandonedDependents, ensureCronProcess } from './webhookGatekeeper';
export { handleIssueClosedDependencyUnblock } from './issueClosedUnblockRouter';
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

/**
 * Maps a guardrails startup probe verdict to a `CheckResult`. A failed probe is
 * reported as a `warning`, not an `error` — the probe is fail-open by design
 * (see guardrailsGate.ts), so a failure means target-repo runs proceed WITHOUT
 * injected guardrails, not that the service itself is unhealthy.
 */
function guardrailsProbeCheckResult(verdict: ProbeVerdict): CheckResult {
  if (verdict.ok) return { success: true, details: {} };
  return {
    success: true,
    warning: `Guardrails probe failed (fail-open — target-repo runs proceed without injected guardrails): ${verdict.detail ?? 'unknown reason'}`,
    details: {},
  };
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    (async () => {
      const result: HealthCheckResult = { success: true, timestamp: new Date().toISOString(), checks: {}, warnings: [], errors: [] };
      // Construct a self-host boundary for git and forge probes; degrade gracefully on failure.
      const boundary = selfHostBoundary();
      const healthCtx = boundary?.gitContext;
      let codeHost: import('../providers/types').CodeHost | undefined;
      try {
        codeHost = boundary?.providers.codeHost;
      } catch { /* lazy provider mint failed — the forge probe gets a failure result */ }
      const ctxFailure: CheckResult = { success: false, error: 'GitContext construction failed', details: {} };
      result.checks.environmentVariables = checkEnvironmentVariables();
      result.checks.gitRepository = healthCtx ? checkGitRepository(healthCtx) : ctxFailure;
      result.checks.claudeCodeCLI = checkClaudeCodeCLI();
      result.checks.gitHubCLI = codeHost ? checkGitHubCLI(codeHost) : ctxFailure;
      result.checks.directoryStructure = checkDirectoryStructure();
      result.checks.guardrailsProbe = guardrailsProbeCheckResult(await getGuardrailsProbeVerdict());
      for (const [name, check] of Object.entries(result.checks)) {
        if (check.error) result.errors.push(`${name}: ${check.error}`);
        if (check.warning) result.warnings.push(`${name}: ${check.warning}`);
        if (!check.success) result.success = false;
      }
      jsonResponse(res, 200, result as unknown as Record<string, unknown>);
    })().catch((error) => {
      log(`Health check failed: ${error}`, 'error');
      if (!res.headersSent) jsonResponse(res, 500, { error: 'health check failed' });
    });
    return;
  }
  if (req.url !== '/webhook') { jsonResponse(res, 404, { error: 'not found' }); return; }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); jsonResponse(res, 405, { error: 'method not allowed' }); return; }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    try {
      dispatchWebhookEvent(req, res, rawBody);
    } catch (error) {
      containEventFailure(error, res, rawBody, req.headers['x-github-event'] as string | undefined);
    }
  });
});

/** Dispatches one webhook delivery — any throw must be caught by the caller (containEventFailure). Exported, with an injectable `mintEventBoundary` (default: the real `buildEventBoundary`), so BDD steps can drive it directly without a real HTTP server. */
export function dispatchWebhookEvent(
  req: http.IncomingMessage, res: http.ServerResponse, rawBody: Buffer,
  mintEventBoundary: (targetRepo: TargetRepoInfo | null) => LaunchBoundary | undefined = buildEventBoundary,
): void {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (webhookSecret) {
    const sigResult = validateWebhookSignature(rawBody, webhookSecret, req.headers['x-hub-signature-256'] as string | undefined);
    if (!sigResult.valid) { jsonResponse(res, 401, { error: 'invalid signature' }); return; }
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody.toString()); } catch { jsonResponse(res, 400, { error: 'invalid json' }); return; }
  const event = req.headers['x-github-event'] as string | undefined;
  const eventContext = describeWebhookEvent(event, body);

  const resolution = resolveWebhookRepo(body);
  const webhookTargetRepoArgs = resolution?.targetRepoArgs ?? [];

  // Exactly one immutable LaunchBoundary per event, built synchronously before any
  // await — the only sanctioned construction site on this path (never the process-global).
  const eventBoundary = resolution ? mintEventBoundary(resolution.targetRepo) : undefined;
  if (resolution) ensureCronProcess(resolution.repoInfo, webhookTargetRepoArgs);
  // issue_comment alone keeps the pre-boundary self-host fallback: only when the payload
  // named NO repository (resolution === null) — never when a named repo's boundary failed to mint.
  const commentBoundary = eventBoundary ?? (resolution ? undefined : selfHostBoundary());

  if (event === 'pull_request_review_comment') {
    if (readAuthGate() !== null) {
      jsonResponse(res, 200, { status: 'ignored', reason: 'auth_gate_set' });
      return;
    }
    const prNumber = (body.pull_request as Record<string, unknown> | undefined)?.number as number | undefined;
    if (prNumber == null) { jsonResponse(res, 200, { status: 'ignored' }); return; }
    if ((body.action as string) !== 'created') { jsonResponse(res, 200, { status: 'ignored' }); return; }
    if (!shouldTriggerPrReview(prNumber)) { jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' }); return; }
    if (!eventBoundary) { jsonResponse(res, 200, { status: 'ignored', reason: 'no_repository' }); return; }
    const prrcTarget = resolvePrReviewSpawn(prNumber, eventBoundary.providers);
    if (prrcTarget === null) { jsonResponse(res, 200, { status: 'ignored', reason: 'not_issue_linked' }); return; }
    spawnDetached('bunx', ['tsx', 'adws/adwPrReview.tsx', String(prrcTarget.issueNumber), prrcTarget.adwId, ...webhookTargetRepoArgs]);
    jsonResponse(res, 200, { status: 'triggered', pr: prNumber });
    return;
  }

  if (event === 'pull_request_review') {
    if (readAuthGate() !== null) {
      jsonResponse(res, 200, { status: 'ignored', reason: 'auth_gate_set' });
      return;
    }
    const prNumber = (body.pull_request as Record<string, unknown> | undefined)?.number as number | undefined;
    if (prNumber == null) { jsonResponse(res, 200, { status: 'ignored' }); return; }
    if ((body.action as string) !== 'submitted') { jsonResponse(res, 200, { status: 'ignored' }); return; }
    const reviewState = ((body.review as Record<string, unknown> | undefined)?.state as string | undefined) || '';
    // Approved reviews are no-ops: merge is handled by cron + adwMerge.tsx
    if (reviewState === 'approved') { jsonResponse(res, 200, { status: 'ignored' }); return; }
    if (!shouldTriggerPrReview(prNumber)) { jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' }); return; }
    if (!eventBoundary) { jsonResponse(res, 200, { status: 'ignored', reason: 'no_repository' }); return; }
    const prrTarget = resolvePrReviewSpawn(prNumber, eventBoundary.providers);
    if (prrTarget === null) { jsonResponse(res, 200, { status: 'ignored', reason: 'not_issue_linked' }); return; }
    spawnDetached('bunx', ['tsx', 'adws/adwPrReview.tsx', String(prrTarget.issueNumber), prrTarget.adwId, ...webhookTargetRepoArgs]);
    jsonResponse(res, 200, { status: 'triggered', pr: prNumber });
    return;
  }

  if (event === 'issue_comment') {
    if (readAuthGate() !== null) {
      jsonResponse(res, 200, { status: 'ignored', reason: 'auth_gate_set' });
      return;
    }
    if ((body.action as string) !== 'created') { jsonResponse(res, 200, { status: 'ignored' }); return; }
    const commentBody = ((body.comment as Record<string, unknown> | undefined)?.body as string) || '';
    const issue = body.issue as Record<string, unknown> | undefined;
    const issueNumber = issue?.number as number | undefined;
    if (issueNumber == null) { jsonResponse(res, 200, { status: 'ignored' }); return; }
    log(`Checking comment on issue #${issueNumber}: "${truncateText(commentBody, 100)}"`);
    if (!commentBoundary) {
      // A repository was named but its boundary could not be minted — report it
      // rather than silently redirecting to the self-host identity (Finding 1/2).
      jsonResponse(res, 200, { status: 'ignored', reason: 'boundary_unavailable' });
      return;
    }
    if (isCancelComment(commentBody)) {
      const cancelParts = (webhookTargetRepoArgs.length >= 2 ? webhookTargetRepoArgs[1] : undefined)?.split('/');
      const cancelCwd = cancelParts?.length === 2
        ? getTargetRepoWorkspacePath(cancelParts[0], cancelParts[1])
        : undefined;
      const allComments = commentBoundary.providers.issueTracker.fetchComments(issueNumber);
      handleCancelDirective(issueNumber, allComments, commentBoundary, cancelCwd);
      jsonResponse(res, 200, { status: 'cancelled', issue: issueNumber });
      return;
    }
    if (isRetryComment(commentBody)) {
      const allComments = commentBoundary.providers.issueTracker.fetchComments(issueNumber);
      handleRetryDirective(issueNumber, allComments);
      jsonResponse(res, 200, { status: 'retry_reset', issue: issueNumber });
      return;
    }
    if (!isActionableComment(commentBody)) { jsonResponse(res, 200, { status: 'ignored' }); return; }
    if (!shouldTriggerIssueWorkflow(issueNumber)) {
      log(`Issue #${issueNumber} cooldown active, ignoring duplicate webhook`);
      jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' });
      return;
    }
    isAdwRunningForIssue(issueNumber, commentBoundary.providers.issueTracker)
      .then(async (running) => {
        if (running) { log(`ADW already running for issue #${issueNumber}, deferring`); return; }
        if (eventBoundary) {
          const eligibility = await checkIssueEligibility(issueNumber, (issue?.body as string) || '', eventBoundary.providers);
          if (!eligibility.eligible) { logDeferral(issueNumber, eligibility); return; }
        }
        try {
          await classifyAndSpawnWorkflow(issueNumber, commentBoundary, webhookTargetRepoArgs);
        } catch (err) {
          if (err instanceof AuthRequiredError) {
            writeAuthGate({ adwId: null, issueNumber, agentName: err.agentName });
            log(`Auth gate set inside webhook handler (issue #${issueNumber}): ${err.message}`, 'warn');
            return;
          }
          throw err;
        }
      })
      .catch((error) => {
        reportWebhookEventFailure(eventContext, error);
      });
    jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
    return;
  }

  if (event === 'pull_request') {
    if ((body.action as string) === 'closed') {
      if (!eventBoundary) { jsonResponse(res, 200, { status: 'ignored', reason: 'no_repository' }); return; }
      handlePullRequestEvent(body as unknown as PullRequestWebhookPayload, defaultPrClosedDeps(eventBoundary.providers.issueTracker)).catch((e) => reportWebhookEventFailure(eventContext, e));
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
    handleIssueClosedEvent(issueNumber, eventBoundary, cwd, webhookTargetRepoArgs)
      .then((result) => log(`Issue #${issueNumber} closed: worktrees=${result.worktreesRemoved}, branch=${result.branchDeleted}, status=${result.status}`))
      .catch((e) => reportWebhookEventFailure(eventContext, e));
    jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
    return;
  }

  if (action === 'opened') {
    if (readAuthGate() !== null) {
      jsonResponse(res, 200, { status: 'ignored', reason: 'auth_gate_set' });
      return;
    }
    if (!eventBoundary) { jsonResponse(res, 200, { status: 'ignored', reason: 'no_repository' }); return; }
    if (!shouldTriggerIssueWorkflow(issueNumber)) {
      jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' });
      return;
    }
    log(`New issue #${issueNumber} detected, routing by adw:* labels`);
    (async () => {
      try {
        const labelNames = extractPayloadLabelNames(issue);
        await routeIssueOpened({
          issueNumber,
          issueBody: (issue?.body as string) || '',
          issueTitle: (issue?.title as string) || undefined,
          labelNames,
          boundary: eventBoundary,
          targetRepoArgs: webhookTargetRepoArgs,
        });
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          writeAuthGate({ adwId: null, issueNumber, agentName: error.agentName });
          log(`Auth gate set inside webhook handler (issue #${issueNumber}): ${error.message}`, 'warn');
          return;
        }
        reportWebhookEventFailure(eventContext, error);
      }
    })();
    jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
    return;
  }
  jsonResponse(res, 200, { status: 'ignored' });
}

/**
 * Contains a synchronous per-event dispatch failure: reports it, then answers 500
 * so GitHub's delivery log shows a real failure instead of a dropped connection.
 * Never throws — a throw here would kill the server, which is the bug (#776).
 */
function containEventFailure(error: unknown, res: http.ServerResponse, rawBody: Buffer, event: string | undefined): void {
  const context = describeWebhookEvent(event, safeParseWebhookBody(rawBody));
  reportWebhookEventFailure(context, error);
  if (res.headersSent) return;
  try {
    jsonResponse(res, 500, { error: 'event handler failed', event: context.event, issue: context.issueNumber });
  } catch (responseError) {
    log(`Webhook 500 response could not be sent: ${responseError}`, 'error');
  }
}

async function resolveWebhookPort(preferredPort: number): Promise<number> {
  if (await isPortAvailable(preferredPort, '0.0.0.0')) return preferredPort;
  if (process.env.GITHUB_WEBHOOK_SECRET) throw new Error(`Port ${preferredPort} is in use and GITHUB_WEBHOOK_SECRET is set (tunnel mode).`);
  log(`Port ${preferredPort} is in use, allocating a random available port...`, 'warn');
  return allocateRandomPort();
}

async function startServer(): Promise<void> {
  assertCwdIsRepoRoot();
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

// Entry-script guard (trigger_cron.ts's cronBoundary idiom) — no real port bind on test import.
if (process.argv[1]?.replace(/\\/g, '/').includes('trigger_webhook')) {
  startServer().catch((error) => log(`Fatal error starting webhook server: ${error}`, 'error'));
}
