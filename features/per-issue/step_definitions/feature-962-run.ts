/**
 * Runs `.github/workflows/regression.yml` for an event the way a GitHub runner does, on
 * feature-939's runner: the workflow's `on:` must list the event, a job whose `if:` does not hold
 * is skipped, each job that runs gets a fresh checkout of its own with the `docker` stand-in on its
 * PATH, and `actions/upload-artifact` stores what its steps upload. The workflow file is read only
 * to run it, and a shape the runner does not understand throws, which is a scenario error and never
 * a failed run.
 */

import * as fs from 'fs';
import * as path from 'path';

import { runWorkflow, type RunResult, type RunSandbox } from './feature-939-runner.ts';
import type { WorkflowJob } from './feature-939-workflow.ts';
import { artifactUploader, type StoredArtifact } from './feature-962-artifacts.ts';
import { readDockerCalls } from './feature-962-docker.ts';
import { resolverFor, type RegressionEvent } from './feature-962-event.ts';
import { createJobSandbox, type JobSandbox } from './feature-962-sandbox.ts';
import type { SuiteKind } from './feature-962-suite.ts';

const WORKFLOW_FILE = '.github/workflows/regression.yml';

export interface WorkflowRun {
  readonly result: RunResult;
  readonly artifacts: readonly StoredArtifact[];
  /** The sandbox of each job that started, by job id. */
  readonly sandboxes: ReadonlyMap<string, JobSandbox>;
}

export interface WorkflowRunRequest {
  readonly repoRoot: string;
  /** The directory the run keeps the sandboxes of its jobs in. */
  readonly runRoot: string;
  readonly event: RegressionEvent;
  readonly suite: SuiteKind;
  readonly dockerExitStatus: number;
}

/** What `github.workspace` is before a job has its checkout: a path nothing was ever written to. */
const runSandbox = (runRoot: string): RunSandbox => ({ checkoutDir: path.join(runRoot, 'workspace'), runnerTemp: runRoot, environment: {} });

/** A `docker run` the stand-in could not read would leave a mount unseen, which is a scenario error. */
function assertUnderstood(sandboxes: ReadonlyMap<string, JobSandbox>): void {
  const calls = [...sandboxes.values()].flatMap(sandbox => readDockerCalls(sandbox.callsPath));
  const unknown = calls.find(call => call.unsupported !== undefined);
  if (unknown !== undefined) throw new Error(`The docker stand-in does not understand ${unknown.unsupported} in: docker ${unknown.args.join(' ')}`);
}

export async function runRegressionWorkflow(request: WorkflowRunRequest): Promise<WorkflowRun> {
  const artifacts: StoredArtifact[] = [];
  const sandboxes = new Map<string, JobSandbox>();
  const sandboxFor = (job: WorkflowJob): JobSandbox => {
    const sandbox = createJobSandbox({
      repoRoot: request.repoRoot,
      runRoot: request.runRoot,
      name: job.id,
      eventName: request.event.name,
      suite: request.suite,
      dockerExitStatus: request.dockerExitStatus,
      linkModules: false,
    });
    sandboxes.set(job.id, sandbox);
    return sandbox;
  };

  const workflow = fs.readFileSync(path.join(request.repoRoot, WORKFLOW_FILE), 'utf-8');
  const result = await runWorkflow(workflow, runSandbox(request.runRoot), new Map(), {
    resolveEvent: resolverFor(request.event),
    actions: new Map([['actions/upload-artifact', artifactUploader(artifacts)]]),
    sandboxFor,
  });
  assertUnderstood(sandboxes);
  return { result, artifacts, sandboxes };
}
