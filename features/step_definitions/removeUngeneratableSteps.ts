import { Given, Then } from '@cucumber/cucumber';
import { existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── 1. Classification removal ────────────────────────────────────────────────

Then('it should not contain a section that classifies scenarios as {string} or {string}', function (a: string, b: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes(a) && !content.includes(b),
    `Expected "${sharedCtx.filePath}" not to classify scenarios as "${a}" or "${b}"`,
  );
});

Then('it should not contain instructions to determine whether a scenario requires runtime infrastructure', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes('Ungeneratable') && !content.includes('ungeneratable'),
    `Expected "${sharedCtx.filePath}" not to contain ungeneratable classification instructions`,
  );
});

Then('it should not contain instructions to remove scenarios from {string} files', function (_ext: string) {
  const content = sharedCtx.fileContent;
  // The old step 6 said: "Remove the entire scenario block ... from the .feature file"
  // Check that this specific instruction is absent
  assert.ok(
    !content.includes('Remove the entire scenario block'),
    `Expected "${sharedCtx.filePath}" not to instruct removing scenario blocks from feature files`,
  );
});

Then('it should not contain instructions to delete feature files that have no remaining scenarios', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes('delete') || !content.includes('feature'),
    `Expected "${sharedCtx.filePath}" not to instruct deleting feature files`,
  );
});

Then('it should instruct generating step definitions for every scenario tagged with the issue tag', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('@adw-$1') || content.includes('@adw-{issueNumber}') || (content.includes('@adw-') && content.includes('$1')),
    `Expected "${sharedCtx.filePath}" to instruct generating step definitions for every tagged scenario`,
  );
});

Then('it should not skip any scenarios based on infrastructure requirements', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes('Ungeneratable') && !content.includes('ungeneratable'),
    `Expected "${sharedCtx.filePath}" not to skip scenarios based on infrastructure requirements`,
  );
});

// ── 2. Test harness documentation ───────────────────────────────────────────

Then('it should document that the test harness provides a mock GitHub API server', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('github-api-server') || content.includes('GitHub API server') || content.includes('github API'),
    `Expected "${sharedCtx.filePath}" to document the mock GitHub API server`,
  );
});

Then('it should describe that the mock server handles issue, comment, PR, and label endpoints', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('api.github.com') || (content.includes('issues') && content.includes('comments')),
    `Expected "${sharedCtx.filePath}" to describe that the mock server handles GitHub API endpoints`,
  );
});

Then('it should describe that the mock server supports programmatic state setup and request recording', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('/_mock/state') || content.includes('state setup'),
    `Expected "${sharedCtx.filePath}" to describe state setup support`,
  );
  assert.ok(
    content.includes('/_mock/requests') || content.includes('request recording'),
    `Expected "${sharedCtx.filePath}" to describe request recording support`,
  );
});

Then('it should document that the test harness provides a Claude CLI stub', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('claude-cli-stub') || content.includes('Claude CLI stub'),
    `Expected "${sharedCtx.filePath}" to document the Claude CLI stub`,
  );
});

Then('it should describe that the stub streams canned JSONL fixtures to stdout', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('JSONL') || content.includes('jsonl'),
    `Expected "${sharedCtx.filePath}" to describe that the stub streams JSONL fixtures`,
  );
});

Then('it should describe that the stub is activated via the CLAUDE_CODE_PATH environment variable', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('CLAUDE_CODE_PATH'),
    `Expected "${sharedCtx.filePath}" to describe CLAUDE_CODE_PATH activation`,
  );
});

Then('it should document that the test harness provides a git remote mock', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('git-remote-mock') || content.includes('git remote mock') || content.includes('Git remote mock'),
    `Expected "${sharedCtx.filePath}" to document the git remote mock`,
  );
});

Then('it should describe that the mock intercepts push, fetch, and clone without network access', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('push') && content.includes('fetch') && content.includes('clone'),
    `Expected "${sharedCtx.filePath}" to describe that the mock intercepts push, fetch, and clone`,
  );
  assert.ok(
    content.includes('without network') || content.includes('no-ops') || content.includes('intercepts'),
    `Expected "${sharedCtx.filePath}" to describe no network access`,
  );
});

Then('it should describe that local git operations work normally', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('local git') || content.includes('real binary') || content.includes('delegating'),
    `Expected "${sharedCtx.filePath}" to describe that local git operations work normally`,
  );
});

Then('it should document that the test harness provides fixture repo initialization', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('setupFixtureRepo') || content.includes('fixture repo'),
    `Expected "${sharedCtx.filePath}" to document fixture repo initialization`,
  );
});

Then('it should describe that setupFixtureRepo copies a fixture template and initializes a git repo', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('setupFixtureRepo'),
    `Expected "${sharedCtx.filePath}" to describe setupFixtureRepo`,
  );
  assert.ok(
    content.includes('copies') || content.includes('copy'),
    `Expected "${sharedCtx.filePath}" to describe that setupFixtureRepo copies a fixture template`,
  );
  assert.ok(
    content.includes('git repo') || content.includes('git repository'),
    `Expected "${sharedCtx.filePath}" to describe git repo initialization`,
  );
});

Then('it should describe that the fixture repo is used as the working directory during tests', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('working directory') || content.includes('temp directory') || content.includes('setupFixtureRepo'),
    `Expected "${sharedCtx.filePath}" to describe fixture repo as working directory`,
  );
});

Then('it should instruct the agent to import and use the test harness setup\\/teardown functions', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('setupMockInfrastructure') && content.includes('teardownMockInfrastructure'),
    `Expected "${sharedCtx.filePath}" to instruct using setupMockInfrastructure/teardownMockInfrastructure`,
  );
});

Then('it should instruct the agent to use mock infrastructure for scenarios requiring running servers', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('running server') || content.includes('runtime infrastructure') || content.includes('runtime dependencies'),
    `Expected "${sharedCtx.filePath}" to instruct using mock infrastructure for scenarios requiring running servers`,
  );
});

Then('it should instruct the agent to use mock infrastructure for scenarios requiring mocked LLM calls', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('mocked LLM') || content.includes('LLM call') || content.includes('Claude CLI stub'),
    `Expected "${sharedCtx.filePath}" to instruct using mock infrastructure for scenarios requiring mocked LLM calls`,
  );
});

Then('it should instruct the agent to use mock infrastructure for scenarios requiring external service dependencies', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('external service') || content.includes('mock infrastructure') || content.includes('setupMockInfrastructure'),
    `Expected "${sharedCtx.filePath}" to instruct using mock infrastructure for scenarios requiring external service dependencies`,
  );
});

// ── 3. removedScenarios backward compatibility ───────────────────────────────

Then('the output format should remain valid JSON without markdown fences', function () {
  const content = sharedCtx.fileContent;
  // The output section should describe returning JSON and mention no markdown fences
  assert.ok(
    content.includes('no markdown fences') || content.includes('no prose') || content.includes('Return ONLY the following JSON'),
    `Expected "${sharedCtx.filePath}" to describe output format as valid JSON without markdown fences`,
  );
});

Then('the output JSON schema should contain a {string} field', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" output JSON schema to contain a "${field}" field`,
  );
});

Then('the output instructions should specify that {string} is always an empty array', function (field: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('always be an empty array') || content.includes(`"${field}": []`) || content.includes(`${field}: []`),
    `Expected "${sharedCtx.filePath}" to specify that "${field}" is always an empty array`,
  );
});

// ── 4. Existing command structure preserved ───────────────────────────────────

Then('it should instruct reading {string} for the scenario directory path', function (configFile: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(configFile),
    `Expected "${sharedCtx.filePath}" to instruct reading "${configFile}" for the scenario directory path`,
  );
});

// ── 5. TypeScript integrity ──────────────────────────────────────────────────

Given('the ADW codebase has been modified for issue 303', function () {
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
});

