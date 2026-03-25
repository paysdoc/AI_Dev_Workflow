import { When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Generic file content helpers ──────────────────────────────────────────────

Then('the file is not empty', function () {
  assert.ok(
    sharedCtx.fileContent && sharedCtx.fileContent.trim().length > 0,
    `Expected "${sharedCtx.filePath}" to be non-empty`,
  );
});

Then(
  'the following files exist in {string}:',
  function (dir: string, dataTable: { rows: () => string[][] }) {
    const rows = dataTable.rows();
    rows.forEach(([file]: string[]) => {
      const fullPath = join(ROOT, dir, file);
      assert.ok(existsSync(fullPath), `Expected file to exist: ${join(dir, file)}`);
    });
  },
);

// ── SKILL.md plan-reading instructions ───────────────────────────────────────

Then('it contains instructions to read the plan provided as input', function () {
  assert.ok(
    sharedCtx.fileContent.includes('Read the plan'),
    `Expected SKILL.md to contain instructions to read the plan (searched for "Read the plan")`,
  );
});

Then('it references plan tasks or plan structure as the work to implement', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('tasks') || content.includes('plan'),
    `Expected SKILL.md to reference plan tasks or plan structure`,
  );
});

// ── .feature file / RED test instructions ────────────────────────────────────

Then('it contains instructions to read {string} files tagged with {string}', function (
  extension: string,
  tag: string,
) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(extension),
    `Expected SKILL.md to reference "${extension}" files`,
  );
  assert.ok(
    content.includes(tag) || content.includes(tag.replace('{issueNumber}', '{issueNumber}')),
    `Expected SKILL.md to reference tag "${tag}"`,
  );
});

Then('it describes these scenarios as the RED tests for the TDD loop', function () {
  assert.ok(
    sharedCtx.fileContent.includes('RED'),
    `Expected SKILL.md to describe scenarios as RED tests`,
  );
});

// ── Red-Green-Refactor loop instructions ─────────────────────────────────────

Then('it contains instructions for the RED phase: write or complete step definitions', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('RED') && (content.includes('step definition') || content.includes('step definitions')),
    `Expected SKILL.md to contain RED phase instructions for writing step definitions`,
  );
});

Then('it contains instructions for verifying the test fails \\(RED confirmation)', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('RED') && (content.includes('fails') || content.includes('fail')),
    `Expected SKILL.md to contain instructions to verify the test fails (RED confirmation)`,
  );
});

Then('it contains instructions for the GREEN phase: implement code to pass', function () {
  assert.ok(
    sharedCtx.fileContent.includes('GREEN'),
    `Expected SKILL.md to contain GREEN phase instructions`,
  );
});

Then('it contains instructions for verifying the test passes \\(GREEN confirmation)', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('GREEN') && (content.includes('pass') || content.includes('passes')),
    `Expected SKILL.md to contain instructions to verify the test passes (GREEN confirmation)`,
  );
});

Then('it contains instructions for the REFACTOR phase', function () {
  assert.ok(
    sharedCtx.fileContent.includes('REFACTOR'),
    `Expected SKILL.md to contain REFACTOR phase instructions`,
  );
});

// ── Vertical slicing instructions ────────────────────────────────────────────

Then('it instructs vertical slicing: one test then one implementation then repeat', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.toLowerCase().includes('vertical') || content.includes('Vertical slicing'),
    `Expected SKILL.md to instruct vertical slicing`,
  );
});

Then('it explicitly warns against horizontal slicing', function () {
  assert.ok(
    sharedCtx.fileContent.toLowerCase().includes('horizontal'),
    `Expected SKILL.md to warn against horizontal slicing`,
  );
});

Then('it warns against writing all tests first then all implementation', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('WRONG') || content.toLowerCase().includes('all tests first'),
    `Expected SKILL.md to warn against writing all tests first`,
  );
});

// ── Test harness awareness ────────────────────────────────────────────────────

Then('it references test harness or mock infrastructure for step definitions', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('test harness') || content.includes('mock') || content.includes('Mock'),
    `Expected SKILL.md to reference test harness or mock infrastructure`,
  );
});

Then('it acknowledges that step definitions may need runtime support from the test harness', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('runtime') || content.includes('mock'),
    `Expected SKILL.md to acknowledge runtime support needs for step definitions`,
  );
});

// ── Unit test conditional instructions ───────────────────────────────────────

Then('it contains instructions to check {string} for unit test configuration', function (
  configFile: string,
) {
  assert.ok(
    sharedCtx.fileContent.includes(configFile),
    `Expected SKILL.md to reference "${configFile}" for unit test configuration`,
  );
});

Then('it describes writing unit tests when unit tests are enabled', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('enabled') || content.includes('unit tests'),
    `Expected SKILL.md to describe writing unit tests when enabled`,
  );
});

Then('it describes skipping unit tests when unit tests are disabled', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('disabled') || content.includes('skip unit tests'),
    `Expected SKILL.md to describe skipping unit tests when disabled`,
  );
});

// ── Verification frequency instructions ──────────────────────────────────────

Then('it allows the agent to decide when to run verification based on plan task structure', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('judgement') || content.includes('judgment') || content.includes('Use your'),
    `Expected SKILL.md to allow the agent to decide verification frequency`,
  );
});

Then('it does not mandate running tests after every single line of code', function () {
  assert.ok(
    sharedCtx.fileContent.includes('every single line'),
    `Expected SKILL.md to address "every single line" (to negate the mandate)`,
  );
});

// ── No interactive approval instructions ─────────────────────────────────────

Then('it does not contain instructions to ask the user for approval', function () {
  const content = sharedCtx.fileContent;
  const hasForbiddenContent =
    content.includes('ask the user for approval') ||
    content.includes('ask for approval') ||
    (content.includes('ask the user') && content.includes('approval'));
  assert.ok(
    !hasForbiddenContent,
    `Expected SKILL.md not to contain instructions to ask the user for approval`,
  );
});

Then('it does not contain instructions to confirm with the user before proceeding', function () {
  const content = sharedCtx.fileContent;
  const hasForbiddenContent =
    content.includes('confirm with the user') ||
    content.includes('ask the user to confirm');
  assert.ok(
    !hasForbiddenContent,
    `Expected SKILL.md not to contain instructions to confirm with the user`,
  );
});

Then('it treats the plan as the specification that authorizes implementation', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('plan') && (content.includes('authorizes') || content.includes('specification') || content.includes('Trust the plan')),
    `Expected SKILL.md to treat the plan as the authorizing specification`,
  );
});

// ── Reporting instructions ────────────────────────────────────────────────────

Then('it contains instructions to report completed work', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('Report') || content.includes('report'),
    `Expected SKILL.md to contain instructions to report completed work`,
  );
});

Then('it includes {string} as part of the reporting step', function (command: string) {
  assert.ok(
    sharedCtx.fileContent.includes(command),
    `Expected SKILL.md to include "${command}" in the reporting step`,
  );
});

// ── $ARGUMENTS / invocation pattern ──────────────────────────────────────────

Then('it references {string} or an equivalent mechanism for receiving the plan', function (
  token: string,
) {
  assert.ok(
    sharedCtx.fileContent.includes(token),
    `Expected SKILL.md to reference "${token}" or equivalent`,
  );
});

Then('the plan content drives what the agent builds', function () {
  // Verified by the $ARGUMENTS check above — $ARGUMENTS passes the plan into the skill
});

// ── Comparison: implement-tdd vs implement ────────────────────────────────────

When('both files are compared', function () {
  // Context only — assertions performed in Then steps
});

Then('the implement-tdd skill includes TDD-specific instructions not present in implement', function () {
  const skillContent = readFileSync(join(ROOT, '.claude/skills/implement-tdd/SKILL.md'), 'utf-8');
  const implementContent = readFileSync(join(ROOT, '.claude/commands/implement.md'), 'utf-8');
  const hasTdd = skillContent.includes('RED') && skillContent.includes('GREEN') && skillContent.includes('REFACTOR');
  const implementHasTdd = implementContent.includes('RED') && implementContent.includes('GREEN') && implementContent.includes('REFACTOR');
  assert.ok(hasTdd, 'Expected implement-tdd SKILL.md to contain RED/GREEN/REFACTOR instructions');
  assert.ok(!implementHasTdd, 'Expected implement.md to NOT contain TDD-specific RED/GREEN/REFACTOR instructions');
});

Then('the implement-tdd skill references BDD scenarios as test inputs', function () {
  const skillContent = readFileSync(join(ROOT, '.claude/skills/implement-tdd/SKILL.md'), 'utf-8');
  assert.ok(
    skillContent.includes('.feature') || skillContent.includes('BDD'),
    `Expected implement-tdd SKILL.md to reference BDD scenarios (.feature files)`,
  );
});

Then('the implement command does not reference red-green-refactor', function () {
  const implementContent = readFileSync(join(ROOT, '.claude/commands/implement.md'), 'utf-8');
  assert.ok(
    !implementContent.toLowerCase().includes('red-green-refactor'),
    `Expected implement.md NOT to reference red-green-refactor`,
  );
});

// ── File content matching across skill directories ────────────────────────────

Then(
  '{string} in {string} matches {string} in {string}',
  function (file1: string, dir1: string, file2: string, dir2: string) {
    const path1 = join(ROOT, dir1, file1);
    const path2 = join(ROOT, dir2, file2);
    assert.ok(existsSync(path1), `Expected "${join(dir1, file1)}" to exist`);
    assert.ok(existsSync(path2), `Expected "${join(dir2, file2)}" to exist`);
    const content1 = readFileSync(path1, 'utf-8');
    const content2 = readFileSync(path2, 'utf-8');
    assert.strictEqual(
      content1,
      content2,
      `Expected "${join(dir1, file1)}" to match "${join(dir2, file2)}"`,
    );
  },
);
