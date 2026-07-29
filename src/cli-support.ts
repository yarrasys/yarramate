import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import type { Diagnostic } from './compiler.js'
import { loadWorkspaceManifest } from './workspace.js'

export interface CliResult {
  readonly exitCode: 0 | 1 | 2
  readonly stdout: string
  readonly stderr: string
}

export const isMainModule = (
  moduleUrl: string,
  entrypoint: string | undefined,
): boolean => {
  if (entrypoint === undefined) return false
  try {
    return (
      realpathSync(fileURLToPath(moduleUrl)) ===
      realpathSync(entrypoint)
    )
  } catch {
    return false
  }
}

export const usage =
  'Usage:\n  yarramate init <directory>\n  yarramate add <document.yaml> --id <id> --kind <kind> --name <name> [--status <status>] [--description <text>] [--owner <ref>] [--constraint <id>=<ref> ...] [--reference <id>=<ref> ...] [--present-in <state-ref> ...] [--source <source.yaml> ...]\n  yarramate connect <document.yaml> --id <id> --kind <kind> --from <ref> --to <ref> [--name <name>] [--description <text>] [--status <status>] [--mode <mode>] [--content <text>] [--reference <id>=<ref> ...] [--present-in <state-ref> ...] [--source <source.yaml> ...]\n  yarramate check <source.yaml> [source.yaml ...] [--json]\n  yarramate status <workspace.yaml> [--json]\n  yarramate compile <source.yaml> [source.yaml ...]\n  yarramate context <projection.yaml> <source.yaml> [source.yaml ...] [--budget <tokens>]\n  yarramate context --subject <document-id>#<local-id> [--subject ...] <source.yaml> [source.yaml ...] [--budget <tokens>]\n  yarramate view <projection.yaml> <source.yaml> [source.yaml ...]\n  yarramate compare <from-state> <to-state> <source.yaml> [source.yaml ...]\n  yarramate evidence <evidence.yaml> <source.yaml> [source.yaml ...]\n  yarramate reconcile <workspace.yaml>\n'

export const diagnosticJson = (diagnostics: unknown) =>
  `${JSON.stringify(
    {
      format: 'yarramate/diagnostic-result/v1',
      diagnostics,
    },
    null,
    2,
  )}\n`

export const checkResultJson = (
  ok: boolean,
  diagnostics: unknown,
  counted?: {
    readonly documents: number
    readonly concepts: number
    readonly relationships: number
    readonly states: number
  },
) =>
  `${JSON.stringify(
    {
      format: 'yarramate/check-result/v1',
      ok,
      diagnostics,
      ...(counted === undefined ? {} : { counted }),
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
      readonly contracts: readonly string[]
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly Diagnostic[]
    } => {
  if (paths.length !== 1) {
    return {
      ok: true,
      paths,
      projections: [],
      evidence: [],
      contracts: [],
    }
  }
  const manifestPath = paths[0]
  if (manifestPath === undefined) {
    return {
      ok: true,
      paths,
      projections: [],
      evidence: [],
      contracts: [],
    }
  }
  const source = readFileSync(resolve(cwd, manifestPath), 'utf8')
  if (
    parseDocument(source).get('format') !== 'yarramate/workspace/v1'
  ) {
    return {
      ok: true,
      paths,
      projections: [],
      evidence: [],
      contracts: [],
    }
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
        contracts: loaded.workspace.contracts,
      }
    : { ok: false, diagnostics: loaded.diagnostics }
}
