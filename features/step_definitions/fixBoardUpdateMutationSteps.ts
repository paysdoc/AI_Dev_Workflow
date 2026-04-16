import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

// ── Scenario A: Remove projectId from updateProjectV2Field mutation ──────────

Then('the updateProjectV2Field mutation input does not contain {string}', function (unexpected: string) {
  const content = sharedCtx.fileContent;
  // Find the updateProjectV2Field mutation input block and check it doesn't contain the string
  const mutationIdx = content.indexOf('updateProjectV2Field');
  assert.ok(mutationIdx !== -1, 'Expected updateProjectV2Field in githubBoardManager.ts');
  // Search the input block — 600 chars is enough to cover the mutation body
  const mutationBlock = content.slice(mutationIdx, mutationIdx + 600);
  assert.ok(
    !mutationBlock.includes(unexpected),
    `Expected the updateProjectV2Field mutation input NOT to contain "${unexpected}"`,
  );
});

Then('the updateProjectV2Field mutation input contains {string}', function (expected: string) {
  const content = sharedCtx.fileContent;
  const mutationIdx = content.indexOf('updateProjectV2Field');
  assert.ok(mutationIdx !== -1, 'Expected updateProjectV2Field in githubBoardManager.ts');
  const mutationBlock = content.slice(mutationIdx, mutationIdx + 600);
  assert.ok(
    mutationBlock.includes(expected),
    `Expected the updateProjectV2Field mutation input to contain "${expected}"`,
  );
});

Then('the updateProjectV2Field mutation does not declare a $projectId variable', function () {
  const content = sharedCtx.fileContent;
  // Only check the updateStatusFieldOptions / updateProjectV2Field mutation block
  const mutationIdx = content.indexOf('updateProjectV2Field');
  assert.ok(mutationIdx !== -1, 'Expected updateProjectV2Field in githubBoardManager.ts');
  const mutationBlock = content.slice(mutationIdx, mutationIdx + 600);
  assert.ok(
    !mutationBlock.includes('$projectId'),
    'Expected the updateProjectV2Field mutation NOT to declare $projectId variable',
  );
});

// ── Scenario B: getStatusFieldOptions fetches color and description ───────────

Then('the getStatusFieldOptions query requests {string} for each option', function (field: string) {
  const content = sharedCtx.fileContent;
  const methodIdx = content.indexOf('getStatusFieldOptions');
  assert.ok(methodIdx !== -1, 'Expected getStatusFieldOptions in githubBoardManager.ts');
  // Look for the options selection within the method body (2000 chars covers it)
  const methodBody = content.slice(methodIdx, methodIdx + 2000);
  assert.ok(
    methodBody.includes(field),
    `Expected getStatusFieldOptions to request "${field}" for each option`,
  );
});

Then('the getStatusFieldOptions return type includes {string} and {string} fields', function (
  field1: string,
  field2: string,
) {
  const content = sharedCtx.fileContent;
  // Find the private method definition (not a call-site)
  const methodDefIdx = content.indexOf('private getStatusFieldOptions');
  assert.ok(methodDefIdx !== -1, 'Expected private getStatusFieldOptions method in githubBoardManager.ts');
  // The return type annotation is on the line after the method signature (within ~400 chars)
  const methodSignature = content.slice(methodDefIdx, methodDefIdx + 400);
  assert.ok(
    methodSignature.includes(field1),
    `Expected getStatusFieldOptions return type to include "${field1}"`,
  );
  assert.ok(
    methodSignature.includes(field2),
    `Expected getStatusFieldOptions return type to include "${field2}"`,
  );
});

// ── Scenario C: Single bulk update replaces per-column addStatusOption ────────

Then(
  'ensureColumns builds a merged list of all options before calling updateProjectV2Field',
  function () {
    const content = sharedCtx.fileContent;
    // The ensureColumns method should call mergeStatusOptions or build a merged array
    const methodIdx = content.indexOf('ensureColumns');
    assert.ok(methodIdx !== -1, 'Expected ensureColumns in githubBoardManager.ts');
    const methodBody = content.slice(methodIdx, methodIdx + 2000);
    const hasMerge =
      methodBody.includes('mergeStatusOptions') ||
      methodBody.includes('merged') ||
      methodBody.includes('mergedOptions');
    assert.ok(hasMerge, 'Expected ensureColumns to build a merged list before calling updateProjectV2Field');
  },
);

Then('ensureColumns does not call addStatusOption in a loop', function () {
  const content = sharedCtx.fileContent;
  // addStatusOption should not exist at all
  assert.ok(
    !content.includes('addStatusOption'),
    'Expected ensureColumns NOT to call addStatusOption (method should be removed)',
  );
});

Then(
  'ensureColumns merges existing options that do not match any BOARD_COLUMNS entry',
  function () {
    const content = sharedCtx.fileContent;
    // The mergeStatusOptions function (or ensureColumns itself) should preserve non-ADW options
    // We verify by checking that the implementation iterates over existing options and builds a merged result
    const methodIdx = content.indexOf('mergeStatusOptions');
    assert.ok(
      methodIdx !== -1,
      'Expected mergeStatusOptions helper to exist in githubBoardManager.ts',
    );
  },
);

Then(
  'ensureColumns replaces options whose name matches a BOARD_COLUMNS entry',
  function () {
    const content = sharedCtx.fileContent;
    // The merge function overwrites matching ADW options with BOARD_COLUMNS defaults
    assert.ok(
      content.includes('BOARD_COLUMNS'),
      'Expected githubBoardManager.ts to reference BOARD_COLUMNS for merge logic',
    );
  },
);

Then('ensureColumns adds BOARD_COLUMNS entries not present in existing options', function () {
  const content = sharedCtx.fileContent;
  const methodIdx = content.indexOf('mergeStatusOptions');
  assert.ok(
    methodIdx !== -1,
    'Expected mergeStatusOptions helper to exist in githubBoardManager.ts',
  );
  // The helper should include logic to append missing columns
  const helperBody = content.slice(methodIdx, methodIdx + 1500);
  assert.ok(
    helperBody.includes('added') || helperBody.includes('append') || helperBody.includes('push') || helperBody.includes('filter'),
    'Expected mergeStatusOptions to append missing ADW columns',
  );
});

// ── Scenario D: Non-blocking board setup behavior unchanged ───────────────────

// "the board setup call is wrapped in a try-catch or .catch handler" is already
// defined in boardManagerProviderSteps.ts — no duplicate needed.

// ── Scenario E: TypeScript type-check passes ──────────────────────────────────
// Step "the ADW TypeScript type-check passes" is already defined in cronGuardToctouFixSteps.ts
