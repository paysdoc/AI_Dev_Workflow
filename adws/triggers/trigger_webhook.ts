#!/usr/bin/env npx tsx

/**
 * Webhook trigger for ADW (AI Developer Workflow).
 *
 * Receives GitHub webhook events and spawns adwPlanBuild.tsx
 * for new issues and adwPrReview.tsx for PR review comments.
 * Start with: npx tsx adws/triggers/trigger_webhook.ts
 */

import * as http from 'http';
import { spawn } from 'child_process';
import { log, PullRequestWebhookPayload, allocateRandomPort, isPortAvailable } from '../core';
import { isActionableComment, isAdwRunningForIssue, truncateText } from '../github';
import { removeWorktreesForIssue } from '../github/worktreeOperations';
import { classifyIssueForTrigger, getWorkflowScript } from '../core/issueClassifier';
import { handlePullRequestEvent } from './webhookHandlers';
import {
  checkEnvironmentVariables,
  checkGitRepository,
  checkClaudeCodeCLI,
  checkGitHubCLI,
  checkDirectoryStructure,
  type CheckResult,
} from '../healthCheckChecks';

// Re-export for any external consumers
export { handlePullRequestEvent, extractIssueNumberFromPRBody } from './webhookHandlers';

const HTTP_STATUS_DESCRIPTIONS: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  405: 'Method Not Allowed',
};

function jsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  if (statusCode >= 400) {
    const description = HTTP_STATUS_DESCRIPTIONS[statusCode] || 'Error';
    log(`HTTP ${statusCode} ${description}: ${JSON.stringify(body)}`, 'error');
  }
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

interface HealthCheckResult {
  success: boolean;
  timestamp: string;
  checks: Record<string, CheckResult>;
  warnings: string[];
  errors: string[];
}

function spawnDetached(command: string, args: string[]): void {
  log(`Spawning: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    detached: true,
    stdio: 'inherit',
  });
  child.unref();
}

/**
 * Extracts target repo CLI arguments from a webhook payload's repository field.
 * Returns `['--target-repo', 'owner/repo', '--clone-url', 'https://...']` when available,
 * or an empty array if the payload has no repository information.
 */
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
    const result: HealthCheckResult = {
      success: true,
      timestamp: new Date().toISOString(),
      checks: {},
      warnings: [],
      errors: [],
    };

    result.checks.environmentVariables = checkEnvironmentVariables();
    result.checks.gitRepository = checkGitRepository();
    result.checks.claudeCodeCLI = checkClaudeCodeCLI();
    result.checks.gitHubCLI = checkGitHubCLI();
    result.checks.directoryStructure = checkDirectoryStructure();

    for (const [checkName, checkResult] of Object.entries(result.checks)) {
      if (checkResult.error) {
        result.errors.push(`${checkName}: ${checkResult.error}`);
      }
      if (checkResult.warning) {
        result.warnings.push(`${checkName}: ${checkResult.warning}`);
      }
      if (!checkResult.success) {
        result.success = false;
      }
    }

    jsonResponse(res, 200, result as unknown as Record<string, unknown>);
    return;
  }

  if (req.url !== '/webhook') {
    jsonResponse(res, 404, { error: 'not found' });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    jsonResponse(res, 405, { error: 'method not allowed' });
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      jsonResponse(res, 400, { error: 'invalid json' });
      return;
    }

    const event = req.headers['x-github-event'] as string | undefined;

    // Handle PR review comment events
    if (event === 'pull_request_review_comment' || event === 'pull_request_review') {
      const pr = (body.pull_request as Record<string, unknown> | undefined);
      const prNumber = pr?.number as number | undefined;
      if (prNumber == null) {
        log('No PR number found in payload');
        jsonResponse(res, 200, { status: 'ignored' });
        return;
      }

      const action = (body.action as string) || '';
      if (action !== 'created' && action !== 'submitted') {
        log(`Ignored PR review action: ${action}`);
        jsonResponse(res, 200, { status: 'ignored' });
        return;
      }

      log(`PR review comment on PR #${prNumber}, triggering ADW PR Review`);
      const prTargetRepoArgs = extractTargetRepoArgs(body);
      spawnDetached('npx', ['tsx', 'adws/adwPrReview.tsx', String(prNumber), ...prTargetRepoArgs]);
      jsonResponse(res, 200, { status: 'triggered', pr: prNumber });
      return;
    }

    // Handle issue comment events (human comments trigger workflows)
    if (event === 'issue_comment') {
      const action = (body.action as string) || '';
      if (action !== 'created') {
        log(`Ignored issue_comment action: ${action}`);
        jsonResponse(res, 200, { status: 'ignored' });
        return;
      }

      const comment = body.comment as Record<string, unknown> | undefined;
      const commentBody = (comment?.body as string) || '';
      const issue = body.issue as Record<string, unknown> | undefined;
      const issueNumber = issue?.number as number | undefined;

      if (issueNumber == null) {
        log('No issue number found in issue_comment payload');
        jsonResponse(res, 200, { status: 'ignored' });
        return;
      }

      log(`Checking comment on issue #${issueNumber}: "${truncateText(commentBody, 100)}"`);

      if (!isActionableComment(commentBody)) {
        log(`Ignored comment on issue #${issueNumber}: missing "## Take action" directive`);
        jsonResponse(res, 200, { status: 'ignored' });
        return;
      }

      log(`Actionable comment on issue #${issueNumber}: contains "## Take action" directive`);

      // Check if workflow is already running — respond quickly, handle async
      const commentTargetRepoArgs = extractTargetRepoArgs(body);
      isAdwRunningForIssue(issueNumber)
        .then((running) => {
          if (running) {
            log(`ADW workflow already running for issue #${issueNumber}, deferring comment`);
            return;
          }

          log(`Human comment on issue #${issueNumber}, triggering ADW workflow`);
          return classifyIssueForTrigger(issueNumber).then((classification) => {
            const workflowScript = getWorkflowScript(classification.issueType, classification.adwCommand);
            log(
              `Issue #${issueNumber} classified as ${classification.issueType}, spawning ${workflowScript}`,
              'success'
            );
            const adwIdArgs = classification.adwId ? [classification.adwId] : [];
            spawnDetached('npx', ['tsx', workflowScript, String(issueNumber), ...adwIdArgs, '--issue-type', classification.issueType, ...commentTargetRepoArgs]);
          });
        })
        .catch((error) => {
          log(`Error handling comment on issue #${issueNumber}: ${error}`, 'error');
          spawnDetached('npx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...commentTargetRepoArgs]);
        });

      jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
      return;
    }

    // Handle pull_request events (for closing linked issues when PR is closed/merged)
    if (event === 'pull_request') {
      const action = (body.action as string) || '';
      if (action === 'closed') {
        // Handle asynchronously but respond quickly to avoid GitHub timeout
        const prPayload = body as unknown as PullRequestWebhookPayload;
        handlePullRequestEvent(prPayload)
          .then((result) => {
            log(`PR close event handled: ${JSON.stringify(result)}`);
          })
          .catch((error) => {
            log(`Error handling PR close event: ${error}`, 'error');
          });
        jsonResponse(res, 200, { status: 'processing' });
        return;
      }
      log(`Ignored pull_request action: ${action}`);
      jsonResponse(res, 200, { status: 'ignored' });
      return;
    }

    // Handle issue events
    if (event !== 'issues') {
      log(`Ignored event: ${event || '(none)'}`);
      jsonResponse(res, 200, { status: 'ignored' });
      return;
    }

    const action = (body.action as string) || '';
    const issue = (body.issue as Record<string, unknown> | undefined);
    const issueNumber = issue?.number as number | undefined;

    if (issueNumber == null) {
      log('No issue number found in payload');
      jsonResponse(res, 200, { status: 'ignored' });
      return;
    }

    if (action === 'closed') {
      log(`Issue #${issueNumber} closed, removing associated worktrees`);
      const removed = removeWorktreesForIssue(issueNumber);
      log(`Removed ${removed} worktree(s) for issue #${issueNumber}`, 'success');
      jsonResponse(res, 200, { status: 'worktrees_cleaned', issue: issueNumber, removed });
      return;
    }

    if (action === 'opened') {
      log(`New issue #${issueNumber} detected, classifying and triggering ADW workflow`);

      // Classify the issue and spawn the appropriate workflow asynchronously
      // Respond quickly to avoid GitHub timeout
      const issueTargetRepoArgs = extractTargetRepoArgs(body);
      classifyIssueForTrigger(issueNumber)
        .then((classification) => {
          const workflowScript = getWorkflowScript(classification.issueType, classification.adwCommand);
          log(
            `Issue #${issueNumber} classified as ${classification.issueType}, spawning ${workflowScript}`,
            'success'
          );
          const adwIdArgs = classification.adwId ? [classification.adwId] : [];
          spawnDetached('npx', ['tsx', workflowScript, String(issueNumber), ...adwIdArgs, '--issue-type', classification.issueType, ...issueTargetRepoArgs]);
        })
        .catch((error) => {
          log(`Error classifying issue #${issueNumber}: ${error}, defaulting to adwPlanBuildTest.tsx`, 'error');
          spawnDetached('npx', ['tsx', 'adws/adwPlanBuildTest.tsx', String(issueNumber), ...issueTargetRepoArgs]);
        });

      jsonResponse(res, 200, { status: 'processing', issue: issueNumber });
      return;
    }

    log(`Ignored issues action: ${action}`);
    jsonResponse(res, 200, { status: 'ignored' });
  });
});

/**
 * Resolves the port the webhook server should listen on.
 * Uses the preferred port if available, otherwise allocates a random available port.
 */
export async function resolveWebhookPort(preferredPort: number): Promise<number> {
  const available = await isPortAvailable(preferredPort, '0.0.0.0');
  if (available) {
    return preferredPort;
  }
  log(`Port ${preferredPort} is in use, allocating a random available port...`, 'warn');
  return allocateRandomPort();
}

async function startServer(): Promise<void> {
  const preferredPort = parseInt(process.env.PORT || '8001', 10);
  const actualPort = await resolveWebhookPort(preferredPort);
  log(`Starting webhook trigger on port ${actualPort}`);

  server.once('error', async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`Port ${actualPort} was taken (TOCTOU race), retrying with a random port...`, 'warn');
      const retryPort = await allocateRandomPort();
      server.listen(retryPort, '0.0.0.0', () => {
        log(`Webhook server listening on 0.0.0.0:${retryPort}`);
      });
    } else {
      throw err;
    }
  });

  server.listen(actualPort, '0.0.0.0', () => {
    log(`Webhook server listening on 0.0.0.0:${actualPort}`);
  });
}

startServer().catch((error) => {
  log(`Fatal error starting webhook server: ${error}`, 'error');
});
