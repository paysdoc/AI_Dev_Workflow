/**
 * What the feature-990 scenarios share: one scenario's description of its target repository (static checks,
 * dev server, scenario outcomes, agent behaviour), the workflow it runs, and the runs made so far, plus the hooks that
 * bring up and tear down the subprocess harness around every scenario of the feature. The scenarios run real
 * orchestrator processes through the regression suite's harness, so these hooks do what its
 * `@regression and (@subprocess or @webhook)` hooks do. The feature-989 park-comment scenarios that also carry
 * `@adw-990` run no workflow and are left to their own hooks.
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
import type { ConfiguredCheck } from './feature-988-commands.ts';
import { s as state988 } from './feature-988-world.ts';
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

const OWN_SCENARIOS = '@adw-990 and not @adw-989';

function forgetWorkflow(): void {
  resetWorld();
  state988.workflow = null;
}

Before({ tags: OWN_SCENARIOS }, async function (this: RegressionWorld) {
  resetState();
  forgetWorkflow();
  s.world = this;
  this.mockContext = await setupMockInfrastructure();
  this.subprocess = createSubprocessHarness(this);

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-990-'));
  s.scratch = scratchPaths(scratchDir);
  this.cleanup.push(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
});

After({ tags: OWN_SCENARIOS }, async function (this: RegressionWorld) {
  await runCleanup(this);
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.subprocess = null;
  this.lastExitCode = -1;
  this.lastOutput = '';
  this.harnessEnv = {};
  this.cleanup = [];
  resetState();
  forgetWorkflow();
});
