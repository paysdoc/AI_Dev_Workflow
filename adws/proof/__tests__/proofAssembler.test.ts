import { describe, it, expect } from 'vitest';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { ScenarioTagRole, fixedScenarioTags, shouldRunTag } from '../proofAssembler';
import { NO_PER_ISSUE_SCENARIOS, NO_SCENARIO_OPENED_A_PAGE } from '../proofDocument';
import {
  GENERATED_AT,
  NOT_RUN,
  PER_ISSUE,
  PER_ISSUE_FEATURE,
  PROOF_DIR,
  REGRESSION,
  REGRESSION_FEATURE,
  artifact,
  assemble,
  attachment,
  indexOf,
  reportOf,
  runOf,
  testCase,
} from './proofAssembler.helpers';

describe('fixedScenarioTags', () => {
  it('names the regression tag and the issue\'s tag, in that order', () => {
    expect(fixedScenarioTags(994)).toEqual([
      { role: ScenarioTagRole.Regression, pattern: '@regression', tag: '@regression' },
      { role: ScenarioTagRole.PerIssue, pattern: '@adw-{issueNumber}', tag: '@adw-994' },
    ]);
  });
});

describe('shouldRunTag', () => {
  it('always runs the regression tag, even over feature files that carry nothing', () => {
    expect(shouldRunTag(REGRESSION, indexOf())).toBe(true);
    expect(shouldRunTag(REGRESSION, indexOf(PER_ISSUE_FEATURE))).toBe(true);
  });

  it('runs the issue\'s tag only when a scenario carries it', () => {
    expect(shouldRunTag(PER_ISSUE, indexOf(REGRESSION_FEATURE))).toBe(false);
    expect(shouldRunTag(PER_ISSUE, indexOf(REGRESSION_FEATURE, PER_ISSUE_FEATURE))).toBe(true);
  });

  it('runs the issue\'s tag when only one Examples table of an outline carries it', () => {
    const outline = `Feature: Products

  Scenario Outline: The <product> page
    When the shopper opens the <product> page

    @adw-42
    Examples:
      | product |
      | lamp    |
`;

    expect(shouldRunTag(PER_ISSUE, indexOf(outline))).toBe(true);
  });

  it('runs the issue\'s tag when a feature file that does not parse holds it, so that the runner reports the error', () => {
    expect(shouldRunTag(PER_ISSUE, indexOf('@adw-42\nthis is not Gherkin\n'))).toBe(true);
    expect(shouldRunTag(PER_ISSUE, indexOf('@adw-421\nthis is not Gherkin\n'))).toBe(false);
  });

  it('does not take @adw-4 for @adw-42', () => {
    const otherIssue = '@adw-4\nFeature: Other\n\n  Scenario: Works\n    Given a thing\n';

    expect(shouldRunTag(PER_ISSUE, indexOf(otherIssue))).toBe(false);
  });
});

describe('assembleScenarioProof — the two fixed lines', () => {
  it('says that no scenario opened a page when a web proof holds no image, and the run does not fail for it', () => {
    const regressionRun = runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens')));
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total')));

    const proof = assemble({ runs: [regressionRun, perIssueRun], scenarioIndex: indexOf(REGRESSION_FEATURE, PER_ISSUE_FEATURE) });

    expect(proof.document).toContain(NO_SCENARIO_OPENED_A_PAGE);
    expect(proof.document).not.toContain(NO_PER_ISSUE_SCENARIOS);
    expect(proof.hasBlockerFailures).toBe(false);
  });

  it('does not say it when a web proof holds an image, and lists the absolute path with the name of the scenario', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total', [attachment('adw-42/total/a.png')])));

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(PER_ISSUE_FEATURE),
      artifacts: [artifact('adw-42/total/a.png')],
    });

    expect(proof.document).not.toContain(NO_SCENARIO_OPENED_A_PAGE);
    expect(proof.document).toContain('## Evidence');
    expect(proof.document).toContain('Per-issue scenario images (1):');
    expect(proof.document).toContain(`- \`Cart › The cart shows the total\`: ${PROOF_DIR}/artifacts/adw-42/total/a.png`);
  });

  it('says that there are no per-issue scenarios when the tag matched nothing, which is a pass and no failure', () => {
    const regressionRun = runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens')));

    const proof = assemble({
      applicationProfile: APPLICATION_TYPE_PROFILES.cli,
      runs: [regressionRun, NOT_RUN(PER_ISSUE)],
      scenarioIndex: indexOf(REGRESSION_FEATURE),
    });

    const perIssue = proof.tagResults.find(result => result.resolvedTag === '@adw-42');
    expect(perIssue).toMatchObject({ passed: true, skipped: true, exitCode: null, output: '' });
    expect(proof.hasBlockerFailures).toBe(false);
    expect(proof.document).toContain(`**Status:** ⏭️ ${NO_PER_ISSUE_SCENARIOS}`);
  });

  it('carries both lines together in a web repository, and fails for neither', () => {
    const regressionRun = runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens')));

    const proof = assemble({ runs: [regressionRun, NOT_RUN(PER_ISSUE)], scenarioIndex: indexOf(REGRESSION_FEATURE) });

    expect(proof.document).toContain(NO_PER_ISSUE_SCENARIOS);
    expect(proof.document).toContain(NO_SCENARIO_OPENED_A_PAGE);
    expect(proof.hasBlockerFailures).toBe(false);
  });

  it('leaves out of the section of a tag that was not run its exit code and its output', () => {
    const proof = assemble({ runs: [NOT_RUN(PER_ISSUE)], applicationProfile: APPLICATION_TYPE_PROFILES.cli });

    const section = proof.document.slice(proof.document.indexOf('## @adw-42'));
    expect(section).not.toContain('Exit Code');
    expect(section).not.toContain('### Output');
  });
});

describe('assembleScenarioProof — what each tag reports', () => {
  const both = indexOf(REGRESSION_FEATURE, PER_ISSUE_FEATURE);

  it('fails a tag whose report holds a failed case, as a blocker, and tallies the report', () => {
    const regressionRun = runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens'), testCase('Wish list › Other', [], 'failed')), { exitCode: 1 });

    const proof = assemble({ runs: [regressionRun, NOT_RUN(PER_ISSUE)], scenarioIndex: both });

    expect(proof.tagResults[0]).toMatchObject({
      tag: '@regression',
      resolvedTag: '@regression',
      severity: 'blocker',
      optional: false,
      passed: false,
      skipped: false,
      exitCode: 1,
      counts: { total: 2, passed: 1, failed: 1 },
    });
    expect(proof.tagResults[0].cases).toHaveLength(2);
    expect(proof.hasBlockerFailures).toBe(true);
    expect(proof.document).toContain('**Status:** ❌ FAILED');
    expect(proof.document).toContain('**Report:** 1 passed, 1 failed of 2');
  });

  it('fails the issue\'s tag as a blocker, as it does the regression tag', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total', [], 'failed')), { exitCode: 1 });

    const proof = assemble({ runs: [NOT_RUN(REGRESSION), perIssueRun], scenarioIndex: both });

    expect(proof.tagResults[1]).toMatchObject({ tag: '@adw-{issueNumber}', resolvedTag: '@adw-42', severity: 'blocker', optional: true, passed: false, skipped: false });
    expect(proof.hasBlockerFailures).toBe(true);
  });

  it('passes a clean report although the process exited non-zero, and says so', () => {
    const regressionRun = runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens')), { exitCode: 1 });

    const proof = assemble({ runs: [regressionRun], scenarioIndex: both });

    expect(proof.tagResults[0].passed).toBe(true);
    expect(proof.tagResults[0].warning).toContain('Process exited 1 but JUnit report is clean: 1 passed, 0 failed, 0 skipped of 1');
    expect(proof.document).toContain('**Warning:** Process exited 1 but JUnit report is clean');
  });

  it('has no warning for a clean report and a clean exit', () => {
    const regressionRun = runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens')));

    expect(assemble({ runs: [regressionRun], scenarioIndex: both }).tagResults[0].warning).toBeUndefined();
  });

  it('fails the regression tag when its report holds no case', () => {
    const proof = assemble({ runs: [runOf(REGRESSION, reportOf())], scenarioIndex: both });

    expect(proof.tagResults[0]).toMatchObject({ passed: false, skipped: false });
    expect(proof.tagResults[0].counts).toBeUndefined();
    expect(proof.tagResults[0].warning).toBeUndefined();
    expect(proof.hasBlockerFailures).toBe(true);
  });

  it('fails the issue\'s tag, with a warning, when scenarios carry it but its report holds no case', () => {
    const proof = assemble({ runs: [NOT_RUN(REGRESSION), runOf(PER_ISSUE, reportOf())], scenarioIndex: both });

    expect(proof.tagResults[1]).toMatchObject({ passed: false, skipped: false });
    expect(proof.tagResults[1].warning).toBe('1 scenario(s) in the feature files carry @adw-42, but the run reported none');
    expect(proof.hasBlockerFailures).toBe(true);
  });

  it('counts the scenarios an outline row adds when it words that warning', () => {
    const outline = `@adw-42
Feature: Products

  Scenario Outline: The <product> page
    When the shopper opens the <product> page

    Examples:
      | product |
      | lamp    |
      | chair   |
`;

    const proof = assemble({ runs: [NOT_RUN(REGRESSION), runOf(PER_ISSUE, reportOf())], scenarioIndex: indexOf(outline) });

    expect(proof.tagResults[1].warning).toBe('2 scenario(s) in the feature files carry @adw-42, but the run reported none');
  });

  it('lets the exit code decide a tag that left no report', () => {
    const passes = assemble({ runs: [runOf(REGRESSION, null, { exitCode: 0 })], scenarioIndex: both });
    const fails = assemble({ runs: [runOf(REGRESSION, null, { exitCode: 1 })], scenarioIndex: both });
    const killed = assemble({ runs: [runOf(REGRESSION, null, { exitCode: null })], scenarioIndex: both });

    expect(passes.tagResults[0]).toMatchObject({ passed: true, skipped: false });
    expect(passes.tagResults[0].counts).toBeUndefined();
    expect(passes.tagResults[0].cases).toBeUndefined();
    expect(fails.tagResults[0]).toMatchObject({ passed: false, skipped: false, exitCode: 1 });
    expect(killed.tagResults[0]).toMatchObject({ passed: false, exitCode: null });
    expect(fails.document).toContain('**Exit Code:** 1');
    expect(killed.document).toContain('**Exit Code:** null');
  });

  it('fails the issue\'s tag when it left no report, though scenarios carry it', () => {
    const proof = assemble({ runs: [NOT_RUN(REGRESSION), runOf(PER_ISSUE, null, { exitCode: 1 })], scenarioIndex: both });

    expect(proof.tagResults[1]).toMatchObject({ passed: false, skipped: false });
    expect(proof.hasBlockerFailures).toBe(true);
  });

  it('keeps what a run printed, up to 10,000 characters, and says where it cut', () => {
    const short = assemble({ runs: [runOf(REGRESSION, null, { stdout: 'all fine' })], scenarioIndex: both });
    const long = assemble({ runs: [runOf(REGRESSION, null, { stdout: 'x'.repeat(10_500) })], scenarioIndex: both });

    expect(short.tagResults[0].output).toBe('all fine');
    expect(long.tagResults[0].output).toBe(`${'x'.repeat(10_000)}\n\n[...output truncated at 10000 characters...]`);
    expect(short.document).toContain('```\nall fine\n```');
  });

  it('writes "(no output)" for a run that printed nothing', () => {
    const proof = assemble({ runs: [runOf(REGRESSION, null, { stdout: '' })], scenarioIndex: both });

    expect(proof.document).toContain('(no output)');
  });

  it('writes the sections in the order of the runs, under a heading with the time of the run', () => {
    const proof = assemble({
      runs: [runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens'))), NOT_RUN(PER_ISSUE)],
      scenarioIndex: both,
      applicationProfile: APPLICATION_TYPE_PROFILES.cli,
    });

    expect(proof.document.startsWith(`# Scenario Proof\n\nGenerated at: ${GENERATED_AT}\n`)).toBe(true);
    expect(proof.document.indexOf('## @regression Scenarios (severity: blocker)')).toBeLessThan(proof.document.indexOf('## @adw-42 Scenarios (severity: blocker)'));
    expect(proof.tagResults.map(result => result.resolvedTag)).toEqual(['@regression', '@adw-42']);
  });
});

describe('assembleScenarioProof — a notice instead of a run', () => {
  it('records no tag, carries the notice, and never blocks', () => {
    const proof = assemble({ notice: 'No step definition files found in features/steps/ — skipping BDD scenario proof', applicationProfile: APPLICATION_TYPE_PROFILES.cli });

    expect(proof.tagResults).toEqual([]);
    expect(proof.hasBlockerFailures).toBe(false);
    expect(proof.perIssueImages).toEqual([]);
    expect(proof.document).toContain('⚠️ No step definition files found in features/steps/ — skipping BDD scenario proof');
  });

  it('also says that no scenario opened a page when the repository is a web one', () => {
    const proof = assemble({ notice: 'No step definition files found', applicationProfile: APPLICATION_TYPE_PROFILES.web });

    expect(proof.document).toContain(NO_SCENARIO_OPENED_A_PAGE);
  });
});
