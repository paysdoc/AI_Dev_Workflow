import { describe, it, expect } from 'vitest';
import { APPLICATION_TYPE_PROFILES, Platform, type ApplicationProfile } from '../../core/applicationType';
import type { TestCaseResult } from '../../core/testReportParser';
import { NO_PER_ISSUE_SCENARIOS, NO_SCENARIO_OPENED_A_SCREEN } from '../proofDocument';
import {
  GENERATED_AT,
  MOBILE_PROFILE,
  NOT_RUN,
  PER_ISSUE,
  PER_ISSUE_FEATURE,
  PROOF_DIR,
  REGRESSION,
  REGRESSION_FEATURE,
  SIGN_IN_FEATURE,
  artifact,
  assemble,
  attachment,
  indexOf,
  reportOf,
  runOf,
  testCase,
} from './proofAssembler.helpers';

function passedSection(tag: string, total: number): string[] {
  return [
    `## ${tag} Scenarios (severity: blocker)`,
    '',
    '**Status:** ✅ PASSED',
    '**Exit Code:** 0',
    `**Report:** ${total} passed, 0 failed of ${total}`,
    '',
    '### Output',
    '',
    '```',
    'ok',
    '```',
    '',
  ];
}

const HEADER = ['# Scenario Proof', '', `Generated at: ${GENERATED_AT}`, ''];

describe('assembleScenarioProof — cli and web proofs are as they were', () => {
  const regressionRun = runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens')));
  const scenarioIndex = indexOf(REGRESSION_FEATURE, PER_ISSUE_FEATURE);

  it('writes a web proof with an image and a left-out case exactly as before', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Cart › The cart shows the total', [attachment('adw-42/total/a.png')]),
      testCase('Cart › Named by another runner', [attachment('adw-42/other/a.png')]),
    ));

    const proof = assemble({
      runs: [regressionRun, perIssueRun],
      scenarioIndex,
      artifacts: [artifact('adw-42/total/a.png'), artifact('adw-42/other/a.png')],
    });

    expect(proof.document).toBe([
      ...HEADER,
      ...passedSection('@regression', 1),
      ...passedSection('@adw-42', 2),
      '## Evidence',
      '',
      'Per-issue scenario images (1):',
      '',
      `- \`Cart › The cart shows the total\`: ${PROOF_DIR}/artifacts/adw-42/total/a.png`,
      '',
      'Left out, because no scenario in the feature files has their name: `Cart › Named by another runner`',
      '',
    ].join('\n'));
  });

  it('ends a web proof without an image with the page line, exactly as before', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Cart › The cart shows the total'),
      testCase('Cart › Named by another runner'),
    ));

    const proof = assemble({ runs: [regressionRun, perIssueRun], scenarioIndex });

    expect(proof.document.slice(proof.document.indexOf('## Evidence'))).toBe(
      '## Evidence\n\nPer-issue scenario images (0):\n\nno scenario opened a page\n',
    );
  });

  it('writes a cli proof exactly as before, with no Evidence section, though the issue\'s case attached an image', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total', [attachment('adw-42/total/a.png')])));

    const proof = assemble({
      applicationProfile: APPLICATION_TYPE_PROFILES.cli,
      runs: [regressionRun, perIssueRun],
      scenarioIndex,
      artifacts: [artifact('adw-42/total/a.png')],
    });

    expect(proof.document).toBe([...HEADER, ...passedSection('@regression', 1), ...passedSection('@adw-42', 1)].join('\n'));
  });
});

describe('assembleScenarioProof — the platforms each per-issue scenario shows', () => {
  const SOME_PLATFORMS_ONLY = 'On some platforms only';

  function assembleMobile(cases: TestCaseResult[], artifactPaths: string[], profile: ApplicationProfile = MOBILE_PROFILE) {
    return assemble({
      applicationProfile: profile,
      runs: [NOT_RUN(REGRESSION), runOf(PER_ISSUE, reportOf(...cases))],
      scenarioIndex: indexOf(SIGN_IN_FEATURE),
      artifacts: artifactPaths.map(artifact),
    });
  }

  it('names android present and ios missing for a scenario with images on android only', () => {
    const proof = assembleMobile([testCase('The user signs in', [attachment('android/sign-in.png')])], ['android/sign-in.png']);

    expect(proof.document).toContain('On some platforms only: `The user signs in` (present: android; missing: ios)');
  });

  it('names ios present and android missing, in the order of the profile, when only ios shows a scenario', () => {
    const proof = assembleMobile([testCase('The user signs in', [attachment('ios/sign-in.png')])], ['ios/sign-in.png']);

    expect(proof.document).toContain('On some platforms only: `The user signs in` (present: ios; missing: android)');
  });

  it('writes no such line for a scenario with images on both platforms', () => {
    const proof = assembleMobile(
      [testCase('The user signs in', [attachment('android/sign-in.png')]), testCase('The user signs in', [attachment('ios/sign-in.png')])],
      ['android/sign-in.png', 'ios/sign-in.png'],
    );

    expect(proof.document).not.toContain(SOME_PLATFORMS_ONLY);
  });

  it('writes one line for a scenario that misses a platform, however many images it has, and none for a per-issue scenario without an image', () => {
    const proof = assembleMobile(
      [testCase('The user signs in', [attachment('android/sign-in.png'), attachment('android/sign-in-2.png')]), testCase('The user signs out')],
      ['android/sign-in.png', 'android/sign-in-2.png'],
    );

    const lines = proof.document.split('\n').filter(line => line.includes(SOME_PLATFORMS_ONLY));
    expect(lines).toEqual(['On some platforms only: `The user signs in` (present: android; missing: ios)']);
    expect(proof.document).not.toContain(NO_SCENARIO_OPENED_A_SCREEN);
  });

  it('takes a file both platform runs attach as one image, so the platform of the other run is still missing', () => {
    const shared = attachment('android/sign-in.png');

    const proof = assembleMobile(
      [testCase('The user signs in', [shared]), testCase('The user signs in', [shared])],
      ['android/sign-in.png'],
    );

    expect(proof.perIssueImages).toHaveLength(1);
    expect(proof.document).toContain('On some platforms only: `The user signs in` (present: android; missing: ios)');
  });

  it('neither selects nor lists the images of the regression run, in a platform directory or outside every one', () => {
    const regressionRun = runOf(REGRESSION, reportOf(testCase('The wish list opens', [attachment('android/wish.png'), attachment('wish.png')])));

    const proof = assemble({
      applicationProfile: MOBILE_PROFILE,
      runs: [regressionRun, NOT_RUN(PER_ISSUE)],
      scenarioIndex: indexOf(REGRESSION_FEATURE),
      artifacts: [artifact('android/wish.png'), artifact('wish.png')],
    });

    expect(proof.perIssueImages).toEqual([]);
    expect(proof.document).not.toContain('wish.png');
  });

  it('says that no scenario opened a screen when the issue\'s run left no report', () => {
    const proof = assemble({
      applicationProfile: MOBILE_PROFILE,
      runs: [NOT_RUN(REGRESSION), runOf(PER_ISSUE, null, { exitCode: 1 })],
      scenarioIndex: indexOf(SIGN_IN_FEATURE),
    });

    expect(proof.document).toContain(NO_SCENARIO_OPENED_A_SCREEN);
    expect(proof.document).not.toContain(SOME_PLATFORMS_ONLY);
  });

  it('lists the issue\'s images that lie in no platform directory as unattributed', () => {
    const proof = assembleMobile(
      [testCase('The user signs in', [attachment('sign-in.png'), attachment('linux/sign-in.png')])],
      ['sign-in.png', 'linux/sign-in.png'],
    );

    expect(proof.document).toContain('Left out as unattributed, because they are in no platform directory (`android/`, `ios/`): `sign-in.png`, `linux/sign-in.png`');
    expect(proof.document).toContain(NO_SCENARIO_OPENED_A_SCREEN);
    expect(proof.perIssueImages).toEqual([]);
  });

  it('writes the Evidence section of a profile with platforms in this order: images, platforms, left-out cases, left-out images', () => {
    const proof = assembleMobile(
      [
        testCase('The user signs in', [attachment('android/sign-in.png')]),
        testCase('The user signs in', [attachment('ios/sign-in.png')]),
        testCase('The user signs out', [attachment('android/sign-out.png'), attachment('sign-out.png')]),
        testCase('Named by another runner', [attachment('android/other.png')]),
      ],
      ['android/sign-in.png', 'ios/sign-in.png', 'android/sign-out.png', 'sign-out.png', 'android/other.png'],
    );

    expect(proof.document.slice(proof.document.indexOf('## Evidence'))).toBe([
      '## Evidence',
      '',
      'Per-issue scenario images (3):',
      '',
      `- \`The user signs in\`: ${PROOF_DIR}/artifacts/android/sign-in.png`,
      `- \`The user signs in\`: ${PROOF_DIR}/artifacts/ios/sign-in.png`,
      `- \`The user signs out\`: ${PROOF_DIR}/artifacts/android/sign-out.png`,
      '',
      'On some platforms only: `The user signs out` (present: android; missing: ios)',
      '',
      'Left out, because no scenario in the feature files has their name: `Named by another runner`',
      '',
      'Left out as unattributed, because they are in no platform directory (`android/`, `ios/`): `sign-out.png`',
      '',
    ].join('\n'));
  });

  it('writes no platform line for a profile with one platform', () => {
    const proof = assembleMobile(
      [testCase('The user signs in', [attachment('android/sign-in.png'), attachment('ios/sign-in.png')])],
      ['android/sign-in.png', 'ios/sign-in.png'],
      { ...MOBILE_PROFILE, platforms: [Platform.Android] },
    );

    expect(proof.document).not.toContain(SOME_PLATFORMS_ONLY);
    expect(proof.document).toContain('Left out as unattributed, because they are in no platform directory (`android/`): `ios/sign-in.png`');
  });

  it('says "no per-issue scenarios" and "no scenario opened a screen" together when the issue has no scenarios of its own, and fails for neither', () => {
    const regressionRun = runOf(REGRESSION, reportOf(testCase('The wish list opens')));

    const proof = assemble({ applicationProfile: MOBILE_PROFILE, runs: [regressionRun, NOT_RUN(PER_ISSUE)], scenarioIndex: indexOf(REGRESSION_FEATURE) });

    expect(proof.document).toContain(NO_PER_ISSUE_SCENARIOS);
    expect(proof.document).toContain(NO_SCENARIO_OPENED_A_SCREEN);
    expect(proof.hasBlockerFailures).toBe(false);
  });

  it('says that no scenario opened a screen in a notice proof of a profile with platforms', () => {
    const proof = assemble({ notice: 'No step definition files found', applicationProfile: MOBILE_PROFILE, runs: [] });

    expect(proof.document).toContain(NO_SCENARIO_OPENED_A_SCREEN);
    expect(proof.hasBlockerFailures).toBe(false);
  });

  it('never blocks on a missing platform', () => {
    const regressionRun = runOf(REGRESSION, reportOf(testCase('The wish list opens')));
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('The user signs in', [attachment('android/sign-in.png')])));

    const proof = assemble({
      applicationProfile: MOBILE_PROFILE,
      runs: [regressionRun, perIssueRun],
      scenarioIndex: indexOf(REGRESSION_FEATURE, SIGN_IN_FEATURE),
      artifacts: [artifact('android/sign-in.png')],
    });

    expect(proof.document).toContain(SOME_PLATFORMS_ONLY);
    expect(proof.hasBlockerFailures).toBe(false);
  });
});
