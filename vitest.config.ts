import { defineConfig } from 'vitest/config'

// Scope discovery to the repository's own test tree: agent worktrees under
// .claude/worktrees/ carry full copies of test/ that default globs would run.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Vitest's 5000ms default was never right for this suite, and #458 is how
    // that surfaced: `pnpm verify` failed intermittently on a busy machine with
    // `Test timed out in 5000ms` and NO assertion failure, which reads exactly
    // like a regression in whatever you had just changed.
    //
    // Measured rather than guessed. Unloaded, the slowest test here takes
    // 9159ms and eight are over 2000ms — the heaviest compile the whole
    // repository self-model or read the built browser bundles, and they are
    // legitimately that slow. So the default sat below the suite's own top end,
    // and the only reason it was not failing constantly is that the machine is
    // usually idle.
    //
    // Under load it fails properly. Same load average of ~50, same tree: at
    // 5000ms three files timed out, at 30000ms none did. It was first blamed on
    // worker contention over `git` subprocesses, because the ten files that
    // shell out are the ones that break first, but pushing the load higher
    // times out plain in-process tests too. Starvation, not contention, and a
    // per-file rule keyed on "does it spawn" would have papered over the
    // slowest test in the suite, which does not.
    //
    // The cost is that a genuinely hung test now takes 30s to fail instead of
    // 5s. That is paid once by whoever wrote the hang; the old setting was
    // being paid by everyone else, in re-runs and in stash-and-reverify cycles
    // to establish that a change was not at fault.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
