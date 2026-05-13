/**
 * Minimal Slack webhook notifier for auth-gate events.
 * No-throw at boundary — failures are logged but never propagate.
 */

import { log } from './logger';

export interface AuthDetectionPayload {
  host: string;
  adwId: string | null;
  issueNumber: number | null;
  agentName: string;
  firstDetectedAt: string;
}

export interface AuthRecoveryPayload {
  host: string;
  clearedAt: string;
  resumedCount: number;
}

async function postSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    log('SLACK_WEBHOOK_URL not set; skipping Slack notification', 'warn');
    return;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log(`Slack notification returned HTTP ${res.status}`, 'warn');
    }
  } catch (err) {
    log(`Slack notification failed: ${err}`, 'warn');
  }
}

export async function sendSlackDetectionNotification(payload: AuthDetectionPayload): Promise<void> {
  const { host, adwId, issueNumber, agentName, firstDetectedAt } = payload;
  const text = `:lock: ADW auth gate triggered on host *${host}*\n• adwId: ${adwId ?? 'n/a'}\n• issue: #${issueNumber ?? 'n/a'}\n• agent: ${agentName}\n• firstDetectedAt: ${firstDetectedAt}\n*Action:* run \`claude auth login\` on host *${host}*.`;
  await postSlack(text);
}

export async function sendSlackRecoveryNotification(payload: AuthRecoveryPayload): Promise<void> {
  const { host, clearedAt, resumedCount } = payload;
  const text = `:unlock: Auth restored on host *${host}* at ${clearedAt}. Resuming ${resumedCount} paused issue(s).`;
  await postSlack(text);
}
