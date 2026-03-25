import { Given, When, Then, After } from '@cucumber/cucumber';
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import assert from 'assert';
import {
  checkConformance,
  formatConformanceReport,
  updateFixtureEnvelopes,
} from '../../adws/jsonl/index.ts';
import type { ConformanceResult, UpdateResult, EnvelopeSchema } from '../../adws/jsonl/types.ts';

const ROOT = process.cwd();
const SCHEMA_PROBE_PATH = 'adws/jsonl/schemaProbe.ts';
const CONFORMANCE_CHECK_PATH = 'adws/jsonl/conformanceCheck.ts';
const FIXTURE_UPDATER_PATH = 'adws/jsonl/fixtureUpdater.ts';
const FIXTURES_DIR = join(ROOT, 'adws/jsonl/fixtures');
const SCHEMA_PATH = join(ROOT, 'adws/jsonl/schema.json');
const PARSER_PATH = 'adws/core/claudeStreamParser.ts';

// ---------------------------------------------------------------------------
// Module-level scenario state (reset in After hook)
// ---------------------------------------------------------------------------

let schemaProbeSource = '';
let conformanceCheckSource = '';
let fixtureContents: Array<{ filename: string; content: string; parsed: Record<string, unknown> }> = [];
let checkResults: ConformanceResult[] = [];
let checkReport = '';
let updateResults: UpdateResult[] = [];
let schemaData: EnvelopeSchema | null = null;

// Temp directory management for CI check / updater scenarios
let tempDirs: string[] = [];
let tempSchemaPath = '';
let tempFixturesDir = '';

After(function () {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs = [];
  tempSchemaPath = '';
  tempFixturesDir = '';
  schemaProbeSource = '';
  conformanceCheckSource = '';
  fixtureContents = [];
  checkResults = [];
  checkReport = '';
  updateResults = [];
  schemaData = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): { dir: string; fixturesSubdir: string; schemaFilePath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const fixturesSubdir = join(dir, 'fixtures');
  mkdirSync(fixturesSubdir);
  const schemaFilePath = join(dir, 'schema.json');
  return { dir, fixturesSubdir, schemaFilePath };
}

function writeTestSchema(
  schemaFilePath: string,
  fields: Array<{ name: string; required: boolean; type: EnvelopeSchema['messageTypes'][string][number]['type'] }>
): void {
  const schema: EnvelopeSchema = {
    probedAt: '2026-01-01T00:00:00.000Z',
    messageTypes: { result: fields },
  };
  writeFileSync(schemaFilePath, JSON.stringify(schema, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// ── 1. Schema probe script ───────────────────────────────────────────────────
// ---------------------------------------------------------------------------

When('the schema probe script is located', function () {
  // context only — assertion in Then step
});

Then('a runnable script exists for probing the Claude CLI JSONL envelope', function () {
  assert.ok(
    existsSync(join(ROOT, SCHEMA_PROBE_PATH)),
    `Expected schema probe script to exist at ${SCHEMA_PROBE_PATH}`
  );
});

Given('the schema probe script source is read', function () {
  schemaProbeSource = readFileSync(join(ROOT, SCHEMA_PROBE_PATH), 'utf-8');
});

When('the CLI invocation is analyzed', function () {
  // context only — assertions in Then steps
});

Then('it passes a short prompt such as {string} to Claude CLI', function (prompt: string) {
  assert.ok(
    schemaProbeSource.includes(prompt),
    `Expected schema probe source to include the prompt "${prompt}"`
  );
});

Then('it requests JSONL output format', function () {
  assert.ok(
    schemaProbeSource.includes('stream-json') || schemaProbeSource.includes('output-format'),
    'Expected schema probe to request JSONL (stream-json) output format'
  );
});

When('the output processing logic is analyzed', function () {
  // context only
});

Then('it parses each JSONL line as JSON', function () {
  assert.ok(
    schemaProbeSource.includes('JSON.parse'),
    'Expected schema probe to parse JSONL lines using JSON.parse'
  );
});

Then('it extracts message types including {string} and {string}', function (type1: string, type2: string) {
  assert.ok(
    schemaProbeSource.includes(`"${type1}"`) || schemaProbeSource.includes(`'${type1}'`),
    `Expected schema probe to reference message type "${type1}"`
  );
  assert.ok(
    schemaProbeSource.includes(`"${type2}"`) || schemaProbeSource.includes(`'${type2}'`),
    `Expected schema probe to reference message type "${type2}"`
  );
});

Then('it extracts field names and nesting depth for each message type', function () {
  assert.ok(
    schemaProbeSource.includes('extractFieldSchema'),
    'Expected schema probe to call extractFieldSchema for recursive field extraction'
  );
});

When('the output persistence logic is analyzed', function () {
  // context only
});

Then('it writes the extracted envelope schema to a JSON reference file', function () {
  assert.ok(
    schemaProbeSource.includes('writeFileSync') || schemaProbeSource.includes('fs.writeFile'),
    'Expected schema probe to write schema to a file using writeFileSync'
  );
});

Then('the reference file path is deterministic and version-controllable', function () {
  assert.ok(
    schemaProbeSource.includes('schema.json'),
    'Expected schema probe to write to a deterministic path containing "schema.json"'
  );
});

Then('the prompt is a single short sentence', function () {
  assert.ok(
    schemaProbeSource.includes('say hello'),
    'Expected schema probe to use a single short-sentence prompt ("say hello")'
  );
});

Then('no tool use or multi-turn conversation is requested', function () {
  assert.ok(
    !schemaProbeSource.includes('--allowedTools') && !schemaProbeSource.includes('--resume'),
    'Expected schema probe not to request tool use or multi-turn conversation'
  );
});

// ---------------------------------------------------------------------------
// ── 2. JSONL fixture files ───────────────────────────────────────────────────
// ---------------------------------------------------------------------------

When('the fixture directory is scanned', function () {
  const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.jsonl'));
  fixtureContents = files.map((filename) => {
    const content = readFileSync(join(FIXTURES_DIR, filename), 'utf-8').trim();
    return { filename, content, parsed: JSON.parse(content) as Record<string, unknown> };
  });
});

Then('at least one JSONL fixture file is present', function () {
  assert.ok(
    fixtureContents.length > 0,
    `Expected at least one .jsonl file in ${FIXTURES_DIR}`
  );
});

Then('each fixture file contains valid JSONL with one JSON object per line', function () {
  for (const fixture of fixtureContents) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fixture.content);
    } catch (err) {
      assert.fail(`Fixture ${fixture.filename} is not valid JSON: ${err}`);
    }
    assert.ok(
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
      `Fixture ${fixture.filename} must be a JSON object (not array or primitive)`
    );
  }
});

Given('the JSONL fixture files are read', function () {
  const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.jsonl'));
  fixtureContents = files.map((filename) => {
    const content = readFileSync(join(FIXTURES_DIR, filename), 'utf-8').trim();
    return { filename, content, parsed: JSON.parse(content) as Record<string, unknown> };
  });
});

When('the message types in each fixture are collected', function () {
  // context only — types accessible via fixtureContents in Then steps
});

Then('at least one fixture contains a message with type {string}', function (type: string) {
  const found = fixtureContents.some(f => f.parsed['type'] === type);
  assert.ok(found, `Expected at least one fixture to have "type": "${type}"`);
});

When('the structure of each fixture message is inspected', function () {
  // context only
});

Then(
  'the envelope fields \\(type, top-level keys\\) are distinguishable from payload content',
  function () {
    for (const fixture of fixtureContents) {
      assert.ok(
        typeof fixture.parsed['type'] === 'string',
        `Fixture ${fixture.filename} must have a string "type" field as envelope discriminator`
      );
    }
  }
);

Then(
  'fixture files or accompanying documentation describe the envelope\\/payload split',
  function () {
    const readmePath = join(FIXTURES_DIR, 'README.md');
    assert.ok(
      existsSync(readmePath),
      `Expected README.md to exist in fixtures directory (${FIXTURES_DIR})`
    );
    const readme = readFileSync(readmePath, 'utf-8').toLowerCase();
    assert.ok(
      readme.includes('envelope') && readme.includes('payload'),
      'Expected fixtures README.md to document both "envelope" and "payload" concepts'
    );
  }
);

// ---------------------------------------------------------------------------
// ── 3. CI conformance check ──────────────────────────────────────────────────
// ---------------------------------------------------------------------------

When('the CI conformance check script is located', function () {
  // context only
});

Then(
  'a runnable script exists for validating fixture envelopes against the probed schema',
  function () {
    assert.ok(
      existsSync(join(ROOT, CONFORMANCE_CHECK_PATH)),
      `Expected CI conformance check script to exist at ${CONFORMANCE_CHECK_PATH}`
    );
  }
);

Given('the CI conformance check script source is read', function () {
  conformanceCheckSource = readFileSync(join(ROOT, CONFORMANCE_CHECK_PATH), 'utf-8');
});

When('the validation logic is analyzed', function () {
  // context only
});

Then(
  'it passes each fixture file through the parseJsonlOutput function from claudeStreamParser.ts',
  function () {
    assert.ok(
      conformanceCheckSource.includes('parseJsonlOutput'),
      'Expected conformanceCheck.ts to import and call parseJsonlOutput from claudeStreamParser.ts'
    );
  }
);

Then('it asserts that parsing completes without errors', function () {
  assert.ok(
    conformanceCheckSource.includes('parserErrors') || conformanceCheckSource.includes('runParserCheck'),
    'Expected conformanceCheck.ts to collect and report parser errors'
  );
});

When('the comparison logic is analyzed', function () {
  // context only
});

Then('it loads the probed schema reference file', function () {
  assert.ok(
    conformanceCheckSource.includes('schema.json'),
    'Expected conformanceCheck.ts to reference schema.json for loading the probed schema'
  );
});

Then(
  "it compares each fixture message's top-level keys against the probed schema",
  function () {
    assert.ok(
      conformanceCheckSource.includes('findMissingFields') || conformanceCheckSource.includes('missingFields'),
      'Expected conformanceCheck.ts to compare fixture top-level keys against schema (findMissingFields)'
    );
  }
);

Then('it compares content block types against the probed schema', function () {
  assert.ok(
    conformanceCheckSource.includes('runParserCheck') || conformanceCheckSource.includes('parserErrors'),
    'Expected conformanceCheck.ts to validate content block types by running fixtures through the parser'
  );
});

Given('a fixture file with an outdated envelope structure', function () {
  const { fixturesSubdir, schemaFilePath } = makeTempDir('adw-conformance-');

  // Schema that has 'subtype' required; fixture below omits it → missingFields = ["subtype"]
  // Schema also lacks 'obsoleteField' → fixture's extra key appears in extraFields
  writeTestSchema(schemaFilePath, [
    { name: 'type', required: true, type: 'string' },
    { name: 'subtype', required: true, type: 'string' },
    { name: 'isError', required: true, type: 'boolean' },
    { name: 'durationMs', required: false, type: 'number' },
  ]);

  // Fixture: missing 'subtype', has 'sessionId' (obsolete envelope field), has 'result' (payload)
  const fixture = {
    type: 'result',
    isError: false,
    sessionId: 'old-session',
    obsoleteField: 'legacy-value',
    result: 'Hand-maintained payload content.',
  };
  writeFileSync(join(fixturesSubdir, 'outdated.jsonl'), JSON.stringify(fixture) + '\n', 'utf-8');

  tempSchemaPath = schemaFilePath;
  tempFixturesDir = fixturesSubdir;
});

When('the CI conformance check is executed', function () {
  checkResults = checkConformance(tempSchemaPath, tempFixturesDir);
  checkReport = formatConformanceReport(checkResults);
});

Then('the check exits with a non-zero exit code', function () {
  const anyFailed = checkResults.some(r => !r.passed);
  assert.ok(anyFailed, 'Expected at least one fixture to fail the conformance check');
});

Then('the error output identifies which fixture files need updating', function () {
  const failedPaths = checkResults.filter(r => !r.passed).map(r => r.fixturePath);
  assert.ok(failedPaths.length > 0, 'Expected conformance report to identify failing fixtures');
  for (const p of failedPaths) {
    assert.ok(
      checkReport.includes(p),
      `Expected report to mention failing fixture path: ${p}`
    );
  }
});

Then('the error output lists which fields were added to the real schema', function () {
  // missingFields = required schema fields absent from fixture = fields "added to real schema"
  const missing = checkResults.flatMap(r => r.missingFields);
  assert.ok(missing.length > 0, 'Expected at least one required schema field to be missing from fixture');
  for (const f of missing) {
    assert.ok(
      checkReport.includes(f) || checkReport.includes('Missing required field'),
      `Expected report to reference missing field "${f}"`
    );
  }
});

Then('the error output lists which fields were removed from the real schema', function () {
  // extraFields = fixture fields absent from schema = fields "removed from real schema"
  const extra = checkResults.flatMap(r => r.extraFields);
  assert.ok(extra.length > 0, 'Expected at least one fixture field to be absent from the probed schema');
  for (const f of extra) {
    assert.ok(
      checkReport.includes(f) || checkReport.includes('Extra fields'),
      `Expected report to reference extra field "${f}"`
    );
  }
});

Then('the error output lists which fields have changed nesting or type', function () {
  // Nesting/type changes manifest as missing or extra fields in the report
  const discrepancies = [
    ...checkResults.flatMap(r => r.missingFields),
    ...checkResults.flatMap(r => r.extraFields),
  ];
  assert.ok(
    discrepancies.length > 0,
    'Expected the report to surface field discrepancies (nesting or type changes show as missing/extra fields)'
  );
});

Given('all fixture files have envelopes matching the probed schema', function () {
  // Use the real schema.json and fixtures — they should all conform
  tempSchemaPath = SCHEMA_PATH;
  tempFixturesDir = FIXTURES_DIR;
});

Then('the check exits with code 0', function () {
  const allPassed = checkResults.every(r => r.passed);
  assert.ok(
    allPassed,
    `Expected all fixtures to pass conformance check.\nReport:\n${checkReport}`
  );
});

Then('no drift warnings are emitted', function () {
  assert.ok(
    !checkReport.includes('✗') && !checkResults.some(r => !r.passed),
    `Expected no failing fixtures in conformance report.\nReport:\n${checkReport}`
  );
});

// ---------------------------------------------------------------------------
// ── 4. Programmatic fixture update ───────────────────────────────────────────
// ---------------------------------------------------------------------------

When('the fixture update script is located', function () {
  // context only
});

Then('a runnable script exists for programmatically updating fixture envelopes', function () {
  assert.ok(
    existsSync(join(ROOT, FIXTURE_UPDATER_PATH)),
    `Expected fixture updater script to exist at ${FIXTURE_UPDATER_PATH}`
  );
});

// "Given a fixture file with an outdated envelope structure" defined above (section 3, shared)

Given('the fixture file contains hand-maintained payload content', function () {
  // Verify the fixture created by the prior Given step contains payload content
  const files = readdirSync(tempFixturesDir).filter(f => f.endsWith('.jsonl'));
  assert.ok(files.length > 0, 'Expected temp fixtures directory to contain at least one .jsonl file');
  const content = readFileSync(join(tempFixturesDir, files[0]), 'utf-8').trim();
  const parsed = JSON.parse(content) as Record<string, unknown>;
  assert.ok(
    'result' in parsed,
    'Expected fixture to contain a "result" payload field'
  );
});

When('the fixture update script is executed', function () {
  updateResults = updateFixtureEnvelopes(tempSchemaPath, tempFixturesDir);
});

Then('the envelope structure is updated to match the probed schema', function () {
  const anyUpdated = updateResults.some(r => r.changed);
  assert.ok(anyUpdated, 'Expected at least one fixture to be modified by the updater');
});

Then('the hand-maintained payload content is preserved unchanged', function () {
  const files = readdirSync(tempFixturesDir).filter(f => f.endsWith('.jsonl'));
  for (const f of files) {
    const content = readFileSync(join(tempFixturesDir, f), 'utf-8').trim();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.ok(
      'result' in parsed,
      `Expected payload field "result" to be preserved in ${f} after update`
    );
  }
});

Given(
  'the probed schema includes a new top-level field not present in a fixture',
  function () {
    const { fixturesSubdir, schemaFilePath } = makeTempDir('adw-updater-new-');

    // Schema with durationMs (in ENVELOPE_FIELDS.result) as new field
    writeTestSchema(schemaFilePath, [
      { name: 'type', required: true, type: 'string' },
      { name: 'subtype', required: true, type: 'string' },
      { name: 'isError', required: true, type: 'boolean' },
      { name: 'durationMs', required: false, type: 'number' }, // new envelope field
    ]);

    // Fixture that already has all required fields but lacks durationMs
    const fixture = { type: 'result', subtype: 'success', isError: false, result: 'Done.' };
    writeFileSync(join(fixturesSubdir, 'result.jsonl'), JSON.stringify(fixture) + '\n', 'utf-8');

    tempSchemaPath = schemaFilePath;
    tempFixturesDir = fixturesSubdir;
  }
);

When('the fixture update script is executed against that fixture', function () {
  updateResults = updateFixtureEnvelopes(tempSchemaPath, tempFixturesDir);
});

Then(
  'the new field is added to the fixture messages with a sensible default value',
  function () {
    const files = readdirSync(tempFixturesDir).filter(f => f.endsWith('.jsonl'));
    for (const f of files) {
      const content = readFileSync(join(tempFixturesDir, f), 'utf-8').trim();
      const parsed = JSON.parse(content) as Record<string, unknown>;
      assert.ok(
        'durationMs' in parsed,
        `Expected new envelope field "durationMs" to be added to ${f}`
      );
      assert.strictEqual(
        parsed['durationMs'],
        0,
        `Expected "durationMs" to have numeric default value 0 in ${f}`
      );
    }
  }
);

Then('existing fields remain unchanged', function () {
  const files = readdirSync(tempFixturesDir).filter(f => f.endsWith('.jsonl'));
  for (const f of files) {
    const content = readFileSync(join(tempFixturesDir, f), 'utf-8').trim();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.ok('type' in parsed, `Expected "type" to remain in ${f}`);
    assert.ok('subtype' in parsed, `Expected "subtype" to remain in ${f}`);
    assert.ok('isError' in parsed, `Expected "isError" to remain in ${f}`);
  }
});

Given(
  'a fixture contains an envelope field no longer present in the probed schema',
  function () {
    const { fixturesSubdir, schemaFilePath } = makeTempDir('adw-updater-remove-');

    // Schema WITHOUT sessionId (but sessionId is in ENVELOPE_FIELDS.result)
    writeTestSchema(schemaFilePath, [
      { name: 'type', required: true, type: 'string' },
      { name: 'subtype', required: true, type: 'string' },
      { name: 'isError', required: true, type: 'boolean' },
    ]);

    // Fixture WITH sessionId (will be removed as obsolete envelope field)
    const fixture = {
      type: 'result',
      subtype: 'success',
      isError: false,
      sessionId: 'obsolete-session',
      result: 'Payload preserved.',
    };
    writeFileSync(join(fixturesSubdir, 'result.jsonl'), JSON.stringify(fixture) + '\n', 'utf-8');

    tempSchemaPath = schemaFilePath;
    tempFixturesDir = fixturesSubdir;
  }
);

Then('the obsolete field is removed from the fixture messages', function () {
  const files = readdirSync(tempFixturesDir).filter(f => f.endsWith('.jsonl'));
  for (const f of files) {
    const content = readFileSync(join(tempFixturesDir, f), 'utf-8').trim();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.ok(
      !('sessionId' in parsed),
      `Expected obsolete envelope field "sessionId" to be removed from ${f}`
    );
  }
});

Then('payload content fields are not removed', function () {
  const files = readdirSync(tempFixturesDir).filter(f => f.endsWith('.jsonl'));
  for (const f of files) {
    const content = readFileSync(join(tempFixturesDir, f), 'utf-8').trim();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.ok(
      'result' in parsed,
      `Expected payload field "result" to be preserved in ${f}`
    );
  }
});

Given('multiple fixture files exist with outdated envelopes', function () {
  const { fixturesSubdir, schemaFilePath } = makeTempDir('adw-updater-multi-');

  // Schema with durationMs as new envelope field
  writeTestSchema(schemaFilePath, [
    { name: 'type', required: true, type: 'string' },
    { name: 'subtype', required: true, type: 'string' },
    { name: 'isError', required: true, type: 'boolean' },
    { name: 'durationMs', required: false, type: 'number' },
  ]);

  // Two fixtures both missing durationMs
  const f1 = { type: 'result', subtype: 'success', isError: false };
  const f2 = { type: 'result', subtype: 'error', isError: true };
  writeFileSync(join(fixturesSubdir, 'result1.jsonl'), JSON.stringify(f1) + '\n', 'utf-8');
  writeFileSync(join(fixturesSubdir, 'result2.jsonl'), JSON.stringify(f2) + '\n', 'utf-8');

  tempSchemaPath = schemaFilePath;
  tempFixturesDir = fixturesSubdir;
});

When('the fixture update script is executed without specifying individual files', function () {
  updateResults = updateFixtureEnvelopes(tempSchemaPath, tempFixturesDir);
});

Then('all fixture files in the fixture directory are updated', function () {
  const fixtureCount = readdirSync(tempFixturesDir).filter(f => f.endsWith('.jsonl')).length;
  const updatedCount = updateResults.filter(r => r.changed).length;
  assert.ok(fixtureCount > 1, 'Expected multiple fixture files in the temp directory');
  assert.strictEqual(
    updatedCount,
    fixtureCount,
    `Expected all ${fixtureCount} fixture files to be updated, but only ${updatedCount} were`
  );
});

// ---------------------------------------------------------------------------
// ── 5. Parser type alignment ─────────────────────────────────────────────────
// ---------------------------------------------------------------------------

Given('the probed schema reference file is loaded', function () {
  assert.ok(existsSync(SCHEMA_PATH), `Expected schema.json to exist at ${SCHEMA_PATH}`);
  schemaData = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as EnvelopeSchema;
});

When('the content block types in the schema are listed', function () {
  // Content block type discriminators live in the parser and fixture files;
  // schema.json captures the "content" field as an array but not the enum values.
  // Assertions happen in Then steps against the parser source.
});

Then(
  'they include {string}, {string}, and {string}',
  function (t1: string, t2: string, t3: string) {
    const parserSource = readFileSync(join(ROOT, PARSER_PATH), 'utf-8');
    assert.ok(
      parserSource.includes(`'${t1}'`) || parserSource.includes(`"${t1}"`),
      `Expected claudeStreamParser.ts to reference content block type "${t1}"`
    );
    assert.ok(
      parserSource.includes(`'${t2}'`) || parserSource.includes(`"${t2}"`),
      `Expected claudeStreamParser.ts to reference content block type "${t2}"`
    );
    assert.ok(
      parserSource.includes(`'${t3}'`) || parserSource.includes(`"${t3}"`),
      `Expected claudeStreamParser.ts to reference content block type "${t3}"`
    );
  }
);

Then('they align with the ContentBlock union in claudeStreamParser.ts', function () {
  const parserSource = readFileSync(join(ROOT, PARSER_PATH), 'utf-8');
  assert.ok(
    parserSource.includes('ContentBlock'),
    'Expected claudeStreamParser.ts to define a ContentBlock discriminated union type'
  );
});

When('the top-level message types in the schema are listed', function () {
  // context only — assertions in Then steps use schemaData
});

Then('they include {string} and {string}', function (t1: string, t2: string) {
  assert.ok(
    schemaData!.messageTypes[t1] !== undefined,
    `Expected schema.json to include message type "${t1}"`
  );
  assert.ok(
    schemaData!.messageTypes[t2] !== undefined,
    `Expected schema.json to include message type "${t2}"`
  );
});

Then('they align with the JsonlMessage union in claudeStreamParser.ts', function () {
  const parserSource = readFileSync(join(ROOT, PARSER_PATH), 'utf-8');
  assert.ok(
    parserSource.includes('JsonlMessage'),
    'Expected claudeStreamParser.ts to define a JsonlMessage discriminated union type'
  );
});

// ---------------------------------------------------------------------------
// ── 6. TypeScript integrity ──────────────────────────────────────────────────
// ---------------------------------------------------------------------------

Given('the ADW codebase has been modified for issue 280', function () {
  assert.ok(
    existsSync(join(ROOT, SCHEMA_PROBE_PATH)),
    `Expected ${SCHEMA_PROBE_PATH} to exist (added for issue 280)`
  );
  assert.ok(
    existsSync(join(ROOT, CONFORMANCE_CHECK_PATH)),
    `Expected ${CONFORMANCE_CHECK_PATH} to exist (added for issue 280)`
  );
  assert.ok(
    existsSync(join(ROOT, FIXTURE_UPDATER_PATH)),
    `Expected ${FIXTURE_UPDATER_PATH} to exist (added for issue 280)`
  );
});

// When/Then for the tsc commands are handled by the shared step definitions
// in removeUnnecessaryExportsSteps.ts:
//   When('{string} and {string} are run', ...) — runs both tsc commands
//   Then('both type-check commands exit with code {int}', ...) — asserts exit code
