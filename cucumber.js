export default {
  paths: ['features/**/*.feature'],
  import: ['features/support/register-tsx.mjs', 'features/step_definitions/**/*.ts'],
  format: ['progress'],
};
