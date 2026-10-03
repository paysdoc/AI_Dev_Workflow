/**
 * Runs a workflow file the way a GitHub runner runs it, for a pull request unless the caller names
 * another event. Every job runs in file order with its `if:` evaluated and its `needs:` honoured.
 * Every step has its `if:` and its `env` evaluated, and a `run:` step is started in the sandbox's
 * checkout (feature-939-stepProcess.ts), which is the job's own when the caller gives each job one.
 * The run fails when a job fails, and a workflow that GitHub would reject runs no step at all.
 * Only the shapes feature-939-workflow.ts and feature-939-expressions.ts understand are run;
 * anything else throws, which is a scenario error and never a failed run.
 */

import * as path from 'path';

import {
  conditionHolds, expand, scopeAt, type ContextValues, type Scope, type Status, type StepRecord,
} from './feature-939-expressions.ts';
import type { Sandbox } from './feature-939-sandbox.ts';
import { runScript, type Annotation, type ScriptOutcome } from './feature-939-stepProcess.ts';
import { invalidExpressions } from './feature-939-validation.ts';
import {
  readWorkflow, type EventResolver, type RunAction, type RunEvent, type UsesAction, type WorkflowJob, type WorkflowStep,
} from './feature-939-workflow.ts';

export type Conclusion = 'success' | 'failure' | 'skipped';

export interface StepResult {
  readonly name: string;
  /** What the step did, before `continue-on-error` is applied. */
  readonly outcome: Conclusion;
  readonly conclusion: Conclusion;
  readonly stdout: string;
  readonly stderr: string;
  readonly annotations: readonly Annotation[];
}

export interface JobResult {
  readonly id: string;
  readonly conclusion: Conclusion;
  readonly steps: readonly StepResult[];
}

export interface RunResult {
  readonly conclusion: 'success' | 'failure';
  /** Why GitHub rejects the workflow before it runs a step; empty for a valid workflow. */
  readonly invalid: readonly string[];
  readonly jobs: readonly JobResult[];
}

/** What a run needs of the place it happens in: the checkout its steps start in, and what they start with. */
export type RunSandbox = Pick<Sandbox, 'checkoutDir' | 'runnerTemp' | 'environment'>;

/** What a `uses:` action beyond the no-op ones is asked to do, in the checkout of the job that uses it. */
export interface ActionRequest {
  readonly jobId: string;
  readonly checkoutDir: string;
  /** The step's `with:`, its expressions expanded. */
  readonly inputs: ReadonlyMap<string, string>;
}

/** Reports like a script: a failed outcome fails the step. */
export type ActionHandler = (request: ActionRequest) => ScriptOutcome;

export interface RunOptions {
  /** Reads the workflow's `on:` for the run's event; the workflow must run for a pull request when absent. */
  readonly resolveEvent?: EventResolver;
  /** The actions the workflow may use besides the no-op ones, by name. */
  readonly actions?: ReadonlyMap<string, ActionHandler>;
  /** The sandbox of a job whose `if:` holds; the run's own sandbox when absent. */
  readonly sandboxFor?: (job: WorkflowJob) => RunSandbox;
}

interface RunContext {
  readonly sandbox: RunSandbox;
  readonly secrets: ReadonlyMap<string, string>;
  readonly workflowEnv: ReadonlyMap<string, string>;
  readonly event: RunEvent;
  readonly actions: ReadonlyMap<string, ActionHandler>;
  readonly sandboxFor: (job: WorkflowJob) => RunSandbox;
}

interface JobContext extends RunContext {
  readonly job: WorkflowJob;
  readonly jobEnv: ReadonlyMap<string, string>;
}

/** What the steps before the current one left behind. */
interface JobState {
  readonly failed: boolean;
  readonly githubEnv: ReadonlyMap<string, string>;
  /** Newest first: each directory of `$GITHUB_PATH` goes in front of the ones before it. */
  readonly pathDirs: readonly string[];
  readonly records: ReadonlyMap<string, StepRecord>;
  readonly results: readonly StepResult[];
}

interface StepScopes {
  readonly condition: Scope;
  readonly run: Scope;
  readonly env: ReadonlyMap<string, string>;
}

const INITIAL_STATE: JobState = { failed: false, githubEnv: new Map(), pathDirs: [], records: new Map(), results: [] };
const SUCCEEDING: Status = { success: true, failure: false };
const NOTHING_RAN: ScriptOutcome = { passed: true, stdout: '', stderr: '', annotations: [], env: new Map(), outputs: new Map(), path: [] };

const expandEnv = (env: ReadonlyMap<string, string>, scope: Scope): ReadonlyMap<string, string> =>
  new Map([...env].map(([name, value]): [string, string] => [name, expand(value, scope)]));

function valuesOf(
  context: Pick<RunContext, 'sandbox' | 'secrets' | 'event'>,
  env: ReadonlyMap<string, string>,
  steps: ReadonlyMap<string, StepRecord>,
): ContextValues {
  return { env, eventName: context.event.name, inputs: context.event.inputs, secrets: context.secrets, steps, workspace: context.sandbox.checkoutDir };
}

/** A step's own `env` is set for its `run`, not for its `if:` or for its own `env`. */
function scopesOf(context: JobContext, step: WorkflowStep, state: JobState): StepScopes {
  const status: Status = { success: !state.failed, failure: state.failed };
  const outside = new Map([...context.workflowEnv, ...context.jobEnv, ...state.githubEnv]);
  const stepEnv = expandEnv(step.env, scopeAt('step env', valuesOf(context, outside, state.records), status));
  const env = new Map([...outside, ...stepEnv]);
  return {
    condition: scopeAt('step if', valuesOf(context, outside, state.records), status),
    run: scopeAt('step run', valuesOf(context, env, state.records), status),
    env,
  };
}

function executeRun(context: JobContext, action: RunAction, scopes: StepScopes, state: JobState, index: number): Promise<ScriptOutcome> {
  const { sandbox } = context;
  const workingDirectory = action.workingDirectory === undefined ? '' : expand(action.workingDirectory, scopes.run);
  const searchPath = [...state.pathDirs, scopes.env.get('PATH') ?? sandbox.environment['PATH']].join(path.delimiter);
  return runScript({
    script: expand(action.script, scopes.run),
    shell: action.shell,
    cwd: path.resolve(sandbox.checkoutDir, workingDirectory),
    environment: { ...sandbox.environment, ...Object.fromEntries(scopes.env), PATH: searchPath },
    directory: sandbox.runnerTemp,
    stem: `${context.job.id}-${index + 1}`,
  });
}

/** A failure that `continue-on-error` allows leaves the step concluded as a success. */
function concludeStep(step: WorkflowStep, output: ScriptOutcome, scope: Scope): { outcome: Conclusion; conclusion: Conclusion } {
  if (output.passed) return { outcome: 'success', conclusion: 'success' };
  const continues = expand(step.continueOnError, scope).trim().toLowerCase() === 'true';
  return { outcome: 'failure', conclusion: continues ? 'success' : 'failure' };
}

function recordStep(state: JobState, step: WorkflowStep, outcome: Conclusion, conclusion: Conclusion, output: ScriptOutcome): JobState {
  const result: StepResult = { name: step.name, outcome, conclusion, stdout: output.stdout, stderr: output.stderr, annotations: output.annotations };
  const entry: [string, StepRecord][] = step.id === undefined ? [] : [[step.id, { outcome, conclusion, outputs: output.outputs }]];
  return {
    failed: state.failed || conclusion === 'failure',
    githubEnv: new Map([...state.githubEnv, ...output.env]),
    pathDirs: [...[...output.path].reverse(), ...state.pathDirs],
    records: new Map([...state.records, ...entry]),
    results: [...state.results, result],
  };
}

/** An action the caller handles runs in the job's checkout; the no-op actions do nothing. */
function executeUses(context: JobContext, action: UsesAction, scopes: StepScopes): ScriptOutcome {
  const handler = context.actions.get(action.action);
  if (handler === undefined) return NOTHING_RAN;
  return handler({ jobId: context.job.id, checkoutDir: context.sandbox.checkoutDir, inputs: expandEnv(action.inputs, scopes.run) });
}

async function runStep(context: JobContext, step: WorkflowStep, index: number, state: JobState): Promise<JobState> {
  const scopes = scopesOf(context, step, state);
  if (!conditionHolds(step.condition, scopes.condition)) return recordStep(state, step, 'skipped', 'skipped', NOTHING_RAN);

  const output = step.action.kind === 'run' ? await executeRun(context, step.action, scopes, state, index) : executeUses(context, step.action, scopes);
  const { outcome, conclusion } = concludeStep(step, output, scopes.run);
  return recordStep(state, step, outcome, conclusion, output);
}

async function runSteps(context: JobContext): Promise<readonly StepResult[]> {
  let state = INITIAL_STATE;
  for (const [index, step] of context.job.steps.entries()) {
    state = await runStep(context, step, index, state);
  }
  return state.results;
}

function neededJob(finished: readonly JobResult[], job: WorkflowJob, id: string): JobResult {
  const needed = finished.find(result => result.id === id);
  if (needed === undefined) throw new Error(`Unsupported workflow syntax: job "${job.id}" needs "${id}", which is not a job above it`);
  return needed;
}

async function runJob(job: WorkflowJob, finished: readonly JobResult[], run: RunContext): Promise<JobResult> {
  const needed = job.needs.map(id => neededJob(finished, job, id));
  const status: Status = {
    success: needed.every(result => result.conclusion === 'success'),
    failure: needed.some(result => result.conclusion === 'failure'),
  };
  const values = valuesOf(run, new Map(), new Map());
  if (!conditionHolds(job.condition, scopeAt('job if', values, status))) return { id: job.id, conclusion: 'skipped', steps: [] };

  const jobEnv = expandEnv(job.env, scopeAt('job env', values, status));
  const steps = await runSteps({ ...run, sandbox: run.sandboxFor(job), job, jobEnv });
  return { id: job.id, conclusion: steps.some(step => step.conclusion === 'failure') ? 'failure' : 'success', steps };
}

async function runJobs(jobs: readonly WorkflowJob[], run: RunContext): Promise<readonly JobResult[]> {
  const results: JobResult[] = [];
  for (const job of jobs) {
    results.push(await runJob(job, results, run));
  }
  return results;
}

/** Runs the workflow `text` in `sandbox`, with the repository's `secrets`, for a pull request unless `options` name the event. */
export async function runWorkflow(
  text: string,
  sandbox: RunSandbox,
  secrets: ReadonlyMap<string, string>,
  options: RunOptions = {},
): Promise<RunResult> {
  const { resolveEvent, actions = new Map<string, ActionHandler>(), sandboxFor = () => sandbox } = options;
  const workflow = readWorkflow(text, { resolveEvent, actions: new Set(actions.keys()) });
  const invalid = invalidExpressions(workflow);
  if (invalid.length > 0) return { conclusion: 'failure', invalid, jobs: [] };

  const event = workflow.event;
  const workflowEnv = expandEnv(workflow.env, scopeAt('workflow env', valuesOf({ sandbox, secrets, event }, new Map(), new Map()), SUCCEEDING));
  const jobs = await runJobs(workflow.jobs, { sandbox, secrets, workflowEnv, event, actions, sandboxFor });
  return { conclusion: jobs.some(job => job.conclusion === 'failure') ? 'failure' : 'success', invalid: [], jobs };
}
