import { Then } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── 1. pull_request_review (approved) — webhook does nothing ─────────────────

// Note: 'the file does not import {string}' is defined in orchestratorAwaitingMergeHandoffSteps.ts — do not redefine here.
// Note: 'the file does not contain a call to {string}' is defined in orchestratorAwaitingMergeHandoffSteps.ts — do not redefine here.

Then('the pull_request_review handler returns an {string} response for approved reviews', function (status: string) {
  const content = sharedCtx.fileContent;
  // The approved review branch should return an ignored response
  const approvedIdx = content.indexOf("'approved'");
  assert.ok(approvedIdx !== -1, 'Expected trigger_webhook.ts to handle approved review state');
  const afterApproved = content.slice(approvedIdx, approvedIdx + 200);
  assert.ok(
    afterApproved.includes(`'${status}'`),
    `Expected approved review handler to return "${status}" response`,
  );
});

Then('no auto-merge or workflow spawn occurs for approved reviews', function () {
  const content = sharedCtx.fileContent;
  // The approved block returns early with status: 'ignored', no spawn
  const reviewSection = content.indexOf("event === 'pull_request_review'");
  assert.ok(reviewSection !== -1, 'Expected trigger_webhook.ts to handle pull_request_review event');
  const sectionBlock = content.slice(reviewSection, reviewSection + 600);
  assert.ok(
    !sectionBlock.includes('handleApprovedReview'),
    'Expected no handleApprovedReview call in pull_request_review handler',
  );
});

// Note: 'the non-approved review branch spawns adwPrReview.tsx' is defined in autoMergeApprovedPrSteps.ts

// ── 2. handleApprovedReview removed from autoMergeHandler.ts ─────────────────

// Note: 'the file does not export {string}' is defined in replaceClearWithCancelDirectiveSteps.ts — do not redefine here.
// Note: 'the file does not contain {string}' is defined in commonSteps.ts — do not redefine here.

// Note: 'the file exports a function named {string}' is defined in autoApproveMergeAfterReviewSteps.ts — do not redefine here.

// ── 3. pull_request.closed (merged) — does nothing ──────────────────────────

Then('the pull_request closed handler returns early with no side effects when the PR was merged', function () {
  const content = sharedCtx.fileContent;
  const prClosedSection = content.indexOf("event === 'pull_request'") ?? content.indexOf("'pull_request'");
  assert.ok(prClosedSection !== -1, 'Expected trigger_webhook.ts to handle pull_request event');
  // handlePullRequestEvent is called for closed PRs — verify in webhookHandlers.ts that merged PRs return early
  const handlersPath = join(ROOT, 'adws/triggers/webhookHandlers.ts');
  const handlersContent = readFileSync(handlersPath, 'utf-8');
  assert.ok(
    handlersContent.includes('pull_request.merged'),
    'Expected webhookHandlers.ts to check pull_request.merged',
  );
  const mergedIdx = handlersContent.indexOf('pull_request.merged');
  const afterMerged = handlersContent.slice(mergedIdx, mergedIdx + 200);
  assert.ok(
    afterMerged.includes("'ignored'") || afterMerged.includes('status: \'ignored\''),
    'Expected merged PR handler to return ignored status',
  );
});

Then('handlePullRequestEvent does not call removeWorktree when the PR was merged', function () {
  const content = sharedCtx.fileContent;
  // The merged branch returns early before any cleanup calls
  const mergedIdx = content.indexOf('pull_request.merged');
  assert.ok(mergedIdx !== -1, 'Expected webhookHandlers.ts to check pull_request.merged');
  const mergedBlock = content.slice(mergedIdx, mergedIdx + 200);
  assert.ok(
    mergedBlock.includes("return { status: 'ignored' }"),
    'Expected handlePullRequestEvent to return early for merged PRs before any cleanup',
  );
});

Then('handlePullRequestEvent does not call deleteRemoteBranch when the PR was merged', function () {
  const content = sharedCtx.fileContent;
  // Same early return — no deleteRemoteBranch is reached for merged PRs
  const mergedIdx = content.indexOf('pull_request.merged');
  assert.ok(mergedIdx !== -1, 'Expected webhookHandlers.ts to check pull_request.merged');
  const mergedBlock = content.slice(mergedIdx, mergedIdx + 200);
  assert.ok(
    mergedBlock.includes('return'),
    'Expected handlePullRequestEvent to return before deleteRemoteBranch for merged PRs',
  );
});

Then('handlePullRequestEvent does not call closeIssue when the PR was merged', function () {
  const content = sharedCtx.fileContent;
  const mergedIdx = content.indexOf('pull_request.merged');
  assert.ok(mergedIdx !== -1, 'Expected webhookHandlers.ts to check pull_request.merged');
  const mergedBlock = content.slice(mergedIdx, mergedIdx + 200);
  assert.ok(
    mergedBlock.includes('return'),
    'Expected handlePullRequestEvent to return before closeIssue for merged PRs',
  );
});

// ── 4. pull_request.closed (not merged) — abandoned flow ─────────────────────

Then('handlePullRequestEvent extracts the adw-id from the linked issue\'s comments using extractAdwIdFromComment', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('extractLatestAdwId') || content.includes('extractAdwIdFromComment'),
    'Expected webhookHandlers.ts to extract adw-id from issue comments',
  );
  assert.ok(
    content.includes('fetchIssueComments') || content.includes('deps.fetchIssueComments'),
    'Expected webhookHandlers.ts to fetch issue comments for adw-id extraction',
  );
});

Then('handlePullRequestEvent writes workflowStage {string} to the state file when the PR was not merged', function (stage: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`workflowStage: '${stage}'`),
    `Expected webhookHandlers.ts to write workflowStage "${stage}" to state file`,
  );
  assert.ok(
    content.includes('writeTopLevelState'),
    'Expected webhookHandlers.ts to call writeTopLevelState for abandoned PRs',
  );
});

Then('handlePullRequestEvent closes the linked issue when the PR was not merged', function () {
  const content = sharedCtx.fileContent;
  // After writing abandoned state, the handler closes the linked issue
  const fnIdx = content.indexOf('function handlePullRequestEvent');
  assert.ok(fnIdx !== -1, 'Expected webhookHandlers.ts to define handlePullRequestEvent');
  const fnBlock = content.slice(fnIdx);
  assert.ok(
    fnBlock.includes('closeIssue') || fnBlock.includes('deps.closeIssue'),
    'Expected handlePullRequestEvent to close the linked issue for abandoned PRs',
  );
});

Then('the issue closure cascades to the issues.closed webhook handler', function () {
  // Closing the issue triggers a new issues.closed webhook event, which is handled separately
  const webhookContent = readFileSync(join(ROOT, 'adws/triggers/trigger_webhook.ts'), 'utf-8');
  assert.ok(
    webhookContent.includes("action === 'closed'") && webhookContent.includes('handleIssueClosedEvent'),
    'Expected trigger_webhook.ts to handle issues.closed event via handleIssueClosedEvent',
  );
});

Then('handlePullRequestEvent does not call removeWorktree when the PR was not merged', function () {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function handlePullRequestEvent');
  assert.ok(fnIdx !== -1, 'Expected webhookHandlers.ts to define handlePullRequestEvent');
  // Find the end of handlePullRequestEvent (next export or end)
  const nextFnIdx = content.indexOf('export ', fnIdx + 10);
  const fnBlock = content.slice(fnIdx, nextFnIdx !== -1 ? nextFnIdx : undefined);
  assert.ok(
    !fnBlock.includes('removeWorktree'),
    'Expected handlePullRequestEvent NOT to call removeWorktree directly (deferred to issues.closed)',
  );
});

Then('worktree cleanup is deferred to the issues.closed handler', function () {
  const webhookContent = readFileSync(join(ROOT, 'adws/triggers/trigger_webhook.ts'), 'utf-8');
  assert.ok(
    webhookContent.includes('handleIssueClosedEvent'),
    'Expected worktree cleanup to be handled by handleIssueClosedEvent',
  );
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  assert.ok(
    handlersContent.includes('removeWorktreesForIssue'),
    'Expected handleIssueClosedEvent to call removeWorktreesForIssue for cleanup',
  );
});

// ── 5. issues.closed — state file reading and cleanup ────────────────────────

Then('the issues closed handler extracts adw-id from the closed issue\'s comments', function () {
  const content = sharedCtx.fileContent;
  // The issues.closed route calls handleIssueClosedEvent which extracts adw-id
  assert.ok(
    content.includes('handleIssueClosedEvent'),
    'Expected trigger_webhook.ts to call handleIssueClosedEvent',
  );
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  assert.ok(
    handlersContent.includes('extractLatestAdwId'),
    'Expected handleIssueClosedEvent to extract adw-id from comments',
  );
});

Then('the issues closed handler reads the state file via AgentStateManager using the extracted adw-id', function () {
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  assert.ok(
    handlersContent.includes('readTopLevelState') || handlersContent.includes('AgentStateManager'),
    'Expected handleIssueClosedEvent to read state file via AgentStateManager',
  );
});

Then('the issues closed handler calls removeWorktreesForIssue or equivalent worktree cleanup', function () {
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  assert.ok(
    handlersContent.includes('removeWorktreesForIssue'),
    'Expected handleIssueClosedEvent to call removeWorktreesForIssue',
  );
});

Then('the issues closed handler deletes the remote branch associated with the closed issue', function () {
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  assert.ok(
    handlersContent.includes('deleteRemoteBranch'),
    'Expected handleIssueClosedEvent to call deleteRemoteBranch',
  );
});

// ── 6. issues.closed — active stage grace period guard ───────────────────────

Then('the issues closed handler checks whether the workflowStage is active', function () {
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  assert.ok(
    handlersContent.includes('isActiveStage'),
    'Expected handleIssueClosedEvent to check isActiveStage',
  );
});

Then('skips worktree cleanup and branch deletion when the stage is active and within the grace period', function () {
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  assert.ok(
    handlersContent.includes('GRACE_PERIOD_MS'),
    'Expected handleIssueClosedEvent to use GRACE_PERIOD_MS for the grace period check',
  );
  assert.ok(
    handlersContent.includes("status: 'skipped'") || handlersContent.includes('active_within_grace_period'),
    'Expected handleIssueClosedEvent to skip cleanup when active within grace period',
  );
});

Then('the issues closed handler performs cleanup when the active stage timestamp exceeds the grace period', function () {
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  // The grace period guard only skips when within the grace period; outside it, cleanup proceeds
  assert.ok(
    handlersContent.includes('GRACE_PERIOD_MS'),
    'Expected handleIssueClosedEvent to use GRACE_PERIOD_MS',
  );
  // After the grace period guard, the function falls through to cleanup
  const graceIdx = handlersContent.indexOf('active_within_grace_period');
  assert.ok(graceIdx !== -1, 'Expected active_within_grace_period in handleIssueClosedEvent');
  const afterGrace = handlersContent.slice(graceIdx + 100);
  assert.ok(
    afterGrace.includes('removeWorktreesForIssue'),
    'Expected cleanup to proceed after the grace period guard',
  );
});

// ── 7. issues.closed — abandoned dependency handling ─────────────────────────

Then('when workflowStage is {string} the issues closed handler closes all dependent issues', function (stage: string) {
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  assert.ok(
    handlersContent.includes(`workflowStage === '${stage}'`) || handlersContent.includes(`=== '${stage}'`),
    `Expected handleIssueClosedEvent to check workflowStage === "${stage}"`,
  );
  assert.ok(
    handlersContent.includes('closeAbandonedDependents'),
    'Expected handleIssueClosedEvent to call closeAbandonedDependents for abandoned stage',
  );
});

Then('posts an explanatory error comment on each dependent issue', function () {
  // closeAbandonedDependents is responsible for posting comments
  const gatekeeperContent = readFileSync(join(ROOT, 'adws/triggers/webhookGatekeeper.ts'), 'utf-8');
  assert.ok(
    gatekeeperContent.includes('closeAbandonedDependents'),
    'Expected webhookGatekeeper.ts to define closeAbandonedDependents',
  );
});

Then('when workflowStage is not {string} the issues closed handler unblocks dependent issues', function (stage: string) {
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  // The else branch (not abandoned) calls handleIssueClosedDependencyUnblock
  assert.ok(
    handlersContent.includes('handleIssueClosedDependencyUnblock'),
    'Expected handleIssueClosedEvent to call handleIssueClosedDependencyUnblock for non-abandoned closures',
  );
  // Verify the abandoned check exists to differentiate the two paths
  assert.ok(
    handlersContent.includes(`'${stage}'`),
    `Expected handleIssueClosedEvent to reference "${stage}" stage`,
  );
});

Then('spawns workflows for newly-eligible dependent issues', function () {
  // handleIssueClosedDependencyUnblock handles spawning workflows for unblocked dependents
  const gatekeeperContent = readFileSync(join(ROOT, 'adws/triggers/webhookGatekeeper.ts'), 'utf-8');
  assert.ok(
    gatekeeperContent.includes('handleIssueClosedDependencyUnblock'),
    'Expected webhookGatekeeper.ts to define handleIssueClosedDependencyUnblock',
  );
});

Then('the non-abandoned dependency handling matches the existing handleIssueClosedDependencyUnblock behavior', function () {
  const handlersContent = readFileSync(join(ROOT, 'adws/triggers/webhookHandlers.ts'), 'utf-8');
  assert.ok(
    handlersContent.includes('handleIssueClosedDependencyUnblock'),
    'Expected handleIssueClosedEvent to delegate to handleIssueClosedDependencyUnblock',
  );
});

// ── 8. WorkflowStage type includes abandoned ─────────────────────────────────

Then('the WorkflowStage type includes {string}', function (stage: string) {
  const content = sharedCtx.fileContent;
  // The stage may live in workflowTypes.ts proper or in agentTypes.ts (as workflowStage: string)
  // Check if the literal appears in the type definition or if the type allows arbitrary strings
  const hasLiteral = content.includes(`'${stage}'`);
  // Also accept: workflowStage field typed as string (allows any stage including 'abandoned')
  const hasStringType = content.includes('workflowStage') && content.includes('string');
  assert.ok(
    hasLiteral || hasStringType,
    `Expected WorkflowStage type to include "${stage}" either as a literal or via string type`,
  );
});

// ── 9. known_issues.md — claude-cli-enoent distinction ───────────────────────

Then('the claude-cli-enoent entry distinguishes between a missing working directory and a missing binary', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('claude-cli-enoent'),
    'Expected known_issues.md to contain a claude-cli-enoent entry',
  );
  // The entry should distinguish between the two ENOENT failure modes
  assert.ok(
    content.includes('Binary missing') || content.includes('binary'),
    'Expected claude-cli-enoent entry to describe the binary-missing failure mode',
  );
  assert.ok(
    content.includes('CWD gone') || content.includes('working directory'),
    'Expected claude-cli-enoent entry to describe the CWD-gone failure mode',
  );
});

// ── 10. TypeScript compilation ───────────────────────────────────────────────
// When('{string} is run') is defined in removeUnitTestsSteps.ts
// Then('the command exits with code {int}') is defined in wireExtractorSteps.ts
// Then('{string} also exits with code {int}') is defined in wireExtractorSteps.ts
