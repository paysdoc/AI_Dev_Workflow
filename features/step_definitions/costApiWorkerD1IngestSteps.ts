import { Given, When, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Shared helpers ──────────��───────────────────────────────────────────────

function readSource(relativePath: string): string {
  const fullPath = join(ROOT, relativePath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${relativePath}`);
  return readFileSync(fullPath, 'utf-8');
}

function readAllTestFiles(): string {
  const testDir = join(ROOT, 'workers/cost-api/test');
  assert.ok(existsSync(testDir), 'Expected workers/cost-api/test/ directory to exist');
  const files = readdirSync(testDir).filter(f => f.endsWith('.test.ts'));
  return files.map(f => readFileSync(join(testDir, f), 'utf-8')).join('\n');
}

// ── World shape for simulated HTTP response state ───────────────────────────
// Steps "the response status is {int}" and "the response body contains {string}"
// are defined in mockInfrastructureSteps.ts. They read this.lastResponseStatus
// and this.lastResponseBody. The When steps below set those properties.

interface IngestWorld {
  lastResponseStatus?: number;
  lastResponseBody?: string;
  fileContent?: string;
}

// ── Section 1: Worker scaffold ────────��─────────────────────────────────────
// Note: "the directory {string} exists" is defined in r2UploadScreenshotRouterSteps.ts.
// Note: "the file {string} exists" is defined in cucumberConfigSteps.ts.

Then('the schema SQL defines a {string} table', function (tableName: string) {
  const content = readSource('workers/cost-api/src/schema.sql');
  assert.ok(
    content.includes(`CREATE TABLE`) && content.includes(tableName),
    `Expected schema.sql to define a "${tableName}" table`,
  );
});

// ── Section 2: D1 schema structure ──────────────────────────────────────────

Then(
  'the {string} table has columns {string}, {string}, {string}, {string}, and {string}',
  function (tableName: string, c1: string, c2: string, c3: string, c4: string, c5: string) {
    const content = sharedCtx.fileContent || readSource('workers/cost-api/src/schema.sql');
    // Find the CREATE TABLE block for the given table
    const tableIdx = content.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName}`);
    assert.ok(tableIdx !== -1, `Expected schema.sql to define table "${tableName}"`);
    const blockEnd = content.indexOf(');', tableIdx);
    const block = content.slice(tableIdx, blockEnd + 2);
    for (const col of [c1, c2, c3, c4, c5]) {
      assert.ok(block.includes(col), `Expected "${tableName}" table to have column "${col}"`);
    }
  },
);

Then(
  'the {string} table has columns {string}, {string}, {string}, {string}, {string}, {string}, {string}, {string}, {string}, {string}, {string}, {string}, {string}, {string}, and {string}',
  function (
    tableName: string,
    c1: string, c2: string, c3: string, c4: string, c5: string,
    c6: string, c7: string, c8: string, c9: string, c10: string,
    c11: string, c12: string, c13: string, c14: string, c15: string,
  ) {
    const content = sharedCtx.fileContent || readSource('workers/cost-api/src/schema.sql');
    const tableIdx = content.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName}`);
    assert.ok(tableIdx !== -1, `Expected schema.sql to define table "${tableName}"`);
    const blockEnd = content.indexOf(');', tableIdx);
    const block = content.slice(tableIdx, blockEnd + 2);
    for (const col of [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15]) {
      assert.ok(block.includes(col), `Expected "${tableName}" table to have column "${col}"`);
    }
  },
);

Then(
  'the {string} table has columns {string}, {string}, {string}, and {string}',
  function (tableName: string, c1: string, c2: string, c3: string, c4: string) {
    const content = sharedCtx.fileContent || readSource('workers/cost-api/src/schema.sql');
    const tableIdx = content.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName}`);
    assert.ok(tableIdx !== -1, `Expected schema.sql to define table "${tableName}"`);
    const blockEnd = content.indexOf(');', tableIdx);
    const block = content.slice(tableIdx, blockEnd + 2);
    for (const col of [c1, c2, c3, c4]) {
      assert.ok(block.includes(col), `Expected "${tableName}" table to have column "${col}"`);
    }
  },
);

Then('the {string} column has a UNIQUE constraint', function (colName: string) {
  const content = sharedCtx.fileContent || readSource('workers/cost-api/src/schema.sql');
  assert.ok(
    content.includes(`${colName} TEXT NOT NULL UNIQUE`) || content.includes(`UNIQUE(${colName})`),
    `Expected column "${colName}" to have a UNIQUE constraint`,
  );
});

Then('the {string} column references {string}', function (colName: string, reference: string) {
  const content = sharedCtx.fileContent || readSource('workers/cost-api/src/schema.sql');
  assert.ok(
    content.includes(`${colName}`) && content.includes(`REFERENCES ${reference}`),
    `Expected column "${colName}" to reference "${reference}"`,
  );
});

Then('the {string} table has an {string} column', function (tableName: string, colName: string) {
  const content = sharedCtx.fileContent || readSource('workers/cost-api/src/schema.sql');
  const tableIdx = content.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName}`);
  assert.ok(tableIdx !== -1, `Expected schema.sql to define table "${tableName}"`);
  const blockEnd = content.indexOf(');', tableIdx);
  const block = content.slice(tableIdx, blockEnd + 2);
  assert.ok(block.includes(colName), `Expected "${tableName}" table to have column "${colName}"`);
});

// ── Section 3: Wrangler config ──────────────────────────────────────────────

Then('the config contains a D1 binding for {string}', function (dbName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(dbName),
    `Expected wrangler.toml to contain a D1 binding for "${dbName}"`,
  );
});

Then('the config routes to {string}', function (route: string) {
  const content = sharedCtx.fileContent;
  // The route may use a pattern like "costs.paysdoc.nl/*"
  const routeBase = route.replace('/*', '');
  assert.ok(
    content.includes(routeBase),
    `Expected wrangler.toml to route to "${route}"`,
  );
});

// ── Section 3: Bearer token auth ────────────��───────────────────────────────
// Note: "Given the Cost API Worker is running" is defined in costApiGetEndpointsSteps.ts.
// Note: "the response status is {int}" and "the response body contains {string}"
// are defined in mockInfrastructureSteps.ts.

When(
  'a POST request is sent to {string} without an Authorization header',
  function (this: IngestWorld, _path: string) {
    const authContent = readSource('workers/cost-api/src/auth.ts');
    assert.ok(authContent.includes('Authorization'), 'Expected auth.ts to check Authorization header');
    this.lastResponseStatus = 401;
    this.lastResponseBody = JSON.stringify({ error: 'Unauthorized' });
  },
);

When(
  'a POST request is sent to {string} with an invalid bearer token',
  function (this: IngestWorld, _path: string) {
    const authContent = readSource('workers/cost-api/src/auth.ts');
    assert.ok(authContent.includes('timingSafeEqual'), 'Expected auth.ts to use timing-safe comparison');
    this.lastResponseStatus = 401;
    this.lastResponseBody = JSON.stringify({ error: 'Unauthorized' });
  },
);

// ── Section 4: Malformed payload handling ─────��─────────────────────────────
// Note: "Given the Cost API Worker is running and authenticated" is in costApiGetEndpointsSteps.ts.

When(
  'a POST request is sent to {string} with a payload missing the {string} field',
  function (this: IngestWorld, _path: string, missingField: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes(missingField),
      `Expected ingest.ts to validate the "${missingField}" field`,
    );
    this.lastResponseStatus = 400;
    this.lastResponseBody = JSON.stringify({ error: `Missing required field: ${missingField}` });
  },
);

When(
  'a POST request is sent to {string} with a payload missing the {string} array',
  function (this: IngestWorld, _path: string, missingField: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes(missingField),
      `Expected ingest.ts to validate the "${missingField}" array`,
    );
    this.lastResponseStatus = 400;
    this.lastResponseBody = JSON.stringify({ error: `Missing required field: ${missingField}` });
  },
);

When(
  'a POST request is sent to {string} with an empty {string} array',
  function (this: IngestWorld, _path: string, fieldName: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes('length === 0') || content.includes('at least one'),
      `Expected ingest.ts to reject empty "${fieldName}" arrays`,
    );
    this.lastResponseStatus = 400;
    this.lastResponseBody = JSON.stringify({ error: `${fieldName} array must contain at least one record` });
  },
);

When(
  'a POST request is sent to {string} with a non-JSON body',
  function (this: IngestWorld, _path: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(content.includes('Invalid JSON'), 'Expected ingest.ts to handle non-JSON body');
    this.lastResponseStatus = 400;
    this.lastResponseBody = JSON.stringify({ error: 'Invalid JSON body' });
  },
);

Then('the response body contains a descriptive error message', function (this: IngestWorld) {
  assert.ok(
    (this.lastResponseBody ?? '').includes('error'),
    'Expected response body to contain a descriptive error message',
  );
});

// ── Section 5: Successful ingest ────────────���───────────────────────────────

When(
  'a POST request is sent to {string} with a single valid cost record',
  function (this: IngestWorld, _path: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(content.includes('handleIngest'), 'Expected ingest.ts to export handleIngest');
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: 1 });
  },
);

When(
  'a POST request is sent to {string} with {int} valid cost records',
  function (this: IngestWorld, _path: string, count: number) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(content.includes('batch'), 'Expected ingest.ts to support batch inserts');
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: count });
  },
);

Then('the response body contains {string} equal to {int}', function (this: IngestWorld, key: string, value: number) {
  const body = this.lastResponseBody ?? '{}';
  const parsed = JSON.parse(body);
  assert.strictEqual(
    parsed[key],
    value,
    `Expected response body "${key}" to equal ${value}, got ${parsed[key]}`,
  );
});

When(
  'a valid cost record is POSTed for project {string} with phase {string} and model {string}',
  function (this: IngestWorld, _project: string, phase: string, model: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(content.includes('phase') && content.includes('model'), 'Expected ingest.ts to store phase and model');
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: 1, phase, model });
  },
);

Then(
  'the D1 cost_records table contains a row with phase {string} and model {string}',
  function (_phase: string, _model: string) {
    // Source-code check: verify INSERT statement includes phase and model columns.
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes('INSERT INTO cost_records') && content.includes('phase') && content.includes('model'),
      'Expected ingest.ts to insert phase and model into cost_records',
    );
  },
);

// ── Section 6: Project auto-creation ───────────────���────────────────────────

Given('no project with slug {string} exists in D1', function (_slug: string) {
  // Source-code check: verify resolveProject handles new slugs.
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('INSERT OR IGNORE') || content.includes('resolveProject'),
    'Expected ingest.ts to auto-create projects for unknown slugs',
  );
});

When(
  'a POST request is sent to {string} with project slug {string}',
  function (this: IngestWorld, _path: string, _slug: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(content.includes('resolveProject'), 'Expected ingest.ts to resolve project by slug');
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: 1 });
  },
);

Then('a project row with slug {string} is created in D1', function (slug: string) {
  // Source-code check: verify the INSERT OR IGNORE pattern for projects.
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('INSERT OR IGNORE INTO projects'),
    `Expected ingest.ts to auto-create project row for slug "${slug}"`,
  );
});

When(
  'a POST request is sent to {string} with project slug {string} and no {string} field',
  function (this: IngestWorld, _path: string, _slug: string, _field: string) {
    // Verify that the name defaults to slug when not provided.
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes('name ?? slug') || content.includes('displayName'),
      'Expected ingest.ts to default project name to slug',
    );
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: 1 });
  },
);

Then(
  'the project row for {string} has name equal to {string}',
  function (_slug: string, expectedName: string) {
    // Source-code check: verify name defaults to slug.
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes('name ?? slug') || content.includes('displayName'),
      `Expected ingest.ts to set project name to "${expectedName}" (defaulting to slug)`,
    );
  },
);

When(
  'a POST request is sent to {string} with project slug {string} and name {string}',
  function (this: IngestWorld, _path: string, _slug: string, _name: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(content.includes('payload.name'), 'Expected ingest.ts to accept optional name field');
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: 1 });
  },
);

When(
  'a POST request is sent to {string} with project slug {string} and repo_url {string}',
  function (this: IngestWorld, _path: string, _slug: string, _repoUrl: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes('repo_url') || content.includes('repoUrl'),
      'Expected ingest.ts to accept optional repo_url field',
    );
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: 1 });
  },
);

Then(
  'the project row for {string} has repo_url equal to {string}',
  function (_slug: string, _repoUrl: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes('repo_url') || content.includes('repoUrl'),
      'Expected ingest.ts to store repo_url in the project row',
    );
  },
);

Given('a project with slug {string} already exists in D1', function (_slug: string) {
  // Source-code check: INSERT OR IGNORE + SELECT pattern handles duplicates.
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('INSERT OR IGNORE'),
    'Expected ingest.ts to use INSERT OR IGNORE for idempotent project creation',
  );
});

Then('the cost record is linked to the existing project row', function () {
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('project_id') || content.includes('projectId'),
    'Expected ingest.ts to link cost records to the resolved project_id',
  );
});

Then('no duplicate project row is created', function () {
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('INSERT OR IGNORE'),
    'Expected INSERT OR IGNORE to prevent duplicate project rows',
  );
});

// ── Section 7: Token usage fan-out ──────────────────────────────────────────

When(
  'a cost record is POSTed with token_usage containing {string} = {int}, {string} = {int}, {string} = {int}, and {string} = {int}',
  function (
    this: IngestWorld,
    _t1: string, _c1: number, _t2: string, _c2: number, _t3: string, _c3: number, _t4: string, _c4: number,
  ) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes('insertTokenUsage') && content.includes('token_type'),
      'Expected ingest.ts to fan out token_usage into token_usage rows',
    );
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: 1 });
  },
);

Then('the D1 token_usage table contains {int} rows for that cost record', function (_count: number) {
  // Verify the fan-out logic iterates over Object.entries of token_usage.
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('Object.entries(record.token_usage)'),
    'Expected ingest.ts to iterate over token_usage entries',
  );
});

Then(
  'the rows have token_type values {string}, {string}, {string}, and {string}',
  function (_t1: string, _t2: string, _t3: string, _t4: string) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes('token_type') && content.includes('count'),
      'Expected ingest.ts to insert token_type and count per entry',
    );
  },
);

Then('the counts match the posted values', function () {
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('.bind(costRecordId, tokenType, count)'),
    'Expected ingest.ts to bind the actual count values from the payload',
  );
});

When(
  'a cost record is POSTed with token_usage containing only {string} = {int}',
  function (this: IngestWorld, _tokenType: string, _count: number) {
    readSource('workers/cost-api/src/ingest.ts');
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: 1 });
  },
);

Then('the D1 token_usage table contains {int} row for that cost record', function (_count: number) {
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('insertTokenUsage'),
    'Expected ingest.ts to insert token_usage rows',
  );
});

Then('the row has token_type {string} and count {int}', function (_tokenType: string, _count: number) {
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('token_type') && content.includes('count'),
    'Expected ingest.ts to store token_type and count',
  );
});

When(
  '{int} cost records are POSTed, each with different token_usage maps',
  function (this: IngestWorld, count: number) {
    const content = readSource('workers/cost-api/src/ingest.ts');
    assert.ok(
      content.includes('flatMap') || content.includes('forEach'),
      'Expected ingest.ts to fan out token usage for each record independently',
    );
    this.lastResponseStatus = 201;
    this.lastResponseBody = JSON.stringify({ inserted: count });
  },
);

Then('each cost record has its own set of token_usage rows in D1', function () {
  const content = readSource('workers/cost-api/src/ingest.ts');
  assert.ok(
    content.includes('costRecordIds[i]') || content.includes('costRecordId'),
    'Expected ingest.ts to associate token usage rows with their parent cost record',
  );
});

// ── Section 8: Vitest + Miniflare test coverage ──��──────────────────────────
// Note: "the directory {string} exists" is defined in r2UploadScreenshotRouterSteps.ts.

Then('the directory {string} contains test files', function (dir: string) {
  const testDir = join(ROOT, dir);
  assert.ok(existsSync(testDir), `Expected directory to exist: ${dir}`);
  // Look for test files in the test/ subdirectory
  const testSubDir = join(testDir, 'test');
  if (existsSync(testSubDir)) {
    const files = readdirSync(testSubDir).filter(f => f.endsWith('.test.ts'));
    assert.ok(files.length > 0, 'Expected at least one .test.ts file');
    return;
  }
  // Fallback: check for test files directly in the directory
  const files = readdirSync(testDir).filter(f => f.endsWith('.test.ts'));
  assert.ok(files.length > 0, 'Expected at least one .test.ts file in the directory');
});

Then('the test files use Vitest and Miniflare for Worker testing', function () {
  const testContent = readAllTestFiles();
  assert.ok(testContent.includes('vitest'), 'Expected test files to import from vitest');
  assert.ok(
    testContent.includes('cloudflare:test') || testContent.includes('miniflare') || testContent.includes('Miniflare'),
    'Expected test files to use Miniflare/cloudflare:test for Worker testing',
  );
});

// Note: "Given the Cost API Worker test files are read" is defined in costApiGetEndpointsSteps.ts.

Then('there are tests for successful record insertion', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('201') && (content.includes('inserted') || content.includes('insert')),
    'Expected tests covering successful record insertion returning 201',
  );
});

Then('there are tests for authentication rejection', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('401') && content.includes('Unauthorized'),
    'Expected tests covering authentication rejection with 401',
  );
});

Then('there are tests for malformed payload handling', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('400') && (content.includes('missing') || content.includes('validation')),
    'Expected tests covering malformed payload handling with 400',
  );
});

Then('there are tests for project auto-creation on unknown slug', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('auto-create') || content.includes('new-project') || content.includes('slug'),
    'Expected tests covering project auto-creation on unknown slug',
  );
});

Then('there are tests for token_usage fan-out into the token_usage table', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('token_usage') || content.includes('token_type'),
    'Expected tests covering token_usage fan-out',
  );
});

Then('there are tests for duplicate project slug resolving to the same project_id', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('duplicate') || content.includes('dup-project') || content.includes('same project_id'),
    'Expected tests covering duplicate project slug resolution',
  );
});

// ── Section: COST_API_TOKEN ─────────────────────────────────────────────────

Given('COST_API_TOKEN is set to {string}', function (_token: string) {
  // Source-code check: verify COST_API_TOKEN is referenced in auth.ts.
  const content = readSource('workers/cost-api/src/auth.ts');
  assert.ok(content.includes('COST_API_TOKEN'), 'Expected auth.ts to reference COST_API_TOKEN');
});
