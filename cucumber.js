/* global process */
// The built-in junit formatter (delegates to @cucumber/junit-xml-formatter) writes to
// a file path; progress writes to stdout. They use different targets so there is no
// conflict. Gate on ADW_JUNIT_REPORT_PATH so plain host runs and CI regression.yml
// (which set no such var) remain byte-for-byte unchanged.
const junitPath = process.env.ADW_JUNIT_REPORT_PATH;
const format = junitPath ? ['progress', `junit:${junitPath}`] : ['progress'];

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
