import { RUNNING_TOKENS } from './config';
import { mergeModelUsageMaps, persistTokenCounts, computeDisplayTokens } from '../cost';
import type { ModelUsageMap, PhaseCostRecord } from '../cost';
import { postCostRecordsToD1 } from '../cost/d1Client';
import type { WorkflowConfig } from '../phases/workflowInit';
import { RateLimitError, AgentTimeoutError } from '../types/agentTypes';
import { AgentStateManager } from './agentState';
import { log } from './utils';
import { decideRateLimitWait, sleepUntil, type RateLimitWaitDecision, type WaitClock } from './rateLimitWaitPolicy';

export interface PhaseResult {
  costUsd: number;
  modelUsage: ModelUsageMap;
  phaseCostRecords?: PhaseCostRecord[];
}

export type PhaseFn = (config: WorkflowConfig) => Promise<PhaseResult>;

export class CostTracker {
  private _totalCostUsd = 0;
  private _totalModelUsage: ModelUsageMap = {};

  get totalCostUsd(): number {
    return this._totalCostUsd;
  }

  get totalModelUsage(): ModelUsageMap {
    return this._totalModelUsage;
  }

  accumulate(result: PhaseResult): void {
    this._totalCostUsd += result.costUsd;
    this._totalModelUsage = mergeModelUsageMaps(this._totalModelUsage, result.modelUsage);
  }

  persist(config: WorkflowConfig): void {
    persistTokenCounts(config.orchestratorStatePath, this._totalCostUsd, this._totalModelUsage);
    if (RUNNING_TOKENS) {
      config.ctx.runningTokenTotal = computeDisplayTokens(this._totalModelUsage);
    }
    // Mirror accumulated totals so subsequent phases can read them via config.
    config.totalModelUsage = this._totalModelUsage;
  }

  /** Errors are swallowed so cost failures never abort a workflow. */
  async commit(config: WorkflowConfig, records: PhaseCostRecord[]): Promise<void> {
    if (records.length === 0) return;
    const repoName = config.targetRepo?.repo ?? config.repoContext?.repoId.repo ?? 'unknown';
    postCostRecordsToD1({ project: repoName, repoUrl: process.env.GITHUB_REPO_URL, records })
      .catch(error => log(`Failed to post cost records to D1: ${error}`, 'error'));
  }
}

/** Reads existing metadata to avoid clobbering other fields. */
function recordCompletedPhase(config: WorkflowConfig, phaseName: string): void {
  const existing = AgentStateManager.readState(config.orchestratorStatePath);
  const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  const prior = Array.isArray(existingMeta.completedPhases) ? existingMeta.completedPhases as string[] : [];
  if (!prior.includes(phaseName)) {
    AgentStateManager.writeState(config.orchestratorStatePath, {
      metadata: { ...existingMeta, completedPhases: [...prior, phaseName] },
    });
  }
}

function skippedResult<R extends PhaseResult>(): R {
  return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] } as unknown as R;
}

/** The top-level phases map entry, when present, is authoritative over the legacy completedPhases array. */
function isPhaseAlreadyCompleted(config: WorkflowConfig, phaseName?: string): boolean {
  if (!phaseName) return false;
  if (!config.adwId) return config.completedPhases?.includes(phaseName) ?? false;

  const topState = AgentStateManager.readTopLevelState(config.adwId);
  const phaseEntry = topState?.phases?.[phaseName];
  // A phases-map entry, once it exists, is used exclusively: 'failed' or 'running' must NOT skip.
  if (phaseEntry !== undefined) return phaseEntry.status === 'completed';
  return config.completedPhases?.includes(phaseName) ?? false;
}

function markPhaseRunning(config: WorkflowConfig, phaseName: string | undefined, startedAt: string): void {
  if (!phaseName || !config.adwId) return;
  AgentStateManager.writeTopLevelState(config.adwId, {
    workflowStage: `${phaseName}_running`,
    phases: { [phaseName]: { status: 'running', startedAt } },
  });
}

function markPhaseCompleted(config: WorkflowConfig, phaseName: string | undefined, startedAt: string): void {
  if (phaseName && config.adwId) {
    AgentStateManager.writeTopLevelState(config.adwId, {
      workflowStage: `${phaseName}_completed`,
      phases: { [phaseName]: { status: 'completed', startedAt, completedAt: new Date().toISOString() } },
    });
  }
  if (phaseName) recordCompletedPhase(config, phaseName);
}

function markPhaseFailed(config: WorkflowConfig, phaseName: string | undefined, startedAt: string): void {
  if (!phaseName || !config.adwId) return;
  AgentStateManager.writeTopLevelState(config.adwId, {
    phases: { [phaseName]: { status: 'failed', startedAt, completedAt: new Date().toISOString() } },
  });
}

async function completePhaseAttempt<R extends PhaseResult>(
  config: WorkflowConfig,
  tracker: CostTracker,
  fn: (config: WorkflowConfig) => Promise<R>,
  phaseName: string | undefined,
  startedAt: string,
): Promise<R> {
  const result = await fn(config);
  tracker.accumulate(result);
  tracker.persist(config);
  await tracker.commit(config, result.phaseCostRecords ?? []);
  markPhaseCompleted(config, phaseName, startedAt);
  return result;
}

/** Always throws: AgentTimeoutError exits via handlePhaseTimeout; everything else is marked failed and rethrown. */
async function failPhase(
  config: WorkflowConfig,
  tracker: CostTracker,
  err: unknown,
  phaseName: string | undefined,
  startedAt: string,
): Promise<never> {
  if (err instanceof AgentTimeoutError) {
    if (phaseName && config.adwId) {
      AgentStateManager.writeTopLevelState(config.adwId, {
        phases: { [phaseName]: { status: 'failed', startedAt, completedAt: new Date().toISOString(), failureReason: 'agent_timeout' } },
      });
    }
    // Lazy import mirrors the handleRateLimitPause pattern to avoid circular deps.
    const { handlePhaseTimeout } = await import('../phases/workflowCompletion');
    handlePhaseTimeout(config, err.phaseName ?? phaseName ?? 'unknown', err.timeoutMs);
  }
  markPhaseFailed(config, phaseName, startedAt);
  if (err instanceof RateLimitError) {
    // Lazy import to avoid circular deps at module load time
    const { handleRateLimitPause } = await import('../phases/workflowCompletion');
    handleRateLimitPause(config, err.phaseName, 'rate_limited', tracker.totalCostUsd, tracker.totalModelUsage, err);
  }
  throw err;
}

function decideOnPhaseError(err: unknown, now: Date): RateLimitWaitDecision | null {
  return err instanceof RateLimitError ? decideRateLimitWait(err, now) : null;
}

export type PostIssueComment = (issueNumber: number, body: string) => void;

export interface PhaseRunnerDeps {
  readonly clock?: WaitClock;
  readonly postComment?: PostIssueComment;
}

const timerClock: WaitClock = { now: () => new Date(), sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)) };

// Sliced through sleepUntil so a suspended host or a clock jump is noticed within
// MAX_SLEEP_SLICE_MS, and no single timer nears Node's setTimeout limit (2^31 - 1 ms),
// which a distant reset time would otherwise overflow into an immediate fire.
export const systemClock: WaitClock = {
  now: timerClock.now,
  sleep: (ms) => sleepUntil(timerClock, new Date(timerClock.now().getTime() + ms)),
};

/** No-op without a repoContext; a failure to post is logged, never thrown. */
function defaultPostComment(config: WorkflowConfig): PostIssueComment {
  return (issueNumber, body) => {
    if (!config.repoContext) return;
    try {
      config.repoContext.issueTracker.commentOnIssue(issueNumber, body);
    } catch (err) {
      log(`Failed to post rate-limit wait comment on issue #${issueNumber}: ${err}`, 'error');
    }
  };
}

function resolvePhaseRunnerDeps(config: WorkflowConfig, deps: PhaseRunnerDeps): { clock: WaitClock; postComment: PostIssueComment } {
  return { clock: deps.clock ?? systemClock, postComment: deps.postComment ?? defaultPostComment(config) };
}

/** Posts the wait comment, then asks the clock for exactly one sleep ending at `until`. */
async function waitForRateLimitReset(
  config: WorkflowConfig,
  phaseName: string,
  err: RateLimitError,
  until: Date,
  attempt: number,
  deps: { clock: WaitClock; postComment: PostIssueComment },
): Promise<void> {
  // Lazy import: the forge module imports ../core, which re-exports this file.
  const { formatRateLimitWaitComment } = await import('../forge/workflowCommentsIssue');
  const body = formatRateLimitWaitComment({ adwId: config.adwId, phaseName, rateLimitType: err.rateLimitType, until, attempt });
  deps.postComment(config.issueNumber, body);
  const summary = `Rate limit (${err.rateLimitType ?? 'unknown'}) waiting in-process until ${until.toISOString()} (attempt ${attempt}) for phase '${phaseName}'`;
  AgentStateManager.appendLog(config.orchestratorStatePath, summary);
  log(summary, 'warn');
  await deps.clock.sleep(Math.max(0, until.getTime() - deps.clock.now().getTime()));
  log(`Phase '${phaseName}' resuming after rate-limit wait; reset time reached, re-running`, 'info');
}

/** A RateLimitError either rides out in-process (decideRateLimitWait) or exits via handleRateLimitPause. */
export async function runPhase<R extends PhaseResult>(
  config: WorkflowConfig,
  tracker: CostTracker,
  fn: (config: WorkflowConfig) => Promise<R>,
  phaseName?: string,
  deps: PhaseRunnerDeps = {},
): Promise<R> {
  if (isPhaseAlreadyCompleted(config, phaseName)) return skippedResult<R>();

  const startedAt = new Date().toISOString();
  markPhaseRunning(config, phaseName, startedAt);
  const runnerDeps = resolvePhaseRunnerDeps(config, deps);

  for (let attempt = 1; ; attempt++) {
    try {
      return await completePhaseAttempt(config, tracker, fn, phaseName, startedAt);
    } catch (err) {
      const decision = decideOnPhaseError(err, runnerDeps.clock.now());
      if (!decision || decision.kind !== 'wait_in_process') {
        await failPhase(config, tracker, err, phaseName, startedAt);
        continue; // unreachable (failPhase always throws) — narrows `decision` below for tsc
      }
      const rateLimitErr = err as RateLimitError;
      await waitForRateLimitReset(config, phaseName ?? rateLimitErr.phaseName, rateLimitErr, decision.until, attempt, runnerDeps);
    }
  }
}

/** Each phase sees the updated config.totalModelUsage from the previous phase. */
export async function runPhasesSequential<R extends PhaseResult>(
  config: WorkflowConfig,
  tracker: CostTracker,
  fns: ReadonlyArray<(config: WorkflowConfig) => Promise<R>>,
  deps: PhaseRunnerDeps = {},
): Promise<R[]> {
  const results: R[] = [];
  for (const fn of fns) {
    results.push(await runPhase(config, tracker, fn, undefined, deps));
  }
  return results;
}

async function finishParallelAttempt<R extends PhaseResult>(
  config: WorkflowConfig,
  tracker: CostTracker,
  results: R[],
): Promise<R[]> {
  const mergedRecords: PhaseCostRecord[] = results.flatMap(r => r.phaseCostRecords ?? []);
  const mergedUsage = results.reduce((acc, r) => mergeModelUsageMaps(acc, r.modelUsage), {} as ModelUsageMap);
  const mergedCost = results.reduce((sum, r) => sum + r.costUsd, 0);
  // Accumulate merged totals in one shot so persist() reflects all parallel phases.
  tracker.accumulate({ costUsd: mergedCost, modelUsage: mergedUsage, phaseCostRecords: mergedRecords });
  tracker.persist(config);
  await tracker.commit(config, mergedRecords);
  return results;
}

/** Mirrors failPhase; the parallel group has no phaseName to mark failed. */
async function failParallel(config: WorkflowConfig, tracker: CostTracker, err: unknown): Promise<never> {
  if (err instanceof RateLimitError) {
    const { handleRateLimitPause } = await import('../phases/workflowCompletion');
    handleRateLimitPause(config, err.phaseName, 'rate_limited', tracker.totalCostUsd, tracker.totalModelUsage, err);
  }
  throw err;
}

/** Use only when the phases have no data dependency on each other. */
export async function runPhasesParallel<R extends PhaseResult>(
  config: WorkflowConfig,
  tracker: CostTracker,
  fns: ReadonlyArray<(config: WorkflowConfig) => Promise<R>>,
  deps: PhaseRunnerDeps = {},
): Promise<R[]> {
  const runnerDeps = resolvePhaseRunnerDeps(config, deps);

  for (let attempt = 1; ; attempt++) {
    const promises = fns.map(fn => fn(config));
    try {
      const results = await Promise.all(promises);
      return await finishParallelAttempt(config, tracker, results);
    } catch (err) {
      const decision = decideOnPhaseError(err, runnerDeps.clock.now());
      if (!decision || decision.kind !== 'wait_in_process') {
        await failParallel(config, tracker, err);
        continue; // unreachable (failParallel always throws) — narrows `decision` below for tsc
      }
      // Let in-flight siblings settle before sleeping so no agent is running during the wait.
      await Promise.allSettled(promises);
      const rateLimitErr = err as RateLimitError;
      await waitForRateLimitReset(config, rateLimitErr.phaseName, rateLimitErr, decision.until, attempt, runnerDeps);
    }
  }
}
