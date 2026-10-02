/**
 * The orchestrators the subprocess harness runs under W1, the arguments it launches them with, and
 * the matchers the cron Thens use on the launches the recorder caught. There is no `review` and no
 * `init`: neither names an orchestrator that exists. No hooks and no import-time side effects.
 */

import type { RepoIdentifier } from '@paysdoc/devplatform';
import assert from 'assert';
import { realpathSync } from 'fs';
import { basename, resolve } from 'path';

import { OrchestratorId, type IssueClassSlashCommand, type OrchestratorIdType } from '../../../adws/core/index.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { targetCloneUrl } from './fixtureTargetRepo.ts';
import { SURFACE_REPO } from './mockForgeProviders.ts';

export interface HarnessOrchestrator {
  /** Relative to the checkout. */
  readonly script: string;
  /** Always passed as `--issue-type`: without it `initializeWorkflow` runs the classifier agent with the ADW checkout as its cwd. */
  readonly issueType?: IssueClassSlashCommand;
  readonly orchestratorId?: OrchestratorIdType;
}

/** An orchestrator that initialises a workflow, which every one but the promotion sweep does. */
export interface WorkflowOrchestrator extends HarnessOrchestrator {
  readonly issueType: IssueClassSlashCommand;
  readonly orchestratorId: OrchestratorIdType;
}

export const HARNESS_ORCHESTRATORS: Readonly<Record<string, HarnessOrchestrator>> = {
  sdlc: { script: 'adws/adwSdlc.tsx', issueType: '/feature', orchestratorId: OrchestratorId.Sdlc },
  chore: { script: 'adws/adwChore.tsx', issueType: '/chore', orchestratorId: OrchestratorId.Chore },
  plan: { script: 'adws/adwPlan.tsx', issueType: '/feature', orchestratorId: OrchestratorId.Plan },
  build: { script: 'adws/adwBuild.tsx', issueType: '/feature', orchestratorId: OrchestratorId.Build },
  test: { script: 'adws/adwTest.tsx', issueType: '/feature', orchestratorId: OrchestratorId.Test },
  patch: { script: 'adws/adwPatch.tsx', issueType: '/feature', orchestratorId: OrchestratorId.Patch },
  merge: { script: 'adws/adwMerge.tsx', issueType: '/feature', orchestratorId: OrchestratorId.Merge },
  document: { script: 'adws/adwDocument.tsx', issueType: '/feature', orchestratorId: OrchestratorId.Document },
  'pr-review': { script: 'adws/adwPrReview.tsx', issueType: '/pr_review', orchestratorId: OrchestratorId.PrReview },
  'promotion-sweep': { script: 'adws/triggers/promotionSweep.ts' },
};

const ORCHESTRATOR_SCRIPT = /adws\/(adw[A-Z]\w*\.tsx|triggers\/promotionSweep\.ts)$/;

export function harnessOrchestrator(name: string): HarnessOrchestrator {
  const orchestrator = HARNESS_ORCHESTRATORS[name];
  assert.ok(orchestrator, `Unknown orchestrator "${name}". The subprocess harness runs: ${Object.keys(HARNESS_ORCHESTRATORS).join(', ')}`);
  return orchestrator;
}

/**
 * Absolute and real. `adwMerge.tsx`, `adwChore.tsx` and `adwUpgrade.tsx` run `main()` only when
 * `import.meta.url` equals `file://` plus `process.argv[1]`, so a relative or symlinked path makes
 * `main()` silently not run, and the process exits 0 having done nothing.
 */
export function realScriptPath(relativePath: string): string {
  return realpathSync(resolve(REPO_ROOT, relativePath));
}

/** `adwMerge.tsx` and the others that ignore `--issue-type` leave it trailing, which `parseOrchestratorArguments` never reads. */
export function orchestratorArgv(name: string, adwId: string, issue: number, repo: RepoIdentifier = SURFACE_REPO): string[] {
  const { script, issueType } = harnessOrchestrator(name);
  const target = ['--target-repo', `${repo.owner}/${repo.repo}`, '--clone-url', targetCloneUrl(repo.owner, repo.repo)];
  if (!issueType) return [realScriptPath(script), ...target];
  return [realScriptPath(script), String(issue), adwId, '--issue-type', issueType, ...target];
}

function isWorkflowOrchestrator(orchestrator: HarnessOrchestrator): orchestrator is WorkflowOrchestrator {
  return orchestrator.issueType !== undefined && orchestrator.orchestratorId !== undefined;
}

/** The orchestrator the init driver stands in for, named by its script's stem, such as `adwPlan`. */
export function orchestratorForStem(stem: string): WorkflowOrchestrator {
  const known = Object.values(HARNESS_ORCHESTRATORS).filter(isWorkflowOrchestrator);
  const found = known.find(({ script }) => basename(script, '.tsx') === stem);
  assert.ok(found, `Unknown orchestrator script "${stem}". The workflow can be initialised for: ${known.map(({ script }) => basename(script, '.tsx')).join(', ')}`);
  return found;
}

function normalised(argv: readonly string[]): string[] {
  return argv.map((arg) => arg.replace(/\\/g, '/'));
}

/** `spawnDetached` makes the script path absolute, so a launch records `tsx <checkout>/adws/adwSdlc.tsx <issue> <adwId> --issue-type ...`. */
export function isOrchestratorLaunch(argv: readonly string[]): boolean {
  return normalised(argv).some((arg) => ORCHESTRATOR_SCRIPT.test(arg));
}

export function isLaunchOf(argv: readonly string[], name: string, issue: number): boolean {
  const { script } = harnessOrchestrator(name);
  const arguments_ = normalised(argv);
  const at = arguments_.findIndex((arg) => arg.endsWith(script));
  return at !== -1 && arguments_[at + 1] === String(issue);
}
