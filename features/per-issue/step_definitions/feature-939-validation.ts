/**
 * What GitHub rejects before it runs a single step: an expression that names a context which its
 * place in the file does not offer, such as `secrets` in an `if:`. The run of such a workflow fails
 * with an error and no step runs, with the secret or without it.
 */

import { contextsNotOfferedAt, contextsOfCondition, contextsOfTemplate, type Place } from './feature-939-expressions.ts';
import type { Workflow, WorkflowJob, WorkflowStep } from './feature-939-workflow.ts';

function problems(place: Place, where: string, contexts: readonly string[]): string[] {
  return contextsNotOfferedAt(place, contexts).map(context => `Unrecognized named-value: '${context}' in the ${place} of ${where}`);
}

function envProblems(place: Place, where: string, env: ReadonlyMap<string, string>): string[] {
  return [...env.values()].flatMap(value => problems(place, where, contextsOfTemplate(value)));
}

function conditionProblems(place: Place, where: string, condition: string | undefined): string[] {
  return condition === undefined ? [] : problems(place, where, contextsOfCondition(condition));
}

function stepProblems(job: WorkflowJob, step: WorkflowStep): string[] {
  const where = `step "${step.name}" of job "${job.id}"`;
  const { action } = step;
  const runTexts = action.kind === 'run' ? [action.script, action.workingDirectory ?? ''] : [];
  return [
    ...conditionProblems('step if', where, step.condition),
    ...envProblems('step env', where, step.env),
    ...[...runTexts, step.continueOnError].flatMap(text => problems('step run', where, contextsOfTemplate(text))),
  ];
}

function jobProblems(job: WorkflowJob): string[] {
  const where = `job "${job.id}"`;
  return [
    ...conditionProblems('job if', where, job.condition),
    ...envProblems('job env', where, job.env),
    ...job.steps.flatMap(step => stepProblems(job, step)),
  ];
}

export function invalidExpressions(workflow: Workflow): string[] {
  return [...envProblems('workflow env', 'the workflow', workflow.env), ...workflow.jobs.flatMap(jobProblems)];
}
