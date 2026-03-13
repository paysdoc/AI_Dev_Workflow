import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    // Discover tests via the real adws/ directory so filters like "adws/__tests__" work
    include: ['adws/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', '.worktrees/**', '**/e2e-tests/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './adws'),
    },
  },
})
