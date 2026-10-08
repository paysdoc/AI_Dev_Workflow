/**
 * The stand-in for the Playwright run of the feature-937 workflow's `web` repository: the `npx` that the ADW Playwright project's
 * run command calls. Asked to run the tests, whatever the tag, it copies the proof run into `$ADW_PROOF_DIR` and writes a passing
 * JUnit report whose one test case, the issue's scenario, attaches every file it copied, as Playwright lists an attachment:
 * relative to the report's directory. Any other `npx` call (`bddgen`) has nothing to do and succeeds.
 */

import * as fs from 'fs';
import * as path from 'path';

const ISSUE_FEATURE_NAME = 'The change of the issue';
const ISSUE_SCENARIO_NAME = 'The proof run';

// ADW's Playwright project names a test case by its Feature and scenario names, joined as playwright-bdd joins them.
const ISSUE_TEST_CASE_NAME = `${ISSUE_FEATURE_NAME} › ${ISSUE_SCENARIO_NAME}`;

export const ISSUE_FEATURE_FILE = 'features/issue.feature';

/** The repository's one scenario: it carries the issue's tag, so the scenario test phase runs that tag and reads its images. */
export function issueFeature(issueNumber: number): string {
  return [
    `Feature: ${ISSUE_FEATURE_NAME}`,
    '',
    `  @adw-${issueNumber}`,
    `  Scenario: ${ISSUE_SCENARIO_NAME}`,
    '    Given the change of the issue is in place',
    '',
  ].join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const REPORT_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?><testsuites tests="1" failures="0">' +
  `<testsuite name="issue.feature" tests="1" failures="0"><testcase name="${ISSUE_TEST_CASE_NAME}" classname="issue.feature">` +
  '<system-out><![CDATA[';
const REPORT_TAIL = ']]></system-out></testcase></testsuite></testsuites>';

// POSIX sh rather than Node: a Node child would inherit the Cucumber run's `NODE_OPTIONS` loader, which its working directory cannot resolve.
function standInNpxScript(proofRunDir: string): string {
  const proofRun = shellQuote(proofRunDir);
  return [
    '#!/bin/sh',
    'if [ "$1" != playwright ] || [ "$2" != test ]; then exit 0; fi',
    'set -e',
    'mkdir -p "$ADW_PROOF_DIR"',
    `cp -R ${shellQuote(`${proofRunDir}/.`)} "$ADW_PROOF_DIR/"`,
    'report_dir=$(dirname "$ADW_JUNIT_REPORT_PATH")',
    'attachment_dir=${ADW_PROOF_DIR#"$report_dir"/}',
    '{',
    `  printf '%s' ${shellQuote(REPORT_HEAD)}`,
    `  (cd ${proofRun} && find . -type f | LC_ALL=C sort) | while IFS= read -r file; do`,
    `    printf '\\n[[ATTACHMENT|%s/%s]]\\n' "$attachment_dir" "\${file#./}"`,
    '  done',
    `  printf '%s\\n' ${shellQuote(REPORT_TAIL)}`,
    '} > "$ADW_JUNIT_REPORT_PATH"',
    "echo '1 passed'",
    '',
  ].join('\n');
}

/** Writes the stand-in `npx` into `binDir`; it reads the proof run directory at every run, so a changed proof run needs no rewrite. */
export function installStandInNpx(binDir: string, proofRunDir: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'npx'), standInNpxScript(proofRunDir), { mode: 0o755 });
}

/** `PATH` leads with the stand-in only while `run` does, so that nothing outside the scenario run finds it. */
export async function withStandInNpxOnPath<T>(binDir: string, run: () => Promise<T>): Promise<T> {
  const savedPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${savedPath ?? ''}`;
  try {
    return await run();
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }
}
