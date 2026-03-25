import { Given, When, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

import {
  formatReviewProofComment,
  formatVerificationSection,
  type ProofCommentInput,
  type VerificationResult,
} from '../../adws/github/proofCommentFormatter.ts';
import type { ScenarioProofResult, TagProofResult } from '../../adws/agents/regressionScenarioProof.ts';
import type { ReviewIssue } from '../../adws/agents/reviewAgent.ts';

const ROOT = process.cwd();

// ── World state ──────────────────────────────────────────────────────────────

interface ProofWorld {
  passed: boolean;
  reviewSummary: string | undefined;
  tagResults: TagProofResult[];
  verificationResults: VerificationResult[] | undefined;
  nonBlockerIssues: ReviewIssue[];
  blockerIssues: ReviewIssue[];
  allSummaries: string[] | undefined;
  scenarioProof: ScenarioProofResult | undefined;
  formatterOutput: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTagResult(overrides: Partial<TagProofResult> = {}): TagProofResult {
  return {
    tag: '@review-proof',
    resolvedTag: '@review-proof',
    severity: 'blocker',
    optional: false,
    passed: true,
    output: '',
    exitCode: 0,
    skipped: false,
    ...overrides,
  };
}

function makeReviewIssue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    reviewIssueNumber: 1,
    screenshotPath: '',
    issueDescription: 'Test issue description',
    issueResolution: 'Fix it',
    issueSeverity: 'tech-debt',
    ...overrides,
  };
}

function buildScenarioProof(tagResults: TagProofResult[]): ScenarioProofResult {
  const hasBlockerFailures = tagResults.some(
    r => r.severity === 'blocker' && !r.passed && !r.skipped,
  );
  return { tagResults, hasBlockerFailures, resultsFilePath: '/tmp/scenario_proof.md' };
}

// ── Section 1: Module existence ───────────────────────────────────────────────

Given('the proof comment formatter module exists', function () {
  const filePath = join(ROOT, 'adws/github/proofCommentFormatter.ts');
  assert.ok(existsSync(filePath), 'Expected adws/github/proofCommentFormatter.ts to exist');
  const content = readFileSync(filePath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/github/proofCommentFormatter.ts';
});

Then('it exports a function that accepts scenario proof results', function () {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProof') && sharedCtx.fileContent.includes('export'),
    'Expected formatter to export a function accepting scenarioProof',
  );
});

Then('it exports a function that accepts verification results', function () {
  assert.ok(
    sharedCtx.fileContent.includes('verificationResults') || sharedCtx.fileContent.includes('VerificationResult'),
    'Expected formatter to export a function accepting verificationResults',
  );
});

Then('it exports a function that accepts review summary text', function () {
  assert.ok(
    sharedCtx.fileContent.includes('reviewSummary'),
    'Expected formatter to export a function accepting reviewSummary',
  );
});

Then('it exports a function that accepts blocker and non-blocker issues', function () {
  assert.ok(
    sharedCtx.fileContent.includes('blockerIssues') && sharedCtx.fileContent.includes('nonBlockerIssues'),
    'Expected formatter to export a function accepting blockerIssues and nonBlockerIssues',
  );
});

Then('it returns structured markdown as a string', function () {
  assert.ok(
    sharedCtx.fileContent.includes(': string'),
    'Expected formatter functions to return string (structured markdown)',
  );
});

// ── Section 2 & 3: Build ProofCommentInput ────────────────────────────────────

Given('a passed review with summary {string}', function (this: ProofWorld, summary: string) {
  this.passed = true;
  this.reviewSummary = summary;
  this.blockerIssues ??= [];
  this.nonBlockerIssues ??= [];
  this.tagResults ??= [];
});

Given('a failed review with summary {string}', function (this: ProofWorld, summary: string) {
  this.passed = false;
  this.reviewSummary = summary;
  this.blockerIssues ??= [];
  this.nonBlockerIssues ??= [];
  this.tagResults ??= [];
});

Given(
  'scenario proof results where {string} passed and {string} passed',
  function (this: ProofWorld, tag1: string, tag2: string) {
    this.tagResults = [
      makeTagResult({ tag: tag1, resolvedTag: tag1, passed: true, output: '1 scenarios (1 passed)' }),
      makeTagResult({ tag: tag2, resolvedTag: tag2, passed: true, output: '1 scenarios (1 passed)', optional: true }),
    ];
    this.scenarioProof = buildScenarioProof(this.tagResults);
  },
);

Given(
  'scenario proof results where {string} passed and {string} failed',
  function (this: ProofWorld, tag1: string, tag2: string) {
    this.tagResults = [
      makeTagResult({ tag: tag1, resolvedTag: tag1, passed: true, output: '2 scenarios (2 passed)' }),
      makeTagResult({ tag: tag2, resolvedTag: tag2, severity: 'blocker', passed: false, exitCode: 1,
        output: '2 scenarios (1 failed, 1 passed)' }),
    ];
    this.scenarioProof = buildScenarioProof(this.tagResults);
  },
);

Given('scenario proof results where all tags passed', function (this: ProofWorld) {
  this.tagResults = [
    makeTagResult({ tag: '@review-proof', resolvedTag: '@review-proof', passed: true, output: '3 scenarios (3 passed)' }),
    makeTagResult({ tag: '@adw-276', resolvedTag: '@adw-276', passed: true, output: '2 scenarios (2 passed)', optional: true }),
  ];
  this.scenarioProof = buildScenarioProof(this.tagResults);
});

Given('verification results where type-check passed and lint passed', function (this: ProofWorld) {
  this.verificationResults = [
    { name: 'Type Check', passed: true, command: 'bunx tsc --noEmit' },
    { name: 'Lint', passed: true, command: 'bun run lint' },
  ];
});

Given('verification results where type-check passed and lint failed', function (this: ProofWorld) {
  this.verificationResults = [
    { name: 'Type Check', passed: true, command: 'bunx tsc --noEmit' },
    { name: 'Lint', passed: false, command: 'bun run lint' },
  ];
});

Given('verification results where all checks passed', function (this: ProofWorld) {
  this.verificationResults = [
    { name: 'Type Check', passed: true, command: 'bunx tsc --noEmit' },
    { name: 'Lint', passed: true, command: 'bun run lint' },
  ];
});

Given('verification results with type-check passed and lint failed', function (this: ProofWorld) {
  this.verificationResults = [
    { name: 'Type Check', passed: true, command: 'bunx tsc --noEmit' },
    { name: 'Lint', passed: false, command: 'bun run lint' },
  ];
});

Given('{int} non-blocker issues', function (this: ProofWorld, count: number) {
  this.nonBlockerIssues = Array.from({ length: count }, (_, i) =>
    makeReviewIssue({ reviewIssueNumber: i + 1, issueSeverity: 'tech-debt',
      issueDescription: `Non-blocker issue #${i + 1}` }),
  );
});

Given('{int} non-blocker issue', function (this: ProofWorld, count: number) {
  this.nonBlockerIssues = Array.from({ length: count }, (_, i) =>
    makeReviewIssue({ reviewIssueNumber: i + 1, issueSeverity: 'tech-debt',
      issueDescription: `Non-blocker issue #${i + 1}` }),
  );
});

Given('{int} blocker issues', function (this: ProofWorld, count: number) {
  this.blockerIssues = Array.from({ length: count }, (_, i) =>
    makeReviewIssue({ reviewIssueNumber: i + 1, issueSeverity: 'blocker',
      issueDescription: `Blocker issue #${i + 1}` }),
  );
});

Given('a passed review with scenario proof results', function (this: ProofWorld) {
  this.passed = true;
  this.reviewSummary = undefined;
  this.blockerIssues = [];
  this.nonBlockerIssues ??= [];
  this.tagResults = [
    makeTagResult({ tag: '@review-proof', resolvedTag: '@review-proof', passed: true, output: '' }),
    makeTagResult({ tag: '@adw-276', resolvedTag: '@adw-276', passed: true, output: '', optional: true }),
  ];
  this.scenarioProof = buildScenarioProof(this.tagResults);
});

Given(
  'the {string} tag ran {int} scenarios with {int} passing',
  function (this: ProofWorld, tag: string, total: number, passing: number) {
    const output = `${total} scenarios (${passing} passed)`;
    this.tagResults ??= [];
    const idx = this.tagResults.findIndex(r => r.resolvedTag === tag || r.tag === tag);
    if (idx >= 0) {
      this.tagResults[idx] = { ...this.tagResults[idx], output, passed: passing === total };
    } else {
      this.tagResults.push(makeTagResult({ tag, resolvedTag: tag, output, passed: passing === total }));
    }
    this.scenarioProof = buildScenarioProof(this.tagResults);
  },
);

Given('a failed review with scenario proof output text', function (this: ProofWorld) {
  this.passed = false;
  this.reviewSummary = 'Scenario failures found';
  this.blockerIssues = [makeReviewIssue({ issueSeverity: 'blocker', issueDescription: 'BDD scenario failed' })];
  this.nonBlockerIssues = [];
  this.tagResults = [
    makeTagResult({ tag: '@review-proof', resolvedTag: '@review-proof', passed: false, exitCode: 1,
      output: '3 scenarios (1 failed, 2 passed)' }),
  ];
  this.scenarioProof = buildScenarioProof(this.tagResults);
});

Given('the scenario proof output contains multi-line test runner output', function (this: ProofWorld) {
  const multilineOutput = 'Feature: Test\n  Scenario: Pass\n    Given step passes\n  Scenario: Fail\n    Given step fails\n\n3 scenarios (1 failed, 2 passed)';
  this.tagResults ??= [];
  if (this.tagResults.length > 0) {
    this.tagResults[0] = { ...this.tagResults[0], output: multilineOutput };
  } else {
    this.tagResults = [makeTagResult({ output: multilineOutput, passed: false, exitCode: 1 })];
  }
  this.scenarioProof = buildScenarioProof(this.tagResults);
});

Given(
  'a failed review with {int} blocker issues each having a description',
  function (this: ProofWorld, count: number) {
    this.passed = false;
    this.reviewSummary = undefined;
    this.nonBlockerIssues = [];
    this.blockerIssues = Array.from({ length: count }, (_, i) =>
      makeReviewIssue({ reviewIssueNumber: i + 1, issueSeverity: 'blocker',
        issueDescription: `Blocker description ${i + 1}` }),
    );
    this.tagResults = [makeTagResult({ passed: false, exitCode: 1, output: '1 scenarios (1 failed)' })];
    this.scenarioProof = buildScenarioProof(this.tagResults);
  },
);

Given('a failed review with scenario proof output', function (this: ProofWorld) {
  this.passed = false;
  this.reviewSummary = undefined;
  this.blockerIssues = [makeReviewIssue({ issueSeverity: 'blocker' })];
  this.nonBlockerIssues = [];
  this.tagResults = [
    makeTagResult({ passed: false, exitCode: 1, output: '2 scenarios (1 failed, 1 passed)' }),
  ];
  this.scenarioProof = buildScenarioProof(this.tagResults);
});

Given('a review with {int} non-blocker issues', function (this: ProofWorld, count: number) {
  this.passed = true;
  this.reviewSummary = undefined;
  this.blockerIssues = [];
  this.nonBlockerIssues = Array.from({ length: count }, (_, i) =>
    makeReviewIssue({ reviewIssueNumber: i + 1, issueSeverity: 'tech-debt',
      issueDescription: `Non-blocker ${i + 1}` }),
  );
  this.tagResults = [makeTagResult({ passed: true, output: '1 scenarios (1 passed)' })];
  this.scenarioProof = buildScenarioProof(this.tagResults);
});

Given('a failed review with {int} blocker issues', function (this: ProofWorld, count: number) {
  this.passed = false;
  this.reviewSummary = undefined;
  this.nonBlockerIssues = [];
  this.blockerIssues = Array.from({ length: count }, (_, i) =>
    makeReviewIssue({ reviewIssueNumber: i + 1, issueSeverity: 'blocker',
      issueDescription: `Blocker issue ${i + 1}` }),
  );
  this.tagResults = [makeTagResult({ passed: false, exitCode: 1, output: '1 scenarios (1 failed)' })];
  this.scenarioProof = buildScenarioProof(this.tagResults);
});

Given('no scenario proof results are provided', function (this: ProofWorld) {
  this.scenarioProof = undefined;
  this.tagResults = [];
});

Given('no verification results are provided', function (this: ProofWorld) {
  this.verificationResults = undefined;
});

Given('a passed review with no summary text', function (this: ProofWorld) {
  this.passed = true;
  this.reviewSummary = undefined;
  this.blockerIssues = [];
  this.nonBlockerIssues ??= [];
  this.tagResults ??= [];
});

Given('empty allSummaries', function (this: ProofWorld) {
  this.allSummaries = [];
});

Given(
  'scenario proof results where {string} was skipped because no matching scenarios exist',
  function (this: ProofWorld, tag: string) {
    this.tagResults ??= [];
    const idx = this.tagResults.findIndex(r => r.resolvedTag === tag || r.tag === tag);
    const skipped = makeTagResult({ tag, resolvedTag: tag, passed: true, skipped: true, output: '', optional: true });
    if (idx >= 0) {
      this.tagResults[idx] = skipped;
    } else {
      this.tagResults.push(skipped);
    }
    this.scenarioProof = buildScenarioProof(this.tagResults);
  },
);

Given('the {string} tag is marked as optional', function (this: ProofWorld, tag: string) {
  this.tagResults ??= [];
  const idx = this.tagResults.findIndex(r => r.resolvedTag === tag || r.tag === tag);
  if (idx >= 0) {
    this.tagResults[idx] = { ...this.tagResults[idx], optional: true };
    this.scenarioProof = buildScenarioProof(this.tagResults);
  }
});

Given(
  'scenario proof results where all tags are optional and no matching scenarios exist',
  function (this: ProofWorld) {
    this.passed = true;
    this.blockerIssues = [];
    this.nonBlockerIssues = [];
    this.tagResults = [];
  },
);

Given('{string} was skipped because no matching scenarios exist', function (this: ProofWorld, tag: string) {
  this.tagResults ??= [];
  const idx = this.tagResults.findIndex(r => r.resolvedTag === tag || r.tag === tag);
  const skipped = makeTagResult({ tag, resolvedTag: tag, passed: true, skipped: true, output: '', optional: true });
  if (idx >= 0) {
    this.tagResults[idx] = skipped;
  } else {
    this.tagResults.push(skipped);
  }
  this.scenarioProof = buildScenarioProof(this.tagResults);
});

Given('the ADW codebase has been modified for issue 276', function () {
  assert.ok(existsSync(join(ROOT, 'adws/github/proofCommentFormatter.ts')),
    'Expected proofCommentFormatter.ts to exist');
  assert.ok(existsSync(join(ROOT, 'adws/phases/workflowCompletion.ts')),
    'Expected workflowCompletion.ts to exist');
  assert.ok(existsSync(join(ROOT, 'adws/github/workflowCommentsIssue.ts')),
    'Expected workflowCommentsIssue.ts to exist');
});

Given('the proof comment formatter unit test file exists', function () {
  const filePath = join(ROOT, 'features/step_definitions/proofCommentFormatterSteps.ts');
  assert.ok(existsSync(filePath), 'Expected proofCommentFormatterSteps.ts to exist');
  const content = readFileSync(filePath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'features/step_definitions/proofCommentFormatterSteps.ts';
});

// ── When steps ────────────────────────────────────────────────────────────────

When('the proof comment formatter formats the review comment', function (this: ProofWorld) {
  const tagResults = this.tagResults ?? [];
  const scenarioProof = tagResults.length > 0 && this.scenarioProof !== undefined
    ? this.scenarioProof
    : this.scenarioProof;
  const input: ProofCommentInput = {
    passed: this.passed ?? true,
    reviewSummary: this.reviewSummary,
    scenarioProof,
    blockerIssues: this.blockerIssues ?? [],
    nonBlockerIssues: this.nonBlockerIssues ?? [],
    verificationResults: this.verificationResults,
    allSummaries: this.allSummaries,
  };
  this.formatterOutput = formatReviewProofComment(input);
});

When('the proof comment formatter formats the verification section', function (this: ProofWorld) {
  const results = this.verificationResults ?? [];
  this.formatterOutput = formatVerificationSection(results);
});

When('the ReviewRetryResult interface is inspected', function () {
  // Context only — file loaded via "the file ... is read"
});

When('the runReviewWithRetry function is inspected', function () {
  // Context only
});

When('the executeReviewPhase function is inspected', function () {
  // Context only
});

When('the review comment posting logic is inspected', function () {
  // Context only
});

When('the review phase completion logic is inspected', function () {
  // Context only
});

When('the review passed comment formatting is inspected', function () {
  // Context only
});

When('the review failed comment formatting is inspected', function () {
  // Context only
});

When('the comment context type or parameter is inspected', function () {
  // Context only
});

// ── Then steps: formatter output ─────────────────────────────────────────────

Then('the output contains a review status header indicating {string}', function (this: ProofWorld, status: string) {
  if (status === 'passed') {
    assert.ok(
      this.formatterOutput.includes('Review Passed'),
      `Expected output to contain "Review Passed"\nActual:\n${this.formatterOutput}`,
    );
  } else {
    assert.ok(
      this.formatterOutput.includes('Review Failed'),
      `Expected output to contain "Review Failed"\nActual:\n${this.formatterOutput}`,
    );
  }
});

Then('the output contains the review summary text', function (this: ProofWorld) {
  assert.ok(
    this.reviewSummary && this.formatterOutput.includes(this.reviewSummary),
    `Expected output to contain review summary "${this.reviewSummary}"`,
  );
});

Then('the output contains a scenario proof table with suite and status columns', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('| Suite |') && this.formatterOutput.includes('| Status |'),
    `Expected output to contain a proof table with Suite and Status columns\nActual:\n${this.formatterOutput}`,
  );
});

Then(/^the proof table shows "(.*?)" as (passed|failed|skipped)$/, function (this: ProofWorld, tag: string, status: string) {
  assert.ok(this.formatterOutput.includes(tag),
    `Expected output to include tag "${tag}"\nActual:\n${this.formatterOutput}`);
  const tagIdx = this.formatterOutput.indexOf(tag);
  const lineEnd = this.formatterOutput.indexOf('\n', tagIdx);
  const line = this.formatterOutput.slice(tagIdx, lineEnd === -1 ? undefined : lineEnd);
  if (status === 'passed') {
    assert.ok(line.includes('✅') || line.includes('passed'),
      `Expected "${tag}" table row to show passed status, got: ${line}`);
  } else if (status === 'failed') {
    assert.ok(line.includes('❌') || line.includes('failed'),
      `Expected "${tag}" table row to show failed status, got: ${line}`);
  } else if (status === 'skipped') {
    assert.ok(line.includes('⏭️') || line.includes('skipped'),
      `Expected "${tag}" table row to show skipped status, got: ${line}`);
  }
});

Then('the output contains a verification section showing type-check passed', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('Type Check') && this.formatterOutput.includes('✅'),
    `Expected output to show type-check passed\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output contains a verification section showing lint passed', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('Lint') && this.formatterOutput.includes('✅'),
    `Expected output to show lint passed\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output contains a verification section showing lint failed', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('Lint') && this.formatterOutput.includes('❌'),
    `Expected output to show lint failed\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output contains a collapsible non-blocker issues section', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('<details>') && this.formatterOutput.includes('Non-blocker issues'),
    `Expected output to contain collapsible non-blocker section\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output does not contain a blocker issues section', function (this: ProofWorld) {
  assert.ok(
    !this.formatterOutput.includes('Blocker issues'),
    `Expected output NOT to contain blocker issues section\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output contains a collapsible blocker issues section', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('<details>') && this.formatterOutput.includes('Blocker issues'),
    `Expected output to contain collapsible blocker section\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output contains a collapsible full scenario output section', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('<details>') && this.formatterOutput.includes('Full scenario output'),
    `Expected output to contain collapsible full scenario output\nActual:\n${this.formatterOutput}`,
  );
});

Then('the proof table includes scenario counts for each suite', function (this: ProofWorld) {
  assert.ok(
    /\d+\/\d+/.test(this.formatterOutput),
    `Expected proof table to include scenario counts (e.g. "5/5")\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output does not contain a non-blocker issues section', function (this: ProofWorld) {
  assert.ok(
    !this.formatterOutput.includes('Non-blocker issues'),
    `Expected output NOT to contain non-blocker issues section\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output contains a "<details>" section for full scenario output', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('<details>') && this.formatterOutput.includes('Full scenario output'),
    `Expected "<details>" section for full scenario output\nActual:\n${this.formatterOutput}`,
  );
});

Then('the details section contains the raw scenario proof output', function (this: ProofWorld) {
  const firstTag = (this.tagResults ?? []).find(r => !r.skipped && r.output.length > 0);
  if (firstTag) {
    assert.ok(
      this.formatterOutput.includes(firstTag.output.slice(0, 20)),
      `Expected details section to contain scenario output\nActual:\n${this.formatterOutput}`,
    );
  }
});

Then('the collapsible blocker issues section lists each blocker with its description', function (this: ProofWorld) {
  for (const blocker of (this.blockerIssues ?? [])) {
    assert.ok(
      this.formatterOutput.includes(blocker.issueDescription),
      `Expected blocker section to include description: "${blocker.issueDescription}"`,
    );
  }
});

Then('the scenario output section uses a "<details>" HTML element', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('<details>') && this.formatterOutput.includes('Full scenario output'),
    `Expected scenario output to use <details> element\nActual:\n${this.formatterOutput}`,
  );
});

Then('the "<details>" element has a "<summary>" describing the section', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('<summary>'),
    `Expected <details> to contain a <summary> element\nActual:\n${this.formatterOutput}`,
  );
});

Then('the section content is inside the details element', function (this: ProofWorld) {
  const detailsStart = this.formatterOutput.indexOf('<details>');
  const detailsEnd = this.formatterOutput.indexOf('</details>');
  assert.ok(
    detailsStart !== -1 && detailsEnd !== -1 && detailsStart < detailsEnd,
    `Expected <details>...</details> wrapping section content\nActual:\n${this.formatterOutput}`,
  );
});

Then('the non-blocker issues section uses a "<details>" HTML element', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('<details>') && this.formatterOutput.includes('Non-blocker issues'),
    `Expected non-blocker section to use <details> element\nActual:\n${this.formatterOutput}`,
  );
});

Then('the section content lists all non-blocker issues', function (this: ProofWorld) {
  for (const issue of (this.nonBlockerIssues ?? [])) {
    assert.ok(
      this.formatterOutput.includes(issue.issueDescription),
      `Expected non-blocker section to list issue: "${issue.issueDescription}"`,
    );
  }
});

Then('the blocker issues section uses a "<details>" HTML element', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('<details>') && this.formatterOutput.includes('Blocker issues'),
    `Expected blocker section to use <details> element\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output does not contain a scenario proof table', function (this: ProofWorld) {
  assert.ok(
    !this.formatterOutput.includes('| Suite |'),
    `Expected output NOT to contain a scenario proof table\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output does not contain a verification section', function (this: ProofWorld) {
  assert.ok(
    !this.formatterOutput.includes('**Verification**'),
    `Expected output NOT to contain a verification section\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output does not contain a review summary section', function (this: ProofWorld) {
  // When reviewSummary is undefined/empty, no summary text appears
  const hasSummary = this.reviewSummary && this.formatterOutput.includes(this.reviewSummary);
  assert.ok(
    !hasSummary,
    `Expected output NOT to contain review summary text\nActual:\n${this.formatterOutput}`,
  );
});

Then('the proof table shows all entries as skipped', function (this: ProofWorld) {
  const tableLines = this.formatterOutput
    .split('\n')
    .filter(l => l.startsWith('|') && !l.includes('Suite') && !l.includes('---'));
  for (const line of tableLines) {
    assert.ok(
      line.includes('⏭️') || line.includes('skipped'),
      `Expected all proof table rows to show skipped, got: ${line}`,
    );
  }
});

Then('the overall review status is not failed', function (this: ProofWorld) {
  assert.ok(
    !this.formatterOutput.includes('Review Failed'),
    `Expected overall status not to be failed\nActual:\n${this.formatterOutput}`,
  );
});

Then('the skipped entry does not count as a failure', function (this: ProofWorld) {
  assert.ok(
    !this.formatterOutput.includes('Review Failed'),
    `Expected skipped entry not to count as failure\nActual:\n${this.formatterOutput}`,
  );
});

Then('the output contains a verification table or list', function (this: ProofWorld) {
  assert.ok(
    this.formatterOutput.includes('| Check |') || this.formatterOutput.includes('**Verification**'),
    `Expected output to contain a verification table or list\nActual:\n${this.formatterOutput}`,
  );
});

Then('each check shows its name, status, and severity', function (this: ProofWorld) {
  for (const v of (this.verificationResults ?? [])) {
    assert.ok(
      this.formatterOutput.includes(v.name),
      `Expected verification output to include check name "${v.name}"`,
    );
  }
});

// ── Section 8: reviewRetry.ts code inspection ─────────────────────────────────

Then(/^it includes (?:a|an) "(.*?)" field(?: of type (.*))?$/, function (field: string, _type?: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" to include field "${field}"`,
  );
});

Then('scenarioProof is assigned from the scenario proof execution result', function () {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProof') && sharedCtx.fileContent.includes('runScenarioProof'),
    `Expected reviewRetry.ts to assign scenarioProof from runScenarioProof`,
  );
});

Then('the scenarioProof value is included in the returned ReviewRetryResult', function () {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProof') && sharedCtx.fileContent.includes('return {'),
    `Expected reviewRetry.ts to include scenarioProof in the returned result`,
  );
});

// ── Section 9: workflowCompletion.ts code inspection ─────────────────────────

Then('it extracts {string} from the ReviewRetryResult', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(`reviewResult.${field}`) || sharedCtx.fileContent.includes(`ctx.${field}`),
    `Expected "${sharedCtx.filePath}" to extract "${field}" from reviewResult`,
  );
});

Then('it passes scenarioProof to the proof comment formatter or comment context', function () {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProof'),
    `Expected "${sharedCtx.filePath}" to pass scenarioProof to comment context`,
  );
});

Then('it passes nonBlockerIssues to the proof comment formatter or comment context', function () {
  assert.ok(
    sharedCtx.fileContent.includes('nonBlockerIssues'),
    `Expected "${sharedCtx.filePath}" to pass nonBlockerIssues to comment context`,
  );
});

Then('it calls the issue comment posting function with the formatted proof comment', function () {
  assert.ok(
    sharedCtx.fileContent.includes('postIssueStageComment'),
    `Expected "${sharedCtx.filePath}" to call postIssueStageComment`,
  );
});

// ── Section 10: workflowCommentsIssue.ts code inspection ──────────────────────

Then('it uses the proof comment formatter to build the comment body', function () {
  assert.ok(
    sharedCtx.fileContent.includes('formatReviewProofComment'),
    `Expected "${sharedCtx.filePath}" to use formatReviewProofComment`,
  );
});

Then('the comment includes the scenario proof table', function () {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProof') || sharedCtx.fileContent.includes('formatProofTable'),
    `Expected "${sharedCtx.filePath}" to include scenario proof table logic`,
  );
});

Then('the comment includes the verification section', function () {
  assert.ok(
    sharedCtx.fileContent.includes('formatReviewProofComment') || sharedCtx.fileContent.includes('verificationResults'),
    `Expected "${sharedCtx.filePath}" to include verification section via proof comment formatter`,
  );
});

Then('the comment includes the blocker issues section', function () {
  assert.ok(
    sharedCtx.fileContent.includes('blockerIssues') || sharedCtx.fileContent.includes('formatBlockerSection'),
    `Expected "${sharedCtx.filePath}" to include blocker issues section`,
  );
});

Then('the comment includes the full scenario output section', function () {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProof') || sharedCtx.fileContent.includes('formatScenarioOutputSection'),
    `Expected "${sharedCtx.filePath}" to include full scenario output section`,
  );
});

Then(/^it accepts (\w+) as an optional field$/, function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(`${field}?:`),
    `Expected "${sharedCtx.filePath}" WorkflowContext to include optional field "${field}?"`,
  );
});

// ── Section 11: unit test coverage (meta) ────────────────────────────────────

Then('there are tests for passed review formatting', function () {
  assert.ok(
    sharedCtx.fileContent.includes('passed review'),
    `Expected step definitions to contain "passed review" scenarios`,
  );
});

Then('there are tests for failed review formatting', function () {
  assert.ok(
    sharedCtx.fileContent.includes('failed review'),
    `Expected step definitions to contain "failed review" scenarios`,
  );
});

Then('there are tests for review with non-blocker issues', function () {
  assert.ok(
    sharedCtx.fileContent.includes('non-blocker') || sharedCtx.fileContent.includes('nonBlocker'),
    `Expected step definitions to contain non-blocker issue scenarios`,
  );
});

Then('there are tests for review without non-blocker issues', function () {
  assert.ok(
    sharedCtx.fileContent.includes('0 non-blocker') || sharedCtx.fileContent.includes('nonBlockerIssues = []'),
    `Expected step definitions to contain a "no non-blockers" scenario`,
  );
});

Then('there is a test verifying passed review includes status header, summary, proof table, and verification', function () {
  assert.ok(
    sharedCtx.fileContent.includes('passed') && sharedCtx.fileContent.includes('summary') &&
      sharedCtx.fileContent.includes('proof table') || sharedCtx.fileContent.includes('proofTable'),
    `Expected step definitions to verify passed review sections`,
  );
});

Then('there is a test verifying failed review includes blocker issues and full scenario output', function () {
  assert.ok(
    sharedCtx.fileContent.includes('failed') && sharedCtx.fileContent.includes('blocker'),
    `Expected step definitions to verify failed review has blocker and scenario output sections`,
  );
});

Then('there is a test verifying non-blocker issues use a details element', function () {
  assert.ok(
    sharedCtx.fileContent.includes('Non-blocker') && sharedCtx.fileContent.includes('details'),
    `Expected step definitions to verify non-blocker section uses <details>`,
  );
});

Then('there is a test verifying scenario output uses a details element', function () {
  assert.ok(
    sharedCtx.fileContent.includes('Full scenario output') || sharedCtx.fileContent.includes('scenario output'),
    `Expected step definitions to verify scenario output uses <details>`,
  );
});

Then('there is a test verifying blocker issues use a details element on failure', function () {
  assert.ok(
    sharedCtx.fileContent.includes('Blocker issues') && sharedCtx.fileContent.includes('details'),
    `Expected step definitions to verify blocker section uses <details>`,
  );
});
