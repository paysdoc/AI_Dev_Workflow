import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

Then('the file contains {string} or {string}', function (expected1: string, expected2: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(expected1) || content.includes(expected2),
    `Expected "${sharedCtx.filePath}" to contain "${expected1}" or "${expected2}"`,
  );
});

Then('the board setup call is wrapped in a try-catch or .catch handler', function () {
  const content = sharedCtx.fileContent;
  const hasTryCatch = content.includes('try {') && content.includes('catch (');
  const hasCatchHandler = content.includes('.catch(');
  assert.ok(
    hasTryCatch || hasCatchHandler,
    `Expected "adws/phases/workflowInit.ts" board setup to be wrapped in a try-catch or .catch handler`,
  );
});

Then('the moveToStatus call in handleWorkflowError uses BoardStatus.Blocked', function () {
  const content = sharedCtx.fileContent;
  const funcStart = content.indexOf('function handleWorkflowError');
  assert.ok(funcStart !== -1, 'Expected "function handleWorkflowError" in workflowCompletion.ts');
  const funcBody = content.slice(funcStart, funcStart + 2000);
  assert.ok(
    funcBody.includes('BoardStatus.Blocked'),
    'Expected handleWorkflowError to call moveToStatus with BoardStatus.Blocked',
  );
});

Then('the handleWorkflowError function does not contain {string}', function (unexpected: string) {
  const content = sharedCtx.fileContent;
  const funcStart = content.indexOf('function handleWorkflowError');
  assert.ok(funcStart !== -1, 'Expected "function handleWorkflowError" in workflowCompletion.ts');
  const funcBody = content.slice(funcStart, funcStart + 2000);
  assert.ok(
    !funcBody.includes(unexpected),
    `Expected handleWorkflowError NOT to contain "${unexpected}"`,
  );
});

Then('the handleRateLimitPause function contains {string}', function (expected: string) {
  const content = sharedCtx.fileContent;
  const funcStart = content.indexOf('function handleRateLimitPause');
  assert.ok(funcStart !== -1, 'Expected "function handleRateLimitPause" in workflowCompletion.ts');
  const funcBody = content.slice(funcStart, funcStart + 3000);
  assert.ok(
    funcBody.includes(expected),
    `Expected handleRateLimitPause to contain "${expected}"`,
  );
});
