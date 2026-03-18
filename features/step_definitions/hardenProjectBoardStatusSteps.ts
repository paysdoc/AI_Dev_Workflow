import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

Then('the catch block in moveIssueToStatus logs at error level not warn', function () {
  const content = sharedCtx.fileContent;
  const funcStart = content.indexOf('async function moveIssueToStatus');
  assert.ok(funcStart !== -1, 'Expected "async function moveIssueToStatus" in projectBoardApi.ts');
  const funcBody = content.slice(funcStart);
  const catchIdx = funcBody.indexOf('} catch');
  assert.ok(catchIdx !== -1, 'Expected a catch block in moveIssueToStatus');
  const catchBlock = funcBody.slice(catchIdx, catchIdx + 300);
  const hasError = catchBlock.includes("'error'") || catchBlock.includes('"error"');
  assert.ok(hasError, "Expected catch block to log at 'error' level");
  const hasWarn = catchBlock.includes("'warn'") || catchBlock.includes('"warn"');
  assert.ok(!hasWarn, "Expected catch block NOT to log at 'warn' level — should be 'error'");
});

Then('moveIssueToStatus has a return true statement in the success path', function () {
  const content = sharedCtx.fileContent;
  const funcStart = content.indexOf('async function moveIssueToStatus');
  assert.ok(funcStart !== -1, 'Expected "async function moveIssueToStatus" in projectBoardApi.ts');
  const funcBody = content.slice(funcStart);
  const catchStart = funcBody.indexOf('} catch');
  // success path is before the catch block
  const successBody = catchStart !== -1 ? funcBody.slice(0, catchStart) : funcBody;
  assert.ok(
    successBody.includes('return true'),
    'Expected "return true" in the success path of moveIssueToStatus (before the catch block)',
  );
});

Then('moveIssueToStatus has a return false statement in the catch block', function () {
  const content = sharedCtx.fileContent;
  const funcStart = content.indexOf('async function moveIssueToStatus');
  assert.ok(funcStart !== -1, 'Expected "async function moveIssueToStatus" in projectBoardApi.ts');
  const funcBody = content.slice(funcStart);
  const catchIdx = funcBody.indexOf('} catch');
  assert.ok(catchIdx !== -1, 'Expected a catch block in moveIssueToStatus');
  const catchBlock = funcBody.slice(catchIdx, catchIdx + 300);
  assert.ok(
    catchBlock.includes('return false'),
    'Expected "return false" in the catch block of moveIssueToStatus',
  );
});

Then('the IssueTracker moveToStatus method returns Promise<boolean>', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('moveToStatus') && content.includes('Promise<boolean>'),
    'Expected IssueTracker.moveToStatus to declare "Promise<boolean>" return type',
  );
});

Then(
  'the {string} log in moveIssueToStatus uses warn level',
  function (logFragment: string) {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('async function moveIssueToStatus');
    assert.ok(funcStart !== -1, 'Expected "async function moveIssueToStatus" in the file');
    const funcBody = content.slice(funcStart);
    const idx = funcBody.indexOf(logFragment);
    assert.ok(idx !== -1, `Expected log message containing "${logFragment}" in moveIssueToStatus`);
    const context = funcBody.slice(idx, idx + 200);
    const hasWarn = context.includes("'warn'") || context.includes('"warn"');
    assert.ok(hasWarn, `Expected the "${logFragment}" log in moveIssueToStatus to use 'warn' level`);
  },
);

Then(
  'refreshTokenIfNeeded is called before findRepoProjectId in moveIssueToStatus',
  function () {
    const content = sharedCtx.fileContent;
    const funcStart = content.indexOf('async function moveIssueToStatus');
    assert.ok(
      funcStart !== -1,
      'Expected "async function moveIssueToStatus" in projectBoardApi.ts',
    );
    const funcBody = content.slice(funcStart);
    const refreshIdx = funcBody.indexOf('refreshTokenIfNeeded');
    assert.ok(
      refreshIdx !== -1,
      'Expected "refreshTokenIfNeeded" to be called inside moveIssueToStatus',
    );
    const findProjectIdx = funcBody.indexOf('findRepoProjectId');
    assert.ok(
      findProjectIdx !== -1,
      'Expected "findRepoProjectId" to be called inside moveIssueToStatus',
    );
    assert.ok(
      refreshIdx < findProjectIdx,
      'Expected refreshTokenIfNeeded to be called before findRepoProjectId in moveIssueToStatus',
    );
  },
);
