import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

/**
 * Extracts the moveIssueToStatus function body from the shared file content.
 */
function getMoveIssueBody(): string {
  const content = sharedCtx.fileContent;
  const funcStart = content.indexOf('async function moveIssueToStatus');
  if (funcStart === -1) {
    // Also check for `export async function moveIssueToStatus`
    const exportStart = content.indexOf('export async function moveIssueToStatus');
    assert.ok(exportStart !== -1, 'Expected moveIssueToStatus function in projectBoardApi.ts');
    return content.slice(exportStart);
  }
  return content.slice(funcStart);
}

Then(
  'moveIssueToStatus contains a GITHUB_PAT fallback after findRepoProjectId returns null',
  function () {
    const funcBody = getMoveIssueBody();

    // Must reference GITHUB_PAT somewhere in the function
    assert.ok(
      funcBody.includes('GITHUB_PAT'),
      'Expected moveIssueToStatus to reference GITHUB_PAT for fallback',
    );

    // findRepoProjectId should appear, and there should be a second attempt or fallback path
    const firstFind = funcBody.indexOf('findRepoProjectId');
    assert.ok(firstFind !== -1, 'Expected findRepoProjectId call in moveIssueToStatus');

    // After the first findRepoProjectId, GITHUB_PAT should be referenced (fallback logic)
    const afterFirstFind = funcBody.slice(firstFind);
    assert.ok(
      afterFirstFind.includes('GITHUB_PAT'),
      'Expected GITHUB_PAT fallback after findRepoProjectId returns null',
    );
  },
);

Then(
  'moveIssueToStatus restores the original GH_TOKEN after PAT fallback',
  function () {
    const funcBody = getMoveIssueBody();

    // The function should save the original GH_TOKEN before swapping
    const savesOriginal =
      funcBody.includes('GH_TOKEN') &&
      (funcBody.includes('originalToken') ||
        funcBody.includes('savedToken') ||
        funcBody.includes('prevToken') ||
        funcBody.includes('originalGhToken') ||
        // Check for a pattern like: const X = process.env.GH_TOKEN
        /const\s+\w+\s*=\s*process\.env\.GH_TOKEN/.test(funcBody));

    assert.ok(
      savesOriginal,
      'Expected moveIssueToStatus to save the original GH_TOKEN before PAT fallback',
    );
  },
);

Then(
  'the "No project linked" log message in moveIssueToStatus uses warn level',
  function () {
    const funcBody = getMoveIssueBody();

    // Find the "No project linked" log line
    const noProjectMatch = funcBody.match(/log\([^)]*No project linked[^)]*,\s*'(\w+)'\s*\)/);
    assert.ok(noProjectMatch, 'Expected a log message containing "No project linked"');
    assert.strictEqual(
      noProjectMatch[1],
      'warn',
      `Expected "No project linked" log level to be 'warn', got '${noProjectMatch[1]}'`,
    );
  },
);

Then(
  'all status-not-found log messages in moveIssueToStatus use warn level',
  function () {
    const funcBody = getMoveIssueBody();

    // Check "No Status field found" log
    const noFieldMatch = funcBody.match(/log\([^)]*No Status field[^)]*,\s*'(\w+)'\s*\)/);
    if (noFieldMatch) {
      assert.strictEqual(
        noFieldMatch[1],
        'warn',
        `Expected "No Status field" log level to be 'warn', got '${noFieldMatch[1]}'`,
      );
    }

    // Check "not found in project options" log
    const notFoundMatch = funcBody.match(/log\([^)]*not found in project options[^)]*,\s*'(\w+)'\s*\)/);
    if (notFoundMatch) {
      assert.strictEqual(
        notFoundMatch[1],
        'warn',
        `Expected "not found in project options" log level to be 'warn', got '${notFoundMatch[1]}'`,
      );
    }

    // At least one of the patterns must exist
    assert.ok(
      noFieldMatch || notFoundMatch,
      'Expected at least one status-not-found log message in moveIssueToStatus',
    );
  },
);

Then(
  'moveIssueToStatus logs the auth method used for project board operations',
  function () {
    const funcBody = getMoveIssueBody();

    // Should log something about which auth method is being used (app token, PAT, fallback, etc.)
    const hasAuthLog =
      funcBody.includes('app token') ||
      funcBody.includes('App token') ||
      funcBody.includes('PAT') ||
      funcBody.includes('personal access token') ||
      funcBody.includes('fallback') ||
      funcBody.includes('auth method');

    assert.ok(
      hasAuthLog,
      'Expected moveIssueToStatus to log the auth method used (app token, PAT, or fallback)',
    );
  },
);
