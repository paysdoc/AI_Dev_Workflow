import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── A: StatusOption type carries an optional id ──────────────────────────────

Then('the StatusOption type declares an optional {string} field', function (fieldName: string) {
  const content = sharedCtx.fileContent;
  const typeIdx = content.indexOf('type StatusOption');
  assert.ok(typeIdx !== -1, 'Expected "type StatusOption" in githubBoardManager.ts');
  const typeBlock = content.slice(typeIdx, typeIdx + 300);
  const optionalPatterns = [
    `${fieldName}?:`,
    `${fieldName}? :`,
  ];
  assert.ok(
    optionalPatterns.some((p) => typeBlock.includes(p)),
    `Expected StatusOption type to declare optional "${fieldName}" field (e.g. "${fieldName}?:")`,
  );
});

Then(
  'the mergeStatusOptions existing parameter type declares an optional {string} field',
  function (fieldName: string) {
    const content = sharedCtx.fileContent;
    const fnIdx = content.indexOf('export function mergeStatusOptions');
    assert.ok(fnIdx !== -1, 'Expected "export function mergeStatusOptions" in githubBoardManager.ts');
    // The signature — including the existing parameter's inline object type — is within ~600 chars.
    const signature = content.slice(fnIdx, fnIdx + 600);
    const optionalPatterns = [
      `${fieldName}?:`,
      `${fieldName}? :`,
    ];
    assert.ok(
      optionalPatterns.some((p) => signature.includes(p)),
      `Expected mergeStatusOptions existing parameter to declare optional "${fieldName}" field`,
    );
  },
);

// ── B: Option IDs are preserved through merge ────────────────────────────────

Then(
  'the ensureColumns method passes statusField.options to mergeStatusOptions without stripping id',
  function () {
    const content = sharedCtx.fileContent;
    const ensureIdx = content.indexOf('async ensureColumns');
    assert.ok(ensureIdx !== -1, 'Expected "async ensureColumns" in githubBoardManager.ts');
    const methodBody = content.slice(ensureIdx, ensureIdx + 2000);
    assert.ok(
      methodBody.includes('mergeStatusOptions(statusField.options'),
      'Expected ensureColumns to call mergeStatusOptions(statusField.options, ...) so the option id is not stripped',
    );
  },
);

Then(
  'the mergeStatusOptions function preserves the existing option id when mapping non-ADW options',
  function () {
    const content = sharedCtx.fileContent;
    const fnIdx = content.indexOf('export function mergeStatusOptions');
    assert.ok(fnIdx !== -1, 'Expected "export function mergeStatusOptions" in githubBoardManager.ts');
    const fnBody = content.slice(fnIdx, fnIdx + 2500);
    // Non-ADW passthrough should either return the full existing option (spread or direct return)
    // or explicitly propagate `id`.
    const passthroughPatterns = [
      /return opt\b/,
      /\.\.\.opt/,
      /id: opt\.id/,
    ];
    assert.ok(
      passthroughPatterns.some((p) => p.test(fnBody)),
      'Expected mergeStatusOptions to preserve existing option id when mapping non-ADW options (e.g. "return opt", "...opt", or explicit "id: opt.id")',
    );
  },
);

Then(
  'the mergeStatusOptions function preserves the existing option id when overwriting ADW-matching options',
  function () {
    const content = sharedCtx.fileContent;
    const fnIdx = content.indexOf('export function mergeStatusOptions');
    assert.ok(fnIdx !== -1, 'Expected "export function mergeStatusOptions" in githubBoardManager.ts');
    const fnBody = content.slice(fnIdx, fnIdx + 2500);
    // When overwriting an ADW-matching option, the id must be carried over.
    assert.ok(
      fnBody.includes('id: opt.id'),
      'Expected mergeStatusOptions overwrite branch to propagate the existing option id (e.g. "id: opt.id")',
    );
  },
);

// ── C: Column ordering uses BOARD_COLUMNS.order for insertion ────────────────

Then(
  'the mergeStatusOptions function reads {string} from the adw column definitions',
  function (fieldName: string) {
    const content = sharedCtx.fileContent;
    const fnIdx = content.indexOf('export function mergeStatusOptions');
    assert.ok(fnIdx !== -1, 'Expected "export function mergeStatusOptions" in githubBoardManager.ts');
    const fnBody = content.slice(fnIdx, fnIdx + 2500);
    const patterns = [
      `.${fieldName}`,
      `${fieldName}:`,
    ];
    assert.ok(
      patterns.some((p) => fnBody.includes(p)),
      `Expected mergeStatusOptions to read "${fieldName}" from adw column definitions when positioning inserts`,
    );
  },
);

Then(
  'the mergeStatusOptions function does not unconditionally push missing columns to the end',
  function () {
    const content = sharedCtx.fileContent;
    const fnIdx = content.indexOf('export function mergeStatusOptions');
    assert.ok(fnIdx !== -1, 'Expected "export function mergeStatusOptions" in githubBoardManager.ts');
    const fnBody = content.slice(fnIdx, fnIdx + 2500);
    // Guard: the previous bug was an unconditional `merged.push({ name: col.status ... })` inside the
    // missing-columns .filter(...).map(...). Ensure either splice-based insertion or an ordered build
    // is used. We require at least one of: merged.splice(...) OR a position/index computation that
    // references `order` near the insertion site.
    const hasSplice = /merged\.splice\(/.test(fnBody);
    const hasOrderedInsertion =
      fnBody.includes('anchor') ||
      fnBody.includes('insertIndex') ||
      fnBody.includes('insertAt') ||
      fnBody.includes('position');
    assert.ok(
      hasSplice || hasOrderedInsertion,
      'Expected mergeStatusOptions to insert missing columns at an ordered position (splice or index computation), not unconditionally push to the end',
    );
  },
);

// ── D: updateStatusFieldOptions includes id in mutation payload ──────────────

Then(
  'the updateStatusFieldOptions mutation payload includes {string} for each existing option',
  function (fieldName: string) {
    const content = sharedCtx.fileContent;
    const methodIdx = content.indexOf('updateStatusFieldOptions');
    assert.ok(methodIdx !== -1, 'Expected "updateStatusFieldOptions" in githubBoardManager.ts');
    // The method body is within ~1500 chars — covers the mutation string, body construction, and execSync.
    const methodBody = content.slice(methodIdx, methodIdx + 1500);
    // Require that id is explicitly threaded into the payload — either via destructure/map
    // (e.g. `id: opt.id` / `id: o.id`) or via a spread of the option (e.g. `...opt` / `...o`).
    const patterns = [
      /\bid: [a-zA-Z_$][\w$]*\.id\b/,
      /\.\.\.[a-zA-Z_$][\w$]*\b/,
    ];
    assert.ok(
      patterns.some((p) => p.test(methodBody)),
      `Expected updateStatusFieldOptions mutation payload to include "${fieldName}" for each option (e.g. "id: opt.id" or spread)`,
    );
  },
);

// ── E: Unit tests for column ordering exist ──────────────────────────────────

Then('the boardManager unit tests cover inserting Blocked at index 0', function () {
  const content = sharedCtx.fileContent;
  // Search for a test block that references Blocked insertion at index 0.
  // Looser match: must mention BoardStatus.Blocked and index 0 in the same test.
  const hasIndex0Pattern =
    /\[0\]\.name.*Blocked/s.test(content) ||
    /Blocked.*\[0\]\.name/s.test(content) ||
    /merged\[0\].*Blocked/s.test(content) ||
    /Blocked.*merged\[0\]/s.test(content);
  assert.ok(
    hasIndex0Pattern,
    'Expected a boardManager unit test that asserts Blocked is inserted at merged[0] when the other four ADW columns already exist',
  );
});

Then(
  'the boardManager unit tests cover inserting Review between InProgress and Done',
  function () {
    const content = sharedCtx.fileContent;
    // Look for a test that mentions both InProgress and Done surrounding Review in the expected merged order.
    const hasReviewBetween =
      /InProgress[\s\S]{0,200}Review[\s\S]{0,200}Done/.test(content) ||
      /Review.*InProgress.*Done/s.test(content) ||
      /indexOf\(['"]Review['"]\)/.test(content);
    assert.ok(
      hasReviewBetween,
      'Expected a boardManager unit test that asserts Review is inserted between InProgress and Done',
    );
  },
);

Then(
  'the boardManager unit tests cover inserting all five ADW columns in BOARD_COLUMNS order',
  function () {
    const content = sharedCtx.fileContent;
    // Look for an assertion that the merged names match BOARD_COLUMNS order
    // (either by mapping BOARD_COLUMNS to statuses, or by asserting the five names in order).
    const hasOrderedAssertion =
      /BOARD_COLUMNS\.map\([^)]*\)\.toEqual|toEqual\(BOARD_COLUMNS/.test(content) ||
      /\[\s*['"]Blocked['"]\s*,\s*['"]Todo['"]\s*,\s*['"]In Progress['"]\s*,\s*['"]Review['"]\s*,\s*['"]Done['"]\s*\]/.test(
        content,
      ) ||
      /Blocked[\s\S]{0,60}Todo[\s\S]{0,60}In Progress[\s\S]{0,60}Review[\s\S]{0,60}Done/.test(content);
    assert.ok(
      hasOrderedAssertion,
      'Expected a boardManager unit test that asserts all five ADW columns appear in BOARD_COLUMNS order when none exist',
    );
  },
);

Then(
  'the boardManager unit tests cover non-ADW options keeping their relative position',
  function () {
    const content = sharedCtx.fileContent;
    // A test that exercises relative position should reference at least one non-ADW option
    // (e.g. 'Custom', 'Backlog') and assert its index or relative ordering.
    const hasNonAdwPositionCheck =
      /Custom[\s\S]{0,400}(indexOf|\[0\]|\[1\]|toBeLessThan|toBeGreaterThan|\btoEqual\b)/.test(content) ||
      /Backlog[\s\S]{0,400}(indexOf|\[0\]|\[1\]|toBeLessThan|toBeGreaterThan|\btoEqual\b)/.test(content);
    assert.ok(
      hasNonAdwPositionCheck,
      'Expected a boardManager unit test that asserts non-ADW options retain their relative position',
    );
  },
);

// ── F: Unit tests for id preservation ────────────────────────────────────────

Then(
  'the boardManager unit tests assert every existing option id survives into merged',
  function () {
    const content = sharedCtx.fileContent;
    // A test should check that an existing option with an id (e.g. id: 'abc') appears
    // in the merged result with the same id.
    const hasIdSurvivalCheck =
      /id:\s*['"][^'"]+['"][\s\S]{0,2000}\.id\)?\.toBe\(|\.id\)?\.toEqual\(/.test(content) ||
      /existing[\s\S]{0,2000}merged[\s\S]{0,500}\.id/.test(content);
    assert.ok(
      hasIdSurvivalCheck,
      'Expected a boardManager unit test that asserts every existing option id survives into merged',
    );
  },
);

Then(
  'the boardManager unit tests assert newly added ADW options have undefined id',
  function () {
    const content = sharedCtx.fileContent;
    // Look for an assertion that a newly added option's id is undefined.
    const hasUndefinedIdAssertion =
      /\.id\)?\.toBeUndefined\(\)/.test(content) ||
      /\.id\)?\.toBe\(undefined\)/.test(content) ||
      /id === undefined/.test(content);
    assert.ok(
      hasUndefinedIdAssertion,
      'Expected a boardManager unit test that asserts newly added ADW options have id === undefined',
    );
  },
);

// ── G: Unit test suite passes ────────────────────────────────────────────────

Then('the boardManager unit tests pass', function () {
  try {
    execSync('bun run test:unit -- adws/providers/__tests__/boardManager.test.ts', {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string };
    const output = (error.stdout ?? '') + (error.stderr ?? '');
    assert.fail(`boardManager unit tests failed:\n${output}`);
  }
});

// ── H: TypeScript type-check step is already defined in cronGuardToctouFixSteps.ts
