import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import { parseDocument } from 'yaml'
import {
  loadAdapterMapping,
  validateAdapterMappings,
} from './adapter-mapping.js'
import {
  checkResultJson,
  humanDiagnostics,
  resolveCliWorkspaceSources,
  sortDiagnostics,
  usage,
  type CliResult,
} from './cli-support.js'
import { compileWorkspace } from './compiler.js'
import {
  checkCoreContract,
  loadCoreContract,
} from './core-contract.js'
import {
  evaluateEvidenceWorkspace,
  loadEvidence,
} from './evidence.js'
import { loadProjection } from './projection.js'
import {
  reconcileEvidenceReports,
  type ReconciliationFinding,
} from './reconciliation.js'

const Ajv2020 = Ajv2020Module.default

const strictFindingMessage = (finding: ReconciliationFinding): string => {
  const observed =
    finding.evidence.message === undefined
      ? finding.evidence.uri
      : `${finding.evidence.uri}: ${finding.evidence.message}`
  const assertion =
    finding.asserted === undefined
      ? `Evidence contradicts ${finding.target.type} "${finding.target.id}"`
      : `Evidence contradicts claim "${finding.target.id}": the model asserts ` +
        `${finding.asserted.from} -> ${finding.asserted.to} (${finding.asserted.kind})`
  return (
    `${assertion}, but provider "${finding.provider}" observed otherwise ` +
    `(${observed}); align the model or the evidence to pass --strict`
  )
}

export function runCheckCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const json = options.includes('--json')
  const strict = options.includes('--strict')
  const paths = options.filter(
    (option) => option !== '--json' && option !== '--strict',
  )
  const unknownOption = paths.find((path) => path.startsWith('-'))
  if (unknownOption !== undefined || paths.length === 0) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const resolved = resolveCliWorkspaceSources(paths, cwd, {
      includeAdapterMappings: true,
    })
    if (!resolved.ok) {
      const output = json
        ? checkResultJson(false, resolved.diagnostics)
        : humanDiagnostics(resolved.diagnostics)
      return { exitCode: 1, stdout: output, stderr: '' }
    }
    const contractDiagnostics = sortDiagnostics(
      resolved.contracts.flatMap((path) => {
        const source = {
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
        }
        const loaded = loadCoreContract(source)
        if (!loaded.ok) return loaded.diagnostics
        let packageManifest: unknown
        try {
          packageManifest = JSON.parse(
            readFileSync(
              resolve(cwd, loaded.contract.packageManifest),
              'utf8',
            ),
          )
        } catch {
          packageManifest = undefined
        }
        const packageRecord =
          typeof packageManifest === 'object' &&
          packageManifest !== null &&
          !Array.isArray(packageManifest)
            ? (packageManifest as Record<string, unknown>)
            : undefined
        const exportsRecord =
          typeof packageRecord?.exports === 'object' &&
          packageRecord.exports !== null
            ? Object.fromEntries(
                Object.entries(
                  packageRecord.exports as Record<string, unknown>,
                ).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === 'string',
                ),
              )
            : {}
        const binaries =
          typeof packageRecord?.bin === 'object' &&
          packageRecord.bin !== null
            ? Object.keys(packageRecord.bin)
            : typeof packageRecord?.bin === 'string' &&
                typeof packageRecord.name === 'string'
              ? [packageRecord.name]
              : []
        const schemas: Record<
          string,
          { readonly ok: false } | {
            readonly ok: true
            readonly format?: string
            readonly validSchema: boolean
          }
        > = {}
        for (const { schema } of loaded.contract.formats) {
          if (!existsSync(resolve(cwd, schema))) continue
          try {
            const value = JSON.parse(
              readFileSync(resolve(cwd, schema), 'utf8'),
            ) as unknown
            const record =
              typeof value === 'object' && value !== null
                ? (value as Record<string, unknown>)
                : undefined
            const properties =
              typeof record?.properties === 'object' &&
              record.properties !== null
                ? (record.properties as Record<string, unknown>)
                : undefined
            const format =
              typeof properties?.format === 'object' &&
              properties.format !== null
                ? (properties.format as Record<string, unknown>)
                : undefined
            let validSchema = true
            try {
              new Ajv2020({ strict: false }).compile(value as object)
            } catch {
              validSchema = false
            }
            schemas[schema] = {
              ok: true,
              validSchema,
              ...(typeof format?.const === 'string'
                ? { format: format.const }
                : {}),
            }
          } catch {
            schemas[schema] = { ok: false }
          }
        }
        const checked = checkCoreContract(source, {
          files: [
            loaded.contract.packageManifest,
            ...loaded.contract.formats.map(({ schema }) => schema),
          ].filter((file) => existsSync(resolve(cwd, file))),
          packageManifestValid: packageRecord !== undefined,
          packageExports: exportsRecord,
          packageBinaries: binaries,
          schemas,
        })
        return checked.ok ? [] : checked.diagnostics
      }),
    )
    if (contractDiagnostics.length > 0) {
      const output = json
        ? checkResultJson(false, contractDiagnostics)
        : humanDiagnostics(contractDiagnostics)
      return { exitCode: 1, stdout: output, stderr: '' }
    }
    const projectionDiagnostics = sortDiagnostics(
      resolved.projections.flatMap((path) => {
        const loaded = loadProjection({
          path,
          source: readFileSync(resolve(cwd, path), 'utf8'),
        })
        return loaded.ok ? [] : loaded.diagnostics
      }),
    )
    if (projectionDiagnostics.length > 0) {
      const output = json
        ? checkResultJson(false, projectionDiagnostics)
        : humanDiagnostics(projectionDiagnostics)
      return { exitCode: 1, stdout: output, stderr: '' }
    }
    const loadedEvidence = resolved.evidence.map((path) =>
      loadEvidence({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      }),
    )
    const evidenceLoadDiagnostics = sortDiagnostics(
      loadedEvidence.flatMap((loaded) =>
        loaded.ok ? [] : loaded.diagnostics,
      ),
    )
    if (evidenceLoadDiagnostics.length > 0) {
      const output = json
        ? checkResultJson(false, evidenceLoadDiagnostics)
        : humanDiagnostics(evidenceLoadDiagnostics)
      return { exitCode: 1, stdout: output, stderr: '' }
    }
    const sources = resolved.paths.map((path) => ({
      path,
      source: readFileSync(resolve(cwd, path), 'utf8'),
    }))
    const mappingSources = sources.filter(
      ({ source }) =>
        parseDocument(source).get('format') ===
        'yarramate/adapter-mapping/v1',
    )
    const coreSources = sources.filter(
      (source) => !mappingSources.includes(source),
    )
    const loadedMappings = mappingSources.map((source) =>
      loadAdapterMapping(source),
    )
    const mappingLoadDiagnostics = sortDiagnostics(
      loadedMappings.flatMap((loaded) =>
        loaded.ok ? [] : loaded.diagnostics,
      ),
    )
    if (mappingLoadDiagnostics.length > 0) {
      const output = json
        ? checkResultJson(false, mappingLoadDiagnostics)
        : humanDiagnostics(mappingLoadDiagnostics)
      return { exitCode: 1, stdout: output, stderr: '' }
    }

    const result = compileWorkspace(coreSources)
    const mappingValidation = result.ok
      ? validateAdapterMappings(
          result.graph,
          loadedMappings.flatMap((loaded) =>
            loaded.ok ? [loaded.mapping] : [],
          ),
        )
      : undefined
    const mappingDiagnostics =
      mappingValidation === undefined || mappingValidation.ok
        ? []
        : mappingValidation.diagnostics
    const evidenceEvaluation = result.ok
      ? evaluateEvidenceWorkspace(
          result.graph,
          loadedEvidence.flatMap((loaded) =>
            loaded.ok ? [loaded.evidence] : [],
          ),
        )
      : undefined
    const evidenceDiagnostics =
      evidenceEvaluation === undefined || evidenceEvaluation.ok
        ? []
        : evidenceEvaluation.diagnostics
    const optionalDiagnostics = sortDiagnostics([
      ...mappingDiagnostics,
      ...evidenceDiagnostics,
    ])
    const ok = result.ok && optionalDiagnostics.length === 0
    const diagnostics = result.ok
      ? optionalDiagnostics
      : result.diagnostics

    // Strict only tightens a passing check: base diagnostics already fail
    // the gate, so contradictions are folded in only once everything else
    // holds, and each one is anchored at the claim the model declares.
    const strictEvaluation =
      strict && result.ok && ok
        ? (() => {
            const reports =
              evidenceEvaluation !== undefined && evidenceEvaluation.ok
                ? evidenceEvaluation.reports
                : []
            const graph = result.graph
            const contradicted = reconcileEvidenceReports(
              'strict',
              reports,
              graph,
            ).findings.filter(({ result: outcome }) => outcome === 'contradicted')
            return {
              observations: reports.reduce(
                (total, report) => total + report.observations.length,
                0,
              ),
              diagnostics: sortDiagnostics(
                contradicted.map((finding) => {
                  const anchor =
                    graph.claims.find(({ id }) => id === finding.target.id) ??
                    graph.claims.find(
                      ({ subject, predicate }) =>
                        subject === finding.target.id &&
                        predicate === 'yarramate/concept/kind',
                    ) ??
                    graph.claims.find(
                      ({ subject }) => subject === finding.target.id,
                    )
                  return {
                    severity: 'error' as const,
                    code: 'YM901',
                    message: strictFindingMessage(finding),
                    path: anchor?.source.path ?? finding.evidenceDocument,
                    pointer: anchor?.source.pointer ?? '/',
                    line: anchor?.source.line ?? 1,
                    column: anchor?.source.column ?? 1,
                  }
                }),
              ),
            }
          })()
        : undefined
    const strictSummary =
      strictEvaluation === undefined
        ? undefined
        : {
            observations: strictEvaluation.observations,
            contradicted: strictEvaluation.diagnostics.length,
          }
    const strictOk = strictEvaluation === undefined
      ? true
      : strictEvaluation.diagnostics.length === 0
    const finalOk = ok && strictOk

    const counted = result.ok
      ? (() => {
          const states = new Set(
            result.graph.claims
              .filter(
                ({ predicate }) =>
                  predicate === 'yarramate/state/type',
              )
              .map(({ subject }) => subject),
          )
          return {
            documents: result.graph.documents.length,
            concepts: result.graph.subjects.filter(
              ({ id, type }) => type === 'concept' && !states.has(id),
            ).length,
            relationships: result.graph.subjects.filter(
              ({ type }) => type === 'relationship',
            ).length,
            states: states.size,
          }
        })()
      : undefined

    if (json) {
      return {
        exitCode: finalOk ? 0 : 1,
        stdout: checkResultJson(
          finalOk,
          finalOk ? [] : ok ? strictEvaluation!.diagnostics : diagnostics,
          finalOk ? counted : undefined,
          strictSummary,
        ),
        stderr: '',
      }
    }

    if (ok && !strictOk) {
      return {
        exitCode: 1,
        stdout: humanDiagnostics(strictEvaluation!.diagnostics),
        stderr: '',
      }
    }

    if (ok && result.ok) {
      const successfulCounts = counted!
      const documentCount = result.graph.documents.length
      const profileCount = coreSources.length - documentCount
      const mappingCount = mappingSources.length
      const projectionCount = resolved.projections.length
      const evidenceCount = resolved.evidence.length
      const contractCount = resolved.contracts.length
      const checked = [
        `${documentCount} ${documentCount === 1 ? 'document' : 'documents'}`,
        ...(profileCount > 0
          ? [
              `${profileCount} ${profileCount === 1 ? 'profile' : 'profiles'}`,
            ]
          : []),
        ...(mappingCount > 0
          ? [
              `${mappingCount} ${mappingCount === 1 ? 'adapter mapping' : 'adapter mappings'}`,
            ]
          : []),
        ...(projectionCount > 0
          ? [
              `${projectionCount} ${projectionCount === 1 ? 'projection' : 'projections'}`,
            ]
          : []),
        ...(evidenceCount > 0
          ? [
              `${evidenceCount} ${evidenceCount === 1 ? 'evidence document' : 'evidence documents'}`,
            ]
          : []),
        ...(contractCount > 0
          ? [
              `${contractCount} ${contractCount === 1 ? 'Core contract' : 'Core contracts'}`,
            ]
          : []),
      ].join(' and ')
      const strictLine =
        strictSummary === undefined
          ? ''
          : strictSummary.observations === 0
            ? 'Strict: no evidence observations to evaluate\n'
            : `Strict: ${strictSummary.observations} ${strictSummary.observations === 1 ? 'observation' : 'observations'}, 0 contradicted\n`
      return {
        exitCode: 0,
        stdout:
          `Checked ${checked} (` +
          `${successfulCounts.concepts} ${successfulCounts.concepts === 1 ? 'concept' : 'concepts'}, ` +
          `${successfulCounts.relationships} ${successfulCounts.relationships === 1 ? 'relationship' : 'relationships'}, ` +
          `${successfulCounts.states} ${successfulCounts.states === 1 ? 'state' : 'states'}` +
          '): no errors\n' +
          strictLine,
        stderr: '',
      }
    }

    return {
      exitCode: 1,
      stdout: humanDiagnostics(diagnostics),
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
