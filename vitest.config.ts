import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'adws/**/__tests__/**/*.test.ts',
      'test/mocks/__tests__/**/*.test.ts',
    ],
  },
});
