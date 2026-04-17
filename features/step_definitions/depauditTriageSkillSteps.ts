import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

// ── depaudit-triage SKILL.md content assertions ───────────────────────────────

Then(
  'it contains instructions to locate {string} in the current working directory',
  function (path: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(path),
      `Expected SKILL.md to reference "${path}"`,
    );
    assert.ok(
      content.includes('current working directory') ||
        content.includes('working directory') ||
        content.includes('cwd'),
      `Expected SKILL.md to instruct locating "${path}" in the current working directory`,
    );
  },
);

Then(
  'it contains instructions to error clearly if {string} is missing or unreadable',
  function (path: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(path),
      `Expected SKILL.md to reference "${path}"`,
    );
    assert.ok(
      content.includes('not found') ||
        content.includes('missing') ||
        content.includes('does not exist'),
      `Expected SKILL.md to instruct erroring clearly when "${path}" is missing`,
    );
  },
);

Then(
  'it contains instructions to walk each {string} finding one at a time in sequence',
  function (classification: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(`"${classification}"`) || content.includes(classification),
      `Expected SKILL.md to reference "${classification}" findings`,
    );
    assert.ok(
      content.includes('one at a time') ||
        content.includes('sequential') ||
        content.includes('sequentially'),
      `Expected SKILL.md to instruct walking findings one at a time in sequence`,
    );
  },
);

Then(
  'it contains a menu with at least these actions:',
  function (dataTable: { rows: () => string[][] }) {
    const rows = dataTable.rows();
    rows.forEach(([action]: string[]) => {
      const trimmed = action.trim();
      assert.ok(
        sharedCtx.fileContent.toLowerCase().includes(trimmed.toLowerCase()),
        `Expected SKILL.md to contain menu action "${trimmed}"`,
      );
    });
  },
);

Then(
  'it contains instructions to prompt for a {string} of at least 20 characters when accepting a finding',
  function (field: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(field),
      `Expected SKILL.md to reference the "${field}" field`,
    );
    assert.ok(
      content.includes('20'),
      `Expected SKILL.md to enforce a minimum of 20 characters for "${field}"`,
    );
  },
);

Then(
  'it contains instructions to enforce an {string} date no more than 90 days from today',
  function (field: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(field),
      `Expected SKILL.md to reference the "${field}" date field`,
    );
    assert.ok(
      content.includes('90'),
      `Expected SKILL.md to enforce a maximum of 90 days for "${field}"`,
    );
  },
);

Then(
  'it contains instructions to write supply-chain accept entries into {string}',
  function (file: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(file),
      `Expected SKILL.md to reference "${file}" for supply-chain entries`,
    );
    assert.ok(
      content.includes('supply-chain') || content.includes('supplyChain') || content.includes('socket'),
      `Expected SKILL.md to associate supply-chain findings with "${file}"`,
    );
  },
);

Then(
  'it contains instructions to write CVE accept entries into {string}',
  function (file: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(file),
      `Expected SKILL.md to reference "${file}" for CVE entries`,
    );
    assert.ok(
      content.includes('CVE') || content.includes('osv') || content.includes('OSV'),
      `Expected SKILL.md to associate CVE findings with "${file}"`,
    );
  },
);

Then(
  'it contains instructions to key accept entries by the triple of package, version, and finding-id',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(content.includes('package'), `Expected SKILL.md to reference "package" in the identity`);
    assert.ok(content.includes('version'), `Expected SKILL.md to reference "version" in the identity`);
    assert.ok(
      content.includes('finding-id') ||
        content.includes('finding-ID') ||
        content.includes('findingId'),
      `Expected SKILL.md to reference "finding-id" in the identity`,
    );
  },
);

Then(
  'it contains instructions that the {string} action leaves all state files untouched',
  function (action: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.toLowerCase().includes(action.toLowerCase()),
      `Expected SKILL.md to reference the "${action}" action`,
    );
    assert.ok(
      content.includes('untouched') ||
        content.includes('without writing') ||
        content.includes('without modifying'),
      `Expected SKILL.md to specify that "${action}" leaves state files untouched`,
    );
  },
);

Then('it moves to the next finding without writing anything', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('next finding'),
    `Expected SKILL.md to instruct moving to the next finding`,
  );
  assert.ok(
    content.includes('without writing anything') ||
      content.includes('without writing') ||
      content.includes('without modifying'),
    `Expected SKILL.md to specify moving to the next finding without writing anything`,
  );
});

Then(
  'it contains instructions to detect findings that already have an accept entry with a non-empty {string}',
  function (field: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(field),
      `Expected SKILL.md to reference the "${field}" field`,
    );
    assert.ok(
      content.includes('non-empty') || content.includes('already'),
      `Expected SKILL.md to check for a non-empty "${field}" in existing accept entries`,
    );
  },
);

Then(
  'it marks those findings as {string} and skips them automatically',
  function (status: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(status),
      `Expected SKILL.md to mark findings as "${status}"`,
    );
    assert.ok(
      content.includes('auto-skip') ||
        content.includes('skip') ||
        content.includes('automatically'),
      `Expected SKILL.md to specify auto-skipping findings marked as "${status}"`,
    );
  },
);

Then(
  'it contains instructions that the findings file is treated as a static snapshot',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('static snapshot') ||
        (content.includes('static') && content.includes('snapshot')),
      `Expected SKILL.md to describe findings file as a static snapshot`,
    );
  },
);

Then('it does not trigger a re-scan after each action', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('re-scan') || content.includes('rescan'),
    `Expected SKILL.md to address re-scan behavior`,
  );
  assert.ok(
    content.includes('NOT') ||
      content.includes('no re-scan') ||
      content.includes('do not') ||
      content.includes('Do not') ||
      content.includes('Do NOT'),
    `Expected SKILL.md to explicitly prohibit re-scanning`,
  );
});
