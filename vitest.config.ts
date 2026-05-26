import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'adws/**/__tests__/**/*.test.ts',
      'test/mocks/__tests__/**/*.test.ts',
    ],
    // app_tests runs `--run src`, but this repo has no src/ dir (tests live in
    // adws/). Pass instead of erroring when a subset filter matches no files.
    passWithNoTests: true,
  },
});
