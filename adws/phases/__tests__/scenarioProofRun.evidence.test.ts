import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NO_PER_ISSUE_SCENARIOS, NO_SCENARIO_OPENED_A_PAGE } from '../../proof/proofDocument';
import { makeSandbox, proofDocument, removeSandboxes, run, wasRun, type Sandbox } from './scenarioProofRun.helpers';

afterEach(removeSandboxes);

// A scenario command that reports as ADW's Playwright project does: a JUnit report whose cases carry their images in
// "[[ATTACHMENT|<path>]]" lines relative to the report, and the images under the proof directory of the run.
function playwrightLikeCommand(sandbox: Sandbox): string {
  const script = path.join(sandbox.recordsDir, 'report.sh');
  fs.writeFileSync(script, `#!/bin/sh
tag="$1"
reports="$(dirname "$ADW_JUNIT_REPORT_PATH")"
relative="\${ADW_PROOF_DIR#"$reports"/}"
mkdir -p "$ADW_PROOF_DIR/a" "$ADW_PROOF_DIR/b"
printf 'png' > "$ADW_PROOF_DIR/a/shot.png"
printf 'zip' > "$ADW_PROOF_DIR/a/trace.zip"
printf 'png' > "$ADW_PROOF_DIR/b/shot.png"
case "$tag" in
  adw-9921)
    cases="<testcase name=\\"Cart › The cart shows the total\\" classname=\\"cart.feature.spec.js\\"><system-out><![CDATA[
[[ATTACHMENT|$relative/a/shot.png]]

[[ATTACHMENT|$relative/a/trace.zip]]
]]></system-out></testcase><testcase name=\\"Cart › The cart page loads\\" classname=\\"cart.feature.spec.js\\"><system-out><![CDATA[
[[ATTACHMENT|$relative/b/shot.png]]
]]></system-out></testcase>"
    ;;
  *)
    cases="<testcase name=\\"Cart › The cart page loads\\" classname=\\"cart.feature.spec.js\\"><system-out><![CDATA[
[[ATTACHMENT|$relative/b/shot.png]]
]]></system-out></testcase>"
    ;;
esac
printf '<?xml version="1.0"?><testsuites><testsuite name="cart.feature.spec.js">%s</testsuite></testsuites>' "$cases" > "$ADW_JUNIT_REPORT_PATH"
`, { mode: 0o755 });
  return `'${script}' {tag}`;
}

describe('runScenarioProof — the images of a run', () => {
  it('returns exactly the images of the per-issue scenarios in a web repository, by their absolute path', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { profile: 'web', proofDirPerTag: true, command: playwrightLikeCommand(sandbox) });

    expect(result.hasBlockerFailures).toBe(false);
    expect(result.perIssueImages).toEqual([
      {
        absPath: path.join(result.artifactsDir, 'adw-9921', 'a', 'shot.png'),
        relPath: 'adw-9921/a/shot.png',
        scenario: 'Cart › The cart shows the total',
      },
    ]);
    expect(proofDocument(sandbox)).toContain(`- \`Cart › The cart shows the total\`: ${path.join(result.artifactsDir, 'adw-9921', 'a', 'shot.png')}`);
    expect(proofDocument(sandbox)).not.toContain(NO_SCENARIO_OPENED_A_PAGE);
  });

  it('selects no image in a cli repository, though the runner attached one, and writes no Evidence section', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { profile: 'cli', proofDirPerTag: true, command: playwrightLikeCommand(sandbox) });

    expect(result.perIssueImages).toEqual([]);
    expect(proofDocument(sandbox)).not.toContain('## Evidence');
  });

  it('says that no scenario opened a page when a web run left no image of the issue\'s scenarios', async () => {
    const sandbox = makeSandbox();

    const result = await run(sandbox, { profile: 'web', proofDirPerTag: true });

    expect(result.perIssueImages).toEqual([]);
    expect(result.hasBlockerFailures).toBe(false);
    expect(proofDocument(sandbox)).toContain(NO_SCENARIO_OPENED_A_PAGE);
  });

  it('says both lines in a web repository whose issue has no scenarios of its own, and passes', async () => {
    const sandbox = makeSandbox({ perIssueScenarios: false });

    const result = await run(sandbox, { profile: 'web', proofDirPerTag: true });

    expect(result.hasBlockerFailures).toBe(false);
    expect(proofDocument(sandbox)).toContain(NO_PER_ISSUE_SCENARIOS);
    expect(proofDocument(sandbox)).toContain(NO_SCENARIO_OPENED_A_PAGE);
  });

  it('clears the images of an earlier run, so that the proof never lists one the run did not make', async () => {
    const sandbox = makeSandbox();
    const stale = path.join(sandbox.proofDir, 'artifacts', 'adw-9921', 'stale.png');
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, 'stale');

    await run(sandbox, { profile: 'web', proofDirPerTag: true });

    expect(fs.existsSync(stale)).toBe(false);
  });
});

describe('runScenarioProof — a repository without step definitions', () => {
  it('runs no tag, and writes a proof that says why', async () => {
    const sandbox = makeSandbox({ stepDefinitions: false });

    const result = await run(sandbox, { profile: 'cli' });

    expect(result).toMatchObject({ tagResults: [], hasBlockerFailures: false, perIssueImages: [] });
    expect(wasRun(sandbox, 'regression')).toBe(false);
    const document = proofDocument(sandbox);
    expect(document).toContain('⚠️ No step definition files found in features/step_definitions/ — skipping BDD scenario proof');
    expect(document).not.toContain(NO_SCENARIO_OPENED_A_PAGE);
  });

  it('says that no scenario opened a page in a web repository', async () => {
    const sandbox = makeSandbox({ stepDefinitions: false });

    const result = await run(sandbox, { profile: 'web', proofDirPerTag: true });

    expect(result.tagResults).toEqual([]);
    expect(proofDocument(sandbox)).toContain(NO_SCENARIO_OPENED_A_PAGE);
  });

  it('empties the artifacts directory and gives the path of the proof it wrote', async () => {
    const sandbox = makeSandbox({ stepDefinitions: false });
    const stale = path.join(sandbox.proofDir, 'artifacts', 'stale.png');
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, 'stale');

    const result = await run(sandbox, {});

    expect(fs.existsSync(stale)).toBe(false);
    expect(result.resultsFilePath).toBe(path.join(sandbox.proofDir, 'scenario_proof.md'));
    expect(result.artifactsDir).toBe(path.join(sandbox.proofDir, 'artifacts'));
  });
});
