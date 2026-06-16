import { defineConfig } from 'vitest/config';

const junitReportPath = process.env.ADW_UNIT_TEST_REPORT_PATH;

export default defineConfig({
  test: {
    include: [
      'adws/**/__tests__/**/*.test.ts',
      'test/mocks/__tests__/**/*.test.ts',
    ],
    reporters: junitReportPath
      ? ['default', ['junit', { outputFile: junitReportPath }]]
      : ['default'],
  },
});
