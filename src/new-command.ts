import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { humanDiagnostics, usage, type CliResult } from './cli-support.js'
import { loadProjection } from './projection.js'

const singleValueFlags = new Set([
  '--id',
  '--version',
  '--title',
  '--description',
  '--relationships',
])
const repeatableFlags = new Set(['--document', '--subject', '--kind'])

const yamlText = (value: string): string =>
  /^[A-Za-z0-9][A-Za-z0-9 ._/@#-]*$/.test(value)
    ? value
    : JSON.stringify(value)

export function runNewCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const [family, target, ...flags] = options
  if (family !== 'projection' || target === undefined || target.startsWith('-')) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  const single = new Map<string, string>()
  const repeated = new Map<string, string[]>()
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index]
    const value = flags[index + 1]
    if (
      flag === undefined ||
      value === undefined ||
      value.startsWith('--') ||
      (!singleValueFlags.has(flag) && !repeatableFlags.has(flag))
    ) {
      return { exitCode: 2, stdout: '', stderr: usage }
    }
    if (singleValueFlags.has(flag)) {
      if (single.has(flag)) {
        return { exitCode: 2, stdout: '', stderr: usage }
      }
      single.set(flag, value)
    } else {
      repeated.set(flag, [...(repeated.get(flag) ?? []), value])
    }
  }

  const id = single.get('--id')
  if (id === undefined) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const documents = repeated.get('--document')
  const subjects = repeated.get('--subject')
  const kinds = repeated.get('--kind')
  if (documents === undefined && subjects === undefined && kinds === undefined) {
    return {
      exitCode: 2,
      stdout: '',
      stderr:
        'new projection requires at least one selector: --document, --subject, or --kind\n',
    }
  }

  const targetPath = resolve(cwd, target)
  if (existsSync(targetPath)) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${target} already exists; nothing was changed\n`,
    }
  }

  const lines: string[] = [
    'format: yarramate/projection/v1',
    `id: ${yamlText(id)}`,
    `version: "${single.get('--version') ?? '1.0'}"`,
    'query:',
  ]
  const list = (key: string, values: readonly string[] | undefined) => {
    if (values === undefined) return
    lines.push(`  ${key}:`)
    for (const value of values) lines.push(`    - ${yamlText(value)}`)
  }
  list('subjects', subjects)
  list('documents', documents)
  list('kinds', kinds)
  const relationships = single.get('--relationships')
  if (relationships !== undefined) {
    lines.push(`  relationships: ${yamlText(relationships)}`)
  }
  const title = single.get('--title')
  const description = single.get('--description')
  if (title !== undefined || description !== undefined) {
    lines.push('presentation:')
    if (title !== undefined) lines.push(`  title: ${yamlText(title)}`)
    if (description !== undefined) {
      lines.push(`  description: ${yamlText(description)}`)
    }
  }
  const source = `${lines.join('\n')}\n`

  const loaded = loadProjection({ path: target, source })
  if (!loaded.ok) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: humanDiagnostics(loaded.diagnostics),
    }
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, source, 'utf8')
  return {
    exitCode: 0,
    stdout:
      `Created ${target} (${loaded.projection.id}@${loaded.projection.version})\n` +
      'Include it in the workspace manifest projections list if no glob already covers it\n',
    stderr: '',
  }
}
