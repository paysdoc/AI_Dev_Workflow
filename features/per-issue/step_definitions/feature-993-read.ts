/**
 * What the feature-993 Then steps read back from a workflow's run: where the dev server was started and what it answered
 * (the log of the program feature-990 writes), the scenario runs the stand-in `npx playwright test` made and how they went,
 * and when the review agent and the review patch agent were started. Every function only reads. "The issue's branch" is
 * every worktree that is not the base worktree of the baseline.
 */

import assert from 'assert';
import * as fs from 'fs';

import { MAX_START_ATTEMPTS } from '../../../adws/core/devServerLifecycle.ts';

import { agentStarts, isBaseWorktree, type AgentStart } from './feature-990-read.ts';
import { requireScratch, requireWorkflowSetup } from './feature-990-world.ts';
import { commandLine, recordedCalls, type RecordedCall } from './feature-992-standins.ts';

export type ServerEvent = 'attempt' | 'started' | 'answered' | 'stopped';

export interface ServerLogEntry {
  readonly event: ServerEvent;
  readonly cwd: string;
  readonly at: number;
}

const SERVER_EVENTS: readonly string[] = ['attempt', 'started', 'answered', 'stopped'];
const REVIEW_COMMAND = '/review';
const PATCH_COMMAND = '/patch';
const SCENARIO_RUN = 'npx playwright test';

function isServerEvent(event: string | undefined): event is ServerEvent {
  return event !== undefined && SERVER_EVENTS.includes(event);
}

function serverLogEntries(): ServerLogEntry[] {
  const { serverLog } = requireScratch();
  if (!fs.existsSync(serverLog)) return [];
  return fs.readFileSync(serverLog, 'utf-8').split('\n').flatMap((line) => {
    const [event, cwd, at] = line.split(' ');
    return isServerEvent(event) ? [{ event, cwd: cwd ?? '', at: Number(at) }] : [];
  });
}

/** What the dev server did in the worktrees of the issue's branch, oldest first. */
export function issueServerLog(): ServerLogEntry[] {
  return serverLogEntries().filter(entry => !isBaseWorktree(entry.cwd));
}

/** A try of the start command that was not followed by the server coming up before the next try. */
function failedAttempts(): ServerLogEntry[] {
  const tries = issueServerLog().filter(entry => entry.event === 'attempt' || entry.event === 'started');
  return tries.filter((entry, index) => entry.event === 'attempt' && tries[index + 1]?.event !== 'started');
}

/** The failed starts of the issue's branch, each as the tries it made: a start fails when none of its tries got an answer. */
export function failedStarts(): ServerLogEntry[][] {
  const attempts = failedAttempts();
  const starts: ServerLogEntry[][] = [];
  for (let first = 0; first < attempts.length; first += MAX_START_ATTEMPTS) starts.push(attempts.slice(first, first + MAX_START_ATTEMPTS));
  return starts;
}

export function agentStartsOf(command: string): AgentStart[] {
  return agentStarts().filter(start => start.command === command);
}

export const reviewAgentStarts = (): AgentStart[] => agentStartsOf(REVIEW_COMMAND);
export const reviewPatchAgentStarts = (): AgentStart[] => agentStartsOf(PATCH_COMMAND);

/** The scenario runs on the issue's branch, in the order they finished: the runs of the stand-in `npx playwright test`. */
export function issueScenarioRuns(): RecordedCall[] {
  return recordedCalls().filter(call => commandLine(call).startsWith(SCENARIO_RUN) && !isBaseWorktree(call.cwd));
}

/** When the stand-in `npx playwright test` finished the run. */
export function ranAt(run: RecordedCall): number {
  assert.ok(run.at !== undefined, `Expected the stand-in to have recorded when "${commandLine(run)}" finished`);
  return run.at;
}

export function issueScenarioRunsOf(issue = requireWorkflowSetup().issue): RecordedCall[] {
  return issueScenarioRuns().filter(call => call.tag === `adw-${issue}`);
}

export function describeEntries(entries: readonly ServerLogEntry[]): string {
  return entries.map(({ event, cwd, at }) => `${event} ${cwd} ${at}`).join('\n') || '(none)';
}

export function describeRuns(runs: readonly RecordedCall[]): string {
  return runs.map(({ tag, cwd, at, passed, probes }) => `${tag} in ${cwd} at ${at}: ${passed ? 'passed' : 'failed'}, probes ${JSON.stringify(probes)}`).join('\n') || '(none)';
}
