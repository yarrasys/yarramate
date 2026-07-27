import { globSync, realpathSync, statSync } from 'node:fs'
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import { LineCounter, parseDocument } from 'yaml'
import type { Diagnostic, WorkspaceSource } from './compiler.js'
import workspaceSchema from '../schema/yarramate-workspace.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
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
  readonly evidence?: readonly string[]
}

export interface ResolvedWorkspace {
  readonly id: string
  readonly documents: readonly string[]
  readonly profiles: readonly string[]
  readonly projections: readonly string[]
  readonly adapterMappings: readonly string[]
  readonly evidence: readonly string[]
}

export type WorkspaceManifestResult =
  | {
      readonly ok: true
      readonly manifest: WorkspaceManifest
      readonly workspace: ResolvedWorkspace
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

const diagnosticOrder = (left: Diagnostic, right: Diagnostic) =>
  left.path.localeCompare(right.path) ||
  left.line - right.line ||
  left.column - right.column ||
  left.code.localeCompare(right.code) ||
  left.message.localeCompare(right.message)

export function loadWorkspaceManifest(
  source: WorkspaceSource,
  cwd: string,
): WorkspaceManifestResult {
  const lineCounter = new LineCounter()
  const yaml = parseDocument(source.source, { lineCounter })
  if (yaml.errors.length > 0) {
    return {
      ok: false,
      diagnostics: yaml.errors.map((error) => {
        const position = error.linePos?.[0] ?? { line: 1, col: 1 }
        return {
          severity: 'error',
          code: 'YM101',
          message: error.message.split(' at line ')[0] ?? error.message,
          path: source.path,
          pointer: '/',
          line: position.line,
          column: position.col,
        }
      }),
    }
  }

  const value = yaml.toJS() as WorkspaceManifest
  if (!validateWorkspace(value)) {
    return {
      ok: false,
      diagnostics: (validateWorkspace.errors ?? [])
        .map((error): Diagnostic => {
          const property =
            error.keyword === 'additionalProperties'
              ? String(error.params.additionalProperty)
              : undefined
          const pointer = property
            ? `${error.instancePath}/${property}`
            : error.instancePath || '/'
          const yamlPath = pointer
            .split('/')
            .slice(1)
            .map((segment) =>
              /^\d+$/.test(segment) ? Number(segment) : segment,
            )
          const node = yaml.getIn(yamlPath, true)
          const offset =
            typeof node === 'object' &&
            node !== null &&
            'range' in node &&
            Array.isArray(node.range)
              ? node.range[0]
              : 0
          const position = lineCounter.linePos(offset)
          return {
            severity: 'error',
            code: 'YM201',
            message: property
              ? `Property "${property}" is not allowed`
              : `Workspace schema violation: ${error.message ?? error.keyword}`,
            path: source.path,
            pointer,
            line: position.line,
            column: position.col,
          }
        })
        .sort(diagnosticOrder),
    }
  }

  const base = dirname(resolve(cwd, source.path))
  const realBase = realpathSync(base)
  const resolutionDiagnostics: Diagnostic[] = []
  const categoryByPath = new Map<string, string>()
  const expand = (
    field:
      | 'documents'
      | 'profiles'
      | 'projections'
      | 'adapterMappings'
      | 'evidence',
    label: string,
    patterns: readonly string[],
  ) =>
    [
      ...new Set(
        patterns.flatMap((pattern, index) => {
          const node = yaml.getIn([field, index], true)
          const offset =
            typeof node === 'object' &&
            node !== null &&
            'range' in node &&
            Array.isArray(node.range)
              ? node.range[0]
              : 0
          const position = lineCounter.linePos(offset)
          const unsafe =
            isAbsolute(pattern) ||
            /^[A-Za-z]:[\\/]/.test(pattern) ||
            pattern.includes('\\') ||
            pattern.split('/').includes('..')
          if (unsafe) {
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
    evidence: expand('evidence', 'evidence', value.evidence ?? []),
  }
  if (resolutionDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: resolutionDiagnostics.sort(diagnosticOrder),
    }
  }
  return { ok: true, manifest: value, workspace }
}
