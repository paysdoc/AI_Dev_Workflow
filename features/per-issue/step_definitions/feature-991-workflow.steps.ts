/**
 * Workflow scenarios of feature-991. Each builds feature-929's throwaway workflow, commits the scenario's
 * ".adw/project.md" into its worktree, and runs the application-type step of the workflow's start over it (see
 * feature-991-start.ts). The steps of feature-989 that read a park comment, count park comments and post "## Retry"
 * are not defined again here: they act on the same shared workflow.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { AgentStateManager } from '../../../adws/core/agentState.ts';

import { commitFile, createWorkflow, type Workflow929 } from '../../regression/step_definitions/feature-929-workflow.ts';
import { requireWorkflow } from './feature-988-phase.steps.ts';
import { s as sharedWorld } from '../../regression/step_definitions/feature-988-world.ts';
import { parkCommentsOn, requireParkCommentOn } from './feature-989-comments.ts';
import { commitToDefaultBranch, publishDefaultBranch } from './feature-991-git.ts';
import { PROJECT_MD, assertApplicationTypeSection, assertProjectMdFile, projectMd } from '../../regression/step_definitions/feature-991-project-md.ts';
import { describeStart, startWorkflow } from './feature-991-start.ts';
import { s, type StartOutcome } from './feature-991-world.ts';

const TARGET_REPOSITORY = 'adw-fixture/void-991';
const PARKED_STAGE = 'human_gated';

function topLevelStage(workflow: Workflow929): string | undefined {
  return AgentStateManager.readTopLevelState(workflow.adwId)?.workflowStage;
}

function workflowFor(issueNumber: number): Workflow929 {
  const workflow = requireWorkflow();
  assert.strictEqual(workflow.issueNumber, issueNumber, `Expected the scenario's workflow to be the one for issue ${issueNumber}`);
  return workflow;
}

function requireStart(): StartOutcome {
  assert.ok(s.start, "Expected the workflow's start to have run first");
  return s.start;
}

/** The repository's default branch holds the committed description, as the repository a workflow starts in does. */
function startWorkflowIn(issueNumber: number, description: string): void {
  const workflow = createWorkflow(issueNumber, TARGET_REPOSITORY);
  sharedWorld.workflow = workflow;
  commitFile(workflow.worktreePath, PROJECT_MD, description);
  publishDefaultBranch(workflow);
}

function assertStartStopped(start: StartOutcome): void {
  assert.ok(start.applicationProfile === null && start.exitCode === 0, `Expected the workflow's start to stop the run deliberately (exit code 0), but ${describeStart(start)}`);
}

function assertParked(workflow: Workflow929): void {
  assertStartStopped(requireStart());
  assert.strictEqual(topLevelStage(workflow), PARKED_STAGE, `Expected the workflow to be parked as "${PARKED_STAGE}"`);
}

Given("a workflow for issue {int} whose repository's {string} has no {string} section", function (issueNumber: number, file: string, section: string) {
  assertProjectMdFile(file);
  assertApplicationTypeSection(section);
  startWorkflowIn(issueNumber, projectMd(null));
});

Given("a workflow for issue {int} whose repository's {string} declares the application type {string}", function (issueNumber: number, file: string, applicationType: string) {
  assertProjectMdFile(file);
  startWorkflowIn(issueNumber, projectMd(applicationType));
});

Given("a workflow for issue {int} whose repository's {string} holds:", function (issueNumber: number, file: string, content: string) {
  assertProjectMdFile(file);
  startWorkflowIn(issueNumber, `${content}\n`);
});

Given('the workflow for issue {int} has started and been parked as {string}', function (issueNumber: number, stage: string) {
  assert.strictEqual(stage, PARKED_STAGE, `The stage a park leaves is "${PARKED_STAGE}"`);
  const workflow = workflowFor(issueNumber);
  s.start = startWorkflow(workflow);
  assertParked(workflow);
});

Given("the repository's default branch has since gained a commit whose {string} declares the application type {string}", function (file: string, applicationType: string) {
  assertProjectMdFile(file);
  commitToDefaultBranch(requireWorkflow(), file, projectMd(applicationType));
});

When('the workflow for issue {int} starts', function (issueNumber: number) {
  s.start = startWorkflow(workflowFor(issueNumber));
});

When('the resumed workflow starts', function () {
  s.start = startWorkflow(requireWorkflow());
});

Then("the workflow's start did not complete", function () {
  assertStartStopped(requireStart());
});

Then("the workflow's start completed", function () {
  const start = requireStart();
  assert.ok(start.applicationProfile !== null, `Expected the workflow's start to complete, but ${describeStart(start)}`);
});

Then('the workflow for issue {int} is not parked', function (issueNumber: number) {
  const workflow = workflowFor(issueNumber);
  assert.notStrictEqual(topLevelStage(workflow), PARKED_STAGE, `Expected the workflow for issue ${issueNumber} not to be parked as "${PARKED_STAGE}"`);
});

Then('the park comment posted on issue {int} says that {string} is missing', function (issueNumber: number, section: string) {
  const comment = requireParkCommentOn(issueNumber);
  const saysMissing = comment.split('\n').some(line => line.includes(`\`${section}\``) && line.includes('is missing'));
  assert.ok(saysMissing, `Expected the park comment to say that "${section}" is missing, got:\n${comment}`);
});

Then('the park comment posted on issue {int} names {string}', function (issueNumber: number, name: string) {
  const comment = requireParkCommentOn(issueNumber);
  assert.ok(comment.includes(name), `Expected the park comment to name "${name}", got:\n${comment}`);
});

Then('the park comment posted on issue {int} says to re-run {string}', function (issueNumber: number, command: string) {
  const comment = requireParkCommentOn(issueNumber);
  assert.ok(comment.toLowerCase().includes(`re-run \`${command}\``), `Expected the park comment to say to re-run ${command}, got:\n${comment}`);
});

Then('exactly one park comment was posted on issue {int}', function (issueNumber: number) {
  const comments = parkCommentsOn(issueNumber);
  assert.strictEqual(comments.length, 1, `Expected exactly one park comment on issue ${issueNumber}, got ${comments.length}`);
});
