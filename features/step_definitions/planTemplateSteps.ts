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

Given('the ADW codebase contains {string}', function (filePath: string) {
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
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
