import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import type { Diagnostic } from './compiler.js'
import { loadWorkspaceManifest } from './workspace.js'
import packageManifest from '../package.json' with {
  type: 'json',
}

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

export const packageVersion: string = packageManifest.version

export const versionResult = (binary: string): CliResult => ({
  exitCode: 0,
  stdout: `${binary} ${packageVersion}\n`,
  stderr: '',
})

export const usage =
  'Usage:\n  yarramate init <directory> [--no-pointer]\n  yarramate design <workspace.yaml> [--subject <document-id>#<local-id>] [--catalogue <catalogue.yaml>] [--json]\n  yarramate apply <operations.yaml> <workspace.yaml> [--json]\n  yarramate ask <workspace.yaml> [--json]\n  yarramate ask <workspace.yaml> "<free text>" | <document-id>#<local-id> ... | <projection.yaml> [--budget <tokens>] [--json]\n  yarramate ask <workspace.yaml> --subjects [--kind <term>] [--status <status>] [--json]\n  yarramate ask <workspace.yaml> --kinds [--json]\n  yarramate ask <workspace.yaml> --advise "<topic>" [--budget <tokens>] [--catalogue <catalogue.yaml>] [--json]\n  yarramate ask <workspace.yaml> --next [--json]\n  yarramate ask <workspace.yaml> --open [--catalogue <catalogue.yaml>] [--json]\n  yarramate ask <workspace.yaml> --compare <from-state> <to-state> [--json]\n  yarramate check <source.yaml> [source.yaml ...] [--json] [--strict]\n  yarramate reconcile <workspace.yaml>\n  yarramate export graph <workspace.yaml> [--out <file>]\n  yarramate export markdown <projection.yaml> <workspace.yaml> [--out <file>]\n  yarramate export briefs <projection.yaml> <workspace.yaml> --out <directory> [--budget <tokens>]\n  yarramate export likec4 <likec4-project.yaml> <output-dir> <workspace.yaml>\n'

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
  strict?: {
    readonly observations: number
    readonly contradicted: number
  },
) =>
  `${JSON.stringify(
    {
      format: 'yarramate/check-result/v1',
      ok,
      diagnostics,
      ...(counted === undefined ? {} : { counted }),
      ...(strict === undefined ? {} : { strict }),
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
