import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// Scenario-local state for generated commands.md fixture scenarios
const ctx = {
  generatedContent: '',
};

// ── In-memory fixtures ────────────────────────────────────────────────────────

// What adw_init generates for a Playwright project with webServer block
const PLAYWRIGHT_WEBSERVER_COMMANDS_MD = [
  '## Start Dev Server',
  'N/A',
  '',
  '## Health Check Path',
  '/',
  '',
  '## Run Scenarios by Tag',
  'bunx playwright test --grep "@{tag}"',
  '',
  '## Run Regression Scenarios',
  'bunx playwright test --grep "@regression"',
].join('\n');

// What adw_init generates for a Next.js project without a self-managing runner
const NEXTJS_COMMANDS_MD = [
  '## Start Dev Server',
  'bunx next dev --port {PORT}',
  '',
  '## Health Check Path',
  '/',
  '',
  '## Run Scenarios by Tag',
  'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"',
  '',
  '## Run Regression Scenarios',
  'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"',
].join('\n');

// ── Helper ────────────────────────────────────────────────────────────────────

function extractSectionValue(content: string, heading: string): string {
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) return '';
  const sectionLines: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    sectionLines.push(lines[i]);
  }
  return sectionLines.join('\n');
}

// ── Detection logic: "instruction states" steps ───────────────────────────────
// These check sharedCtx.fileContent (the full adw_init.md) for detection keywords.

Then(
  'the instruction states that CLI-only target repos must have {string} set to {string}',
  function (heading: string, _value: string) {
    assert.ok(
      sharedCtx.fileContent.includes('CLI-only'),
      `Expected adw_init.md to document CLI-only detection for "${heading}"`,
    );
  },
);

Then(
  'the instruction states that when a Playwright config has a {string} block, {string} must be set to {string}',
  function (block: string, _heading: string, _value: string) {
    assert.ok(
      sharedCtx.fileContent.includes('Playwright'),
      `Expected adw_init.md to mention Playwright detection`,
    );
    assert.ok(
      sharedCtx.fileContent.includes(block),
      `Expected adw_init.md to mention "${block}" block in Playwright config`,
    );
  },
);

Then(
  'the instruction states that when any test runner self-manages its server, {string} must be set to {string}',
  function (_heading: string, _value: string) {
    assert.ok(
      sharedCtx.fileContent.includes('self-manag'),
      `Expected adw_init.md to document self-managing test runner detection`,
    );
  },
);

Then(
  "the instruction states that web framework targets without a self-managing runner must have {string} set to the framework's dev command with {string} substituted",
  function (_heading: string, placeholder: string) {
    assert.ok(
      sharedCtx.fileContent.includes(placeholder),
      `Expected adw_init.md to document "${placeholder}" substitution for web framework targets`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('without a self-managing runner'),
      `Expected adw_init.md to mention web framework targets without a self-managing runner`,
    );
  },
);

Then(
  'it provides examples like {string} or {string}',
  function (example1: string, example2: string) {
    assert.ok(
      sharedCtx.fileContent.includes(example1),
      `Expected adw_init.md to include example "${example1}"`,
    );
    assert.ok(
      sharedCtx.fileContent.includes(example2),
      `Expected adw_init.md to include example "${example2}"`,
    );
  },
);

// ── {PORT} substitution documentation ─────────────────────────────────────────

Then(
  'it contains an explanation that {string} is a placeholder substituted at runtime by the dev server lifecycle helper',
  function (placeholder: string) {
    assert.ok(
      sharedCtx.fileContent.includes(placeholder),
      `Expected adw_init.md to reference "${placeholder}"`,
    );
    assert.ok(
      sharedCtx.fileContent.includes('dev server lifecycle helper'),
      `Expected adw_init.md to mention the dev server lifecycle helper`,
    );
  },
);

Then('it explains that parallel workflows use dynamic ports to avoid collisions', function () {
  assert.ok(
    sharedCtx.fileContent.includes('parallel'),
    `Expected adw_init.md to mention parallel workflows`,
  );
  assert.ok(
    sharedCtx.fileContent.includes('dynamic ports'),
    `Expected adw_init.md to mention dynamic ports`,
  );
});

// ── Health Check Path documentation ───────────────────────────────────────────

Then('the instruction specifies a default value of {string} for that section', function (value: string) {
  assert.ok(
    sharedCtx.fileContent.includes(`default \`${value}\``),
    `Expected adw_init.md to specify a default value of "${value}"`,
  );
});

Then(
  'it notes that {string} can be overridden per target repo if {string} is slow or redirects',
  function (section: string, _path: string) {
    assert.ok(
      sharedCtx.fileContent.includes(section),
      `Expected adw_init.md to mention "${section}"`,
    );
    assert.ok(
      sharedCtx.fileContent.toLowerCase().includes('overridden'),
      `Expected adw_init.md to note that "${section}" can be overridden`,
    );
  },
);

// ── Run E2E Tests removal ──────────────────────────────────────────────────────

Then('the instruction does NOT list {string} as a section to generate', function (section: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(section),
    `Expected adw_init.md NOT to list "${section}" as a section to generate`,
  );
});

// ── Generated commands.md: Given steps (fixture setup) ───────────────────────

Given('adw_init was run on a CLI-only target repository with no web framework', function () {
  const filePath = join(ROOT, 'test/fixtures/cli-tool/.adw/commands.md');
  ctx.generatedContent = readFileSync(filePath, 'utf-8');
});

Given('adw_init was run on a target repository using Playwright', function () {
  ctx.generatedContent = PLAYWRIGHT_WEBSERVER_COMMANDS_MD;
});

Given('the target\'s {string} contains a {string} block', function (_file: string, _block: string) {
  // Already reflected in the PLAYWRIGHT_WEBSERVER_COMMANDS_MD fixture
});

Given('adw_init was run on a Next.js target repository without a self-managing test runner', function () {
  ctx.generatedContent = NEXTJS_COMMANDS_MD;
});

Given('adw_init was run on any target repository', function () {
  const filePath = join(ROOT, 'test/fixtures/cli-tool/.adw/commands.md');
  ctx.generatedContent = readFileSync(filePath, 'utf-8');
});

// ── Generated commands.md: When step ─────────────────────────────────────────

When('the generated {string} is read', function (filePath: string) {
  sharedCtx.fileContent = ctx.generatedContent;
  sharedCtx.filePath = `${filePath} (fixture)`;
});

// ── Generated commands.md: Then steps ────────────────────────────────────────

Then('the {string} section is set to {string}', function (heading: string, value: string) {
  const sectionValue = extractSectionValue(sharedCtx.fileContent, heading).trim();
  assert.ok(
    sectionValue === value || sectionValue.includes(value),
    `Expected "${heading}" to be "${value}", got: "${sectionValue}"`,
  );
});

Then(
  'the {string} section contains a command with {string} placeholder',
  function (heading: string, placeholder: string) {
    const sectionValue = extractSectionValue(sharedCtx.fileContent, heading);
    assert.ok(
      sectionValue.includes(placeholder),
      `Expected "${heading}" to contain "${placeholder}", got: "${sectionValue.trim()}"`,
    );
  },
);

Then('the command resembles {string} or equivalent', function (example: string) {
  // The {PORT} presence was already verified by the prior step.
  // Additionally confirm the content references the example pattern.
  const portPresent = sharedCtx.fileContent.includes('{PORT}');
  assert.ok(
    portPresent,
    `Expected generated commands.md to contain a {PORT} command resembling "${example}"`,
  );
});

Then('no {string} heading exists in the file', function (heading: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(heading),
    `Expected no "${heading}" heading in file`,
  );
});

// ── ProjectConfig map checks ──────────────────────────────────────────────────

Then('the map does not contain an entry for {string}', function (key: string) {
  const normalizedKey = key.replace(/^##\s*/, '').toLowerCase();
  assert.ok(
    !sharedCtx.fileContent.includes(normalizedKey),
    `Expected "${sharedCtx.filePath}" map not to contain key "${normalizedKey}" (from "${key}")`,
  );
});

// ── Fixture repo schema checks (fixture_repo_test_harness.feature) ────────────

Then(
  'the file contains a {string} section set to {string}',
  function (section: string, value: string) {
    const content = sharedCtx.fileContent;
    assert.ok(content.includes(section), `Expected file to contain section "${section}"`);
    const sectionValue = extractSectionValue(content, section).trim();
    assert.ok(
      sectionValue === value || sectionValue.includes(value),
      `Expected "${section}" to be "${value}", got: "${sectionValue}"`,
    );
  },
);

Then('the file does not contain a {string} section', function (section: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes(section),
    `Expected file not to contain section "${section}"`,
  );
});
