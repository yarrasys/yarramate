import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'
import type { Diagnostic } from './compiler.js'
import { loadWorkspaceManifest } from './workspace.js'

export interface CliResult {
  readonly exitCode: 0 | 1 | 2
  readonly stdout: string
  readonly stderr: string
}

export const usage =
  'Usage:\n  yarramate init <directory>\n  yarramate add <document.yaml> --id <id> --kind <kind> --name <name> [--status <status>] [--description <text>] [--owner <ref>] [--constraint <id>=<ref> ...] [--source <source.yaml> ...]\n  yarramate connect <document.yaml> --id <id> --kind <kind> --from <ref> --to <ref> [--name <name>] [--status <status>] [--mode <mode>] [--content <text>] [--source <source.yaml> ...]\n  yarramate check <source.yaml> [source.yaml ...] [--json]\n  yarramate compile <source.yaml> [source.yaml ...]\n  yarramate context <projection.yaml> <source.yaml> [source.yaml ...]\n  yarramate view <projection.yaml> <source.yaml> [source.yaml ...]\n  yarramate evidence <evidence.yaml> <source.yaml> [source.yaml ...]\n'

export const diagnosticJson = (diagnostics: unknown) =>
  `${JSON.stringify(
    {
      format: 'yarramate/diagnostic-result/v1',
      diagnostics,
    },
    null,
    2,
  )}\n`

export const checkResultJson = (ok: boolean, diagnostics: unknown) =>
  `${JSON.stringify(
    {
      format: 'yarramate/check-result/v1',
      ok,
      diagnostics,
    },
    null,
    2,
  )}\n`

export const humanDiagnostics = (
  diagnostics: readonly Pick<
    Diagnostic,
    'path' | 'line' | 'column' | 'code' | 'message'
  >[],
) =>
  diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.path}:${diagnostic.line}:${diagnostic.column} error ${diagnostic.code} ${diagnostic.message}\n`,
    )
    .join('')

export const sortDiagnostics = <T extends Diagnostic>(
  diagnostics: readonly T[],
) =>
  [...diagnostics].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  )

export const resolveCliWorkspaceSources = (
  paths: readonly string[],
  cwd: string,
  options: {
    readonly includeAdapterMappings?: boolean
  } = {},
):
  | {
      readonly ok: true
      readonly paths: readonly string[]
      readonly projections: readonly string[]
      readonly evidence: readonly string[]
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly Diagnostic[]
    } => {
  if (paths.length !== 1) {
    return { ok: true, paths, projections: [], evidence: [] }
  }
  const manifestPath = paths[0]
  if (manifestPath === undefined) {
    return { ok: true, paths, projections: [], evidence: [] }
  }
  const source = readFileSync(resolve(cwd, manifestPath), 'utf8')
  if (
    parseDocument(source).get('format') !== 'yarramate/workspace/v1'
  ) {
    return { ok: true, paths, projections: [], evidence: [] }
  }
  const loaded = loadWorkspaceManifest(
    { path: manifestPath, source },
    cwd,
  )
  return loaded.ok
    ? {
        ok: true,
        paths: [
          ...loaded.workspace.profiles,
          ...loaded.workspace.documents,
          ...(options.includeAdapterMappings === true
            ? loaded.workspace.adapterMappings
            : []),
        ],
        projections: loaded.workspace.projections,
        evidence: loaded.workspace.evidence,
      }
    : { ok: false, diagnostics: loaded.diagnostics }
}
