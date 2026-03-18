import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

Then('step 5 in the Run section starts with {string}', function (expectedStart: string) {
  const content = sharedCtx.fileContent;

  // Find the ## Run section
  const runSectionIdx = content.indexOf('## Run');
  assert.ok(runSectionIdx !== -1, 'Expected "## Run" section to exist in the file');

  // Extract content after ## Run up to next ## heading or end of file
  const afterRun = content.slice(runSectionIdx);
  const nextSectionMatch = afterRun.slice(5).search(/^## /m);
  const runContent = nextSectionMatch !== -1
    ? afterRun.slice(0, nextSectionMatch + 5)
    : afterRun;

  // Find numbered step 5 (e.g. "5. ...")
  const step5Match = runContent.match(/^5\.\s+(.+)/m);
  assert.ok(step5Match, 'Expected step 5 to exist in the ## Run section');

  const step5Text = step5Match[1];
  assert.ok(
    step5Text.startsWith(expectedStart),
    `Expected step 5 to start with "${expectedStart}", but got: "${step5Text}"`,
  );
});
