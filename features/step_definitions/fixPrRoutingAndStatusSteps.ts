import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

// ── A: Review status transition ──────────────────────────────────────────────

Then('the file contains {string} referencing BoardStatus', function (_keyword: string) {
  const content = sharedCtx.fileContent;
  // Check for any import statement that includes BoardStatus
  const lines = content.split('\n');
  const importLine = lines.find(
    (l) => l.includes('import') && l.includes('BoardStatus'),
  );
  assert.ok(
    importLine !== undefined,
    `Expected "${sharedCtx.filePath}" to contain an import statement referencing BoardStatus`,
  );
});

// ── B: prAgent.ts — JSON extraction ─────────────────────────────────────────

Then('the extractOutput function parses JSON with title and body fields', function () {
  const content = sharedCtx.fileContent;
  // The agent no longer has extractPrUrlFromOutput — it uses extractPrContentFromOutput
  // which parses JSON with title and body fields.
  const hasJsonParse = content.includes('JSON.parse') || content.includes('parsed.title');
  assert.ok(
    hasJsonParse,
    `Expected "${sharedCtx.filePath}" to contain JSON parsing for title and body fields`,
  );
  const hasTitleField =
    content.includes("parsed.title") ||
    (content.includes('"title"') && content.includes('"body"')) ||
    content.includes("typeof parsed.title");
  assert.ok(
    hasTitleField,
    `Expected "${sharedCtx.filePath}" to parse a "title" field from the agent's JSON output`,
  );
  const hasBodyField =
    content.includes("parsed.body") ||
    content.includes("typeof parsed.body");
  assert.ok(
    hasBodyField,
    `Expected "${sharedCtx.filePath}" to parse a "body" field from the agent's JSON output`,
  );
});

// ── B: prPhase.ts — programmatic push before createMergeRequest ─────────────

Then(
  'the file contains {string} or a programmatic git push call before createMergeRequest',
  function (keyword: string) {
    const content = sharedCtx.fileContent;
    const hasPushBranch =
      content.includes(keyword) ||
      content.includes('pushBranch') ||
      content.includes('git push');
    assert.ok(
      hasPushBranch,
      `Expected "${sharedCtx.filePath}" to contain "${keyword}" or a programmatic git push call before createMergeRequest`,
    );
    // Verify push comes before createMergeRequest
    const pushIdx =
      content.indexOf(keyword) !== -1
        ? content.indexOf(keyword)
        : content.indexOf('pushBranch') !== -1
          ? content.indexOf('pushBranch')
          : content.indexOf('git push');
    const createIdx = content.indexOf('createMergeRequest');
    if (createIdx !== -1 && pushIdx !== -1) {
      assert.ok(
        pushIdx < createIdx,
        `Expected push call to appear before createMergeRequest in "${sharedCtx.filePath}"`,
      );
    }
  },
);

// ── B: prPhase.ts — ctx receives prUrl and PR number ────────────────────────

Then('ctx receives prUrl from the createMergeRequest result', function () {
  const content = sharedCtx.fileContent;
  // prPhase.ts sets ctx.prUrl from the createMergeRequest result
  const hasCtxPrUrl =
    content.includes('ctx.prUrl') &&
    (content.includes('.url') || content.includes('mrResult'));
  assert.ok(
    hasCtxPrUrl,
    `Expected "${sharedCtx.filePath}" to assign ctx.prUrl from the createMergeRequest result`,
  );
});

Then('ctx receives a PR number from the createMergeRequest result', function () {
  const content = sharedCtx.fileContent;
  // prPhase.ts should store the PR number from mrResult.number or similar
  const hasPrNumber =
    content.includes('mrResult.number') ||
    content.includes('ctx.prNumber') ||
    (content.includes('.number') && content.includes('mrResult'));
  assert.ok(
    hasPrNumber,
    `Expected "${sharedCtx.filePath}" to store a PR number from the createMergeRequest result`,
  );
});

// ── C: CodeHost interface — createMergeRequest return type ──────────────────

Then('the createMergeRequest return type includes url and number fields', function () {
  const content = sharedCtx.fileContent;
  // MergeRequestResult interface should have url and number
  const hasMergeRequestResult =
    content.includes('MergeRequestResult') ||
    (content.includes('url') && content.includes('number') && content.includes('createMergeRequest'));
  assert.ok(
    hasMergeRequestResult,
    `Expected "${sharedCtx.filePath}" to define a createMergeRequest return type with url and number fields`,
  );
  // Verify both url and number are present in the result type definition
  const resultTypeIdx = content.indexOf('MergeRequestResult');
  if (resultTypeIdx !== -1) {
    const typeBody = content.slice(resultTypeIdx, resultTypeIdx + 200);
    assert.ok(
      typeBody.includes('url') && typeBody.includes('number'),
      `Expected MergeRequestResult to contain both url and number fields`,
    );
  }
});

// ── C: provider createMergeRequest returns { url, number } ──────────────────

Then(
  'the createMergeRequest method returns an object with url and number properties',
  function () {
    const content = sharedCtx.fileContent;
    // Find the createMergeRequest method body
    const methodIdx = content.indexOf('createMergeRequest(');
    assert.ok(
      methodIdx !== -1,
      `Expected "${sharedCtx.filePath}" to contain a createMergeRequest method`,
    );
    // Slice from the method definition onwards to find its body
    const methodBody = content.slice(methodIdx, methodIdx + 1000);
    const returnsUrl =
      methodBody.includes('url:') ||
      methodBody.includes('.url') ||
      methodBody.includes('web_url') ||
      methodBody.includes('prUrl');
    const returnsNumber =
      methodBody.includes('number:') ||
      methodBody.includes('.number') ||
      methodBody.includes('.iid');
    assert.ok(
      returnsUrl,
      `Expected createMergeRequest in "${sharedCtx.filePath}" to return an object with a url property`,
    );
    assert.ok(
      returnsNumber,
      `Expected createMergeRequest in "${sharedCtx.filePath}" to return an object with a number property`,
    );
  },
);

// ── C: GitHubCodeHost — no pullRequestCreator import ────────────────────────

Then(
  'the file does not contain {string} referencing {string}',
  function (keyword: string, target: string) {
    const content = sharedCtx.fileContent;
    const lines = content.split('\n');
    const offendingLine = lines.find(
      (l) => l.includes(keyword) && l.includes(target),
    );
    assert.ok(
      offendingLine === undefined,
      `Expected "${sharedCtx.filePath}" not to contain an "${keyword}" statement referencing "${target}", but found: ${offendingLine?.trim()}`,
    );
  },
);

// ── D: webhookHandlers — extractIssueNumberFromBranch uses only issue-N ─────

Then(
  'extractIssueNumberFromBranch contains the {string} pattern',
  function (pattern: string) {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function extractIssueNumberFromBranch');
    assert.ok(
      funcStart !== -1,
      'Expected extractIssueNumberFromBranch function in the file',
    );
    const funcBody = content.slice(funcStart, funcStart + 600);
    assert.ok(
      funcBody.includes(pattern),
      `Expected extractIssueNumberFromBranch to contain the pattern "${pattern}"`,
    );
  },
);

Then(
  'extractIssueNumberFromBranch does not contain the ADW branch format regex',
  function () {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function extractIssueNumberFromBranch');
    assert.ok(
      funcStart !== -1,
      'Expected extractIssueNumberFromBranch function in the file',
    );
    const funcBody = content.slice(funcStart, funcStart + 600);
    // ADW branch format regex includes branch type prefixes like feat|bug|chore
    const hasAdwPattern =
      funcBody.match(/feat\|feature\|bug\|bugfix\|chore\|fix\|hotfix/) !== null ||
      funcBody.match(/feat\|bug\|chore\|fix\|feature\|bugfix\|hotfix/) !== null ||
      funcBody.match(/\(?feat|feature|bug|bugfix|chore|fix|hotfix\)?/) !== null;
    assert.ok(
      !hasAdwPattern,
      'Expected extractIssueNumberFromBranch NOT to contain the ADW branch type prefix regex (feat|bug|chore etc.) — it should use only the issue-N pattern',
    );
  },
);

// ── fix_pr_review_issue_number: extractIssueNumberFromBranch issue-N only ───

Then(
  'extractIssueNumberFromBranch matches branches containing {string}',
  function (pattern: string) {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('function extractIssueNumberFromBranch');
    assert.ok(
      funcStart !== -1,
      'Expected extractIssueNumberFromBranch function in the file',
    );
    const funcBody = content.slice(funcStart, funcStart + 600);
    // The simplified function should contain the given pattern
    assert.ok(
      funcBody.includes(pattern.replace(/\\\\/g, '\\')),
      `Expected extractIssueNumberFromBranch to match branches containing the pattern "${pattern}"`,
    );
  },
);
