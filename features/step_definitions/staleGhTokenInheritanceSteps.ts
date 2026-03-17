import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

Then('activateGitHubAppAuth is called before fetchGitHubIssue in initializeWorkflow', function () {
  const content = sharedCtx.fileContent;

  const authCallIdx = content.indexOf('activateGitHubAppAuth(');
  assert.ok(
    authCallIdx !== -1,
    `Expected "activateGitHubAppAuth(" to be present in ${sharedCtx.filePath}`,
  );

  const fetchIssueIdx = content.indexOf('fetchGitHubIssue(');
  assert.ok(
    fetchIssueIdx !== -1,
    `Expected "fetchGitHubIssue(" to be present in ${sharedCtx.filePath}`,
  );

  assert.ok(
    authCallIdx < fetchIssueIdx,
    'Expected activateGitHubAppAuth to be called before fetchGitHubIssue in initializeWorkflow',
  );
});

Then('activateGitHubAppAuth is called before fetchPRDetails in initializePRReviewWorkflow', function () {
  const content = sharedCtx.fileContent;

  const authCallIdx = content.indexOf('activateGitHubAppAuth(');
  assert.ok(
    authCallIdx !== -1,
    `Expected "activateGitHubAppAuth(" to be present in ${sharedCtx.filePath}`,
  );

  const fetchPRIdx = content.indexOf('fetchPRDetails(');
  assert.ok(
    fetchPRIdx !== -1,
    `Expected "fetchPRDetails(" to be present in ${sharedCtx.filePath}`,
  );

  assert.ok(
    authCallIdx < fetchPRIdx,
    'Expected activateGitHubAppAuth to be called before fetchPRDetails in initializePRReviewWorkflow',
  );
});
