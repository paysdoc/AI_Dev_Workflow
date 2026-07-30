/**
 * Per-event resilience boundary for the webhook trigger.
 *
 * One job: contain and report a per-event failure so the webhook process
 * survives it (issue #776). Pure context/formatting helpers plus a single
 * no-throw reporter — no `http` types, so this is testable without touching
 * the server.
 */

import { log, type LogLevel } from '../core/logger';
import { postSlack } from '../core/slackNotifier';

export interface WebhookEventContext {
  event: string; // 'issue_comment' | … | 'unknown'
  repo: string; // 'owner/repo' | 'unknown'
  issueNumber: number | null;
  prNumber: number | null;
}

export interface WebhookFailureDeps {
  logger?: (message: string, level?: LogLevel) => void;
  notify?: (text: string) => Promise<void>;
}

/** Parses a webhook delivery body. Never throws — undefined on bad JSON or a non-object result. */
export function safeParseWebhookBody(rawBody: Buffer): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString());
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** Defensively extracts identity from a raw webhook payload. Pure — survives a hostile or truncated body. */
export function describeWebhookEvent(
  event: string | undefined,
  body: Record<string, unknown> | undefined,
): WebhookEventContext {
  const repository = body?.repository;
  const fullName = repository && typeof repository === 'object' ? (repository as Record<string, unknown>).full_name : undefined;
  const issue = body?.issue;
  const pullRequest = body?.pull_request;

  return {
    event: event || 'unknown',
    repo: typeof fullName === 'string' && fullName.length > 0 ? fullName : 'unknown',
    issueNumber: readNumber(issue && typeof issue === 'object' ? (issue as Record<string, unknown>).number : undefined),
    prNumber: readNumber(pullRequest && typeof pullRequest === 'object' ? (pullRequest as Record<string, unknown>).number : undefined),
  };
}

function issueLabel(context: WebhookEventContext): string {
  if (context.issueNumber !== null) return `#${context.issueNumber}`;
  if (context.prNumber !== null) return `PR #${context.prNumber}`;
  return 'n/a';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One-line log message naming event type, repo and issue/PR — the operator-facing failure summary. */
export function formatWebhookFailureLog(context: WebhookEventContext, error: unknown): string {
  return `Webhook event handler failed [event=${context.event} repo=${context.repo} issue=${issueLabel(context)}]: ${errorMessage(error)}`;
}

/** Multi-line Slack alert naming the same identifiers. Makes no claim about the HTTP response. */
export function formatWebhookFailureAlert(context: WebhookEventContext, error: unknown): string {
  return [
    ':rotating_light: Webhook event handler failed',
    `• event: ${context.event}`,
    `• repo: ${context.repo}`,
    `• issue: ${issueLabel(context)}`,
    `• error: ${errorMessage(error)}`,
  ].join('\n');
}

/**
 * Logs and Slack-alerts a contained webhook failure. Contractually never throws — a
 * reporter that throws would re-create the outage it exists to prevent — and never
 * awaits the alert, so a black-holed Slack endpoint cannot delay the caller.
 */
export function reportWebhookEventFailure(
  context: WebhookEventContext,
  error: unknown,
  deps: WebhookFailureDeps = {},
): void {
  const logger = deps.logger ?? log;
  const notify = deps.notify ?? postSlack;
  try {
    logger(formatWebhookFailureLog(context, error), 'error');
    void Promise.resolve(notify(formatWebhookFailureAlert(context, error))).catch((alertError) => {
      logger(`Webhook failure alert could not be delivered: ${alertError}`, 'warn');
    });
  } catch (reportError) {
    // Best-effort only: a throw here would kill the process, recreating the outage
    // this reporter exists to prevent.
    console.error('reportWebhookEventFailure itself failed:', reportError);
  }
}
