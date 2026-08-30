import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

// A shipped document must not point at one that stays in the repository.
//
// `docs/INTERROGATION.md` was not in `files` and 1.14.0's notes said it was.
// Two things had been written into it specifically to be found by adopters:
// the recorded answer to #399, put in a document rather than only on the
// issue so the next adopter would not re-ask it, and `below-subject-count`'s
// entry in the condition list. Neither reached anyone arriving through npm,
// and nothing said so, because the packaging claim lived in a release note.
//
// Fixing that exposed the general shape: `MODEL-FLOOR.md` ships and cited
// `docs/EVIDENCE.md` and `docs/NATIVE-DOCUMENT.md`, which did not. A reader
// with the package followed a pointer to a file they did not have.

const files: readonly string[] = JSON.parse(
  readFileSync('package.json', 'utf8'),
).files

const shipped = files.filter((entry) => entry.startsWith('docs/'))

const referencesIn = (path: string): readonly string[] => [
  ...new Set(readFileSync(path, 'utf8').match(/docs\/[A-Z0-9-]+\.md/g) ?? []),
]

describe('the documentation an adopter receives is self-contained', () => {
  it('ships the documents it claims to ship', () => {
    for (const entry of shipped) {
      expect(existsSync(entry), `${entry} is in files but not in the tree`).toBe(
        true,
      )
    }
  })

  it('resolves every pointer a shipped document makes', () => {
    const dangling = shipped.flatMap((entry) =>
      referencesIn(entry)
        // A reference to a document that does not exist at all is a broken
        // link, which is a different defect and not this test's business.
        .filter((ref) => existsSync(ref) && !files.includes(ref))
        .map((ref) => `${entry} -> ${ref}`),
    )
    expect(
      dangling,
      'A shipped document points at one that stays in the repository, so a ' +
        'reader who installed the package cannot follow it. Either add the ' +
        'target to `files` in package.json, or stop citing it by path.',
    ).toEqual([])
  })

  it('keeps the shipped set closed under reference', () => {
    // The property the test above enforces one level at a time, stated as
    // the invariant: following pointers from the shipped set never leaves it.
    const reachable = new Set(shipped)
    const queue = [...shipped]
    while (queue.length > 0) {
      for (const ref of referencesIn(queue.pop()!)) {
        if (existsSync(ref) && !reachable.has(ref)) {
          reachable.add(ref)
          queue.push(ref)
        }
      }
    }
    expect([...reachable].sort()).toEqual([...shipped].sort())
  })
})
