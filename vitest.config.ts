import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['adws/cost/__tests__/**/*.test.ts'],
  },
});
