import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

// ── Context-only When steps (content loaded by Background) ────────────────────

When('the content is inspected for the red-green-refactor loop instructions', function () {
  // Context only — content already loaded into sharedCtx by Background
});

When('the content is inspected for the GREEN phase instructions', function () {
  // Context only — content already loaded into sharedCtx by Background
});

When('the content is inspected for unit test instructions', function () {
  // Context only — content already loaded into sharedCtx by Background
});

// ── Scenario 1: Reading the Unit Tests setting ────────────────────────────────

Then(
  'it contains instructions to check {string} for the {string} setting',
  function (filePath: string, setting: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(filePath),
      `Expected SKILL.md to reference "${filePath}"`,
    );
    assert.ok(
      content.includes(setting),
      `Expected SKILL.md to reference "${setting}" setting`,
    );
  },
);

Then('the check happens before or during the TDD loop, not after', function () {
  const content = sharedCtx.fileContent;
  const unitTestIdx = content.indexOf('Unit Tests');
  const reportIdx = content.indexOf('## Report');
  assert.ok(unitTestIdx !== -1, 'Expected SKILL.md to mention "Unit Tests"');
  assert.ok(reportIdx !== -1, 'Expected SKILL.md to contain a "## Report" section');
  assert.ok(
    unitTestIdx < reportIdx,
    'Expected the Unit Tests check to appear before the ## Report section (before or during the TDD loop, not after)',
  );
});

// ── Scenario 2: RED phase integration ────────────────────────────────────────

Then(
  'the RED phase includes writing unit tests alongside step definitions when unit tests are enabled',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('RED') &&
        (content.includes('unit test') || content.includes('unit tests')),
      'Expected SKILL.md RED phase to reference writing unit tests alongside step definitions when enabled',
    );
    assert.ok(
      content.includes('step definition') || content.includes('step definitions'),
      'Expected SKILL.md to reference step definitions in the RED phase',
    );
  },
);

Then('unit tests are written before implementation code \\(test-first)', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('test-first') ||
      content.includes('before implementation') ||
      content.includes('before implementation code'),
    'Expected SKILL.md to describe writing unit tests before implementation code (test-first)',
  );
});

// ── Scenario 3: Per-scenario vertical slice ───────────────────────────────────

Then('unit tests are written as part of the vertical slice for each scenario', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    (content.includes('vertical slice') || content.includes('vertical slicing')) &&
      (content.includes('unit test') || content.includes('unit tests')),
    'Expected SKILL.md to instruct writing unit tests as part of the vertical slice for each scenario',
  );
});

Then(
  'there is no separate post-loop section for writing all unit tests at once',
  function () {
    const content = sharedCtx.fileContent;
    // Positive assertion: unit tests are mentioned within the per-scenario loop context
    assert.ok(
      content.includes('unit test') || content.includes('unit tests'),
      'Expected SKILL.md to mention unit tests',
    );
    // Negative assertion: no batch/post-loop instruction
    const hasPostLoopBatch =
      content.includes('After the loop') ||
      content.includes('after the loop') ||
      content.includes('write all unit tests at once') ||
      content.includes('batch unit tests');
    assert.ok(
      !hasPostLoopBatch,
      'Expected SKILL.md NOT to have a separate post-loop section for writing all unit tests at once',
    );
  },
);

// ── Scenario 4: GREEN phase both pass ─────────────────────────────────────────

Then(
  'the GREEN phase verifies that both the BDD scenario and unit tests pass',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('GREEN') &&
        (content.includes('both') || content.includes('both pass')),
      'Expected SKILL.md GREEN phase to verify both BDD scenario and unit tests pass',
    );
    assert.ok(
      content.includes('unit test') || content.includes('unit tests'),
      'Expected SKILL.md GREEN phase to reference unit tests',
    );
  },
);

Then('implementation is considered GREEN only when both pass', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('GREEN only when both pass') ||
      content.includes('only when both pass') ||
      content.includes('considered GREEN only when both'),
    'Expected SKILL.md to state implementation is GREEN only when both BDD scenario and unit tests pass',
  );
});

// ── Scenario 5: Skip when disabled ───────────────────────────────────────────

Then(
  'it describes skipping unit tests when the {string} setting is {string}',
  function (setting: string, value: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(setting),
      `Expected SKILL.md to reference "${setting}"`,
    );
    assert.ok(
      content.includes(value),
      `Expected SKILL.md to describe the "${value}" state for the "${setting}" setting`,
    );
    assert.ok(
      content.includes('skip') || content.includes('skip unit tests') || content.includes('disabled'),
      `Expected SKILL.md to describe skipping unit tests when "${setting}" is "${value}"`,
    );
  },
);

Then('only BDD scenarios drive the TDD loop in this case', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('only BDD scenarios drive the TDD loop') ||
      (content.includes('BDD') &&
        content.includes('skip') &&
        (content.includes('unit test') || content.includes('unit tests'))),
    'Expected SKILL.md to describe only BDD scenarios driving the TDD loop when unit tests are disabled/absent',
  );
});

// ── Scenario 6: Skip when absent ─────────────────────────────────────────────

Then(
  'it describes skipping unit tests when the {string} section is absent from {string}',
  function (section: string, file: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(section),
      `Expected SKILL.md to reference "${section}"`,
    );
    assert.ok(
      content.includes(file),
      `Expected SKILL.md to reference "${file}"`,
    );
    assert.ok(
      content.includes('absent') || content.includes('missing') || content.includes('section is absent'),
      `Expected SKILL.md to describe behavior when "${section}" section is absent from "${file}"`,
    );
  },
);

Then('the behavior is identical to when unit tests are disabled', function () {
  const content = sharedCtx.fileContent;
  // Both disabled and absent should be handled in the same condition
  assert.ok(
    (content.includes('disabled') && content.includes('absent')) ||
      content.includes('disabled or absent') ||
      content.includes('absent') ||
      content.includes('or the section is absent'),
    'Expected SKILL.md to treat absent unit test setting the same as disabled',
  );
});

// ── Scenario 7 & 8: References to tests.md and mocking.md ────────────────────

Then(
  'it references {string} for guidance on writing good unit tests',
  function (refFile: string) {
    assert.ok(
      sharedCtx.fileContent.includes(refFile),
      `Expected SKILL.md to reference "${refFile}" for guidance on writing good unit tests`,
    );
  },
);

Then(
  'it references {string} for guidance on mocking in unit tests',
  function (refFile: string) {
    assert.ok(
      sharedCtx.fileContent.includes(refFile),
      `Expected SKILL.md to reference "${refFile}" for guidance on mocking in unit tests`,
    );
  },
);

// ── Scenario 9: BDD as independent proof layer ────────────────────────────────

Then('it describes BDD scenarios as the independent proof layer', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('independent proof layer'),
    'Expected SKILL.md to describe BDD scenarios as the independent proof layer',
  );
});

Then(
  'it distinguishes unit tests as finer-grained coverage written by the same agent',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('finer-grained') || content.includes('finer grained'),
      'Expected SKILL.md to describe unit tests as finer-grained coverage',
    );
    assert.ok(
      content.includes('same agent'),
      'Expected SKILL.md to note that unit tests are written by the same agent',
    );
  },
);

Then('it does not elevate unit test status above BDD scenarios', function () {
  const content = sharedCtx.fileContent;
  const elevatesUnitTests =
    content.includes('unit tests replace') ||
    content.includes('unit tests supersede') ||
    content.includes('unit tests are more important') ||
    content.includes('unit tests take priority');
  assert.ok(
    !elevatesUnitTests,
    'Expected SKILL.md NOT to elevate unit test status above BDD scenarios',
  );
  // Positive: unit tests supplement BDD scenarios
  assert.ok(
    content.includes('supplement') || content.includes('not replace') || content.includes('independent proof'),
    'Expected SKILL.md to position unit tests as supplementary to BDD scenarios',
  );
});

// ── Scenario 10 & 11: TDD loop structure DataTable ───────────────────────────

Then(
  'the enabled-unit-test loop follows this structure:',
  function (dataTable: { rows: () => string[][] }) {
    const content = sharedCtx.fileContent;
    const rows = dataTable.rows().slice(1); // skip header row
    rows.forEach(([_phase, activity]: string[]) => {
      assert.ok(
        content.includes(activity),
        `Expected SKILL.md to include activity "${activity}" in the enabled-unit-test TDD loop structure`,
      );
    });
  },
);

Then(
  'the disabled-unit-test loop follows this structure:',
  function (dataTable: { rows: () => string[][] }) {
    const content = sharedCtx.fileContent;
    const rows = dataTable.rows().slice(1); // skip header row
    rows.forEach(([_phase, activity]: string[]) => {
      assert.ok(
        content.includes(activity),
        `Expected SKILL.md to include activity "${activity}" in the disabled-unit-test TDD loop structure`,
      );
    });
  },
);

// ── Scenario 12: Vertical slicing with unit tests ─────────────────────────────

Then(
  'the vertical slicing instruction covers both step definitions and unit tests',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      (content.toLowerCase().includes('vertical') &&
        (content.includes('step definition') || content.includes('step definitions')) &&
        (content.includes('unit test') || content.includes('unit tests'))),
      'Expected SKILL.md vertical slicing instruction to cover both step definitions and unit tests',
    );
  },
);

Then(
  'it warns against writing all unit tests first then all implementation',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('all unit tests first') ||
        content.includes('write all unit tests first') ||
        content.includes('Do NOT write all unit tests first'),
      'Expected SKILL.md to warn against writing all unit tests first then all implementation',
    );
  },
);
