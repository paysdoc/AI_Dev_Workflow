/* global process */
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
