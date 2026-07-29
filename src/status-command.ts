import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { runCheckCommand } from './check-command.js'
import {
  diagnosticJson,
  humanDiagnostics,
  usage,
  type CliResult,
} from './cli-support.js'
import { compileWorkspace, type Diagnostic } from './compiler.js'
import { evaluateEvidenceWorkspace, loadEvidence } from './evidence.js'
import { loadProjection } from './projection.js'
import {
  reconcileEvidenceReports,
  type ReconciliationReport,
} from './reconciliation.js'
import { loadWorkspaceManifest } from './workspace.js'

interface StatusInventory {
  readonly documents: readonly { readonly id: string; readonly path: string }[]
  readonly profiles: readonly string[]
  readonly states: readonly { readonly id: string; readonly type: string }[]
  readonly projections: readonly {
    readonly id: string
    readonly path: string
    readonly title?: string
  }[]
  readonly evidence: readonly string[]
  readonly adapterMappings: readonly string[]
  readonly contracts: readonly string[]
}

interface StatusResult {
  readonly format: 'yarramate/status-result/v1'
  readonly workspace: string
  readonly ok: boolean
  readonly check: {
    readonly ok: boolean
    readonly diagnostics: readonly Diagnostic[]
    readonly counted?: {
      readonly documents: number
      readonly concepts: number
      readonly relationships: number
      readonly states: number
    }
  }
  readonly reconciliation?: ReconciliationReport['summary']
  readonly inventory: StatusInventory
}

const plural = (count: number, singular: string, pluralForm?: string) =>
  `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`

export function runStatusCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const json = options.includes('--json')
  const paths = options.filter((option) => option !== '--json')
  const [workspacePath] = paths
  if (
    paths.length !== 1 ||
    workspacePath === undefined ||
    workspacePath.startsWith('-')
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const manifestSource = readFileSync(
      resolve(cwd, workspacePath),
      'utf8',
    )
    if (
      parseDocument(manifestSource).get('format') !==
      'yarramate/workspace/v1'
    ) {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          'status requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
    const loadedWorkspace = loadWorkspaceManifest(
      { path: workspacePath, source: manifestSource },
      cwd,
    )
    if (!loadedWorkspace.ok) {
      return {
        exitCode: 1,
        stdout: json
          ? diagnosticJson(loadedWorkspace.diagnostics)
          : humanDiagnostics(loadedWorkspace.diagnostics),
        stderr: '',
      }
    }
    const workspace = loadedWorkspace.workspace

    const checked = runCheckCommand([workspacePath, '--json'], cwd)
    const checkPayload = JSON.parse(checked.stdout) as {
      readonly ok: boolean
      readonly diagnostics: readonly Diagnostic[]
      readonly counted?: StatusResult['check']['counted']
    }

    const projections = workspace.projections.map((path) => {
      const loaded = loadProjection({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })
      return loaded.ok
        ? {
            id: loaded.projection.id,
            path,
            ...(loaded.projection.presentation?.title === undefined
              ? {}
              : { title: loaded.projection.presentation.title }),
          }
        : { id: path, path }
    })

    let documents: StatusInventory['documents'] = workspace.documents.map(
      (path) => ({ id: path, path }),
    )
    let states: StatusInventory['states'] = []
    let reconciliation: ReconciliationReport['summary'] | undefined
    if (checkPayload.ok) {
      const compilation = compileWorkspace(
        [...workspace.profiles, ...workspace.documents].map((path) => ({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
        })),
      )
      if (compilation.ok) {
        const sourceByDocument = new Map(
          compilation.graph.documents.map((document) => [
            document.id,
            document.source,
          ]),
        )
        documents = workspace.documents.map((path) => {
          const id = [...sourceByDocument.entries()].find(
            ([, source]) => source === path,
          )?.[0]
          return { id: id ?? path, path }
        })
        states = compilation.graph.claims
          .filter(
            ({ predicate }) => predicate === 'yarramate/state/type',
          )
          .map(({ subject, object }) => ({
            id: subject,
            type:
              'value' in object && typeof object.value === 'string'
                ? object.value
                : 'baseline',
          }))
        if (workspace.evidence.length > 0) {
          const evidenceDocuments = workspace.evidence.flatMap(
            (path) => {
              const loaded = loadEvidence({
                path,
                source: readFileSync(resolve(cwd, path), 'utf8'),
              })
              return loaded.ok ? [loaded.evidence] : []
            },
          )
          const evaluation = evaluateEvidenceWorkspace(
            compilation.graph,
            evidenceDocuments,
          )
          if (evaluation.ok) {
            reconciliation = reconcileEvidenceReports(
              workspace.id,
              evaluation.reports,
              compilation.graph,
            ).summary
          }
        }
      }
    }

    const result: StatusResult = {
      format: 'yarramate/status-result/v1',
      workspace: workspace.id,
      ok: checkPayload.ok,
      check: {
        ok: checkPayload.ok,
        diagnostics: checkPayload.ok ? [] : checkPayload.diagnostics,
        ...(checkPayload.counted === undefined
          ? {}
          : { counted: checkPayload.counted }),
      },
      ...(reconciliation === undefined ? {} : { reconciliation }),
      inventory: {
        documents,
        profiles: workspace.profiles,
        states,
        projections,
        evidence: workspace.evidence,
        adapterMappings: workspace.adapterMappings,
        contracts: workspace.contracts,
      },
    }

    if (json) {
      return {
        exitCode: result.ok ? 0 : 1,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: '',
      }
    }

    const lines: string[] = []
    const counted = result.check.counted
    lines.push(
      `Workspace ${result.workspace}: check ${result.ok ? 'ok' : 'failing'}` +
        (counted === undefined
          ? ''
          : ` (${plural(counted.concepts, 'concept')}, ` +
            `${plural(counted.relationships, 'relationship')}, ` +
            `${plural(counted.states, 'state')}, ` +
            `${plural(counted.documents, 'document')})`),
    )
    if (!result.ok) {
      lines.push(
        `Diagnostics: ${plural(result.check.diagnostics.length, 'error')}; run \`yarramate check ${workspacePath}\` for details`,
      )
    }
    if (result.reconciliation !== undefined) {
      lines.push(
        `Reconciliation: ${plural(result.reconciliation.observations, 'observation')}, ` +
          `${result.reconciliation.confirmed} confirmed, ` +
          `${plural(result.reconciliation.findings, 'finding')}` +
          (result.reconciliation.findings > 0
            ? ` (${result.reconciliation.contradicted} contradicted, ` +
              `${result.reconciliation.unknown} unknown, ` +
              `${result.reconciliation.notObserved} not observed)`
            : ''),
      )
    }
    lines.push(
      `Documents: ${documents.map(({ id }) => id).join(', ') || 'none'}`,
    )
    if (states.length > 0) {
      lines.push(
        `States: ${states.map(({ id, type }) => `${id} (${type})`).join(', ')}`,
      )
    }
    lines.push(
      `Projections: ${
        projections
          .map(({ id, title }) =>
            title === undefined ? id : `${id} — ${title}`,
          )
          .join('; ') || 'none'
      }`,
    )
    lines.push(
      `Profiles: ${workspace.profiles.length} · ` +
        `Evidence: ${workspace.evidence.length} · ` +
        `Adapter mappings: ${workspace.adapterMappings.length} · ` +
        `Contracts: ${workspace.contracts.length}`,
    )
    return {
      exitCode: result.ok ? 0 : 1,
      stdout: `${lines.join('\n')}\n`,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
