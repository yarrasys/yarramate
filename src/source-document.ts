import type { ErrorObject, ValidateFunction } from 'ajv'
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

export const describeSchemaViolation = (
  error: Pick<ErrorObject, 'keyword' | 'message' | 'params'>,
): string => {
  const base = error.message ?? error.keyword
  if (error.keyword === 'const') {
    return `${base}: expected ${JSON.stringify(error.params.allowedValue)}`
  }
  if (
    error.keyword === 'enum' &&
    Array.isArray(error.params.allowedValues)
  ) {
    const allowed = error.params.allowedValues as readonly unknown[]
    const shown = allowed
      .slice(0, 8)
      .map((value) => JSON.stringify(value))
      .join(', ')
    return `${base}: ${shown}${allowed.length > 8 ? ', …' : ''}`
  }
  return base
}

const editDistance = (left: string, right: string): number => {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  )
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]!
    previous[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j]!
      previous[j] = Math.min(
        above + 1,
        previous[j - 1]! + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return previous[right.length]!
}

export const closestCandidate = (
  value: string,
  candidates: Iterable<string>,
): string | undefined => {
  const threshold = Math.max(2, Math.floor(value.length / 4))
  let best: string | undefined
  let bestDistance = threshold + 1
  for (const candidate of [...candidates].sort()) {
    const distance = editDistance(
      value.toLowerCase(),
      candidate.toLowerCase(),
    )
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

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
              : `${schemaLabel} schema violation: ${describeSchemaViolation(error)}`,
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
