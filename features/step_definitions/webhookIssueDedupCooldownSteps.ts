import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import { extractAdwIdFromComment } from '../../adws/core/workflowCommentParsing.ts';

// Shared context for regex behavioral tests
const regexCtx: { commentBody: string; adwIdResult: string | null } = {
  commentBody: '',
  adwIdResult: null,
};

// ── Cooldown guard structural checks ──────────────────────────────────────────

Then(
  '"shouldTriggerIssueWorkflow" is called in the issue_comment handler before "classifyAndSpawnWorkflow"',
  function () {
    const content = sharedCtx.fileContent;
    const issueCommentIdx = content.indexOf("event === 'issue_comment'");
    assert.ok(
      issueCommentIdx !== -1,
      `Expected "event === 'issue_comment'" handler to be present in ${sharedCtx.filePath}`,
    );
    // Locate the next top-level event handler block to bound the issue_comment section
    const nextEventIdx = content.indexOf("event === 'pull_request'", issueCommentIdx);
    const handlerSection =
      nextEventIdx !== -1
        ? content.slice(issueCommentIdx, nextEventIdx)
        : content.slice(issueCommentIdx);

    const guardCallIdx = handlerSection.indexOf('shouldTriggerIssueWorkflow(');
    assert.ok(
      guardCallIdx !== -1,
      'Expected shouldTriggerIssueWorkflow to be called inside the issue_comment handler',
    );
    const classifyCallIdx = handlerSection.indexOf('classifyAndSpawnWorkflow(');
    assert.ok(
      classifyCallIdx !== -1,
      'Expected classifyAndSpawnWorkflow to be called inside the issue_comment handler',
    );
    assert.ok(
      guardCallIdx < classifyCallIdx,
      'Expected shouldTriggerIssueWorkflow to be called before classifyAndSpawnWorkflow in the handler',
    );
  },
);

Then('the shouldTriggerIssueWorkflow function uses a 60-second cooldown', function () {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function shouldTriggerIssueWorkflow');
  assert.ok(
    fnIdx !== -1,
    `Expected shouldTriggerIssueWorkflow to be defined as a function in ${sharedCtx.filePath}`,
  );
  const fnEnd = content.indexOf('\n}', fnIdx);
  const fnBody = fnEnd !== -1 ? content.slice(fnIdx, fnEnd + 2) : content.slice(fnIdx);
  // The function must reference a 60-second value directly or via a named constant
  const has60k = fnBody.includes('60_000') || fnBody.includes('60000');
  const hasConstantRef = fnBody.includes('COOLDOWN_MS') || fnBody.includes('COOLDOWN');
  assert.ok(
    has60k || hasConstantRef,
    'Expected shouldTriggerIssueWorkflow to reference a 60-second (60_000 ms) cooldown',
  );
});

Then('"shouldTriggerIssueWorkflow" is not exported from the file', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes('export function shouldTriggerIssueWorkflow') &&
      !content.includes('export const shouldTriggerIssueWorkflow'),
    'Expected shouldTriggerIssueWorkflow to not be exported',
  );
  assert.ok(
    content.includes('shouldTriggerIssueWorkflow'),
    'Expected shouldTriggerIssueWorkflow to still be defined in the file',
  );
});

Then(
  'the issue_comment handler returns an ignored response when shouldTriggerIssueWorkflow returns false',
  function () {
    const content = sharedCtx.fileContent;
    // The guard pattern should short-circuit with an "ignored" response on false return
    assert.ok(
      content.includes('shouldTriggerIssueWorkflow'),
      'Expected shouldTriggerIssueWorkflow to be present in the file',
    );
    assert.ok(
      content.includes("'ignored'") || content.includes('"ignored"'),
      'Expected an ignored response to be returned for deduplicated issue triggers',
    );
  },
);

// ── extractAdwIdFromComment regex structural check ────────────────────────────

Then('the extractAdwIdFromComment regex does not require an "adw-" prefix', function () {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function extractAdwIdFromComment');
  assert.ok(fnIdx !== -1, `Expected extractAdwIdFromComment function to exist in ${sharedCtx.filePath}`);
  const fnEnd = content.indexOf('\n}', fnIdx);
  const fnBody = fnEnd !== -1 ? content.slice(fnIdx, fnEnd + 2) : content.slice(fnIdx);
  // The old regex started with `adw-` as a required literal — the fix must remove it
  assert.ok(
    !fnBody.includes('`(adw-'),
    'Expected extractAdwIdFromComment regex to not require an "adw-" literal prefix in the capture group',
  );
});

// ── extractAdwIdFromComment behavioral checks ─────────────────────────────────

Given(
  'a comment body containing the backtick-wrapped ADW ID {string}',
  function (adwId: string) {
    regexCtx.commentBody = `## :rocket: ADW Workflow Started\n\n**ADW ID:** \`${adwId}\`\n\n---\n_Posted by ADW_`;
  },
);

Given('a comment body with no backtick-wrapped ADW ID', function () {
  regexCtx.commentBody =
    '## :rocket: ADW Workflow Started\n\nNo ID referenced here.\n\n---\n_Posted by ADW_';
});

When('extractAdwIdFromComment is called on the comment body', function () {
  regexCtx.adwIdResult = extractAdwIdFromComment(regexCtx.commentBody);
});

Then('the returned ADW ID is {string}', function (expected: string) {
  assert.strictEqual(
    regexCtx.adwIdResult,
    expected,
    `Expected extractAdwIdFromComment to return "${expected}" but got "${regexCtx.adwIdResult}"`,
  );
});

Then('extractAdwIdFromComment returns null', function () {
  assert.strictEqual(
    regexCtx.adwIdResult,
    null,
    `Expected extractAdwIdFromComment to return null but got "${regexCtx.adwIdResult}"`,
  );
});
