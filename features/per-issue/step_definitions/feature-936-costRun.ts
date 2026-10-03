/**
 * Drives the real `handleAgentProcess` with a fake Claude CLI child that emits the JSONL
 * a scenario describes, then builds a phase's cost records from the resulting
 * `AgentResult`s the way the phases do: one run's `modelUsage` as it is, several runs
 * folded with `mergeModelUsageMaps`.
 */

import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import * as os from 'os';

import { handleAgentProcess } from '../../../adws/agents/agentProcessHandler.ts';
import {
  createPhaseCostRecords,
  mergeModelUsageMaps,
  PhaseCostStatus,
  type ModelUsageMap,
  type PhaseCostRecord,
} from '../../../adws/cost/index.ts';
import type { AgentResult } from '../../../adws/types/agentTypes.ts';

export interface AssistantTurn {
  readonly messageId: string;
  readonly input: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
  readonly textCharacters: number;
}

export interface ReportedModelUsage {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly costUSD: number;
}

export interface ResultSpec {
  readonly models: readonly ReportedModelUsage[];
  /** Absent: the result message reports the sum of its per-model figures. */
  readonly totalCostUsd?: number;
}

export interface AgentRunSpec {
  readonly phase: string;
  readonly turnModel?: string;
  readonly turns: readonly AssistantTurn[];
  /** Absent: the run is stopped before the Claude CLI writes its result message. */
  readonly result?: ResultSpec;
}

function createFakeChild(): { child: ChildProcess; stdout: EventEmitter } {
  const stdout = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { stdout, stderr: new EventEmitter(), kill: () => true });
  return { child: child as unknown as ChildProcess, stdout };
}

function assistantLine(model: string, turn: AssistantTurn): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      id: turn.messageId,
      model,
      usage: {
        input_tokens: turn.input,
        cache_creation_input_tokens: turn.cacheWrite,
        cache_read_input_tokens: turn.cacheRead,
      },
      content: [{ type: 'text', text: 'x'.repeat(turn.textCharacters) }],
    },
  });
}

function resultLine(result: ResultSpec): string {
  const totalCostUsd = result.totalCostUsd ?? result.models.reduce((sum, m) => sum + m.costUSD, 0);
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    session_id: 's-936',
    total_cost_usd: totalCostUsd,
    modelUsage: Object.fromEntries(result.models.map(m => [m.model, {
      inputTokens: m.input,
      outputTokens: m.output,
      cacheReadInputTokens: m.cacheRead,
      cacheCreationInputTokens: m.cacheWrite,
      costUSD: m.costUSD,
    }])),
  });
}

function streamLines(run: AgentRunSpec): string[] {
  const turnLines = run.turns.map(turn => assistantLine(run.turnModel ?? 'unknown', turn));
  return run.result ? [...turnLines, resultLine(run.result)] : turnLines;
}

async function runAgent(run: AgentRunSpec): Promise<AgentResult> {
  const { child, stdout } = createFakeChild();
  const modelHint = run.turnModel ?? run.result?.models[0]?.model ?? 'unknown';
  // The handler's write stream opens and flushes asynchronously with no error listener, so it
  // gets a sink that never needs removing; no scenario reads the raw output.
  const pending = handleAgentProcess(child, `${run.phase}-agent`, os.devNull, undefined, undefined, modelHint);
  for (const line of streamLines(run)) stdout.emit('data', Buffer.from(`${line}\n`));
  child.emit('close', run.result ? 0 : null);
  return pending;
}

function combineModelUsage(results: readonly AgentResult[]): ModelUsageMap {
  if (results.length === 1) return results[0].modelUsage ?? {};
  return results.reduce<ModelUsageMap>((acc, r) => mergeModelUsageMaps(acc, r.modelUsage ?? {}), {});
}

export async function buildPhaseCostRecords(phase: string, runs: readonly AgentRunSpec[]): Promise<PhaseCostRecord[]> {
  const results = await runs
    .filter(run => run.phase === phase)
    .reduce<Promise<AgentResult[]>>(async (done, run) => [...await done, await runAgent(run)], Promise.resolve([]));

  return createPhaseCostRecords({
    workflowId: 'adw-936',
    issueNumber: 936,
    phase,
    status: results.every(r => r.costSource === 'extractor_finalized') ? PhaseCostStatus.Success : PhaseCostStatus.Partial,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: 0,
    modelUsage: combineModelUsage(results),
  });
}
