import { Given, Then } from '@cucumber/cucumber';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

Given('the file {string} exists', function (filePath: string) {
  assert.ok(existsSync(join(ROOT, filePath)), `Expected file to exist: ${filePath}`);
});

Given('all feature files in {string} are scanned for {string}', function (_dir: string, _tag: string) {
  // Context setup only
});

Then('no feature file contains {string}', function (tag: string) {
  const featureDir = join(ROOT, 'features');
  const files = readdirSync(featureDir).filter((f: string) => f.endsWith('.feature'));
  for (const file of files) {
    const content = readFileSync(join(featureDir, file), 'utf-8');
    // Only check Gherkin tag lines (lines starting with optional whitespace + @),
    // not prose/step text that happens to mention the tag name.
    const tagLines = content
      .split('\n')
      .filter((line: string) => /^\s*@/.test(line))
      .join('\n');
    assert.ok(
      !tagLines.includes(tag),
      `Feature file "${file}" still contains the deprecated "${tag}" tag`,
    );
  }
});
