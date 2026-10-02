/**
 * What a workflow run produced, as the Then steps read it: the errors it reported, the warnings it
 * raised, and a report of every step for the message of a failed assertion.
 */

import type { RunResult, StepResult } from './feature-939-runner.ts';
import type { Annotation } from './feature-939-stepProcess.ts';

const annotationText = (annotation: Annotation): string => `${annotation.title} ${annotation.message}`;
const stepsOf = (run: RunResult): StepResult[] => run.jobs.flatMap(job => [...job.steps]);
const annotationsOf = (run: RunResult, level: Annotation['level']): string[] =>
  stepsOf(run).flatMap(step => step.annotations).filter(annotation => annotation.level === level).map(annotationText);

/** The `::error` annotations, and the stdout and stderr of every step that failed. A step's script is not its output and never counts. */
export function errorTexts(run: RunResult): string[] {
  const failedOutput = stepsOf(run).filter(step => step.outcome === 'failure').flatMap(step => [step.stdout, step.stderr]);
  return [...annotationsOf(run, 'error'), ...failedOutput];
}

export function warningTexts(run: RunResult): string[] {
  return annotationsOf(run, 'warning');
}

const indented = (label: string, text: string): string[] =>
  text.trim() === '' ? [] : [`    ${label}:`, ...text.trimEnd().split('\n').map(line => `      ${line}`)];

function describeStep(step: StepResult): string[] {
  const outcome = step.outcome === step.conclusion ? '' : ` (its outcome was ${step.outcome})`;
  const annotations = step.annotations.map(annotation => `::${annotation.level} title=${annotation.title}::${annotation.message}`);
  return [
    `  step "${step.name}": ${step.conclusion}${outcome}`,
    ...indented('annotations', annotations.join('\n')),
    ...indented('stdout', step.stdout),
    ...indented('stderr', step.stderr),
  ];
}

export function describeRun(run: RunResult): string {
  const invalid = run.invalid.map(problem => `The workflow is invalid: ${problem}`);
  const jobs = run.jobs.flatMap(job => [`job "${job.id}": ${job.conclusion}`, ...job.steps.flatMap(describeStep)]);
  return [`The workflow run concluded with ${run.conclusion}.`, ...invalid, ...jobs].join('\n');
}
