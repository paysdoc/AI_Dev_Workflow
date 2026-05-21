/**
 * Per-phase agent invocation timeout configuration.
 *
 * Extend AGENT_PHASE_TIMEOUT_MAP when a phase needs a non-default watchdog.
 * Per-phase overrides can also be set via env vars:
 *   AGENT_PHASE_TIMEOUT_STEP_DEF=5000  (phase name uppercased, hyphens → underscores)
 *
 * Mirrors the structure of modelRouting.ts — one obvious place to extend.
 */

// Compute independently of config.ts so tests that partially mock config don't break.
// config.ts exports the same constant for consumers that import from core.
const DEFAULT_TIMEOUT_MS =
  Math.max(1, parseInt(process.env.AGENT_DEFAULT_TIMEOUT_MS || '1800000', 10)) || 1_800_000;

// Re-export for consumers that import via this module.
export { AGENT_DEFAULT_TIMEOUT_MS } from './config';

/**
 * Static per-phase timeout overrides.
 * 'step-def' is the canonical first entry — it uses DEFAULT_TIMEOUT_MS
 * so the map is visibly extensible even before tuning is needed.
 */
export const AGENT_PHASE_TIMEOUT_MAP: Record<string, number> = {
  'step-def': DEFAULT_TIMEOUT_MS,
};

/**
 * Returns the watchdog timeout (ms) for a given phase name.
 *
 * Lookup order:
 * 1. Env var `AGENT_PHASE_TIMEOUT_<PHASE_UPPER>` (e.g. AGENT_PHASE_TIMEOUT_STEP_DEF)
 * 2. AGENT_PHASE_TIMEOUT_MAP static entry
 * 3. AGENT_DEFAULT_TIMEOUT_MS fallback
 */
export function getAgentTimeoutForPhase(phaseName: string | undefined): number {
  if (phaseName) {
    const envKey = `AGENT_PHASE_TIMEOUT_${phaseName.replace(/-/g, '_').toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return AGENT_PHASE_TIMEOUT_MAP[phaseName] ?? DEFAULT_TIMEOUT_MS;
  }
  return DEFAULT_TIMEOUT_MS;
}
