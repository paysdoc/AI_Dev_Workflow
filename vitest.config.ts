import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    // Exclude worktrees from test discovery to avoid running duplicate tests
    exclude: ['**/node_modules/**', '**/dist/**', '.worktrees/**', '**/e2e-tests/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
