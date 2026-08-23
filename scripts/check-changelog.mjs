#!/usr/bin/env node
// Reports every commit since a release that changed what a user sees and did
// not write a CHANGELOG entry.
//
// Six of the nine pull requests merged into 1.0 wrote no entry, one of them
// breaking, and nothing caught it: no test, no CI job and no script reads
// CHANGELOG.md, so an entry can be skipped without anything failing until the
// release notes are already published. This is the backstop, run before a tag
// rather than on every pull request, where it costs one command and cannot
// nag a refactor that legitimately has nothing to say.
//
// It asks whether the COMMIT touched CHANGELOG.md. That is the reliable test,
// but on its own it convicts a change described later by a catch-up commit, so
// a commit whose pull request is cited in the unreleased section is excused
// too. Citation-matching is used ONLY to excuse, never to accuse: an entry
// that cites the issue it closes rather than its pull request, or cites
// nothing, simply fails to excuse and the commit is reported. The error runs
// toward over-reporting, which a reader can dismiss, rather than toward the
// silence that let six changes ship undocumented.
//
// Only `feat`, `fix` and `perf` are held to it, with or without a scope or a
// breaking `!`. A `chore`, `ci`, `test`, `refactor`, `build`, `style` or
// `docs` commit is exempt, since none of them changes what a user sees. A
// subject outside conventional-commit form is reported, because a commit
// nobody can classify is exactly the one worth a human glance. Genuine
// exceptions say so in the message with a `Changelog: none` trailer, which
// keeps the reason in the history rather than in an ignore list.
//
// Usage:
//   node scripts/check-changelog.mjs [<since>]
//
// `since` defaults to the most recent tag. Exits 1 when anything is missing.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The repository is the working directory, not wherever this file happens to
// live. `pnpm` runs a script from the package root, so the common invocation
// is unchanged, and a test can point it at a repository built for the purpose
// rather than at this one.
const repositoryRoot = process.cwd()

const git = (...args) =>
  execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trimEnd()

// A type that changes what a user sees, so an entry is owed.
const userVisible = /^(feat|fix|perf)(\([^)]*\))?!?:/
// Every other conventional type, none of which a reader of the notes needs.
const exempt = /^(chore|ci|test|refactor|build|style|docs|revert)(\([^)]*\))?!?:/

const since = process.argv[2] ?? (() => {
  try {
    return git('describe', '--tags', '--abbrev=0')
  } catch {
    console.error(
      'No tag to compare against. Name one explicitly:\n' +
        '  node scripts/check-changelog.mjs <since>',
    )
    process.exit(2)
  }
})()

let range
try {
  range = git('rev-parse', '--verify', `${since}^{commit}`)
} catch {
  console.error(`Not a commit this repository knows: ${since}`)
  process.exit(2)
}
void range

const commits = git(
  'log',
  '--no-merges',
  // Fields separated by NUL and records by RS, because a body is free text
  // that may be empty, may span lines, and may itself contain blank lines.
  '--format=%x1e%H%x00%s%x00%b',
  `${since}..HEAD`,
)
  .split('\x1e')
  .filter((entry) => entry.trim() !== '')
  .map((entry) => {
    const [sha, subject, body] = entry.split('\0')
    return { sha: sha.trim(), subject: subject ?? '', body: body ?? '' }
  })

if (commits.length === 0) {
  console.log(`No commits since ${since}.`)
  process.exit(0)
}

const touchesChangelog = (sha) =>
  git('diff-tree', '--no-commit-id', '--name-only', '-r', sha, '--', 'CHANGELOG.md') !== ''

// The section under the topmost `## ` heading: the version being prepared.
const unreleasedSection = (() => {
  let changelog
  try {
    changelog = readFileSync(resolve(repositoryRoot, 'CHANGELOG.md'), 'utf8')
  } catch {
    return ''
  }
  const headings = [...changelog.matchAll(/^## .*$/gm)]
  if (headings.length === 0) return ''
  const start = headings[0].index + headings[0][0].length
  const end = headings[1]?.index ?? changelog.length
  return changelog.slice(start, end)
})()

// A squash merge ends the subject with its pull request number.
const citedInChangelog = (subject) => {
  const pull = /\(#(\d+)\)\s*$/.exec(subject)
  if (pull === null) return false
  return new RegExp(`#${pull[1]}(?![0-9])`).test(unreleasedSection)
}

const waived = (body) => /^Changelog:\s*none\s*$/im.test(body)

const missing = []
const unclassified = []
for (const commit of commits) {
  if (
    touchesChangelog(commit.sha) ||
    citedInChangelog(commit.subject) ||
    waived(commit.body)
  ) {
    continue
  }
  if (exempt.test(commit.subject)) continue
  if (userVisible.test(commit.subject)) {
    missing.push(commit)
    continue
  }
  unclassified.push(commit)
}

const line = ({ sha, subject }) =>
  `  ${sha.slice(0, 7)} ${subject.length > 68 ? `${subject.slice(0, 65)}...` : subject}`

if (missing.length > 0) {
  console.error('Missing a CHANGELOG entry:')
  for (const commit of missing) console.error(line(commit))
  console.error('')
}
if (unclassified.length > 0) {
  console.error('Subject is not conventional-commit form, so nobody can tell:')
  for (const commit of unclassified) console.error(line(commit))
  console.error('')
}

const owed = missing.length + unclassified.length
if (owed === 0) {
  console.log(
    `Every user-visible commit since ${since} has a CHANGELOG entry ` +
      `(${commits.length} commit${commits.length === 1 ? '' : 's'} checked).`,
  )
  process.exit(0)
}

console.error(
  `${owed} of ${commits.length} commits since ${since} wrote no entry.\n` +
    'Write one, or record the reason in the commit with a `Changelog: none` trailer.',
)
process.exit(1)
