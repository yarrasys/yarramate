#!/usr/bin/env node
/**
 * Deterministic stand-in for the LikeC4 CLI.
 *
 * It emulates only the public command contract the visual compiler adapter
 * depends on — `validate --json --no-layout <root>` and
 * `export json --pretty -o <file> <root>` — so the adapter's own process
 * handling, diagnostic conversion, and promotion are exercised for real.
 *
 * Behaviour is selected by a `// fake:<marker>` comment inside a staged source
 * file, which keeps every failure mode a property of the model under
 * compilation rather than of a mocked adapter seam.
 */
import {
  appendFileSync,
  chmodSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const root = argv.at(-1)

const log = process.env.YARRAMATE_FAKE_LIKEC4_LOG
if (log !== undefined) appendFileSync(log, `${JSON.stringify(argv)}\n`)

const sourcesIn = (directory) =>
  readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return sourcesIn(path)
      return /\.(c4|likec4)$/.test(entry.name) ? [path] : []
    })

let marker = 'clean'
let markedFile = root
for (const source of sourcesIn(root)) {
  const found = /\/\/ fake:([a-z-]+)/.exec(readFileSync(source, 'utf8'))
  if (!found) continue
  marker = found[1]
  markedFile = source
  break
}

const exit = (status, stream, text) => {
  if (text !== undefined) writeSync(stream, text)
  process.exit(status)
}

if (argv[0] === 'validate') {
  switch (marker) {
    case 'hang':
      // Outlives any budget the adapter grants it.
      setInterval(() => {}, 1000)
      break
    case 'crash':
      exit(3, 2, 'fake-likec4: project not found\n')
      break
    case 'garbage':
      exit(1, 1, 'validation finished with 1 error\n')
      break
    case 'flood':
      for (let written = 0; written < 512 * 1024; written += 64 * 1024) {
        writeSync(1, 'x'.repeat(64 * 1024))
      }
      exit(0, 1)
      break
    case 'invalid':
      exit(
        1,
        1,
        JSON.stringify({
          success: false,
          diagnostics: [
            {
              severity: 1,
              message: 'Unresolved reference "ghost"',
              sourceFsPath: markedFile,
              range: {
                start: { line: 1, character: 4 },
                end: { line: 1, character: 9 },
              },
            },
          ],
        }),
      )
      break
    default:
      exit(0, 1, JSON.stringify({ success: true, diagnostics: [] }))
  }
} else if (argv[0] === 'export' && argv[1] === 'json') {
  const outfile = argv[argv.indexOf('-o') + 1]
  const exported = JSON.parse(
    readFileSync(new URL('./model.json', import.meta.url), 'utf8'),
  )
  if (marker === 'default-project') {
    // What the real CLI writes for two projects: a bare array. A staged
    // configuration resolves the named project beside an empty default one.
    writeFileSync(
      outfile,
      JSON.stringify(
        [exported, { ...exported, projectId: 'default', views: {} }],
        null,
        2,
      ),
    )
  } else if (marker === 'ambiguous-projects') {
    writeFileSync(
      outfile,
      JSON.stringify(
        [
          { ...exported, projectId: 'other' },
          { ...exported, projectId: 'another' },
        ],
        null,
        2,
      ),
    )
  } else if (marker === 'one-project') {
    writeFileSync(outfile, JSON.stringify([exported], null, 2))
  } else if (marker === 'malformed-export') writeFileSync(outfile, '{"views": ')
  else if (marker === 'no-views') {
    writeFileSync(outfile, JSON.stringify({ ...exported, views: {} }, null, 2))
  } else if (marker === 'huge-export') {
    const padded = { ...exported, _padding: 'x'.repeat(64 * 1024) }
    writeFileSync(outfile, JSON.stringify(padded, null, 2))
  } else writeFileSync(outfile, JSON.stringify(exported, null, 2))
  // The real CLI creates its output under the ambient umask, which on an
  // ordinary developer or CI account leaves the document group- and
  // world-readable. Stating the mode here makes the adapter's hardening
  // observable however restrictive the umask running this suite happens to be.
  chmodSync(outfile, 0o644)
  exit(0, 1)
} else {
  exit(64, 2, `fake-likec4: unsupported command "${argv.join(' ')}"\n`)
}
