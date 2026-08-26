import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * Directories a NUL byte would matter in. Scoped deliberately: an unscoped
 * sweep pulls in caches, build output and any worktree checked out under the
 * repository, and reading git objects for NUL bytes finds nothing but NUL
 * bytes.
 */
const SCOPE = ['src', 'test', 'schema', 'catalogues', 'docs', 'scripts']

const listed = (args: readonly string[]): readonly string[] =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '')

/**
 * A raw NUL byte in a text file has bitten this repository three times, and it
 * is invisible in every ordinary reading of the file.
 *
 * The reason it needs a MECHANICAL check rather than care is that the two
 * obvious detectors are each blind to a case the other catches. `git diff`
 * renders a file with an early NUL as `Bin ... bytes` and one with a late NUL
 * as an ordinary text diff; `git grep -lI` uses the same head sniff and so
 * misses a NUL past the first few kilobytes. Both were trusted, on the same
 * day, by two people who had each just read the other's report of the fault.
 *
 * So this reads every byte, and it lists **untracked files as well as tracked
 * ones**: `git ls-files` alone cannot see the file being written right now,
 * which is exactly the file most likely to have one typed into it. A guard
 * that only fires after the commit is late by precisely one commit.
 */
describe('no source file carries a raw NUL byte', () => {
  it('reads every byte of every tracked and uncommitted source file', () => {
    const paths = new Set([
      ...listed(['ls-files', '-z', '--', ...SCOPE]),
      ...listed(['ls-files', '-z', '--others', '--exclude-standard', '--', ...SCOPE]),
    ])
    expect(paths.size).toBeGreaterThan(100)

    const offending: string[] = []
    for (const path of paths) {
      const full = join(root, path)
      let bytes: Buffer
      try {
        if (!statSync(full).isFile()) continue
        bytes = readFileSync(full)
      } catch {
        // A path git lists and the filesystem does not hold is a race with a
        // checkout, not a NUL byte.
        continue
      }
      const at = bytes.indexOf(0)
      if (at >= 0) offending.push(`${path} (byte ${at})`)
    }
    // Naming the offset matters: the whole difficulty of this fault is that
    // the file looks correct, so a reader needs to be told where to look.
    expect(offending).toEqual([])
  })
})
