/**
 * What the feature-994 scenarios share: one scenario's state, and the hooks that reset it and remove what the scenario made. The
 * state is that of one repository: the feature files its worktree holds, the test cases its stand-in scenario runner reports,
 * and, for the scenarios that run phases, the workflow and everything its stand-ins recorded.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { After, Before } from '@cucumber/cucumber';

import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { setProofUploaderForTesting } from '../../../adws/proof/proofUploader.ts';
import type { AssembledProof } from '../../../adws/proof/proofAssembler.ts';

import { deactivateStandInAgent } from './feature-994-agent.ts';
import type { RepositoryType } from './feature-994-names.ts';
import { disposeRunner, type CaseOutcome, type StandInRunner, type TagBehaviour } from './feature-994-runner.ts';
import type { ScreenshotStore } from './feature-937-world.ts';

/** A scenario the stand-in runner reports, as a table says it: where its feature file is, and how its run ends. */
export interface ReportedScenario {
  readonly featureFile: string;
  readonly scenario: string;
  readonly outcome: CaseOutcome;
  readonly attachments: readonly string[];
}

/** A comment on an issue or on a pull request. */
export interface RecordedComment {
  readonly number: number;
  readonly body: string;
}

/** The scenario proof as the review agent was given it. */
export interface ProofReceived {
  readonly path: string;
  readonly content: string;
}

export interface Workflow994 {
  readonly config: WorkflowConfig;
  readonly adwId: string;
  readonly issueNumber: number;
  readonly worktreePath: string;
}

export interface State994 {
  type: RepositoryType | null;
  issueNumber: number;
  /** Null until a step makes the worktree; the scenarios that assemble a proof have one without a workflow. */
  worktreePath: string | null;
  /** The feature files the worktree holds, by path from its root, with the text as written. */
  featureFiles: Map<string, string>;
  reported: ReportedScenario[];
  overrides: Record<string, TagBehaviour>;
  /** Files every run of the stand-in runner leaves in its proof directory, attached to no test case. */
  strays: string[];
  runner: StandInRunner | null;
  /** The directories the scenario made, removed after it. */
  directories: string[];
  adwIds: string[];
  /** The proof directory of a run the scenario stands for, which holds the reports and the artifacts. */
  proofDirectory: string | null;
  assembled: AssembledProof | null;
  workflow: Workflow994 | null;
  /** Extra files of the worktree's ".adw/", by path, which a step said it holds. */
  adwFiles: Map<string, string>;
  store: ScreenshotStore | null;
  issueComments: RecordedComment[];
  pullRequestComments: RecordedComment[];
  /** What the stand-in review agent answers each review with: the blocker it reports, or null for a pass. */
  verdicts: readonly (string | null)[];
  /** The proof each review was given, in the order the reviews ran. */
  reviewed: ProofReceived[];
  /** The proof the last run of the scenario test phase left. */
  proof: ScenarioProofResult | null;
}

function freshState(): State994 {
  return {
    type: null,
    issueNumber: 0,
    worktreePath: null,
    featureFiles: new Map(),
    reported: [],
    overrides: {},
    strays: [],
    runner: null,
    directories: [],
    adwIds: [],
    proofDirectory: null,
    assembled: null,
    workflow: null,
    adwFiles: new Map(),
    store: null,
    issueComments: [],
    pullRequestComments: [],
    verdicts: [],
    reviewed: [],
    proof: null,
  };
}

export const s: State994 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

export function requireType(): RepositoryType {
  assert.ok(s.type, 'Expected the scenario to have said what kind of repository it is about');
  return s.type;
}

export function requireWorktree(): string {
  assert.ok(s.worktreePath, "Expected the scenario to have made the repository's worktree first");
  return s.worktreePath;
}

export function requireWorkflow(): Workflow994 {
  assert.ok(s.workflow, 'Expected a workflow to have been set up first');
  return s.workflow;
}

export function requireRunner(): StandInRunner {
  assert.ok(s.runner, 'Expected the scenario to have installed the stand-in scenario runner first');
  return s.runner;
}

/** The proof the scenario is about: the one the assembler returned, or the file the scenario test phase wrote. */
export function proofDocument(): string {
  if (s.assembled) return s.assembled.document;
  assert.ok(s.proof, 'Expected a scenario proof to have been made first');
  return fs.readFileSync(s.proof.resultsFilePath, 'utf-8');
}

export function requireStore(): ScreenshotStore {
  assert.ok(s.store, 'Expected the workflow to have been given a screenshot store');
  return s.store;
}

/** A temporary directory the scenario owns, removed after it. */
export function makeDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  s.directories.push(directory);
  return directory;
}

function removeScenarioArtefacts(): void {
  s.adwIds.forEach(adwId => fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true }));
  s.directories.forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
  if (s.runner) disposeRunner(s.runner);
}

Before({ tags: '@adw-994' }, function () {
  resetState();
});

After({ tags: '@adw-994' }, function () {
  setProofUploaderForTesting(null);
  deactivateStandInAgent();
  removeScenarioArtefacts();
  resetState();
});
