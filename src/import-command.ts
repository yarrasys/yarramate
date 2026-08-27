import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runApplyCommand } from './apply-cli.js'
import { humanDiagnostics, packageVersion, usage, type CliResult } from './cli-support.js'
import { compileWorkspaceWithProfileContext } from './compiler.js'
import { evaluateProjection } from './projection.js'
import { loadWorkspaceManifest } from './workspace.js'
import { buildWorkbookSheets } from './workbook.js'
import { baselineSheets, mergeWorkbook } from './workbook-merge.js'
import { operationsFrom, operationsDocument } from './workbook-operations.js'
import { readWorkbook } from './workbook-read.js'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'

/**
 * `yarramate import xlsx <file> <workspace.yaml>` (#355, ADR 0127).
 *
 * The workbook carries its own ancestor, so this is a three-way merge rather
 * than an overwrite: the author's edits are measured against `~Baseline`, the
 * repository's drift is measured against the same, and only a field both moved
 * is refused. Everything the author changed that the repository left alone
 * merges cleanly, which is what makes a week-long workbook cycle usable.
 *
 * Edits land as `yarramate/operations/v1` through `apply`, so untouched YAML
 * keeps its comments, key order and formatting, and the whole import passes
 * the atomic compile gate. A workbook that would produce an uncompilable model
 * is refused whole rather than half written.
 */
export async function runImportCommand(
  options: readonly string[],
  cwd: string,
): Promise<CliResult> {
  const [kind, ...rest] = options
  if (kind !== 'xlsx') return { exitCode: 2, stdout: '', stderr: usage }

  const json = rest.includes('--json')
  const positionals = rest.filter((option) => option !== '--json')
  const [workbookPath, workspacePath] = positionals
  if (
    positionals.length !== 2 ||
    workbookPath === undefined ||
    workspacePath === undefined
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  const manifestPath = resolve(cwd, workspacePath)
  let manifestSource: string
  let workbookBytes: Uint8Array
  try {
    manifestSource = readFileSync(manifestPath, 'utf8')
    workbookBytes = new Uint8Array(readFileSync(resolve(cwd, workbookPath)))
  } catch (cause) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${cause instanceof Error ? cause.message : String(cause)}\n`,
    }
  }

  const loaded = loadWorkspaceManifest(
    { path: workspacePath, source: manifestSource },
    cwd,
  )
  if (!loaded.ok) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: humanDiagnostics(loaded.diagnostics),
    }
  }
  const workspace = loaded.workspace
  const sources = [
    ...workspace.profiles,
    ...workspace.patterns,
    ...workspace.documents,
  ].map((path) => ({ path, source: readFileSync(resolve(cwd, path), 'utf8') }))
  const compilation = compileWorkspaceWithProfileContext(sources)
  if (!compilation.ok) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: humanDiagnostics(compilation.diagnostics),
    }
  }

  const read = await readWorkbook(workbookBytes)
  if (!read.ok) {
    return { exitCode: 1, stdout: '', stderr: `${read.reason}\n` }
  }
  const baselineRows = read.sheets.get('~Baseline')
  if (baselineRows === undefined) {
    // Without the ancestor there is no way to tell the author's edit from the
    // repository's drift, and guessing would silently discard one of them.
    return {
      exitCode: 1,
      stdout: '',
      stderr:
        'This workbook carries no ~Baseline sheet, so it was not produced by ' +
        '`yarramate export xlsx` and there is no ancestor to merge against.\n',
    }
  }

  const projectionId = read.sheets.get('~Meta')?.find((row) => row[0] === 'Projection')?.[1]
  const result = evaluateProjection(
    compilation.graph,
    {
      format: 'yarramate/projection/v1',
      id: projectionId ?? 'imported',
      version: '1.0',
      query: {},
    },
    compilation.profileContext,
  )
  const current = buildWorkbookSheets(result, {
    workspace: workspace.id,
    yarramateVersion: packageVersion,
    sourceDigests: {},
    conceptKinds: [],
    relationshipKinds: [],
    statuses: [],
  })

  const report = mergeWorkbook(read.sheets, baselineSheets(baselineRows), current)
  const planned = operationsFrom(report, read.sheets)

  if (report.conflicts.length > 0) {
    const lines = report.conflicts.map(
      ({ sheet, id, column, from, to, theirs }) =>
        `  ${sheet} "${id}" ${column}: you wrote ${JSON.stringify(to)}, ` +
        `the workspace now has ${JSON.stringify(theirs)}, both from ${JSON.stringify(from)}`,
    )
    return {
      exitCode: 1,
      stdout: '',
      stderr:
        `${report.conflicts.length} field${
          report.conflicts.length === 1 ? '' : 's'
        } changed in the workbook and in the workspace since the workbook was made. ` +
        'Nothing was written.\n' +
        `${lines.join('\n')}\n`,
    }
  }

  const notes = [
    ...planned.refusals.map((reason) => `  not imported: ${reason}`),
    ...report.missing.map(
      ({ sheet, id }) =>
        `  not imported: ${sheet} "${id}" is absent from the workbook; ` +
        'a missing row is never a deletion',
    ),
  ]

  if (planned.operations.length === 0) {
    const summary = `Nothing to import: the workbook matches the workspace.\n`
    return {
      exitCode: 0,
      stdout: json
        ? `${JSON.stringify({ format: 'yarramate/import-result/v1', operations: 0, notes }, null, 2)}\n`
        : summary + (notes.length > 0 ? `${notes.join('\n')}\n` : ''),
      stderr: '',
    }
  }

  // Handed to `apply` rather than written directly: one mutation path, one
  // atomic gate, and the surgical YAML editing that keeps comments.
  const scratch = mkdtempSync(join(tmpdir(), 'yarramate-import-'))
  const operationsPath = join(scratch, 'operations.yaml')
  writeFileSync(
    operationsPath,
    stringify(operationsDocument(planned.operations)),
    'utf8',
  )
  const applied = runApplyCommand([operationsPath, workspacePath], cwd)
  if (applied.exitCode !== 0) return applied

  const summary =
    `Imported ${planned.operations.length} change${
      planned.operations.length === 1 ? '' : 's'
    } from ${workbookPath}\n`
  return {
    exitCode: 0,
    stdout: json
      ? `${JSON.stringify(
          {
            format: 'yarramate/import-result/v1',
            operations: planned.operations.length,
            notes,
          },
          null,
          2,
        )}\n`
      : summary + (notes.length > 0 ? `${notes.join('\n')}\n` : ''),
    stderr: '',
  }
}
