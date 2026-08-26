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
  'Usage:\n  yarramate init <directory> [--no-pointer]\n  yarramate design <workspace.yaml> [--subject <subject-id>] [--catalogue <catalogue.yaml>] [--facilitate] [--json]\n  yarramate apply <operations.yaml> <workspace.yaml> [--json]\n  yarramate ask <workspace.yaml> [--json]\n  yarramate ask <workspace.yaml> "<free text>" | <subject-id> ... | <projection.yaml> [--budget <tokens>] [--neighbours <n>] [--json]\n  yarramate ask <workspace.yaml> --subjects [--kind <term>] [--status <status>] [--json]\n  yarramate ask <workspace.yaml> --kinds [--json]\n  yarramate ask <workspace.yaml> --advise "<topic>" [--budget <tokens>] [--neighbours <n>] [--catalogue <catalogue.yaml>] [--json]\n  yarramate ask <workspace.yaml> --where "<free text>" | <subject-id> ... [--json]\n  yarramate ask <workspace.yaml> --next [--json]\n  yarramate ask <workspace.yaml> --open [--catalogue <catalogue.yaml>] [--json]\n  yarramate ask <workspace.yaml> --compare <from-state> <to-state> [--json]\n  yarramate ask <workspace.yaml> --changed <git-range> [--budget <tokens>] [--neighbours <n>] [--json]\n  yarramate check <source.yaml> [source.yaml ...] [--json] [--strict]\n  yarramate reconcile <workspace.yaml> [--json]\n  yarramate export graph <workspace.yaml> [--out <file>]\n  yarramate export markdown <projection.yaml> <workspace.yaml> [--out <file>]\n  yarramate export markdown --changed <git-range> <workspace.yaml> [--out <file>]\n  yarramate export briefs <projection.yaml> <workspace.yaml> --out <directory> [--budget <tokens>]\n  yarramate export briefs --changed <git-range> <workspace.yaml> --out <directory> [--budget <tokens>]\n  yarramate export rtm <workspace.yaml> --out <directory>\n  yarramate export xlsx <projection.yaml> <workspace.yaml> --out <file>\n  yarramate export likec4 <likec4-project.yaml> <output-dir> <workspace.yaml> [--changed <git-range>]\n'

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
      /** Pattern documents, which ride in `paths` and are not documents. */
      readonly patterns: readonly string[]
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
      patterns: [],
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
      patterns: [],
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
      patterns: [],
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
          // Patterns are compiler input like profiles, and were resolved from
          // the manifest without ever being handed over (#268): a pattern
          // document a workspace declared was silently ignored by every verb,
          // and an instance binding parts then failed YM419 for a pattern that
          // was sitting right there in the manifest. Every test passed because
          // each hands the compiler an explicit source list rather than
          // resolving a workspace - the check that passes was not the check
          // that mattered.
          ...loaded.workspace.patterns,
          ...loaded.workspace.documents,
          ...(options.includeAdapterMappings === true
            ? loaded.workspace.adapterMappings
            : []),
        ],
        projections: loaded.workspace.projections,
        evidence: loaded.workspace.evidence,
        contracts: loaded.workspace.contracts,
        patterns: loaded.workspace.patterns,
      }
    : { ok: false, diagnostics: loaded.diagnostics }
}
