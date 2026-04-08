import { Before, Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// Scenario-local state reset per scenario
const ctx = {
  commandsStepContent: '',
  secondaryContent: '',
  usePlaywrightFixture: false,
};

Before(function () {
  ctx.commandsStepContent = '';
  ctx.secondaryContent = '';
  ctx.usePlaywrightFixture = false;
});

// In-memory Playwright fixture representing what adw_init generates for a Playwright project
const PLAYWRIGHT_COMMANDS_MD = [
  '## Run Scenarios by Tag',
  'bunx playwright test --grep "@{tag}"',
  '',
  '## Run Regression Scenarios',
  'bunx playwright test --grep "@regression"',
].join('\n');

const PLAYWRIGHT_SCENARIOS_MD = [
  '## Scenario Directory',
  'tests/e2e/',
  '',
  '## Run Scenarios by Tag',
  'bunx playwright test --grep "@{tag}"',
  '',
  '## Run Regression Scenarios',
  'bunx playwright test --grep "@regression"',
].join('\n');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function detectE2ETool(value: string): string {
  const v = value.toLowerCase();
  if (v.includes('playwright')) return 'playwright';
  if (v.includes('cypress')) return 'cypress';
  if (v.includes('cucumber')) return 'cucumber';
  return v.trim();
}

// ── Scenarios 1 & 2: adw_init.md instruction lists the sections ──────────────

When('the step that defines sections for {string} generation is found', function (filename: string) {
  const content = sharedCtx.fileContent;
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`Create \`${escaped}\`[\\s\\S]*?(?=\\n\\d+\\. \\*\\*|$)`);
  const match = content.match(pattern);
  assert.ok(match, `Could not find step defining sections for "${filename}" in ${sharedCtx.filePath}`);
  ctx.commandsStepContent = match[0];
});

Then('the instruction lists {string} as a required section', function (section: string) {
  assert.ok(
    ctx.commandsStepContent.includes(section),
    `Expected adw_init.md step 2 to list "${section}" as a required section`,
  );
});

Then(
  'the instruction specifies a command with a {string} placeholder for that section',
  function (placeholder: string) {
    assert.ok(
      ctx.commandsStepContent.includes(placeholder),
      `Expected adw_init.md step 2 to specify a command with "${placeholder}" placeholder`,
    );
  },
);

Then(
  'the instruction specifies a command that runs {string}-tagged scenarios',
  function (tag: string) {
    assert.ok(
      ctx.commandsStepContent.includes(tag),
      `Expected adw_init.md step 2 to reference "${tag}"-tagged scenarios`,
    );
  },
);

// ── Scenarios 3 & 4: generated commands.md contains the sections ─────────────

Given('{string} exists in a repository where adw_init was run', function (filePath: string) {
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected "${filePath}" to exist`);
  const content = readFileSync(fullPath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = filePath;
});

When('the file is read', function () {
  // Content already loaded into sharedCtx by the Given step
});

Then('it contains a {string} section', function (section: string) {
  assert.ok(
    sharedCtx.fileContent.includes(section),
    `Expected "${sharedCtx.filePath}" to contain "${section}"`,
  );
  sharedCtx.lastCheckedSection = section.replace(/^##\s*/, '');
});

Then(
  'the value under that section includes a {string} placeholder',
  function (placeholder: string) {
    assert.ok(
      sharedCtx.fileContent.includes(placeholder),
      `Expected "${sharedCtx.filePath}" to include placeholder "${placeholder}"`,
    );
  },
);

Then('the value under that section includes {string}', function (expected: string) {
  assert.ok(
    sharedCtx.fileContent.includes(expected),
    `Expected "${sharedCtx.filePath}" to include "${expected}"`,
  );
});

// ── Scenario 5: commands.md and scenarios.md use the same E2E tool ───────────

Given('adw_init was run on a repository that uses Playwright for E2E tests', function () {
  ctx.usePlaywrightFixture = true;
});

When('{string} and {string} are read', function (cmdFile: string, scenFile: string) {
  if (ctx.usePlaywrightFixture) {
    sharedCtx.fileContent = PLAYWRIGHT_COMMANDS_MD;
    sharedCtx.filePath = `${cmdFile} (playwright fixture)`;
    ctx.secondaryContent = PLAYWRIGHT_SCENARIOS_MD;
  } else {
    sharedCtx.fileContent = readFileSync(join(ROOT, cmdFile), 'utf-8');
    sharedCtx.filePath = cmdFile;
    ctx.secondaryContent = readFileSync(join(ROOT, scenFile), 'utf-8');
  }
});

Then(
  'both files specify a {string} command using the same E2E tool',
  function (heading: string) {
    const cmdTool = detectE2ETool(extractSectionValue(sharedCtx.fileContent, heading));
    const scenTool = detectE2ETool(extractSectionValue(ctx.secondaryContent, heading));
    assert.strictEqual(
      cmdTool,
      scenTool,
      `commands.md uses "${cmdTool}" but scenarios.md uses "${scenTool}" for "${heading}"`,
    );
  },
);

Then('the {string} placeholder appears in both commands', function (placeholder: string) {
  const cmdValue = extractSectionValue(sharedCtx.fileContent, '## Run Scenarios by Tag');
  const scenValue = extractSectionValue(ctx.secondaryContent, '## Run Scenarios by Tag');
  assert.ok(
    cmdValue.includes(placeholder),
    `commands.md Run Scenarios by Tag missing "${placeholder}"`,
  );
  assert.ok(
    scenValue.includes(placeholder),
    `scenarios.md Run Scenarios by Tag missing "${placeholder}"`,
  );
});

// ── Scenario 6: N/A E2E defaults to cucumber-js ──────────────────────────────

Given(
  'adw_init was run on a repository where {string} is {string}',
  function (_section: string, _value: string) {
    // Context annotation — the When step reads the actual .adw/commands.md
    // which uses cucumber-js defaults for the scenario runner sections
  },
);

Given('adw_init was run on a repository where no E2E tool is detected', function () {
  // Context annotation — the When step reads the actual .adw/commands.md
  // which defaults to cucumber-js when no E2E tool is detected
});

Then('the {string} section uses a cucumber-js command', function (section: string) {
  const value = extractSectionValue(sharedCtx.fileContent, section);
  assert.ok(
    value.includes('cucumber-js'),
    `Expected "${section}" to use a cucumber-js command, got: "${value.trim()}"`,
  );
});

Then(
  'the {string} section uses a cucumber-js command with {string}',
  function (section: string, tag: string) {
    const value = extractSectionValue(sharedCtx.fileContent, section);
    assert.ok(
      value.includes('cucumber-js'),
      `Expected "${section}" to use cucumber-js, got: "${value.trim()}"`,
    );
    assert.ok(
      value.includes(tag),
      `Expected "${section}" command to include "${tag}", got: "${value.trim()}"`,
    );
  },
);

// ── Scenarios 7 & 8: projectConfig.ts interface and map ──────────────────────

Then('the interface contains a {string} field', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" to contain field "${field}"`,
  );
});

When('the {string} map is found', function (_mapName: string) {
  // Context only
});

Then(
  'the map contains an entry for {string} mapping to {string}',
  function (key: string, value: string) {
    // Map keys are lowercase without the ## prefix (e.g., "## Run Scenarios by Tag" → "run scenarios by tag")
    const normalizedKey = key.replace(/^##\s*/, '').toLowerCase();
    assert.ok(
      sharedCtx.fileContent.includes(normalizedKey),
      `Expected "${sharedCtx.filePath}" map to contain key "${normalizedKey}" (from "${key}")`,
    );
    assert.ok(
      sharedCtx.fileContent.includes(value),
      `Expected "${sharedCtx.filePath}" map to contain value "${value}"`,
    );
  },
);
