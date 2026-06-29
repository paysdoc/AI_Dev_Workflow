import type { AgentState } from '../types/agentTypes';

export interface ResumeSpawnDescriptor {
  /** Orchestrator script to spawn, e.g. "adws/adwSdlc.tsx" or "adws/adwPrReview.tsx". */
  readonly script: string;
  /** Normalized positional CLI args: [issueNumber, adwId]. */
  readonly args: readonly string[];
}

/** The historical default: every pre-`orchestratorScript` adwId resumes as SDLC. */
export const DEFAULT_RESUME_SCRIPT = 'adws/adwSdlc.tsx';

/**
 * Maps an adwId's persisted top-level state to the orchestrator that owns it,
 * with normalized (issueNumber, adwId) resume args. Defaults to the SDLC
 * orchestrator when `orchestratorScript` is absent (back-compat for every
 * adwId created before PR-review began persisting it).
 */
export function resolveResumeSpawn(state: AgentState): ResumeSpawnDescriptor {
  const script = state.orchestratorScript ?? DEFAULT_RESUME_SCRIPT;
  const args = [String(state.issueNumber), state.adwId];
  return { script, args };
}
