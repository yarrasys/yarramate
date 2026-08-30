import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Cutting a release retitles `## Unreleased` to the version being cut. That
// step assumes there is exactly one, and for two releases there were three:
// PRs each opened their own heading, the release renamed the first, and the
// entries below it went on reading as pending after they had shipped. A
// reader looking for what is in 1.13.0 found its heading, then two
// "Unreleased" blocks describing 1.13.0's own features.
//
// Nothing detected that, because a changelog is prose and prose is not
// checked. This is the smallest check that would have.

const changelog = readFileSync('CHANGELOG.md', 'utf8')
const headings = changelog
  .split('\n')
  .filter((line) => line.startsWith('## '))

describe('the changelog has one place for pending work', () => {
  it('carries at most one Unreleased heading', () => {
    const unreleased = headings.filter(
      (line) => line.trim() === '## Unreleased',
    )
    expect(
      unreleased.length,
      'Add entries under the existing "## Unreleased" heading rather than ' +
        'opening a second one. Cutting a release renames the first, and any ' +
        'other is left behind describing shipped work as pending.',
    ).toBeLessThanOrEqual(1)
  })

  it('puts Unreleased first when it is present', () => {
    // A pending section below a released one is the same defect wearing a
    // different hat: it reads as belonging to the release above it.
    const index = headings.findIndex((line) => line.trim() === '## Unreleased')
    if (index === -1) return
    expect(index).toBe(0)
  })

  it('never repeats a released version heading', () => {
    const released = headings.filter((line) => line.trim() !== '## Unreleased')
    expect(released).toEqual([...new Set(released)])
  })
})
