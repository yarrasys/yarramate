import { defineConfig } from 'vitest/config'

// Scope discovery to the repository's own test tree: agent worktrees under
// .claude/worktrees/ carry full copies of test/ that default globs would run.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
