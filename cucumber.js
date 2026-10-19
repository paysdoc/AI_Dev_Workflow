/* global process */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The built-in junit formatter (delegates to @cucumber/junit-xml-formatter) writes to
// a file path; progress writes to stdout. They use different targets so there is no
// conflict. Gate on ADW_JUNIT_REPORT_PATH so plain host runs and CI regression.yml
// (which set no such var) remain byte-for-byte unchanged.
const junitPath = process.env.ADW_JUNIT_REPORT_PATH;
const format = junitPath ? ['progress', `junit:${junitPath}`] : ['progress'];

// The review-gate scenarios count review attempts against the default budget of 3. config.ts reads
// MAX_REVIEW_RETRY_ATTEMPTS when it is first imported, after dotenv has loaded the host's env
// file, and dotenv never overrides a variable that is already set. Pin it here, before any
// support code is imported, so a host that raises the budget cannot change what the scenarios see.
process.env.MAX_REVIEW_RETRY_ATTEMPTS = '3';

// The cron tick counter is process-wide and every fifteenth tick runs the dev-server janitor against
// TARGET_REPOS_DIR, which on a developer's machine holds real target-repository worktrees. The cron-tick
// scenarios of several features add up to that cadence, so point the variable at a directory that holds
// none. It is read once, at import, hence here.
const emptyTargetReposDir = mkdtempSync(join(tmpdir(), 'adw-cucumber-target-repos-'));
process.env.TARGET_REPOS_DIR = emptyTargetReposDir;
process.on('exit', () => rmSync(emptyTargetReposDir, { recursive: true, force: true }));

// The same tick also runs the device janitor, which lists and removes the AVDs and simulators of the host the suite runs on. Run
// from a worktree, whose `agents/` directory holds none of the host's live workflows, it would take the devices of every one of them
// for a dead workflow's. No scenario needs a janitor to run on a tick, so the cadence is put out of reach. It is read once, at
// import, hence here; the scenarios that run the cron's janitor tick give it the cycle of this very variable.
process.env.JANITOR_INTERVAL_CYCLES = '1000000';

export default {
  paths: ['features/regression/**/*.feature', 'features/per-issue/**/*.feature'],
  import: [
    'features/support/register-tsx.mjs',
    'features/regression/step_definitions/**/*.ts',
    'features/regression/support/**/*.ts',
    'features/step_definitions/**/*.ts',
    'features/per-issue/step_definitions/**/*.ts',
  ],
  format,
};
