import { globSync, realpathSync, statSync } from 'node:fs'
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import type { Diagnostic, WorkspaceSource } from './compiler.js'
import {
  diagnosticOrder,
  loadSourceDocument,
} from './source-document.js'
import workspaceSchema from '../schema/yarramate-workspace.schema.json' with {
  type: 'json',
}

// `.default ?? module`, not a bare `.default`: NodeNext sees the raw CJS
// `module.exports` and a bundler the unwrapped class. This file resolves a
// manifest's globs against a real filesystem and so is never bundled, but the
// two shapes cost one `??` and a reader should not have to work out which of
// the engine's four Ajv sites is the odd one.
const ajv2020Module = Ajv2020Module as unknown as {
  default?: typeof Ajv2020Module
} & typeof Ajv2020Module
const Ajv2020 = ajv2020Module.default ?? ajv2020Module
const validateWorkspace = new Ajv2020({ allErrors: true }).compile(
  workspaceSchema,
)

export interface WorkspaceManifest {
  readonly format: 'yarramate/workspace/v1'
  readonly id: string
  readonly documents: readonly string[]
  readonly profiles: readonly string[]
  readonly projections: readonly string[]
  readonly adapterMappings: readonly string[]
  readonly patterns?: readonly string[]
  readonly questions?: readonly string[]
  readonly evidence?: readonly string[]
  readonly contracts?: readonly string[]
  /**
   * Glob patterns naming the artifacts the model intends to cover (#175,
   * ADR 0130). Not a document category: nothing here is loaded or compiled,
   * so it never joins ResolvedWorkspace. reconcile resolves the patterns
   * against the root of the git repository the manifest lives in and reports
   * every selected file no evidence observation claims.
   */
  readonly coverage?: readonly string[]
}

export interface ResolvedWorkspace {
  readonly id: string
  readonly documents: readonly string[]
  readonly profiles: readonly string[]
  readonly projections: readonly string[]
  readonly adapterMappings: readonly string[]
  readonly patterns: readonly string[]
  /**
   * Question catalogues the workspace itself carries (#345, ADR 0129).
   * ADDITIVE to the shipped catalogue: `--catalogue` replaces the base, this
   * adds to it, which is what lets a consultant author a question mid
   * engagement without a product release.
   *
   * OPTIONAL in the type although `loadWorkspaceManifest` always populates it,
   * and that is deliberate. `ResolvedWorkspace` is published, and adding
   * `patterns` to it as a required field broke a consumer's production module:
   * a required field is free for readers and a break for CONSTRUCTORS. Six
   * fixtures in this repository construct one, which is the same signal from
   * inside. Read it as `workspace.questions ?? []`.
   */
  readonly questions?: readonly string[]
  readonly evidence: readonly string[]
  readonly contracts: readonly string[]
}

export type WorkspaceManifestResult =
  | {
      readonly ok: true
      readonly manifest: WorkspaceManifest
      readonly workspace: ResolvedWorkspace
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export function loadWorkspaceManifest(
  source: WorkspaceSource,
  cwd: string,
): WorkspaceManifestResult {
  const loaded = loadSourceDocument<WorkspaceManifest>(
    source,
    validateWorkspace,
    'Workspace',
  )
  if (!loaded.ok) return loaded
  const { value, yaml, lineCounter } = loaded.document

  const base = dirname(resolve(cwd, source.path))
  const realBase = realpathSync(base)
  const resolutionDiagnostics: Diagnostic[] = []
  const categoryByPath = new Map<string, string>()
  const positionOf = (field: string, index: number) => {
    const node = yaml.getIn([field, index], true)
    const offset =
      typeof node === 'object' &&
      node !== null &&
      'range' in node &&
      Array.isArray(node.range)
        ? node.range[0]
        : 0
    return lineCounter.linePos(offset)
  }
  const unsafePattern = (pattern: string): boolean =>
    isAbsolute(pattern) ||
    /^[A-Za-z]:[\\/]/.test(pattern) ||
    pattern.includes('\\') ||
    pattern.split('/').includes('..')
  const expand = (
    field:
      | 'documents'
      | 'profiles'
      | 'projections'
      | 'adapterMappings'
      | 'patterns'
      | 'questions'
      | 'evidence'
      | 'contracts',
    label: string,
    patterns: readonly string[],
  ) =>
    [
      ...new Set(
        patterns.flatMap((pattern, index) => {
          const position = positionOf(field, index)
          if (unsafePattern(pattern)) {
            resolutionDiagnostics.push({
              severity: 'error',
              code: 'YM701',
              message: `Workspace ${label} pattern "${pattern}" must be a relative path beneath the manifest directory`,
              path: source.path,
              pointer: `/${field}/${index}`,
              line: position.line,
              column: position.col,
            })
            return []
          }
          const matches = globSync(pattern, { cwd: base }).filter((path) =>
            statSync(resolve(base, path)).isFile(),
          )
          if (matches.length === 0) {
            resolutionDiagnostics.push({
              severity: 'error',
              code: 'YM702',
              message: `Workspace ${label} pattern "${pattern}" matched no files`,
              path: source.path,
              pointer: `/${field}/${index}`,
              line: position.line,
              column: position.col,
            })
          }
          const safeMatches = matches.filter((path) => {
            const realMatch = realpathSync(resolve(base, path))
            const withinBase =
              realMatch === realBase ||
              realMatch.startsWith(`${realBase}${sep}`)
            if (!withinBase) {
              resolutionDiagnostics.push({
                severity: 'error',
                code: 'YM701',
                message: `Workspace ${label} pattern "${pattern}" resolved outside the manifest directory`,
                path: source.path,
                pointer: `/${field}/${index}`,
                line: position.line,
                column: position.col,
              })
            }
            return withinBase
          })
          return safeMatches.map((path) => {
            const resolvedPath = relative(cwd, resolve(base, path))
              .split(sep)
              .join('/')
            const physicalPath = realpathSync(resolve(base, path))
            const previousLabel = categoryByPath.get(physicalPath)
            if (previousLabel !== undefined && previousLabel !== label) {
              resolutionDiagnostics.push({
                severity: 'error',
                code: 'YM703',
                message: `Resolved file "${resolvedPath}" is declared as both ${previousLabel} and ${label}`,
                path: source.path,
                pointer: `/${field}/${index}`,
                line: position.line,
                column: position.col,
              })
            } else {
              categoryByPath.set(physicalPath, label)
            }
            return resolvedPath
          })
        }),
      ),
    ].sort()
  const workspace = {
    id: value.id,
    documents: expand('documents', 'document', value.documents),
    profiles: expand('profiles', 'profile', value.profiles),
    projections: expand('projections', 'projection', value.projections),
    adapterMappings: expand(
      'adapterMappings',
      'adapter mapping',
      value.adapterMappings,
    ),
    patterns: expand('patterns', 'pattern', value.patterns ?? []),
    questions: expand('questions', 'question catalogue', value.questions ?? []),
    evidence: expand('evidence', 'evidence', value.evidence ?? []),
    contracts: expand(
      'contracts',
      'Core contract',
      value.contracts ?? [],
    ),
  }
  // Coverage patterns resolve to nothing here: they are not a document
  // category, and reconcile interprets them against the repository root
  // (ADR 0130). Load-time validation covers only pattern safety, with the
  // same guard every resolving category gets — but relative to the
  // repository, so escaping it is what YM701 refuses.
  for (const [index, pattern] of (value.coverage ?? []).entries()) {
    if (!unsafePattern(pattern)) continue
    const position = positionOf('coverage', index)
    resolutionDiagnostics.push({
      severity: 'error',
      code: 'YM701',
      message: `Workspace coverage pattern "${pattern}" must be a relative path beneath the repository root`,
      path: source.path,
      pointer: `/coverage/${index}`,
      line: position.line,
      column: position.col,
    })
  }
  if (resolutionDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: resolutionDiagnostics.sort(diagnosticOrder),
    }
  }
  return { ok: true, manifest: value, workspace }
}
