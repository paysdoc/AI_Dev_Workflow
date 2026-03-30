import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['adws/**/__tests__/**/*.test.ts'],
  },
});
