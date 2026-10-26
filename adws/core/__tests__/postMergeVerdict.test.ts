import { describe, it, expect } from 'vitest';
import { DevServerStartStatus, NO_DEV_SERVER_START, type DevServerStart } from '../devServerFailure';
import { combineMergedIn, failuresOfProof, postMergeVerdict } from '../postMergeVerdict';
import type { TestCaseResult } from '../testReportParser';
import type { ScenarioProofResult, TagProofResult } from '../../proof/types';

function passedCase(name: string): TestCaseResult {
  return { name, classname: 'Orders', status: 'passed', attachments: [] };
}

function failedCase(name: string, failureMessage?: string): TestCaseResult {
  return { name, classname: 'Orders', status: 'failed', failureMessage, attachments: [] };
}

function tagResult(overrides: Partial<TagProofResult>): TagProofResult {
  return {
    tag: '@regression',
    resolvedTag: '@regression',
    severity: 'blocker',
    optional: false,
    passed: true,
    output: '',
    exitCode: 0,
    skipped: false,
    ...overrides,
  };
}

function proofOf(...tagResults: TagProofResult[]): ScenarioProofResult {
  return {
    tagResults,
    hasBlockerFailures: tagResults.some((tag) => tag.severity === 'blocker' && !tag.passed && !tag.skipped),
    perIssueImages: [],
    resultsFilePath: '/proof/scenario_proof.md',
    artifactsDir: '/proof/artifacts',
  };
}

const STARTED: DevServerStart = { status: DevServerStartStatus.Started };

describe('postMergeVerdict', () => {
  it('is green when no scenario proof was produced', () => {
    expect(postMergeVerdict({ scenarioProof: undefined, devServer: NO_DEV_SERVER_START })).toEqual({ kind: 'green' });
  });

  it('is green when the dev server started and no blocker failed', () => {
    const scenarioProof = proofOf(tagResult({ cases: [passedCase('Orders are accepted')] }));

    expect(postMergeVerdict({ scenarioProof, devServer: STARTED })).toEqual({ kind: 'green' });
  });

  it('is green when the only tag that did not pass was skipped', () => {
    const scenarioProof = proofOf(
      tagResult({}),
      tagResult({ tag: '@adw-{issueNumber}', resolvedTag: '@adw-7', passed: true, skipped: true, exitCode: null }),
    );

    expect(postMergeVerdict({ scenarioProof, devServer: STARTED })).toEqual({ kind: 'green' });
  });

  it('is red with the start command and the output when the dev server did not start', () => {
    const devServer: DevServerStart = {
      status: DevServerStartStatus.Failed,
      command: 'bun run dev --port 4100',
      healthUrl: 'http://localhost:4100/',
      output: 'Error: Cannot find module "jszip"',
    };

    expect(postMergeVerdict({ scenarioProof: undefined, devServer })).toEqual({
      kind: 'red',
      failures: [{ title: 'dev server did not start: bun run dev --port 4100', detail: 'Error: Cannot find module "jszip"' }],
    });
  });

  it('prefers the dev server failure to a proof that, being absent, cannot say anything', () => {
    const devServer: DevServerStart = { status: DevServerStartStatus.Failed, command: 'start', healthUrl: 'http://localhost:1/', output: 'boom' };
    const scenarioProof = proofOf(tagResult({}));

    expect(postMergeVerdict({ scenarioProof, devServer })).toMatchObject({ kind: 'red' });
  });

  it('is red with a failure for each failed case when a blocker tag failed', () => {
    const scenarioProof = proofOf(
      tagResult({
        passed: false,
        exitCode: 1,
        cases: [passedCase('Orders are accepted'), failedCase('Orders are totalled', 'expected 3, found 2')],
      }),
    );

    expect(postMergeVerdict({ scenarioProof, devServer: STARTED })).toEqual({
      kind: 'red',
      failures: [{ title: '@regression Orders: Orders are totalled', detail: 'expected 3, found 2' }],
    });
  });
});

describe('failuresOfProof', () => {
  it('lists the failed cases of each failed blocker tag, regression first, titled with the resolved tag and the scenario', () => {
    const proof = proofOf(
      tagResult({ passed: false, exitCode: 1, cases: [failedCase('Orders are accepted', 'expected 1 order, found 0')] }),
      tagResult({
        tag: '@adw-{issueNumber}',
        resolvedTag: '@adw-110106',
        passed: false,
        exitCode: 1,
        cases: [failedCase('Orders over the limit are refused', 'expected status 422, got 201'), passedCase('Orders under the limit are accepted')],
      }),
    );

    expect(failuresOfProof(proof)).toEqual([
      { title: '@regression Orders: Orders are accepted', detail: 'expected 1 order, found 0' },
      { title: '@adw-110106 Orders: Orders over the limit are refused', detail: 'expected status 422, got 201' },
    ]);
  });

  it('contributes nothing for passed tags, skipped tags and tech-debt tags', () => {
    const proof = proofOf(
      tagResult({ cases: [passedCase('Orders are accepted')] }),
      tagResult({ resolvedTag: '@adw-7', passed: true, skipped: true, exitCode: null }),
      tagResult({ resolvedTag: '@later', severity: 'tech-debt', passed: false, exitCode: 1, cases: [failedCase('Later', 'nope')] }),
    );

    expect(failuresOfProof(proof)).toEqual([]);
  });

  it('names a scenario by its name alone when the report gave no classname', () => {
    const proof = proofOf(
      tagResult({ passed: false, exitCode: 1, cases: [{ name: 'Orders are accepted', status: 'failed', failureMessage: 'boom', attachments: [] }] }),
    );

    expect(failuresOfProof(proof)).toEqual([{ title: '@regression Orders are accepted', detail: 'boom' }]);
  });

  it('says so when the report holds no error message for a failed case', () => {
    const proof = proofOf(tagResult({ passed: false, exitCode: 1, cases: [failedCase('Orders are accepted')] }));

    expect(failuresOfProof(proof)).toEqual([
      { title: '@regression Orders: Orders are accepted', detail: 'no error message in the report' },
    ]);
  });

  it('gives one failure with the exit code and the output for a failed tag that left no report', () => {
    const proof = proofOf(
      tagResult({ passed: false, exitCode: 2, reportMissing: true, output: 'cucumber-js: command not found' }),
    );

    expect(failuresOfProof(proof)).toEqual([
      { title: '@regression failed (exit 2, no JUnit report was left)', detail: 'cucumber-js: command not found' },
    ]);
  });

  it('gives one failure with the exit code and the output for a failed tag whose report holds no failed case', () => {
    const proof = proofOf(tagResult({ passed: false, exitCode: 1, cases: [passedCase('Orders are accepted')], output: 'exited 1 after the suite' }));

    expect(failuresOfProof(proof)).toEqual([{ title: '@regression failed (exit 1)', detail: 'exited 1 after the suite' }]);
  });

  it('says there was no exit code for a tag that did not exit', () => {
    const proof = proofOf(tagResult({ passed: false, exitCode: null, reportMissing: true, output: 'killed' }));

    expect(failuresOfProof(proof)).toEqual([{ title: '@regression failed (no exit code, no JUnit report was left)', detail: 'killed' }]);
  });
});

describe('combineMergedIn', () => {
  const next = { mergedCommits: ['b2 Raise the order limit'], conflictedFiles: ['src/shared.ts'] };

  it('returns the next merge when there was none before', () => {
    expect(combineMergedIn(null, next)).toEqual(next);
  });

  it('keeps only the commits and the conflicted files of a merge that carries more, and each file once', () => {
    const integration = { kind: 'brought_in', mergedCommits: next.mergedCommits, conflictedFiles: ['src/shared.ts', 'src/shared.ts'] };

    expect(combineMergedIn(null, integration)).toEqual(next);
    expect(combineMergedIn(null, integration)).not.toHaveProperty('kind');
  });

  it('keeps the commits of both merges in order', () => {
    const previous = { mergedCommits: ['a1 Add the changelog'], conflictedFiles: [] };

    expect(combineMergedIn(previous, next).mergedCommits).toEqual(['a1 Add the changelog', 'b2 Raise the order limit']);
  });

  it('names a file that conflicted in both merges once', () => {
    const previous = { mergedCommits: [], conflictedFiles: ['src/shared.ts', 'src/orders.ts'] };

    expect(combineMergedIn(previous, next).conflictedFiles).toEqual(['src/shared.ts', 'src/orders.ts']);
  });
});
