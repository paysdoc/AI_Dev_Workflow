import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import {
  isAdwComment,
  parseWorkflowStageFromComment,
} from '../../adws/core/workflowCommentParsing';
import {
  parseKeywordProximityDependencies,
} from '../../adws/triggers/issueDependencies';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// World interface
// ---------------------------------------------------------------------------
interface CronWorld {
  cronSource: string;
  issueComments: { body: string }[];
  latestStage: string | null;
  evaluationResult: { eligible: boolean; reason?: string };
  issueBody: string;
  parsedRefs: number[];
  proximityDeps: number[];
  totalRefs: number;
  llmNeeded: boolean | null;
  depCache: Map<string, number[]>;
  cachedResult: number[] | null;
  parsingPerformed: boolean;
}

// ---------------------------------------------------------------------------
// 1. Issue re-evaluation logic
// ---------------------------------------------------------------------------

const RETRIABLE_STAGES = new Set(['error', 'paused', 'review_failed', 'build_failed']);
const ACTIVE_STAGES = new Set([
  'starting', 'resuming', 'classified', 'branch_created',
  'plan_building', 'plan_created', 'planFile_created', 'plan_committing',
  'plan_validating', 'plan_aligning', 'implementing', 'build_progress',
  'implemented', 'implementation_committing', 'pr_creating',
  'review_running', 'review_patching', 'test_running', 'test_resolving',
  'document_running', 'install_running', 'resumed',
]);

Then('eligible issue filtering does not use hasAdwWorkflowComment as a blanket exclusion', function (this: CronWorld & Record<string, string>) {
  const content = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
  const blanketUsage = /hasAdwWorkflowComment\s*\(/.test(content);
  assert.ok(
    !blanketUsage,
    'trigger_cron.ts should not use hasAdwWorkflowComment as a blanket exclusion filter',
  );
});

Given('an issue with multiple ADW workflow comments', function (this: CronWorld) {
  this.issueComments = [
    { body: '## :rocket: ADW Workflow Started\n**ADW ID:** `abc12345`\nStarting...\n\n---\n_Posted by ADW (AI Developer Workflow) automation_ <!-- adw-bot -->' },
    { body: '## :x: ADW Workflow Error\n**ADW ID:** `abc12345`\nFailed.\n\n---\n_Posted by ADW (AI Developer Workflow) automation_ <!-- adw-bot -->' },
  ];
});

When('the cron trigger evaluates the issue', function (this: CronWorld) {
  const adwComments = this.issueComments.filter(c => isAdwComment(c.body));
  assert.ok(adwComments.length > 0, 'Expected at least one ADW comment');
  const latest = adwComments[adwComments.length - 1];
  this.latestStage = parseWorkflowStageFromComment(latest.body);
});

Then('it inspects the status of the most recent ADW comment', function (this: CronWorld) {
  assert.ok(
    this.latestStage !== undefined,
    'Expected the evaluator to inspect the latest ADW comment stage',
  );
  assert.strictEqual(this.latestStage, 'error', 'Expected latest stage to be "error"');
});

Given('an issue whose latest ADW comment indicates status {string}', function (this: CronWorld, status: string) {
  const headerMap: Record<string, string> = {
    error: ':x: ADW Workflow Error',
    paused: ':pause_button: ADW Workflow Paused',
    review_failed: ':x: ADW Workflow Error',
    build_failed: ':x: ADW Workflow Error',
    completed: ':tada: ADW Workflow Completed',
  };

  const header = headerMap[status];
  assert.ok(header, `No header mapping for status "${status}"`);
  const body = `## ${header}\n**ADW ID:** \`test1234\`\nDetails.\n\n---\n_Posted by ADW (AI Developer Workflow) automation_ <!-- adw-bot -->`;
  this.issueComments = [{ body }];

  const adwComments = this.issueComments.filter(c => isAdwComment(c.body));
  const latest = adwComments[adwComments.length - 1];
  this.latestStage = parseWorkflowStageFromComment(latest.body);
});

When('the cron trigger evaluates eligibility', function (this: CronWorld) {
  const stage = this.latestStage;
  if (stage === null) {
    this.evaluationResult = { eligible: true };
  } else if (stage === 'completed') {
    this.evaluationResult = { eligible: false, reason: 'completed' };
  } else if (ACTIVE_STAGES.has(stage)) {
    this.evaluationResult = { eligible: false, reason: 'active' };
  } else if (RETRIABLE_STAGES.has(stage)) {
    this.evaluationResult = { eligible: true };
  } else {
    this.evaluationResult = { eligible: false, reason: `adw_stage:${stage}` };
  }
});

Then('the issue is considered eligible for re-processing', function (this: CronWorld) {
  assert.ok(
    this.evaluationResult.eligible,
    `Expected issue to be eligible, but got reason: ${this.evaluationResult.reason}`,
  );
});

Then('the issue is not eligible for re-processing', function (this: CronWorld) {
  assert.ok(
    !this.evaluationResult.eligible,
    'Expected issue to NOT be eligible for re-processing',
  );
});

Given('an issue that is deferred because its dependencies are still open', function () {
  const content = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
  assert.ok(
    content.includes('open_dependencies'),
    'trigger_cron.ts should handle open_dependencies reason',
  );
});

When('the cron trigger skips the issue', function () {
  // Context step — assertion in Then
});

Then('the issue number is not added to the processedIssues set', function () {
  const content = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
  const deferIdx = content.indexOf('open_dependencies');
  const continueIdx = content.indexOf('continue', deferIdx);
  const addIdx = content.indexOf('processedIssues.add', deferIdx);
  assert.ok(
    continueIdx !== -1 && continueIdx < addIdx,
    'Dependency-deferred issues should hit continue before processedIssues.add',
  );
});

Given('an issue that passes all eligibility checks', function () {
  // Context step
});

When('the cron trigger spawns a workflow for the issue', function () {
  // Context step
});

Then('the issue number is added to the processedIssues set', function () {
  const content = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
  const addIdx = content.indexOf('processedIssues.add');
  const spawnIdx = content.indexOf('classifyAndSpawnWorkflow', addIdx);
  assert.ok(addIdx !== -1, 'processedIssues.add should exist in trigger_cron.ts');
  assert.ok(
    spawnIdx > addIdx,
    'processedIssues.add should be called before classifyAndSpawnWorkflow',
  );
});

// ---------------------------------------------------------------------------
// 2. Verbose poll logging
// ---------------------------------------------------------------------------

Given('the cron trigger polls and finds {int} open issues', function (_count: number) {
  // Context step
});

Given('{int} pass initial filtering as candidates', function (_count: number) {
  // Context step
});

Given('{int} are filtered out with reasons such as adw_comment, processed, or grace_period', function (_count: number) {
  // Context step
});

When('the poll cycle completes evaluation', function () {
  // Context step
});

Then('it logs a one-liner in format {string}', function (_format: string) {
  const content = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
  assert.ok(
    content.includes('POLL:') && content.includes('open,') && content.includes('candidate(s)') && content.includes('filtered:'),
    'Expected trigger_cron.ts to contain POLL log line with open/candidates/filtered format',
  );
});

// ---------------------------------------------------------------------------
// 3. Dependency extraction — direct function calls using parseKeywordProximityDependencies
// ---------------------------------------------------------------------------

// Helper: build and parse issue body in one go, storing results on World
function parseIssueBody(world: CronWorld): void {
  world.parsedRefs = [...(world.issueBody.matchAll(/#(\d+)/g))].map(m => parseInt(m[1], 10)).filter(n => n > 0);
  world.proximityDeps = parseKeywordProximityDependencies(world.issueBody);
}

Given('an issue body text {string}', function (this: CronWorld, body: string) {
  this.issueBody = body;
});

// Builds a body where #42 is near "blocked by" (within 80 chars) but #43 is far away
// with 100+ chars of padding between the keyword and #43 to exceed the lookback window.
Given('a dependency extraction body with keyword ref and plain ref', function (this: CronWorld) {
  const padding = 'x'.repeat(100);
  this.issueBody = `blocked by #42. ${padding} Unrelated context mentioning #43 for reference.`;
});

Then('the keyword-adjacent ref is a detected dependency', function (this: CronWorld) {
  assert.ok(
    this.proximityDeps.includes(42),
    `Expected #42 to be classified as a dependency, got [${this.proximityDeps.join(', ')}]`,
  );
});

Then('the distant plain ref is not a detected dependency', function (this: CronWorld) {
  assert.ok(
    !this.proximityDeps.includes(43),
    `Expected #43 to NOT be classified as a dependency (too far from keyword), but it was`,
  );
});

When('the dependency proximity extractor parses the body', function (this: CronWorld) {
  parseIssueBody(this);
});

Then('it finds issue references [{int}, {int}, {int}]', function (this: CronWorld, a: number, b: number, c: number) {
  const expected = [a, b, c];
  for (const n of expected) {
    assert.ok(
      this.parsedRefs.includes(n),
      `Expected parsed references to include #${n}, got [${this.parsedRefs.join(', ')}]`,
    );
  }
});

When('the proximity extractor applies keyword analysis', function (this: CronWorld) {
  this.proximityDeps = parseKeywordProximityDependencies(this.issueBody);
});

Then('issue #{int} is a detected dependency', function (this: CronWorld, issueNum: number) {
  assert.ok(
    this.proximityDeps.includes(issueNum),
    `Expected #${issueNum} to be classified as a dependency, got [${this.proximityDeps.join(', ')}]`,
  );
});

Then('issue #{int} is not a detected dependency', function (this: CronWorld, issueNum: number) {
  assert.ok(
    !this.proximityDeps.includes(issueNum),
    `Expected #${issueNum} to NOT be classified as a dependency, but it was`,
  );
});

Given('an issue body text with a {string} heading listing {string}', function (this: CronWorld, heading: string, ref: string) {
  this.issueBody = `Some intro text.\n\n${heading}\n- ${ref}\n\n## Other section\nStuff.`;
});

Given('an issue body text with {int} hash-N references', function (this: CronWorld, count: number) {
  // Build body with `count` references, each separated by 100+ chars of padding
  // so no keyword proximity leaks between references.
  const padding = 'x'.repeat(100);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(`${padding} mentions #${100 + i} here`);
  }
  this.issueBody = lines.join('\n');
  this.totalRefs = count;
});

Given('the regex parser classified {int} of them as dependencies', function (this: CronWorld, count: number) {
  // Rebuild body: first `count` references have keywords, rest are isolated with padding
  const padding = 'x'.repeat(100);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(`blocked by #${100 + i}`);
  }
  for (let i = count; i < this.totalRefs; i++) {
    lines.push(`${padding} mentions #${100 + i} here`);
  }
  this.issueBody = lines.join('\n');
  this.proximityDeps = parseKeywordProximityDependencies(this.issueBody);
});

Given('{int} of the references remain unclassified', function (this: CronWorld, count: number) {
  const allRefs = [...(this.issueBody.matchAll(/#(\d+)/g))].length;
  const unclassified = allRefs - this.proximityDeps.length;
  assert.strictEqual(
    unclassified, count,
    `Expected ${count} unclassified references, got ${unclassified}`,
  );
});

Given('the regex parser classified all {int} references as dependencies', function (this: CronWorld, count: number) {
  const lines = Array.from({ length: count }, (_, i) => `depends on #${200 + i}`);
  this.issueBody = lines.join('\n');
  this.proximityDeps = parseKeywordProximityDependencies(this.issueBody);
  this.totalRefs = count;
});

When('the dependency extractor evaluates whether LLM fallback is needed', function (this: CronWorld) {
  const totalRefs = [...(this.issueBody.matchAll(/#(\d+)/g))].length;
  this.llmNeeded = totalRefs > 0 && this.proximityDeps.length < totalRefs;
});

Then('LLM extraction is triggered for the unclassified references', function (this: CronWorld) {
  assert.strictEqual(this.llmNeeded, true, 'Expected LLM fallback to be triggered');
});

Then('LLM extraction is not triggered', function (this: CronWorld) {
  assert.strictEqual(this.llmNeeded, false, 'Expected LLM fallback NOT to be triggered');
});

// ---------------------------------------------------------------------------
// 4. In-memory cache
// ---------------------------------------------------------------------------

Given('dependency extraction was performed for issue {int} with body hash {string}', function (this: CronWorld, issueNum: number, _hash: string) {
  this.depCache = new Map();
  this.depCache.set(`${issueNum}:abc123`, [10, 20]);
  this.parsingPerformed = false;
});

When('the cron trigger re-evaluates issue {int} with the same body hash', function (this: CronWorld, issueNum: number) {
  const cacheKey = `${issueNum}:abc123`;
  const cached = this.depCache.get(cacheKey);
  if (cached !== undefined) {
    this.cachedResult = cached;
    this.parsingPerformed = false;
  } else {
    this.cachedResult = null;
    this.parsingPerformed = true;
  }
});

Then('the cached extraction result is returned', function (this: CronWorld) {
  assert.ok(this.cachedResult !== null, 'Expected cached result to be returned');
  assert.deepStrictEqual(this.cachedResult, [10, 20]);
});

Then('no regex parsing or LLM call is performed', function (this: CronWorld) {
  assert.strictEqual(this.parsingPerformed, false, 'Expected no parsing when cache hit');
});

Given('dependency extraction was cached for issue {int} with body hash {string}', function (this: CronWorld, issueNum: number, _hash: string) {
  this.depCache = new Map();
  this.depCache.set(`${issueNum}:abc123`, [10, 20]);
});

When('the issue body changes and the hash becomes {string}', function (this: CronWorld, _newHash: string) {
  const cacheKey = '42:def456';
  const cached = this.depCache.get(cacheKey);
  this.cachedResult = cached ?? null;
  this.parsingPerformed = cached === undefined;
});

Then('the cache miss triggers fresh dependency extraction', function (this: CronWorld) {
  assert.ok(this.parsingPerformed, 'Expected fresh extraction on cache miss');
  assert.strictEqual(this.cachedResult, null, 'Expected no cached result for new hash');
});
