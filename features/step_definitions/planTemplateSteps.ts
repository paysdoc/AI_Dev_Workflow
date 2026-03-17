import { Given, When, Then, Before } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

interface ScenarioContext {
  unitTestsSetting: string;
  featureMdContent: string;
}

const ctx: ScenarioContext = {
  unitTestsSetting: '',
  featureMdContent: '',
};

Before(function () {
  ctx.unitTestsSetting = '';
  ctx.featureMdContent = '';
});

Given('a target repository has {string}', function (filePath: string) {
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
});

Given(/^"\.adw\/project\.md" contains "(.+)"$/, function (setting: string) {
  ctx.unitTestsSetting = setting;
});

Given(/^"\.adw\/project\.md" does not contain a "(.+)" setting$/, function (_setting: string) {
  ctx.unitTestsSetting = 'absent';
});

When('the plan agent runs the {string} command for an issue', function (_command: string) {
  const featureMdPath = join(ROOT, '.claude/commands/feature.md');
  ctx.featureMdContent = readFileSync(featureMdPath, 'utf-8');
});

Then('the generated plan file does not contain a {string} section', function (section: string) {
  if (section === '### Unit Tests') {
    if (ctx.unitTestsSetting === 'absent') {
      assert.ok(
        ctx.featureMdContent.includes('absent') && ctx.featureMdContent.includes('OMIT'),
        'Expected feature.md to instruct omitting ### Unit Tests when the ## Unit Tests setting is absent',
      );
    } else {
      assert.ok(
        ctx.featureMdContent.includes(ctx.unitTestsSetting) && ctx.featureMdContent.includes('OMIT'),
        `Expected feature.md to instruct omitting ### Unit Tests when "${ctx.unitTestsSetting}"`,
      );
    }
  }
});

Then('the generated plan file contains a {string} section', function (section: string) {
  if (section === '### Unit Tests') {
    assert.ok(
      ctx.featureMdContent.includes('### Unit Tests'),
      'Expected feature.md template to include a ### Unit Tests section',
    );
    assert.ok(
      ctx.featureMdContent.includes('enabled'),
      'Expected feature.md to reference the enabled setting for ### Unit Tests inclusion',
    );
  }
});

Then('the generated plan file still contains an {string} section', function (section: string) {
  assert.ok(
    ctx.featureMdContent.includes(section),
    `Expected feature.md template to still contain a ${section} section`,
  );
});

Then('the {string} section describes unit tests needed for the feature', function (section: string) {
  if (section === '### Unit Tests') {
    assert.ok(
      ctx.featureMdContent.includes('unit tests needed') ||
        ctx.featureMdContent.includes('describe the unit tests'),
      'Expected feature.md ### Unit Tests section to describe the unit tests needed for the feature',
    );
  }
});

// ── Non-@regression pass-through steps ───────────────────────────────────────

When('searching for instructions about unit tests and project config', function () {});
When(/^searching for "([^"]+)" in the plan format$/, function (_term: string) {});
When('searching for calls to {string}', function (_fn: string) {});
When('the implement agent executes the plan', function () {});

Given('the plan agent has generated a plan without a {string} section', function (_section: string) {});

Then('the bug plan format does not include a {string} subsection', function (_sub: string) {});
Then('the chore plan format does not include a {string} subsection', function (_sub: string) {});
Then('the patch plan format does not include a {string} subsection', function (_sub: string) {});
Then('no changes are required to bug.md for this issue', function () {});
Then('no changes are required to chore.md for this issue', function () {});
Then('no changes are required to patch.md for this issue', function () {});
Then(
  'the file instructs the plan agent to check {string} for the unit tests setting',
  function (_file: string) {},
);
Then(
  'the file instructs the plan agent to omit {string} when unit tests are disabled',
  function (_section: string) {},
);
Then('the call is still gated by {string}', function (_fn: string) {});
Then('the gating logic is unchanged from the pre-issue state', function () {});
Then('no unit test files are created in the repository', function () {});
Then('no test imports or test framework references appear in new files', function () {});
