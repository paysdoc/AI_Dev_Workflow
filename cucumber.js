export default {
  paths: ['features/regression/**/*.feature', 'features/per-issue/**/*.feature'],
  import: [
    'features/support/register-tsx.mjs',
    'features/regression/step_definitions/**/*.ts',
    'features/regression/support/**/*.ts',
    'features/step_definitions/**/*.ts',
    'features/per-issue/step_definitions/**/*.ts',
  ],
  format: ['progress'],
};
