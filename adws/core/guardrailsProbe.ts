/**
 * Production seam for the guardrails startup probe (issue #762).
 *
 * Runs `scripts/guardrails-probe.ts` as a subprocess — isolating the real,
 * network-bound `claude -p` call it performs from the long-running cron/
 * webhook process. Memoized so the probe (and its fail-open Slack alert, see
 * guardrailsGate.ts) runs at most once per process.
 */

import { spawnSync } from 'child_process';
import * as path from 'path';
import { REPO_ROOT } from './environment';

/** Outcome of a guardrails probe run. */
export interface ProbeVerdict {
  readonly ok: boolean;
  /** Failure detail (probe stdout/stderr) — present only when `ok` is false. */
  readonly detail?: string;
}

const PROBE_TIMEOUT_MS = 90_000;

/**
 * Runs the guardrails probe script as a subprocess and maps its exit status
 * to a {@link ProbeVerdict}. Never throws — a spawn failure (e.g. `bunx`
 * missing) is itself reported as a failed verdict, consistent with the
 * fail-open contract this probe exists to serve.
 *
 * `REPO_ROOT` is resolved here (not at module scope) so merely importing this
 * module — e.g. transitively via the `adws/core` barrel — never touches it;
 * only actually running the probe does.
 */
export async function runGuardrailsProbe(): Promise<ProbeVerdict> {
  try {
    const probeScriptPath = path.join(REPO_ROOT, 'scripts', 'guardrails-probe.ts');
    const result = spawnSync('bunx', ['tsx', probeScriptPath], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: PROBE_TIMEOUT_MS,
    });

    if (result.status === 0) {
      return { ok: true };
    }

    const detail = [result.stdout, result.stderr, result.error?.message]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join('\n')
      .trim() || `guardrails probe exited with status ${String(result.status)}`;
    return { ok: false, detail };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

let memoizedVerdict: ProbeVerdict | null = null;

/**
 * Runs the guardrails probe at most once per process and returns the
 * memoized verdict on subsequent calls — so the probe's cost (a real Claude
 * CLI call) and its fail-open Slack alert are both paid exactly once.
 */
export async function getGuardrailsProbeVerdict(): Promise<ProbeVerdict> {
  if (memoizedVerdict === null) {
    memoizedVerdict = await runGuardrailsProbe();
  }
  return memoizedVerdict;
}

/** Test-only seam: clears the memoized verdict so the next call re-runs the probe. */
export function resetGuardrailsProbeMemo(): void {
  memoizedVerdict = null;
}
