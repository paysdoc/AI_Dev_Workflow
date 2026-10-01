/**
 * The parts of a workflow file the scenario runner executes: the pull_request trigger, the
 * `env` of the workflow, its jobs and the steps of each. Only the shapes the runner understands
 * are read; anything else throws, so an unexpected edit fails loudly instead of being misread.
 */

import { parseYamlMap, type YamlMap, type YamlNode } from './feature-939-yaml.ts';

export type Shell = 'default' | 'bash';

export interface UsesAction {
  readonly kind: 'uses';
  readonly action: string;
}

export interface RunAction {
  readonly kind: 'run';
  readonly script: string;
  readonly shell: Shell;
  readonly workingDirectory: string | undefined;
}

export type StepAction = UsesAction | RunAction;

export interface WorkflowStep {
  readonly name: string;
  readonly id: string | undefined;
  readonly condition: string | undefined;
  readonly env: ReadonlyMap<string, string>;
  /** `true`, `false` or an expression, as written. */
  readonly continueOnError: string;
  readonly action: StepAction;
}

export interface WorkflowJob {
  readonly id: string;
  readonly condition: string | undefined;
  readonly needs: readonly string[];
  readonly env: ReadonlyMap<string, string>;
  readonly steps: readonly WorkflowStep[];
}

export interface Workflow {
  readonly env: ReadonlyMap<string, string>;
  readonly jobs: readonly WorkflowJob[];
}

const TOP_LEVEL_KEYS = new Set(['name', 'on', 'env', 'jobs', 'permissions', 'concurrency']);
const JOB_KEYS = new Set(['name', 'runs-on', 'permissions', 'concurrency', 'timeout-minutes', 'if', 'needs', 'env', 'steps']);
const STEP_KEYS = new Set(['name', 'id', 'if', 'uses', 'with', 'env', 'run', 'shell', 'working-directory', 'continue-on-error', 'timeout-minutes']);
const NO_OP_ACTIONS = new Set(['actions/checkout', 'oven-sh/setup-bun', 'actions/setup-node']);

const unsupported = (detail: string): Error => new Error(`Unsupported workflow syntax: ${detail}`);
const isMap = (node: YamlNode | undefined): node is YamlMap => node instanceof Map;
const isSequence = (node: YamlNode | undefined): node is readonly YamlNode[] => Array.isArray(node);

function mapOf(node: YamlNode | undefined, where: string): YamlMap {
  if (!isMap(node)) throw unsupported(`${where} is not a mapping`);
  return node;
}

function stringOf(node: YamlNode | undefined, where: string): string {
  if (typeof node !== 'string') throw unsupported(`${where} is not a single value`);
  return node;
}

function optionalString(node: YamlNode | undefined, where: string): string | undefined {
  return node === undefined ? undefined : stringOf(node, where);
}

function assertKeys(map: YamlMap, allowed: ReadonlySet<string>, where: string): void {
  const unknown = [...map.keys()].find(key => !allowed.has(key));
  if (unknown !== undefined) throw unsupported(`${where} has the key "${unknown}"`);
}

function readEnv(node: YamlNode | undefined, where: string): ReadonlyMap<string, string> {
  if (node === undefined) return new Map();
  return new Map([...mapOf(node, where)].map(([name, value]): [string, string] => [name, stringOf(value, `${where}.${name}`)]));
}

function assertPullRequestTrigger(on: YamlNode | undefined): void {
  if (!isMap(on)) throw unsupported('no block-style "on:" trigger');
  if (!on.has('pull_request')) throw new Error('The workflow does not run for a pull request: its "on:" lists no pull_request');
  if (on.get('pull_request') !== '') throw unsupported('the pull_request trigger has a filter');
}

function readUses(uses: string, where: string): StepAction {
  const action = uses.split('@')[0];
  if (!NO_OP_ACTIONS.has(action)) throw unsupported(`${where} uses ${uses}`);
  return { kind: 'uses', action };
}

function readShell(node: YamlNode | undefined, where: string): Shell {
  const shell = optionalString(node, `${where}.shell`);
  if (shell === undefined) return 'default';
  if (shell !== 'bash') throw unsupported(`${where} runs in the shell "${shell}"`);
  return 'bash';
}

function readAction(step: YamlMap, where: string): StepAction {
  const uses = optionalString(step.get('uses'), `${where}.uses`);
  const run = optionalString(step.get('run'), `${where}.run`);
  if (uses !== undefined && run === undefined) return readUses(uses, where);
  if (run === undefined || uses !== undefined) throw unsupported(`${where} must have one of "uses" and "run"`);

  const workingDirectory = optionalString(step.get('working-directory'), `${where}.working-directory`);
  return { kind: 'run', script: run, shell: readShell(step.get('shell'), where), workingDirectory };
}

function readStep(jobId: string, index: number, node: YamlNode): WorkflowStep {
  const where = `step ${index + 1} of job "${jobId}"`;
  const step = mapOf(node, where);
  assertKeys(step, STEP_KEYS, where);

  const id = optionalString(step.get('id'), `${where}.id`);
  return {
    name: optionalString(step.get('name'), `${where}.name`) ?? id ?? `step ${index + 1}`,
    id,
    condition: optionalString(step.get('if'), `${where}.if`),
    env: readEnv(step.get('env'), `${where}.env`),
    continueOnError: optionalString(step.get('continue-on-error'), `${where}.continue-on-error`) ?? 'false',
    action: readAction(step, where),
  };
}

function readNeeds(node: YamlNode | undefined, where: string): readonly string[] {
  if (node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (!isSequence(node)) throw unsupported(`${where}.needs is not a job or a list of jobs`);
  return node.map(item => stringOf(item, `${where}.needs`));
}

function readJob(id: string, node: YamlNode): WorkflowJob {
  const where = `job "${id}"`;
  const job = mapOf(node, where);
  assertKeys(job, JOB_KEYS, where);

  const steps = job.get('steps');
  if (!isSequence(steps)) throw unsupported(`${where} has no list of steps`);
  return {
    id,
    condition: optionalString(job.get('if'), `${where}.if`),
    needs: readNeeds(job.get('needs'), where),
    env: readEnv(job.get('env'), `${where}.env`),
    steps: steps.map((step, index) => readStep(id, index, step)),
  };
}

export function readWorkflow(text: string): Workflow {
  const root = parseYamlMap(text);
  assertKeys(root, TOP_LEVEL_KEYS, 'the workflow');
  assertPullRequestTrigger(root.get('on'));

  const jobs = mapOf(root.get('jobs'), 'the workflow "jobs"');
  return {
    env: readEnv(root.get('env'), 'the workflow "env"'),
    jobs: [...jobs].map(([id, job]) => readJob(id, job)),
  };
}
