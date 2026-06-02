import { Given } from '@cucumber/cucumber';
import assert from 'assert';
import {
  ensureInvocationLog,
  buildReviewPayload,
  seedReviewPayload,
} from './feature-533.steps.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Given — review-agent output seeding (§§1–6)
// ---------------------------------------------------------------------------

Given(
  'the review-agent output for adwId {string} carries one blocker with remediationStrategy {string} listing files {string} and rule {string}',
  function (this: RegressionWorld, adwId: string, strategy: string, files: string, rule: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: `${files}: violates ${rule} rule`,
        issueResolution: 'Run /refactor on the listed files',
        issueSeverity: 'blocker',
        remediationStrategy: strategy,
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries one blocker with no remediationStrategy field',
  function (this: RegressionWorld, adwId: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: 'Logic error in conditional',
        issueResolution: 'Fix the conditional',
        issueSeverity: 'blocker',
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries one blocker with remediationStrategy {string}',
  function (this: RegressionWorld, adwId: string, strategy: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: strategy === 'refactor'
          ? 'file.ts: nesting-depth violation'
          : 'Missing null check in parser',
        issueResolution: strategy === 'refactor'
          ? 'Run /refactor on the listed files'
          : 'Add null guard',
        issueSeverity: 'blocker',
        remediationStrategy: strategy,
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries two patch blockers and one refactor blocker',
  function (this: RegressionWorld, adwId: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [
        {
          reviewIssueNumber: 1,
          issueDescription: 'Null pointer in handler',
          issueResolution: 'Add null check',
          issueSeverity: 'blocker',
          remediationStrategy: 'patch',
        },
        {
          reviewIssueNumber: 2,
          issueDescription: 'Missing error boundary',
          issueResolution: 'Add error handler',
          issueSeverity: 'blocker',
          remediationStrategy: 'patch',
        },
        {
          reviewIssueNumber: 3,
          issueDescription: 'adws/agents/reviewAgent.ts: nesting-depth violation',
          issueResolution: 'Run /refactor on the listed files',
          issueSeverity: 'blocker',
          remediationStrategy: 'refactor',
        },
      ],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries one blocker with remediationStrategy {string} listing three affected files',
  function (this: RegressionWorld, adwId: string, strategy: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: 'fileA.ts: nesting-depth\nfileB.ts: nesting-depth\nfileC.ts: no-any',
        issueResolution: 'Run /refactor on the listed files',
        issueSeverity: 'blocker',
        remediationStrategy: strategy,
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} carries no blockers with remediationStrategy {string}',
  function (this: RegressionWorld, adwId: string, _strategy: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: 'Missing test coverage',
        issueResolution: 'Add unit tests',
        issueSeverity: 'blocker',
        remediationStrategy: 'patch',
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the review-agent output for adwId {string} reports success with zero blocker issues',
  function (this: RegressionWorld, adwId: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload([], true);
    seedReviewPayload(this, adwId, payloadText);
  },
);

// ---------------------------------------------------------------------------
// Given — PR mock state (§6)
// ---------------------------------------------------------------------------

Given(
  'the mock GitHub API is configured to return an open PR {int} for issue {int} with an unaddressed coding-guideline review comment',
  async function (this: RegressionWorld, prNumber: number, issueNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    await this.mockContext.setState({
      prs: {
        [String(prNumber)]: {
          number: prNumber,
          state: 'open',
          merged: false,
          body: `Resolves #${issueNumber}`,
          html_url: `https://github.com/test/test/pull/${prNumber}`,
          title: `PR for issue ${issueNumber}`,
          base: { ref: 'dev' },
          head: { ref: `feature-issue-${issueNumber}` },
        },
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

Given(
  'the mock GitHub API is configured to return an open PR {int} for issue {int} with unaddressed review comments',
  async function (this: RegressionWorld, prNumber: number, issueNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    await this.mockContext.setState({
      prs: {
        [String(prNumber)]: {
          number: prNumber,
          state: 'open',
          merged: false,
          body: `Resolves #${issueNumber}`,
          html_url: `https://github.com/test/test/pull/${prNumber}`,
          title: `PR for issue ${issueNumber}`,
          base: { ref: 'dev' },
          head: { ref: `feature-issue-${issueNumber}` },
        },
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

// ---------------------------------------------------------------------------
// Given — pr-review-agent output seeding (§6)
// ---------------------------------------------------------------------------

Given(
  'the pr-review-agent output for adwId {string} carries one blocker with remediationStrategy {string}',
  function (this: RegressionWorld, adwId: string, strategy: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [{
        reviewIssueNumber: 1,
        issueDescription: strategy === 'refactor'
          ? 'adws/phases/reviewPhase.ts: nesting-depth violation'
          : 'Missing input validation',
        issueResolution: strategy === 'refactor'
          ? 'Run /refactor on the listed files'
          : 'Add validation',
        issueSeverity: 'blocker',
        remediationStrategy: strategy,
      }],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);

Given(
  'the pr-review-agent output for adwId {string} carries one patch blocker and one refactor blocker',
  function (this: RegressionWorld, adwId: string) {
    ensureInvocationLog(this, adwId);
    const payloadText = buildReviewPayload(
      [
        {
          reviewIssueNumber: 1,
          issueDescription: 'Missing input validation in endpoint',
          issueResolution: 'Add validation',
          issueSeverity: 'blocker',
          remediationStrategy: 'patch',
        },
        {
          reviewIssueNumber: 2,
          issueDescription: 'adws/agents/patchAgent.ts: no-any violation',
          issueResolution: 'Run /refactor on the listed files',
          issueSeverity: 'blocker',
          remediationStrategy: 'refactor',
        },
      ],
      false,
    );
    seedReviewPayload(this, adwId, payloadText);
  },
);
