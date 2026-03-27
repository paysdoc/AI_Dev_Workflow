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

// ── B: prPhase.ts — programmatic push before createPullRequest ─────────────

Then(
  'the file contains {string} or a programmatic git push call before createPullRequest',
  function (keyword: string) {
    const content = sharedCtx.fileContent;
    const hasPushBranch =
      content.includes(keyword) ||
      content.includes('pushBranch') ||
      content.includes('git push');
    assert.ok(
      hasPushBranch,
      `Expected "${sharedCtx.filePath}" to contain "${keyword}" or a programmatic git push call before createPullRequest`,
    );
    // Verify push comes before createPullRequest
    const pushIdx =
      content.indexOf(keyword) !== -1
        ? content.indexOf(keyword)
        : content.indexOf('pushBranch') !== -1
          ? content.indexOf('pushBranch')
          : content.indexOf('git push');
    const createIdx = content.indexOf('createPullRequest');
    if (createIdx !== -1 && pushIdx !== -1) {
      assert.ok(
        pushIdx < createIdx,
        `Expected push call to appear before createPullRequest in "${sharedCtx.filePath}"`,
      );
    }
  },
);

// ── B: prPhase.ts — ctx receives prUrl and PR number ────────────────────────

Then('ctx receives prUrl from the createPullRequest result', function () {
  const content = sharedCtx.fileContent;
  // prPhase.ts sets ctx.prUrl from the createPullRequest result
  const hasCtxPrUrl =
    content.includes('ctx.prUrl') &&
    (content.includes('.url') || content.includes('prResult'));
  assert.ok(
    hasCtxPrUrl,
    `Expected "${sharedCtx.filePath}" to assign ctx.prUrl from the createPullRequest result`,
  );
});

Then('ctx receives a PR number from the createPullRequest result', function () {
  const content = sharedCtx.fileContent;
  // prPhase.ts should store the PR number from prResult.number or similar
  const hasPrNumber =
    content.includes('prResult.number') ||
    content.includes('ctx.prNumber') ||
    (content.includes('.number') && content.includes('prResult'));
  assert.ok(
    hasPrNumber,
    `Expected "${sharedCtx.filePath}" to store a PR number from the createPullRequest result`,
  );
});

// ── C: CodeHost interface — createPullRequest return type ──────────────────

Then('the createPullRequest return type includes url and number fields', function () {
  const content = sharedCtx.fileContent;
  // PullRequestResult interface should have url and number
  const hasPullRequestResult =
    content.includes('PullRequestResult') ||
    (content.includes('url') && content.includes('number') && content.includes('createPullRequest'));
  assert.ok(
    hasPullRequestResult,
    `Expected "${sharedCtx.filePath}" to define a createPullRequest return type with url and number fields`,
  );
  // Verify both url and number are present in the result type definition
  const resultTypeIdx = content.indexOf('PullRequestResult');
  if (resultTypeIdx !== -1) {
    const typeBody = content.slice(resultTypeIdx, resultTypeIdx + 200);
    assert.ok(
      typeBody.includes('url') && typeBody.includes('number'),
      `Expected PullRequestResult to contain both url and number fields`,
    );
  }
});

// ── C: provider createPullRequest returns { url, number } ──────────────────

Then(
  'the createPullRequest method returns an object with url and number properties',
  function () {
    const content = sharedCtx.fileContent;
    // Find the createPullRequest method body
    const methodIdx = content.indexOf('createPullRequest(');
    assert.ok(
      methodIdx !== -1,
      `Expected "${sharedCtx.filePath}" to contain a createPullRequest method`,
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
      `Expected createPullRequest in "${sharedCtx.filePath}" to return an object with a url property`,
    );
    assert.ok(
      returnsNumber,
      `Expected createPullRequest in "${sharedCtx.filePath}" to return an object with a number property`,
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
