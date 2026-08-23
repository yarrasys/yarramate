#!/usr/bin/env node
// Rewrites a workspace's documents for the flattened subject identity that
// 1.0 introduced: a subject is named by its authored id alone, unique across
// the workspace, with no `<document-id>#` prefix.
//
// The transformation is textual on purpose. Every reference in a native
// document is either bare already (resolved within its own document) or
// carries a `<document-id>#` prefix, so dropping the prefix is the whole
// migration - and doing it as text preserves comments, block scalars, key
// order and every other authoring choice a parse-and-reserialise would
// quietly normalise away.
//
// It refuses rather than guesses. Only a prefix naming a document of this
// workspace is stripped, so a kind identity (`yarramate/core@0.1#goal`), an
// anchor, or a URL fragment is left alone. If two documents declare the same
// id, flattening would merge two distinct subjects, so the script reports
// every collision and writes nothing at all.
//
// It rewrites the files the manifest reaches. A workspace usually has others
// that reference subjects without being listed there - an adapter's project
// definition is the common one - so extra paths can be named after the
// manifest and are rewritten with the same rule.
//
// Usage:
//   node scripts/flatten-subject-ids.mjs <workspace.yaml> [extra-file ...] [--write]
//
// Without `--write` it reports what it would change and touches nothing.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parse } from 'yaml'

const [, , manifestArg, ...rest] = process.argv
const write = rest.includes('--write')
const extraArgs = rest.filter((arg) => arg !== '--write')

if (manifestArg === undefined || rest.some((arg) => arg.startsWith('--') && arg !== '--write')) {
  console.error(
    'Usage: node scripts/flatten-subject-ids.mjs <workspace.yaml> [extra-file ...] [--write]',
  )
  process.exit(2)
}

const manifestPath = resolve(process.cwd(), manifestArg)
const base = dirname(manifestPath)

/** Expands the manifest's globs the way the workspace loader does. */
const expand = (patterns) => {
  const files = []
  for (const pattern of patterns ?? []) {
    const dir = resolve(base, dirname(pattern))
    const leaf = pattern.split('/').pop()
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries.sort()) {
      if (leaf === '*.yaml' ? name.endsWith('.yaml') : name === leaf) {
        const full = join(dir, name)
        try {
          if (statSync(full).isFile()) files.push(full)
        } catch {
          // Unreadable entries are the workspace loader's problem to report.
        }
      }
    }
  }
  return files
}

let manifest
try {
  manifest = parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error(`Cannot read ${manifestArg}: ${error.message}`)
  process.exit(2)
}
if (manifest?.format !== 'yarramate/workspace/v1') {
  console.error(`${manifestArg} is not a yarramate/workspace/v1 manifest`)
  process.exit(2)
}

// Every file the prefix could name, and every file that could carry a
// reference: documents declare and refer, the rest only refer.
const documentPaths = expand(manifest.documents)
const referringPaths = [
  ...documentPaths,
  ...expand(manifest.projections),
  ...expand(manifest.adapterMappings),
  ...expand(manifest.evidence),
  ...expand(manifest.contracts),
  ...extraArgs.map((arg) => resolve(process.cwd(), arg)),
]

const documentIds = new Set()
const declaredBy = new Map()
const collisions = []

for (const path of documentPaths) {
  let document
  try {
    document = parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`Cannot parse ${relative(process.cwd(), path)}: ${error.message}`)
    process.exit(1)
  }
  if (typeof document?.id !== 'string') continue
  documentIds.add(document.id)
  const declared = [
    ...(document.concepts ?? []),
    ...(document.relationships ?? []),
    ...(document.states ?? []),
  ]
  for (const item of declared) {
    if (typeof item?.id !== 'string') continue
    const first = declaredBy.get(item.id)
    if (first !== undefined && first !== path) {
      collisions.push({ id: item.id, first, second: path })
    } else {
      declaredBy.set(item.id, path)
    }
  }
}

if (collisions.length > 0) {
  console.error(
    `Refusing to flatten ${manifest.id}: ${collisions.length} id${collisions.length === 1 ? '' : 's'} declared by two documents. Flattening would merge distinct subjects, so rename one side first.\n`,
  )
  for (const { id, first, second } of collisions) {
    console.error(
      `  "${id}"\n      ${relative(process.cwd(), first)}\n      ${relative(process.cwd(), second)}`,
    )
  }
  process.exit(1)
}

// Only a prefix naming a document of this workspace is stripped, so a kind
// identity keeps its own `#` and so does anything else that merely looks alike.
const prefixes = [...documentIds].sort((a, b) => b.length - a.length)
const pattern = new RegExp(
  `(?<![A-Za-z0-9/@._-])(?:${prefixes.map((id) => id.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|')})#(?=[a-z])`,
  'g',
)

let changedFiles = 0
let changedRefs = 0
for (const path of referringPaths) {
  const source = readFileSync(path, 'utf8')
  const matches = source.match(pattern)
  if (matches === null) continue
  changedFiles++
  changedRefs += matches.length
  const rewritten = source.replace(pattern, '')
  if (write) writeFileSync(path, rewritten, 'utf8')
  console.log(
    `${write ? 'rewrote' : 'would rewrite'} ${relative(process.cwd(), path)} (${matches.length} reference${matches.length === 1 ? '' : 's'})`,
  )
}

console.log(
  `\n${write ? 'Flattened' : 'Would flatten'} ${changedRefs} reference${changedRefs === 1 ? '' : 's'} across ${changedFiles} file${changedFiles === 1 ? '' : 's'} in workspace "${manifest.id}".`,
)
if (!write && changedFiles > 0) console.log('Re-run with --write to apply, then `yarramate check`.')
