#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileWorkspace } from './compiler.js'

export interface CliResult {
  readonly exitCode: 0 | 1 | 2
  readonly stdout: string
  readonly stderr: string
}

const usage =
  'Usage: yarramate check <document.yaml> [document.yaml ...] [--json]\n'

export function runCli(
  args: readonly string[],
  cwd: string = process.cwd(),
): CliResult {
  const [command, ...options] = args
  if (command !== 'check') {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  const json = options.includes('--json')
  const paths = options.filter((option) => option !== '--json')
  const unknownOption = paths.find((path) => path.startsWith('-'))
  if (unknownOption !== undefined || paths.length === 0) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const result = compileWorkspace(
      paths.map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })),
    )

    if (json) {
      const output = result.ok
        ? { ok: true, diagnostics: [] }
        : { ok: false, diagnostics: result.diagnostics }
      return {
        exitCode: result.ok ? 0 : 1,
        stdout: `${JSON.stringify(output, null, 2)}\n`,
        stderr: '',
      }
    }

    if (result.ok) {
      const noun = paths.length === 1 ? 'document' : 'documents'
      return {
        exitCode: 0,
        stdout: `Checked ${paths.length} ${noun}: no errors\n`,
        stderr: '',
      }
    }

    return {
      exitCode: 1,
      stdout: result.diagnostics
        .map(
          (diagnostic) =>
            `${diagnostic.path}:${diagnostic.line}:${diagnostic.column} error ${diagnostic.code} ${diagnostic.message}\n`,
        )
        .join(''),
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

const entrypoint = process.argv[1]
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  const result = runCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
