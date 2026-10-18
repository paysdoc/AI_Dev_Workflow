import { describe, it, expect } from 'vitest';
import { APPLICATION_TYPE_PROFILES, Platform } from '../../core/applicationType';
import { NO_SCENARIO_OPENED_A_PAGE } from '../proofDocument';
import {
  MOBILE_PROFILE,
  NOT_RUN,
  PER_ISSUE,
  PER_ISSUE_FEATURE,
  PROOF_DIR,
  REGRESSION,
  SIGN_IN_FEATURE,
  artifact,
  assemble,
  attachment,
  indexOf,
  reportOf,
  runOf,
  testCase,
} from './proofAssembler.helpers';
import type { TagRunRecord } from '../proofAssembler';

describe('assembleScenarioProof — which images are selected', () => {
  const index = indexOf(
    PER_ISSUE_FEATURE,
    `@regression
Feature: Cart page

  Scenario: The cart page loads
    Given a cart
`,
  );
  const artifacts = [
    artifact('adw-42/cart-total/test-finished-1.png'),
    artifact('adw-42/cart-page/test-finished-1.png'),
    artifact('regression/cart-page/test-finished-1.png'),
    artifact('regression/wish/test-finished-1.png'),
  ];

  it('selects the images of the issue\'s scenarios and leaves out regression images and what is not an image', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Cart › The cart shows the total', [
        attachment('adw-42/cart-total/test-finished-1.png'),
        attachment('adw-42/cart-total/trace.zip'),
        attachment('adw-42/cart-total/video.webm'),
      ]),
      testCase('Cart page › The cart page loads', [attachment('adw-42/cart-page/test-finished-1.png')]),
    ));
    const regressionRun = runOf(REGRESSION, reportOf(
      testCase('Cart page › The cart page loads', [attachment('regression/cart-page/test-finished-1.png')]),
    ));

    const proof = assemble({ runs: [regressionRun, perIssueRun], scenarioIndex: index, artifacts });

    expect(proof.perIssueImages).toStrictEqual([
      {
        absPath: `${PROOF_DIR}/artifacts/adw-42/cart-total/test-finished-1.png`,
        relPath: 'adw-42/cart-total/test-finished-1.png',
        scenario: 'Cart › The cart shows the total',
      },
    ]);
  });

  it('never takes an image from the regression run, whatever its scenarios carry', () => {
    const regressionRun = runOf(REGRESSION, reportOf(
      testCase('Cart › The cart shows the total', [attachment('regression/cart-page/test-finished-1.png')]),
    ));

    const proof = assemble({ runs: [regressionRun, NOT_RUN(PER_ISSUE)], scenarioIndex: index, artifacts });

    expect(proof.perIssueImages).toEqual([]);
  });

  it('leaves out an attachment that points outside the artifacts directory, one whose file is missing, and one that is no image', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Cart › The cart shows the total', [
        '../elsewhere/cart.png',
        attachment('adw-42/cart-total/missing.png'),
        attachment('adw-42/cart-total/error-context.md'),
        attachment('adw-42/cart-total/test-finished-1.png'),
      ]),
    ));

    const proof = assemble({ runs: [NOT_RUN(REGRESSION), perIssueRun], scenarioIndex: index, artifacts });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['adw-42/cart-total/test-finished-1.png']);
  });

  it('resolves an attachment against the directory of the report, not the working directory', () => {
    const elsewhere: TagRunRecord = runOf(PER_ISSUE, reportOf(
      testCase('Cart › The cart shows the total', ['../../proof/artifacts/adw-42/cart-total/test-finished-1.png']),
    ), { reportPath: '/work/reports/nested/junit-adw-42.xml' });

    const proof = assemble({ runs: [NOT_RUN(REGRESSION), elsewhere], scenarioIndex: index, artifacts });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['adw-42/cart-total/test-finished-1.png']);
  });

  it('keeps the images of a failed scenario, which show where it stopped', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Cart › The cart shows the total', [attachment('adw-42/cart-total/test-finished-1.png')], 'failed'),
    ));

    const proof = assemble({ runs: [NOT_RUN(REGRESSION), perIssueRun], scenarioIndex: index, artifacts });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['adw-42/cart-total/test-finished-1.png']);
  });

  it('selects no image when the issue\'s run left no report', () => {
    const proof = assemble({ runs: [NOT_RUN(REGRESSION), runOf(PER_ISSUE, null, { exitCode: 1 })], scenarioIndex: index, artifacts });

    expect(proof.perIssueImages).toEqual([]);
  });

  it('lists an image once, in the order of the report, when two cases attach the same file', () => {
    const shared = attachment('adw-42/cart-total/test-finished-1.png');
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Cart › The cart shows the total', [shared]),
      testCase('Cart › The cart shows the total', [shared]),
    ));

    const proof = assemble({ runs: [NOT_RUN(REGRESSION), perIssueRun], scenarioIndex: index, artifacts });

    expect(proof.perIssueImages).toHaveLength(1);
  });

  it('keeps the order of the report across scenarios', () => {
    const feature = `@adw-42
Feature: Cart

  Scenario: First
    Given a cart

  Scenario: Second
    Given a cart
`;
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Cart › Second', [attachment('adw-42/second/test-finished-1.png')]),
      testCase('Cart › First', [attachment('adw-42/first/test-finished-1.png')]),
    ));

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(feature),
      artifacts: [artifact('adw-42/first/test-finished-1.png'), artifact('adw-42/second/test-finished-1.png')],
    });

    expect(proof.perIssueImages.map(image => image.scenario)).toEqual(['Cart › Second', 'Cart › First']);
  });
});

describe('assembleScenarioProof — an application that expects no images', () => {
  it('selects no image and writes no Evidence section, though the runner attached one and the case is the issue\'s', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total', [attachment('adw-42/total/a.png')])));

    const proof = assemble({
      applicationProfile: APPLICATION_TYPE_PROFILES.cli,
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(PER_ISSUE_FEATURE),
      artifacts: [artifact('adw-42/total/a.png')],
    });

    expect(proof.perIssueImages).toEqual([]);
    expect(proof.document).not.toContain('## Evidence');
    expect(proof.document).not.toContain(NO_SCENARIO_OPENED_A_PAGE);
  });
});

describe('assembleScenarioProof — the platform of each image, for a profile with platforms', () => {
  const mobile = { applicationProfile: MOBILE_PROFILE, scenarioIndex: indexOf(SIGN_IN_FEATURE) };

  it('selects the images of both platform runs of one scenario, which report the same title, each with its platform', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('The user signs in', [attachment('android/sign-in.png')]),
      testCase('The user signs in', [attachment('ios/sign-in.png')]),
    ));

    const proof = assemble({
      ...mobile,
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      artifacts: [artifact('android/sign-in.png'), artifact('ios/sign-in.png')],
    });

    expect(proof.perIssueImages).toStrictEqual([
      { absPath: `${PROOF_DIR}/artifacts/android/sign-in.png`, relPath: 'android/sign-in.png', scenario: 'The user signs in', platform: Platform.Android },
      { absPath: `${PROOF_DIR}/artifacts/ios/sign-in.png`, relPath: 'ios/sign-in.png', scenario: 'The user signs in', platform: Platform.Ios },
    ]);
  });

  it('never selects an image of the issue\'s scenarios that lies in no platform directory', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('The user signs in', [attachment('sign-in.png'), attachment('linux/sign-in.png'), attachment('android/sign-in.png')]),
    ));

    const proof = assemble({
      ...mobile,
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      artifacts: [artifact('sign-in.png'), artifact('linux/sign-in.png'), artifact('android/sign-in.png')],
    });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['android/sign-in.png']);
    expect(proof.document).not.toContain(`${PROOF_DIR}/artifacts/sign-in.png`);
    expect(proof.document).not.toContain(`${PROOF_DIR}/artifacts/linux/sign-in.png`);
  });

  it('keeps the images of a failed scenario, with their platform', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('The user signs in', [attachment('android/sign-in.png')], 'failed')));

    const proof = assemble({ ...mobile, runs: [NOT_RUN(REGRESSION), perIssueRun], artifacts: [artifact('android/sign-in.png')] });

    expect(proof.perIssueImages.map(image => image.platform)).toEqual([Platform.Android]);
  });

  it('leaves out the directory of a platform the profile does not have', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('The user signs in', [attachment('android/sign-in.png'), attachment('ios/sign-in.png')]),
    ));

    const proof = assemble({
      ...mobile,
      applicationProfile: { ...MOBILE_PROFILE, platforms: [Platform.Android] },
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      artifacts: [artifact('android/sign-in.png'), artifact('ios/sign-in.png')],
    });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['android/sign-in.png']);
  });

  it('never gives a platform to an image of a web repository, whatever its directory', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total', [attachment('android/a.png')])));

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(PER_ISSUE_FEATURE),
      artifacts: [artifact('android/a.png')],
    });

    expect(proof.perIssueImages).toStrictEqual([
      { absPath: `${PROOF_DIR}/artifacts/android/a.png`, relPath: 'android/a.png', scenario: 'Cart › The cart shows the total' },
    ]);
  });
});
