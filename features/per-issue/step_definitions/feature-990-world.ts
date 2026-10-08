/**
 * What the feature-990 scenarios share: one scenario's description of its target repository (static checks,
 * dev server, scenario outcomes, agent behaviour), the workflow it runs, and the runs made so far, plus the hooks that
 * bring up and tear down the subprocess harness around every scenario of the feature. The scenarios run real
 * orchestrator processes through the regression suite's harness, so these hooks do what its
 * `@regression and (@subprocess or @webhook)` hooks do. The feature-989 park-comment scenarios that also carry
 * `@adw-990` run no workflow and are left to their own hooks. The workflow scenarios of feature-993 run on the same
 * harness, with a `web` repository and agents that change what the dev server does; the feature-992 scenario that
 * carries `@adw-993` keeps its own hooks.
 */

import { After, Before } from '@cucumber/cucumber';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import { createSubprocessHarness } from '../../regression/support/subprocessHarness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

import { resetWorld } from '../../regression/step_definitions/feature-796.steps.ts';
import type { ConfiguredCheck } from '../../regression/step_definitions/feature-988-commands.ts';
import { s as state988 } from '../../regression/step_definitions/feature-988-world.ts';
import { scratchPaths, type ScenarioOutcomes, type ScratchPaths } from './feature-990-scripts.ts';

export const BASE_BRANCH = 'dev';

export type ServerSetup =
  | { readonly kind: 'none' }
  | { readonly kind: 'healthy' }
  | { readonly kind: 'broken'; readonly standardError: string };

export interface WorkflowSetup {
  /** As the scenario names it: `adwSdlc`. */
  readonly orchestrator: string;
  /** The name the subprocess harness runs it under. */
  readonly harnessName: string;
  readonly issue: number;
  readonly adwId: string;
}

export interface RunRecord {
  readonly exitCode: number | null;
  readonly output: string;
  readonly startedAt: number;
  readonly endedAt: number;
}

export type ScenarioFixAgent = 'fixes' | 'nothing';

/** `.adw/commands.md` declares the same server on both branches, so what an agent does to it is left in the worktree as a marker. */
export type ServerEffect =
  | { readonly kind: 'breaks'; readonly standardError: string }
  | { readonly kind: 'fixes' };

export interface ServerEffects {
  /** The build agents: the one that builds the issue, and the one that builds each review patch. */
  readonly build: ServerEffect | null;
  /** The review patch agent. */
  readonly patch: ServerEffect | null;
}

export type ReviewSetup =
  | { readonly kind: 'passes' }
  | { readonly kind: 'blocks'; readonly blocker: string };

export interface State990 {
  world: RegressionWorld | null;
  scratch: ScratchPaths | null;
  /** Null: every static check passes. */
  checks: readonly ConfiguredCheck[] | null;
  server: ServerSetup;
  scenarios: ScenarioOutcomes[];
  requiresServer: boolean;
  scenarioFixAgent: ScenarioFixAgent;
  /** The error the build agent is made to fail with, or null. */
  buildFailure: string | null;
  serverEffects: ServerEffects;
  review: ReviewSetup;
  /** The target repository declares the application type "web", and its scenarios run on ADW's Playwright project. */
  web: boolean;
  /** The issue's scenarios fail unless the dev server answers while they run. */
  issueScenariosNeedServer: boolean;
  workflow: WorkflowSetup | null;
  /** Whether the target workspace has been committed to the base branch yet. */
  built: boolean;
  runs: RunRecord[];
  /** How many comments on each issue the recording tracker of feature-796 has been given. */
  syncedComments: Map<number, number>;
}

function freshState(): State990 {
  return {
    world: null,
    scratch: null,
    checks: null,
    server: { kind: 'none' },
    scenarios: [],
    requiresServer: false,
    scenarioFixAgent: 'nothing',
    buildFailure: null,
    serverEffects: { build: null, patch: null },
    review: { kind: 'passes' },
    web: false,
    issueScenariosNeedServer: false,
    workflow: null,
    built: false,
    runs: [],
    syncedComments: new Map(),
  };
}

export const s: State990 = freshState();

export function resetState(): void {
  Object.assign(s, freshState());
}

export function requireWorld(): RegressionWorld {
  if (!s.world) throw new Error('Expected the @adw-990 Before hook to have set up the subprocess harness');
  return s.world;
}

export function requireScratch(): ScratchPaths {
  if (!s.scratch) throw new Error('Expected the @adw-990 Before hook to have made a scratch directory');
  return s.scratch;
}

export function requireWorkflowSetup(): WorkflowSetup {
  if (!s.workflow) throw new Error('Expected a workflow to have been described first');
  return s.workflow;
}

const OWN_SCENARIOS = '(@adw-990 and not @adw-989) or (@adw-993 and not @adw-992)';

function forgetWorkflow(): void {
  resetWorld();
  state988.workflow = null;
}

/** The hook bodies are exported for the scenarios of other features that run this feature's workflows. */
export async function setUpWorld990(world: RegressionWorld): Promise<void> {
  resetState();
  forgetWorkflow();
  s.world = world;
  world.mockContext = await setupMockInfrastructure();
  world.subprocess = createSubprocessHarness(world);

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-990-'));
  s.scratch = scratchPaths(scratchDir);
  world.cleanup.push(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
}

export async function tearDownWorld990(world: RegressionWorld): Promise<void> {
  await runCleanup(world);
  await teardownMockInfrastructure();
  world.mockContext = null;
  world.subprocess = null;
  world.lastExitCode = -1;
  world.lastOutput = '';
  world.harnessEnv = {};
  world.cleanup = [];
  resetState();
  forgetWorkflow();
}

Before({ tags: OWN_SCENARIOS }, function (this: RegressionWorld) {
  return setUpWorld990(this);
});

After({ tags: OWN_SCENARIOS }, function (this: RegressionWorld) {
  return tearDownWorld990(this);
});
