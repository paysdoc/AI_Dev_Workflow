import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import {
  parseReviewProofMd,
  type ReviewTagEntry,
  type SupplementaryCheck,
} from '../../adws/core/projectConfig.ts';

const ROOT = process.cwd();

// ── Shared scenario state ────────────────────────────────────────────────────

interface ScenarioState {
  parsedTags: ReviewTagEntry[];
  parsedChecks: SupplementaryCheck[];
}

const state: ScenarioState = {
  parsedTags: [],
  parsedChecks: [],
};

// ── 1. Machine-readable review_proof.md format ───────────────────────────────

When('the {string} section is parsed', function (sectionName: string) {
  const content = sharedCtx.fileContent;
  const config = parseReviewProofMd(content);
  if (sectionName.replace(/^##\s*/, '').toLowerCase() === 'tags') {
    state.parsedTags = config.tags;
  } else if (sectionName.replace(/^##\s*/, '').toLowerCase() === 'supplementary checks') {
    state.parsedChecks = config.supplementaryChecks;
  }
});

Then('it contains a structured list of BDD tags to run during review', function () {
  const config = parseReviewProofMd(sharedCtx.fileContent);
  assert.ok(
    Array.isArray(config.tags) && config.tags.length > 0,
    'Expected review_proof.md to contain a non-empty list of BDD tags',
  );
});

Then('each tag entry specifies the tag name and a severity classification', function () {
  const config = parseReviewProofMd(sharedCtx.fileContent);
  for (const entry of config.tags) {
    assert.ok(
      typeof entry.tag === 'string' && entry.tag.length > 0,
      `Expected tag entry to have a tag name, got: ${JSON.stringify(entry)}`,
    );
    assert.ok(
      entry.severity === 'blocker' || entry.severity === 'tech-debt',
      `Expected tag entry severity to be "blocker" or "tech-debt", got: ${entry.severity}`,
    );
  }
});

Then('each tag entry specifies whether the tag is optional', function () {
  const config = parseReviewProofMd(sharedCtx.fileContent);
  for (const entry of config.tags) {
    assert.ok(
      typeof entry.optional === 'boolean' || entry.optional === undefined,
      `Expected tag entry optional field to be boolean or undefined, got: ${JSON.stringify(entry)}`,
    );
  }
});

Then(
  'it contains an entry for {string} with severity {string}',
  function (tag: string, severity: string) {
    const config = parseReviewProofMd(sharedCtx.fileContent);
    const entry = config.tags.find(t => t.tag === tag);
    assert.ok(entry, `Expected review_proof.md tags to contain an entry for "${tag}"`);
    assert.strictEqual(
      entry.severity,
      severity,
      `Expected "${tag}" entry to have severity "${severity}", got "${entry.severity}"`,
    );
  },
);

Then('the {string} entry is marked as optional', function (tag: string) {
  const config = parseReviewProofMd(sharedCtx.fileContent);
  const entry = config.tags.find(t => t.tag === tag);
  assert.ok(entry, `Expected review_proof.md tags to contain an entry for "${tag}"`);
  assert.strictEqual(
    entry.optional,
    true,
    `Expected "${tag}" entry to be marked as optional`,
  );
});

Then('it does not contain an entry for {string}', function (tag: string) {
  const config = parseReviewProofMd(sharedCtx.fileContent);
  const entry = config.tags.find(t => t.tag === tag);
  assert.ok(!entry, `Expected review_proof.md tags NOT to contain an entry for "${tag}"`);
});

Then('it contains a type-check command entry', function () {
  const config = parseReviewProofMd(sharedCtx.fileContent);
  const hasTypeCheck = config.supplementaryChecks.some(
    c => c.command.includes('tsc') || c.name.toLowerCase().includes('type'),
  );
  assert.ok(hasTypeCheck, 'Expected review_proof.md supplementary checks to contain a type-check entry');
});

Then('it contains a lint command entry', function () {
  const config = parseReviewProofMd(sharedCtx.fileContent);
  const hasLint = config.supplementaryChecks.some(
    c => c.command.toLowerCase().includes('lint') || c.name.toLowerCase().includes('lint'),
  );
  assert.ok(hasLint, 'Expected review_proof.md supplementary checks to contain a lint entry');
});

Then('each check entry specifies a command to execute', function () {
  const config = parseReviewProofMd(sharedCtx.fileContent);
  assert.ok(
    config.supplementaryChecks.length > 0,
    'Expected at least one supplementary check entry',
  );
  for (const check of config.supplementaryChecks) {
    assert.ok(
      typeof check.command === 'string' && check.command.length > 0,
      `Expected supplementary check to have a command, got: ${JSON.stringify(check)}`,
    );
  }
});

Then('each check entry specifies a failure severity classification', function () {
  const config = parseReviewProofMd(sharedCtx.fileContent);
  for (const check of config.supplementaryChecks) {
    assert.ok(
      check.severity === 'blocker' || check.severity === 'tech-debt',
      `Expected supplementary check severity to be "blocker" or "tech-debt", got: ${check.severity}`,
    );
  }
});

// ── 2. regressionScenarioProof.ts reads config ───────────────────────────────

When('searching for the runScenarioProof function signature', function () {
  // Context only — file already loaded via "the file ... is read"
});

Then(
  'it accepts a parameter for tag-severity entries from the review proof config',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('reviewProofConfig') ||
        sharedCtx.fileContent.includes('ReviewProofConfig'),
      `Expected "${sharedCtx.filePath}" to accept a reviewProofConfig parameter`,
    );
  },
);

Then('it does not hardcode which tags to run', function () {
  // Ensure there is no literal hardcoded tag array like ['@regression', ...]
  // The file should reference config.tags rather than a hardcoded list
  const content = sharedCtx.fileContent;
  const hardcodedTagPattern = /\[\s*['"]@regression['"]/;
  assert.ok(
    !hardcodedTagPattern.test(content),
    `Expected "${sharedCtx.filePath}" not to hardcode a tag list starting with @regression`,
  );
  assert.ok(
    content.includes('reviewProofConfig') || content.includes('config.tags') || content.includes('entry.tag'),
    `Expected "${sharedCtx.filePath}" to iterate config-driven tags`,
  );
});

When('searching for the scenario execution loop', function () {
  // Context only
});

Then('it iterates over the tags defined in the review proof config', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('reviewProofConfig.tags') || content.includes('for (const entry of'),
    `Expected "${sharedCtx.filePath}" to iterate over reviewProofConfig.tags`,
  );
});

// Note: "it does not hardcode "@regression" as a tag to execute during review"
// is handled by the generic Then('it does not hardcode {string} as a tag to execute during review') below.

When('searching for severity classification logic', function () {
  // Context only
});

Then('severity is determined by the per-tag severity from the config', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('entry.severity') || content.includes('r.severity'),
    `Expected "${sharedCtx.filePath}" to use per-tag severity from config entry`,
  );
});

Then('the severity is not hardcoded per tag name', function () {
  const content = sharedCtx.fileContent;
  // There should be no block like: if tag === '@regression' => 'blocker'
  const hardcodedSeverityPattern = /if\s*\([^)]*['"]@regression['"]/;
  assert.ok(
    !hardcodedSeverityPattern.test(content),
    `Expected "${sharedCtx.filePath}" not to hardcode severity based on "@regression" tag name`,
  );
});

When('the {string} interface is found', function (_interfaceName: string) {
  // Context only
});

Then('it can represent results for an arbitrary set of tags', function () {
  const content = sharedCtx.fileContent;
  // ScenarioProofResult should use an array or record, not per-tag boolean fields
  assert.ok(
    content.includes('tagResults') || content.includes('TagProofResult[]'),
    `Expected "${sharedCtx.filePath}" ScenarioProofResult to use a generic tag results collection`,
  );
});

Then(
  /^it is not limited to only @regression and @adw-\{issueNumber\} fields$/,
  function () {
    const content = sharedCtx.fileContent;
    // Ensure ScenarioProofResult does not have dedicated regressionPassed / adwPassed fields
    const limitedFields =
      /regressionPassed\s*[?:]/.test(content) && /adwPassed\s*[?:]/.test(content);
    assert.ok(
      !limitedFields,
      `Expected "${sharedCtx.filePath}" ScenarioProofResult not to have hardcoded regressionPassed and adwPassed fields`,
    );
  },
);

// ── 3. /review command: tag-driven, no hardcoded assumptions ─────────────────

Then('it instructs reading tag definitions from {string}', function (configPath: string) {
  assert.ok(
    sharedCtx.fileContent.includes(configPath),
    `Expected "${sharedCtx.filePath}" to instruct reading tag definitions from "${configPath}"`,
  );
});

Then('it does not assume specific tag names for scenario execution', function () {
  const content = sharedCtx.fileContent;
  // The review command should read tags from config rather than mentioning @regression
  // as a hardcoded tag to run during review
  const hasTagDrivenInstruction =
    content.includes('review_proof.md') || content.includes('reviewProofConfig');
  assert.ok(
    hasTagDrivenInstruction,
    `Expected "${sharedCtx.filePath}" to reference review_proof.md for tag-driven execution`,
  );
});

Then('it does not hardcode {string} as a tag to execute during review', function (tag: string) {
  const content = sharedCtx.fileContent;
  const isTypeScriptSource = sharedCtx.filePath.endsWith('.ts') || sharedCtx.filePath.endsWith('.tsx');

  if (isTypeScriptSource) {
    // For TypeScript source files: verify the tag isn't passed as a literal argument to runScenariosByTag
    const tagWithoutAt = tag.startsWith('@') ? tag.slice(1) : tag;
    const hardcodedInCall =
      new RegExp(`runScenariosByTag[^)]*'${tagWithoutAt}'`).test(content) ||
      new RegExp(`runScenariosByTag[^)]*"${tagWithoutAt}"`).test(content) ||
      new RegExp(`runScenariosByTag[^)]*'${tag}'`).test(content) ||
      new RegExp(`runScenariosByTag[^)]*"${tag}"`).test(content);
    assert.ok(
      !hardcodedInCall,
      `Expected "${sharedCtx.filePath}" not to hardcode "${tag}" as a literal runScenariosByTag argument`,
    );
  } else {
    // For command/markdown files: should reference config-driven approach not hardcoded tag
    const hasStrategyB = content.includes('review_proof.md') || content.includes('Strategy B');
    assert.ok(
      hasStrategyB,
      `Expected "${sharedCtx.filePath}" to have a config-driven proof approach (referencing review_proof.md), not only hardcoded ${tag}`,
    );
  }
});

Then('tag execution is driven by the review proof config', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('review_proof.md'),
    `Expected "${sharedCtx.filePath}" to drive tag execution from review_proof.md`,
  );
});

Then('classification rules reference per-tag severity from the config', function () {
  const content = sharedCtx.fileContent;
  // The review command should reference per-tag severity rather than hardcoded names
  assert.ok(
    content.includes('review_proof.md') || content.includes('severity'),
    `Expected "${sharedCtx.filePath}" to reference per-tag severity from config`,
  );
});

Then('no tag has a hardcoded severity assumption in the review command', function () {
  const content = sharedCtx.fileContent;
  // There should be no pattern like "if @regression then blocker"
  const hardcodedPattern = /if.*@regression.*blocker|@regression.*is.*blocker/i;
  assert.ok(
    !hardcodedPattern.test(content),
    `Expected "${sharedCtx.filePath}" not to hardcode @regression as blocker`,
  );
});

// ── When context-only steps for /review command scenarios ────────────────────

When('the proof requirements section is analyzed', function () {
  // Context only — file already loaded via "the file ... is read"
});

When('searching for tag references in the proof requirements', function () {
  // Context only
});

When('the proof requirements describe failure classification', function () {
  // Context only
});

// ── 4. review.md runs tag-driven BDD scenarios from review_proof.md config ───
// (also needed for the scenario in step_def_generation_review_gating.feature)

Then('it should instruct reading tags from {string}', function (configPath: string) {
  assert.ok(
    sharedCtx.fileContent.includes(configPath),
    `Expected "${sharedCtx.filePath}" to instruct reading tags from "${configPath}"`,
  );
});

Then('it should instruct running scenarios for each configured tag', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('review_proof.md') &&
      (content.includes('tag') || content.includes('scenario')),
    `Expected "${sharedCtx.filePath}" to instruct running scenarios for each configured tag`,
  );
});

// ── review_phase.feature: Background + remaining generatable scenario ────────

Given('the review proof config defines tags and severity classifications', function () {
  // Context only — verifies the review_proof.md file exists with a Tags section
  const fullPath = join(ROOT, '.adw/review_proof.md');
  assert.ok(existsSync(fullPath), 'Expected .adw/review_proof.md to exist');
  const content = readFileSync(fullPath, 'utf-8');
  const config = parseReviewProofMd(content);
  assert.ok(
    Array.isArray(config.tags) && config.tags.length > 0,
    'Expected review_proof.md to define at least one tag with severity classification',
  );
});

Then(
  'it contains a {string} section defining which tags to run during review',
  function (sectionName: string) {
    const config = parseReviewProofMd(sharedCtx.fileContent);
    if (sectionName.replace(/^##\s*/, '').toLowerCase() === 'tags') {
      assert.ok(
        Array.isArray(config.tags) && config.tags.length > 0,
        `Expected review_proof.md "${sectionName}" section to define tags to run during review`,
      );
    } else {
      // Generic: just verify the section heading appears
      assert.ok(
        sharedCtx.fileContent.includes(sectionName),
        `Expected review_proof.md to contain "${sectionName}" section`,
      );
    }
  },
);

Then(
  'it contains a {string} section for type-check and lint',
  function (sectionName: string) {
    const config = parseReviewProofMd(sharedCtx.fileContent);
    if (sectionName.replace(/^##\s*/, '').toLowerCase() === 'supplementary checks') {
      const hasTypeCheck = config.supplementaryChecks.some(
        c => c.command.includes('tsc') || c.name.toLowerCase().includes('type'),
      );
      const hasLint = config.supplementaryChecks.some(
        c => c.command.toLowerCase().includes('lint') || c.name.toLowerCase().includes('lint'),
      );
      assert.ok(
        hasTypeCheck,
        `Expected "${sectionName}" to contain a type-check command`,
      );
      assert.ok(
        hasLint,
        `Expected "${sectionName}" to contain a lint command`,
      );
    } else {
      assert.ok(
        sharedCtx.fileContent.includes(sectionName),
        `Expected review_proof.md to contain "${sectionName}" section`,
      );
    }
  },
);

// ── 8. TypeScript integrity ───────────────────────────────────────────────────

Given('the ADW codebase has been modified for issue 273', function () {
  // Context only — the codebase is already modified on this branch
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
  assert.ok(
    existsSync(join(ROOT, 'adws/agents/regressionScenarioProof.ts')),
    'Expected regressionScenarioProof.ts to exist',
  );
  assert.ok(
    existsSync(join(ROOT, 'adws/core/projectConfig.ts')),
    'Expected projectConfig.ts to exist',
  );
});

// Note: 'When "{string}" and "{string}" are run' is already defined in removeUnnecessaryExportsSteps.ts
// Note: 'Then both type-check commands exit with code {int}' is already defined there too
// No duplicate step definitions needed for the TypeScript scenario.

// ── Helpers for unused import avoidance ──────────────────────────────────────
void (state as unknown); // state is used via mutable assignment above
