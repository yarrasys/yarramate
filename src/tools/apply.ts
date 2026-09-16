import { landOperations, type ApplyOutcome } from '../apply-command.js'
import type { WorkspaceSource } from '../compiler.js'
import { emitYaml } from '../yaml-emission.js'
import {
  failed,
  guarded,
  refused,
  type ToolResult,
  type ToolWorkspace,
} from './workspace.js'

/** The `yarramate/apply-result/v1` document. */
export type ApplyResult = Extract<ApplyOutcome, { readonly ok: true }>['result']

/**
 * One `yarramate/operations/v1` document: YAML or JSON text, or the object
 * (serialised for you; JSON is YAML to the loader). Diagnostics point into
 * it as `/operations/<i>/<field>` and name `path`, so give it one; default
 * `operations.yaml`.
 */
export type OperationsInput =
  | string
  | { readonly path?: string; readonly source: string }
  | { readonly path?: string; readonly document: Record<string, unknown> }

const DEFAULT_OPERATIONS_PATH = 'operations.yaml'

export const operationsSourceOf = (
  operations: OperationsInput,
): WorkspaceSource | undefined => {
  if (typeof operations === 'string') {
    return { path: DEFAULT_OPERATIONS_PATH, source: operations }
  }
  if ('source' in operations && typeof operations.source === 'string') {
    return {
      path: operations.path ?? DEFAULT_OPERATIONS_PATH,
      source: operations.source,
    }
  }
  if ('document' in operations && typeof operations.document === 'object') {
    return {
      path: operations.path ?? DEFAULT_OPERATIONS_PATH,
      source: emitYaml(operations.document),
    }
  }
  return undefined
}

/**
 * `yarramate apply <operations.yaml> <ws> --json`, path-free: plan over the
 * store, compile the candidate, write all or nothing under compare-and-swap
 * (ADR 0100, 0103). `landOperations` already does this; this is it with the
 * input shapes a tool call carries. A refused `writeAll` comes back as
 * YM704/YM705 diagnostics, as the CLI reports it. No actor, by design: the
 * record's own `by` fields are the person's, and a history row is the
 * host's stamp beside the write.
 */
export const applyBatch = (
  workspace: ToolWorkspace,
  operations: OperationsInput,
): ToolResult<ApplyResult> =>
  guarded(() => {
    const source = operationsSourceOf(operations)
    if (source === undefined) {
      return refused(
        'apply needs `operations`: a yarramate/operations/v1 document as YAML or JSON text, or as an object.',
      )
    }
    const outcome = landOperations(workspace.store, {
      workspace: workspace.workspace,
      operations: source,
      manifestDirectory: workspace.manifestDirectory ?? '',
    })
    return outcome.ok
      ? { ok: true, result: outcome.result }
      : failed(outcome.diagnostics)
  })
