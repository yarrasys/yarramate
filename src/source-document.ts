import type { ValidateFunction } from 'ajv'
import { LineCounter, parseDocument } from 'yaml'
import type {
  Diagnostic,
  WorkspaceSource,
} from './compiler.js'

export interface SourceLocation {
  readonly path: string
  readonly pointer: string
  readonly line: number
  readonly column: number
}

export interface ValidatedSourceDocument<T> {
  readonly value: T
  readonly yaml: ReturnType<typeof parseDocument>
  readonly lineCounter: LineCounter
}

export type SourceDocumentResult<T> =
  | { readonly ok: true; readonly document: ValidatedSourceDocument<T> }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export const diagnosticOrder = (left: Diagnostic, right: Diagnostic) =>
  left.path.localeCompare(right.path) ||
  left.line - right.line ||
  left.column - right.column ||
  left.code.localeCompare(right.code) ||
  left.message.localeCompare(right.message)

export function locateSourcePath(
  sourcePath: string,
  yaml: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
  yamlPath: readonly (string | number)[],
  pointer: string,
): SourceLocation {
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
    path: sourcePath,
    pointer,
    line: position.line,
    column: position.col,
  }
}

export function loadSourceDocument<T>(
  source: WorkspaceSource,
  validate: ValidateFunction,
  schemaLabel: string,
): SourceDocumentResult<T> {
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

  const value = yaml.toJS()
  if (!validate(value)) {
    return {
      ok: false,
      diagnostics: (validate.errors ?? [])
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
          const location = locateSourcePath(
            source.path,
            yaml,
            lineCounter,
            yamlPath,
            pointer,
          )
          return {
            severity: 'error',
            code: 'YM201',
            message: property
              ? `Property "${property}" is not allowed`
              : `${schemaLabel} schema violation: ${error.message ?? error.keyword}`,
            ...location,
          }
        })
        .sort(diagnosticOrder),
    }
  }

  return {
    ok: true,
    document: {
      value: value as T,
      yaml,
      lineCounter,
    },
  }
}
