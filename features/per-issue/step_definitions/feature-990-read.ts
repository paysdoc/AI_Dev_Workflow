/**
 * What the feature-990 Then steps read back from a workflow's runs: the orchestrator's execution log, the top-level
 * state, and the logs the scenario's own programs kept (the static checks, the scenario runner, the dev server and the
 * wrapper around the Claude CLI stub). Every function only reads; none of them changes what the run left behind.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import type { AgentState } from '../../../adws/types/agentTypes.ts';
import { extractPrompt } from '../../../test/mocks/stubArgs.ts';
import { realGit } from '../../regression/support/fixtureWorktree.ts';

import { BASE_WORKTREE_MARKER } from './feature-990-scripts.ts';
import { targetWorkspace } from './feature-990-target.ts';
import { requireScratch, requireWorkflowSetup } from './feature-990-world.ts';

export interface LogLine {
  readonly at: number;
  readonly message: string;
}

export interface CheckRun {
  readonly check: string;
  readonly cwd: string;
}

export interface ScenarioRun {
  readonly at: number;
  readonly cwd: string;
  readonly kind: 'base' | 'issue';
  readonly tag: string;
  readonly scenarios: ReadonlyArray<{ readonly name: string; readonly passed: boolean }>;
}

export interface AgentStart {
  readonly at: number;
  readonly cwd: string;
  readonly command: string;
  readonly prompt: string;
}

export interface ServerEvent {
  readonly event: 'started' | 'stopped';
  readonly cwd: string;
  readonly at: number;
}

const LOG_LINE = /^\[([^\]]+)\] (.*)$/;
/** The planning agents: a plan phase has run once one of them has started. */
const PLAN_COMMANDS: ReadonlySet<string> = new Set(['/feature', '/bug', '/chore', '/patch', '/pr_review']);

function linesOf(file: string): string[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter(line => line.trim() !== '') : [];
}

export function topLevelState(): AgentState | null {
  return AgentStateManager.readTopLevelState(requireWorkflowSetup().adwId);
}

/** Every line of the orchestrator's execution log, over all the runs of the workflow, oldest first. */
export function executionLog(): LogLine[] {
  const statePath = AgentStateManager.findOrchestratorStatePath(requireWorkflowSetup().adwId);
  assert.ok(statePath, `Expected the workflow ${requireWorkflowSetup().adwId} to have left an orchestrator state directory`);
  return linesOf(path.join(statePath, 'execution.log')).flatMap((line) => {
    const match = LOG_LINE.exec(line);
    return match ? [{ at: Date.parse(match[1] ?? ''), message: match[2] ?? '' }] : [];
  });
}

export function executionLogText(): string {
  return executionLog().map(line => line.message).join('\n');
}

const BASELINE_CHECKOUT = /^Baseline: base branch (\S+) at (\S+) is checked out in (.+)$/;

export interface BaselineCheckout {
  readonly at: number;
  readonly baseBranch: string;
  readonly commit: string;
  readonly path: string;
}

/** The checkout each run's baseline phase logged, in run order. */
export function baselineCheckouts(): BaselineCheckout[] {
  return executionLog().flatMap(({ at, message }) => {
    const match = BASELINE_CHECKOUT.exec(message);
    return match ? [{ at, baseBranch: match[1] ?? '', commit: match[2] ?? '', path: match[3] ?? '' }] : [];
  });
}

export function checkRuns(): CheckRun[] {
  return linesOf(requireScratch().checkLog).map((line) => {
    const separator = line.indexOf('|');
    return { check: line.slice(0, separator), cwd: line.slice(separator + 1) };
  });
}

export function scenarioRuns(): ScenarioRun[] {
  return linesOf(requireScratch().runLog).map(line => JSON.parse(line) as ScenarioRun);
}

export function baseScenarioRuns(): ScenarioRun[] {
  return scenarioRuns().filter(run => run.kind === 'base');
}

export function agentStarts(): AgentStart[] {
  return linesOf(requireScratch().agentLog).flatMap((line) => {
    const { at, cwd, args } = JSON.parse(line) as { at: number; cwd: string; args: string[] };
    const prompt = extractPrompt(['', '', ...args]);
    return /^\//.test(prompt) ? [{ at, cwd, command: prompt.split(/\s/)[0] ?? '', prompt }] : [];
  });
}

export function planStarts(): AgentStart[] {
  return agentStarts().filter(start => PLAN_COMMANDS.has(start.command));
}

export function serverEvents(): ServerEvent[] {
  return linesOf(requireScratch().serverLog).flatMap((line) => {
    const [event, cwd, at] = line.split(' ');
    return event === 'started' || event === 'stopped' ? [{ event, cwd: cwd ?? '', at: Number(at) }] : [];
  });
}

/** A check logs its physical directory, so the name of a worktree that has been removed since can still be read. */
export function isBaseWorktree(cwd: string): boolean {
  return cwd.includes(BASE_WORKTREE_MARKER);
}

/** The base worktrees that still exist: as directories, and as git worktrees of the workspace. */
export function remainingBaseWorktrees(): string[] {
  const workspace = targetWorkspace();
  const worktrees = path.join(workspace, '.worktrees');
  const directories = fs.existsSync(worktrees) ? fs.readdirSync(worktrees).filter(name => name.startsWith('base-issue-')) : [];
  const registered = realGit(workspace, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter(line => line.startsWith('worktree ') && line.includes(BASE_WORKTREE_MARKER))
    .map(line => line.slice('worktree '.length));
  return [...directories.map(name => path.join(worktrees, name)), ...registered];
}
