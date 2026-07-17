/**
 * Pure decision module for whether an agent spawn should receive the
 * guardrails `--settings` injection (issue #762). Gated three ways, checked
 * in strict order so a mistaken deny rule can never wedge the queue: an
 * `ADW_TARGET_GUARDRAILS=off` kill switch, self-host runs (which keep the
 * framework's own project `settings.json`), the `.github/adw.yml` canary
 * key, and a startup probe that fails OPEN (no injection + one Slack alert)
 * rather than blocking.
 */

import { readAdwYmlConfig } from './adwYmlConfig';
import { REPO_ROOT } from './environment';
import { buildGuardrailsSettings, resolveHookLogDir, serializeGuardrailsSettings } from './guardrailsPayload';
import { getGuardrailsProbeVerdict, type ProbeVerdict } from './guardrailsProbe';
import { postSlack } from './slackNotifier';
import type { AdwYmlConfig } from './adwYmlConfig';

/** The gate's verdict: whether to inject, and — when injecting — the payload to use. */
export type GuardrailsDecision =
  | { readonly inject: false }
  | { readonly inject: true; readonly settingsJson: string; readonly hookLogDir: string };

/** Launch-boundary facts the gate needs to decide. */
export interface GuardrailsGateInput {
  readonly selfHost: boolean;
  readonly worktreePath: string;
  readonly adwId: string;
}

/** Injectable seams — a capturing test double replaces every production side effect. */
export interface GuardrailsGateDeps {
  readonly probeGuardrails: () => Promise<ProbeVerdict>;
  readonly notifySlack: (text: string) => Promise<void>;
  readonly readAdwYml: (worktreePath: string) => AdwYmlConfig;
  readonly getEnv: (name: string) => string | undefined;
}

function buildProbeFailureAlert(verdict: ProbeVerdict): string {
  const detail = verdict.detail ? `\nDetail: ${verdict.detail}` : '';
  return `:warning: ADW guardrails startup probe failed — target-repo agent runs proceed WITHOUT injected guardrails until this is resolved.${detail}`;
}

/**
 * Decides whether a spawn should receive the guardrails `--settings`
 * injection. Guard-clause chain, evaluated in order:
 *   1. Kill switch (`ADW_TARGET_GUARDRAILS=off`) — beats everything.
 *   2. Self-host — keeps the framework's own project settings.
 *   3. `.github/adw.yml` `guardrails` canary — omitted/false/absent withhold.
 *   4. Startup probe verdict — a failure fails OPEN (no inject + one alert).
 * Only once all four pass is the payload built and injection returned.
 */
export async function resolveGuardrailsDecision(
  input: GuardrailsGateInput,
  deps: GuardrailsGateDeps,
): Promise<GuardrailsDecision> {
  if (deps.getEnv('ADW_TARGET_GUARDRAILS') === 'off') return { inject: false };
  if (input.selfHost) return { inject: false };
  if (deps.readAdwYml(input.worktreePath).guardrails !== true) return { inject: false };

  const verdict = await deps.probeGuardrails();
  if (!verdict.ok) {
    await deps.notifySlack(buildProbeFailureAlert(verdict));
    return { inject: false };
  }

  const settingsJson = serializeGuardrailsSettings(buildGuardrailsSettings({ frameworkRepoRoot: REPO_ROOT }));
  const hookLogDir = resolveHookLogDir(input.adwId);
  return { inject: true, settingsJson, hookLogDir };
}

// ---------------------------------------------------------------------------
// Production dependency wiring
// ---------------------------------------------------------------------------

let probeFailureAlertSent = false;

/**
 * Sends the probe-failure Slack alert at most once per process — the probe
 * verdict itself is memoized (see guardrailsProbe.ts), so without this guard
 * a failed verdict would alert on every subsequent target-repo spawn rather
 * than once.
 */
async function notifyProbeFailureOnce(text: string): Promise<void> {
  if (probeFailureAlertSent) return;
  probeFailureAlertSent = true;
  await postSlack(text);
}

/** Test-only seam: clears the once-per-process alert guard. */
export function resetGuardrailsAlertMemo(): void {
  probeFailureAlertSent = false;
}

/** Production seam wiring for {@link resolveGuardrailsDecision}. */
export const productionGuardrailsGateDeps: GuardrailsGateDeps = {
  probeGuardrails: getGuardrailsProbeVerdict,
  notifySlack: notifyProbeFailureOnce,
  readAdwYml: readAdwYmlConfig,
  getEnv: (name: string) => process.env[name],
};
