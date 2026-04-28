export default {
  paths: ['features/regression/**/*.feature'],
  import: ['features/support/register-tsx.mjs', 'features/regression/step_definitions/**/*.ts', 'features/regression/support/**/*.ts'],
  format: ['progress'],
};
