import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { runCommentOnlyCheck } from '../../../adws/checkCommentOnly.ts';

const TOUCHED_FILES: readonly string[] = [
  'features/per-issue/feature-816.feature',
  'features/per-issue/feature-819.feature',
  'features/per-issue/feature-823.feature',
  'features/per-issue/step_definitions/feature-533-given.steps.ts',
  'features/per-issue/step_definitions/feature-797.steps.ts',
  'features/per-issue/step_definitions/feature-810.steps.ts',
  'features/per-issue/step_definitions/feature-817.steps.ts',
  'features/per-issue/step_definitions/feature-818.steps.ts',
  'features/per-issue/step_definitions/feature-823-probes.steps.ts',
  'features/per-issue/step_definitions/feature-823.steps.ts',
  'features/per-issue/step_definitions/feature-846.steps.ts',
  'features/per-issue/step_definitions/takeover-probe-ctx.ts',
  'features/per-issue/support/feature-846-ensure-driver.ts',
];

let files: readonly string[] = [];
let result: { exitCode: 0 | 1; lines: string[] } | null = null;

Given('the files touched by this comment sweep batch', function () {
  files = TOUCHED_FILES;
});

When('the comment-only guard checks those files against the default branch', function () {
  result = runCommentOnlyCheck({ baseRef: null, files });
});

Then('the comment-only guard run reports no violations', function () {
  assert.ok(result !== null, 'Expected the guard to have run');
  assert.strictEqual(result.exitCode, 0, `Expected exit code 0, got report:\n${result.lines.join('\n')}`);
});
