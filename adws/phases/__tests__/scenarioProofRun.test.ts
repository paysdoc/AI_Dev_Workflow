import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import { NO_PER_ISSUE_SCENARIOS } from '../../proof/proofDocument';
import { makeSandbox, proofDocument, recordedFor, removeSandboxes, run, wasRun } from './scenarioProofRun.helpers';

afterEach(removeSandboxes);

describe('runScenarioProof — the environment of a run', () => {
  it('hands the extra variables to the command, for every tag', async () => {
    const sandbox = makeSandbox();

    await run(sandbox, { env: { ADW_APPLICATION_URL: 'http://localhost:4567' } });

    expect(recordedFor(sandbox, 'regression').applicationUrl).toBe('http://localhost:4567');
    expect(recordedFor(sandbox, 'adw-9921').applicationUrl).toBe('http://localhost:4567');
  });

  it('hands none when none are given', async () => {
    const sandbox = makeSandbox();

    await run(sandbox, {});

    expect(recordedFor(sandbox, 'adw-9921').applicationUrl).toBe('');
  });

  it('lets the extra variables override neither the report path nor the proof directory', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { env: { ADW_PROOF_DIR: '/elsewhere', ADW_JUNIT_REPORT_PATH: '/elsewhere/report.xml' } });

    const recorded = recordedFor(sandbox, 'adw-9921');
    expect(recorded.reportPath).toBe(path.join(sandbox.proofDir, 'junit-adw-9921.xml'));
    expect(recorded.proofDir).toBe(result.artifactsDir);
  });

  it('keeps the reports outside the artifacts directory, whatever the proof directory mode', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { proofDirPerTag: true });

    for (const tag of ['regression', 'adw-9921']) {
      expect(path.dirname(recordedFor(sandbox, tag).reportPath)).toBe(sandbox.proofDir);
    }
    expect(result.artifactsDir).toBe(path.join(sandbox.proofDir, 'artifacts'));
  });
});

describe('runScenarioProof — the proof directory of a run', () => {
  it('shares the artifacts directory between tags by default, as before', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, {});

    expect(recordedFor(sandbox, 'regression').proofDir).toBe(result.artifactsDir);
    expect(recordedFor(sandbox, 'adw-9921').proofDir).toBe(result.artifactsDir);
  });

  it('gives each tag a directory of its own inside the artifacts directory with proofDirPerTag', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { proofDirPerTag: true });

    const regression = recordedFor(sandbox, 'regression').proofDir;
    const issue = recordedFor(sandbox, 'adw-9921').proofDir;
    expect(regression).toBe(path.join(result.artifactsDir, 'regression'));
    expect(issue).toBe(path.join(result.artifactsDir, 'adw-9921'));
    expect(regression).not.toBe(issue);
  });

  it('returns the artifacts directory itself as the root to harvest, in both modes', async () => {
    const shared = makeSandbox();
    const perTag = makeSandbox();

    const sharedResult = await run(shared, {});
    const perTagResult = await run(perTag, { proofDirPerTag: true });

    expect(sharedResult.artifactsDir).toBe(path.join(shared.proofDir, 'artifacts'));
    expect(perTagResult.artifactsDir).toBe(path.join(perTag.proofDir, 'artifacts'));
  });
});

describe('runScenarioProof — the fixed tags', () => {
  it('runs the regression tag and then the issue\'s tag, both as blockers', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, {});

    expect(result.tagResults.map(({ tag, resolvedTag, severity }) => ({ tag, resolvedTag, severity }))).toEqual([
      { tag: '@regression', resolvedTag: '@regression', severity: 'blocker' },
      { tag: '@adw-{issueNumber}', resolvedTag: '@adw-9921', severity: 'blocker' },
    ]);
    expect(result.hasBlockerFailures).toBe(false);
  });

  it('does not run the per-issue tag when no scenario carries it, and the proof says so without failing', async () => {
    const sandbox = makeSandbox({ perIssueScenarios: false });

    const result = await run(sandbox, {});

    expect(wasRun(sandbox, 'regression')).toBe(true);
    expect(wasRun(sandbox, 'adw-9921')).toBe(false);
    expect(result.tagResults[1]).toMatchObject({ resolvedTag: '@adw-9921', passed: true, skipped: true, exitCode: null });
    expect(result.hasBlockerFailures).toBe(false);
    expect(proofDocument(sandbox)).toContain(NO_PER_ISSUE_SCENARIOS);
  });

  it('does not run the per-issue tag when the feature directory does not exist, and still runs the regression tag', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { featureDirectory: 'no/such/directory' });

    expect(wasRun(sandbox, 'regression')).toBe(true);
    expect(wasRun(sandbox, 'adw-9921')).toBe(false);
    expect(result.tagResults[1]).toMatchObject({ passed: true, skipped: true });
    expect(result.hasBlockerFailures).toBe(false);
  });

  it('fails the regression tag when its command fails, as a blocker', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { command: 'exit 3' });

    expect(result.tagResults[0]).toMatchObject({ resolvedTag: '@regression', passed: false, exitCode: 3 });
    expect(result.hasBlockerFailures).toBe(true);
  });
});
