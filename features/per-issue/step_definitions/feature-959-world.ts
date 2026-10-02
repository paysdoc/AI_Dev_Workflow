import * as fs from 'fs';
import * as path from 'path';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import type { RepoIdentity } from '../../../adws/types/agentTypes.ts';
import type { OrchestratorProcess } from './feature-959-processes.ts';

/** The flagged feature-908 and feature-912 rows also carry @adw-959 but run under their own harness. */
export const OWN_ROWS = '@adw-959 and not @adw-908 and not @adw-912';

/** The workflow a scenario seeds for one issue, and the process that stands in for its orchestrator. */
export interface Workflow {
  readonly adwId: string;
  readonly issueNumber: number;
  readonly script: string;
  readonly branchName: string;
  readonly repoIdentity: RepoIdentity;
  /** Set once a step starts the orchestrator's stand-in process, dead or alive. */
  process: OrchestratorProcess | null;
}

export interface WorktreeReset {
  readonly worktreePath: string;
  readonly branch: string;
}

export const s: {
  usedAdwIds: Set<string>;
  tempDirs: string[];
  /** adwIds whose orchestrator log this scenario seeded before the launch. */
  seededLogs: Set<string>;
  nonExecutableCli: string;
  launchStartedAt: number;
  workflows: Map<string, Workflow>;
  processes: OrchestratorProcess[];
  issues: Set<number>;
  resets: WorktreeReset[];
  boundaryWrapped: boolean;
  gitDir: string;
  triggerArmed: boolean;
  triggerFired: boolean;
  savedQueueRaw: string | null;
  savedAuthGate: string | null;
} = {
  usedAdwIds: new Set(),
  tempDirs: [],
  seededLogs: new Set(),
  nonExecutableCli: '',
  launchStartedAt: 0,
  workflows: new Map(),
  processes: [],
  issues: new Set(),
  resets: [],
  boundaryWrapped: false,
  gitDir: '',
  triggerArmed: false,
  triggerFired: false,
  savedQueueRaw: null,
  savedAuthGate: null,
};

export function resetState(): void {
  s.usedAdwIds = new Set();
  s.tempDirs = [];
  s.seededLogs = new Set();
  s.nonExecutableCli = '';
  s.launchStartedAt = 0;
  s.workflows = new Map();
  s.processes = [];
  s.issues = new Set();
  s.resets = [];
  s.boundaryWrapped = false;
  s.gitDir = '';
  s.triggerArmed = false;
  s.triggerFired = false;
  s.savedQueueRaw = null;
  s.savedAuthGate = null;
}

export function requireWorkflow(adwId: string): Workflow {
  const workflow = s.workflows.get(adwId);
  if (!workflow) throw new Error(`Expected a workflow under adwId "${adwId}" to have been seeded first`);
  return workflow;
}

export function removeAdwIdArtefacts(adwId: string): void {
  fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true });
  fs.rmSync(path.join(LOGS_DIR, adwId), { recursive: true, force: true });
}

export function removeScenarioArtefacts(): void {
  for (const adwId of s.usedAdwIds) removeAdwIdArtefacts(adwId);
  for (const dir of s.tempDirs) fs.rmSync(dir, { recursive: true, force: true });
}
