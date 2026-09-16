import { parseDocument } from 'yaml'
import {
  loadAdapterMapping,
  validateAdapterMappings,
} from '../adapter-mapping.js'
import {
  compileWorkspaceWithProfileContext,
  withDiagnosticSubjects,
  type Diagnostic,
  type WorkspaceSource,
} from '../compiler.js'
import { checkCoreContract, loadCoreContract } from '../core-contract.js'
import { evaluateEvidenceWorkspace, loadEvidence } from '../evidence.js'
import { composeCatalogues } from '../interrogate-command.js'
import {
  loadProjection,
  projectionReferenceDiagnostics,
} from '../projection.js'
import {
  reconcileEvidenceReports,
  type EvidenceFinding,
} from '../reconciliation.js'
import {
  MissingSourceError,
  SHIPPED_CATALOGUE,
  type ToolWorkspace,
} from './workspace.js'

/**
 * `yarramate check`, as one function over injected reads (ADR 0156). The
 * CLI hands it the filesystem and its resolved source set; `checkWorkspace`
 * hands it a store and a resolved manifest. The verdict, the diagnostics
 * and the counts are computed once, here, so the two cannot disagree.
 */

/** The published `yarramate/check-result/v1` document. */
export interface CheckResult {
  readonly format: 'yarramate/check-result/v1'
  readonly ok: boolean
  readonly diagnostics: readonly Diagnostic[]
  readonly counted?: CheckCounts
  readonly strict?: {
    readonly observations: number
    readonly contradicted: number
  }
}

export interface CheckCounts {
  readonly documents: number
  readonly concepts: number
  readonly relationships: number
  readonly states: number
}

export interface CheckInput {
  /** The bytes at a path; throws when there is nothing there. */
  readonly read: (path: string) => string
  /** Whether a path exists, for the files a Core contract names optionally. */
  readonly exists: (path: string) => boolean
  /** The compiler's sources plus adapter mappings, in workspace order. */
  readonly paths: readonly string[]
  readonly projections: readonly string[]
  readonly evidence: readonly string[]
  readonly contracts: readonly string[]
  readonly patterns: readonly string[]
  readonly questions: readonly string[]
  /** The base catalogue the workspace's own catalogues compose onto. */
  readonly catalogueBase: WorkspaceSource
  /** Contradicted evidence fails the check (YM901), as `--strict`. */
  readonly strict?: boolean
  /**
   * Whether a JSON Schema a Core contract names compiles. The CLI answers
   * with Ajv; a runtime without a schema compiler answers true for every
   * schema that parses, so a contract check there tests presence and
   * format, not validity.
   */
  readonly schemaCompiles?: (schema: object) => boolean
}

/** The result, plus what the CLI's human rendering needs beside it. */
export interface CheckEvaluation {
  readonly result: CheckResult
  /**
   * The diagnostics a human reader sees when `ok` is false: the strict
   * findings when only strict failed, the base diagnostics otherwise.
   */
  readonly shown: readonly Diagnostic[]
  /** The base check passed and only `--strict` failed. */
  readonly strictOnly: boolean
  /** Category counts for the "Checked ..." line; absent when the check failed. */
  readonly checked?: {
    readonly documents: number
    readonly profiles: number
    readonly patterns: number
    readonly mappings: number
    readonly projections: number
    readonly evidence: number
    readonly contracts: number
  }
}

const sortDiagnostics = <T extends Diagnostic>(diagnostics: readonly T[]) =>
  [...diagnostics].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  )

const strictFindingMessage = (finding: EvidenceFinding): string => {
  const observed =
    finding.evidence.message === undefined
      ? finding.evidence.uri
      : `${finding.evidence.uri}: ${finding.evidence.message}`
  // A contradicted expectation is gated exactly like any other contradicted
  // finding (ADR 0075); only the wording differs, because both sides of the
  // disagreement are known values worth naming.
  if (finding.expectation !== undefined) {
    const { key, expected, observed: observedValue } = finding.expectation
    return (
      `Evidence contradicts expectation "${finding.target.id}": the model expects ` +
      `${key} to be "${expected}", but provider "${finding.provider}" observed ` +
      `"${observedValue}" (${observed}); align the model or the evidence to pass --strict`
    )
  }
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

const refusedAt = (diagnostics: readonly Diagnostic[]): CheckEvaluation => ({
  result: {
    format: 'yarramate/check-result/v1',
    ok: false,
    diagnostics,
  },
  shown: diagnostics,
  strictOnly: false,
})

export const checkSources = (input: CheckInput): CheckEvaluation => {
  const { read, exists } = input
  const schemaCompiles = input.schemaCompiles ?? (() => true)

  const contractDiagnostics = sortDiagnostics(
    input.contracts.flatMap((path) => {
      const source = { path, source: read(path) }
      const loaded = loadCoreContract(source)
      if (!loaded.ok) return loaded.diagnostics
      let packageManifest: unknown
      try {
        packageManifest = JSON.parse(read(loaded.contract.packageManifest))
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
        typeof packageRecord?.bin === 'object' && packageRecord.bin !== null
          ? Object.keys(packageRecord.bin)
          : typeof packageRecord?.bin === 'string' &&
              typeof packageRecord.name === 'string'
            ? [packageRecord.name]
            : []
      const schemas: Record<
        string,
        | { readonly ok: false }
        | {
            readonly ok: true
            readonly format?: string
            readonly validSchema: boolean
          }
      > = {}
      for (const { schema } of loaded.contract.formats) {
        if (!exists(schema)) continue
        try {
          const value = JSON.parse(read(schema)) as unknown
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
            validSchema = schemaCompiles(value as object)
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
        ].filter((file) => exists(file)),
        packageManifestValid: packageRecord !== undefined,
        packageExports: exportsRecord,
        packageBinaries: binaries,
        schemas,
      })
      return checked.ok ? [] : checked.diagnostics
    }),
  )
  if (contractDiagnostics.length > 0) return refusedAt(contractDiagnostics)

  const projectionSources = input.projections.map((path) => ({
    path,
    source: read(path),
  }))
  const loadedProjections = projectionSources.map((source) => ({
    source,
    loaded: loadProjection(source),
  }))
  const projectionDiagnostics = sortDiagnostics(
    loadedProjections.flatMap(({ loaded }) =>
      loaded.ok ? [] : loaded.diagnostics,
    ),
  )
  if (projectionDiagnostics.length > 0) return refusedAt(projectionDiagnostics)

  const loadedEvidence = input.evidence.map((path) =>
    loadEvidence({ path, source: read(path) }),
  )
  const evidenceLoadDiagnostics = sortDiagnostics(
    loadedEvidence.flatMap((loaded) => (loaded.ok ? [] : loaded.diagnostics)),
  )
  if (evidenceLoadDiagnostics.length > 0) {
    return refusedAt(evidenceLoadDiagnostics)
  }

  const sources = input.paths.map((path) => ({ path, source: read(path) }))
  const mappingSources = sources.filter(
    ({ source }) =>
      parseDocument(source).get('format') === 'yarramate/adapter-mapping/v1',
  )
  const coreSources = sources.filter(
    (source) => !mappingSources.includes(source),
  )
  const loadedMappings = mappingSources.map((source) =>
    loadAdapterMapping(source),
  )
  const mappingLoadDiagnostics = sortDiagnostics(
    loadedMappings.flatMap((loaded) => (loaded.ok ? [] : loaded.diagnostics)),
  )
  if (mappingLoadDiagnostics.length > 0) return refusedAt(mappingLoadDiagnostics)

  const result = compileWorkspaceWithProfileContext(coreSources)
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
  // A catalogue the manifest declares is workspace content, so `check`
  // refuses a broken one (#345, ADR 0129). Composed rather than checked one
  // by one, because the refusals that matter are CROSS-catalogue: a wave
  // declared twice, and a question naming a wave nothing in the set
  // declares. Checking each file alone would miss both and would refuse the
  // one thing the feature exists to allow, a question joining a wave another
  // catalogue declared.
  const catalogueDiagnostics =
    result.ok && input.questions.length > 0
      ? (() => {
          const composed = composeCatalogues(
            [
              input.catalogueBase,
              ...input.questions.map((path) => ({ path, source: read(path) })),
            ],
            result.profileContext,
          )
          return composed.ok ? [] : composed.diagnostics
        })()
      : []

  // A projection is a document, and a query holds references the same way a
  // relationship does. Checked HERE rather than with the projection's own
  // schema load above, because a reference can only be resolved against a
  // model that compiled: reporting dangling names out of a workspace that
  // does not build would bury the real failure under its consequences.
  const referenceDiagnostics = result.ok
    ? loadedProjections.flatMap(({ source, loaded }) =>
        loaded.ok
          ? projectionReferenceDiagnostics(
              source,
              loaded.projection,
              result.graph,
              result.profileContext,
              // Instance-hood from BOTH lists. A membership row exists only
              // for a BOUND slot, so an instance whose slots are all empty
              // has none - and judging it by bindings alone would call a real
              // instance "not an instance" on the day it was authored, before
              // anything was wired into it. The honest question is not "did
              // it bind anything" but "does the model know it as an
              // instance" (rule 2).
              new Set([
                ...(result.patternMemberships ?? []).map(
                  ({ instance }) => instance,
                ),
                ...(result.patternVacancies ?? []).map(
                  ({ instance }) => instance,
                ),
              ]),
            )
          : [],
      )
    : []
  const optionalDiagnostics = sortDiagnostics([
    ...mappingDiagnostics,
    ...evidenceDiagnostics,
    ...referenceDiagnostics,
    ...catalogueDiagnostics,
  ])
  const ok = result.ok && optionalDiagnostics.length === 0
  // Published results name the subject a diagnostic is about wherever its
  // pointer identifies one, so a consumer that draws the model can put the
  // refusal on the element rather than on a byte offset. Derived here, at
  // the boundary that publishes the document, so the compiler's own
  // diagnostics stay a pure function of the model.
  const diagnostics = withDiagnosticSubjects(
    result.ok ? optionalDiagnostics : result.diagnostics,
    sources,
  )

  // Strict only tightens a passing check: base diagnostics already fail
  // the gate, so contradictions are folded in only once everything else
  // holds, and each one is anchored at the claim the model declares.
  const strictEvaluation =
    input.strict === true && result.ok && ok
      ? (() => {
          const reports =
            evidenceEvaluation !== undefined && evidenceEvaluation.ok
              ? evidenceEvaluation.reports
              : []
          const graph = result.graph
          // Stale attestations never reach this gate: staleness is a
          // freshness signal, not a contradiction (ADR 0074), and the
          // gate derives no attestation staleness in the first place.
          const contradicted = reconcileEvidenceReports(
            'strict',
            reports,
            graph,
          ).findings.filter(
            (finding): finding is EvidenceFinding =>
              finding.result === 'contradicted',
          )
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
  const strictOk =
    strictEvaluation === undefined
      ? true
      : strictEvaluation.diagnostics.length === 0
  const finalOk = ok && strictOk

  const counted = result.ok
    ? (() => {
        const states = new Set(
          result.graph.claims
            .filter(({ predicate }) => predicate === 'yarramate/state/type')
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

  const shown = finalOk ? [] : ok ? strictEvaluation!.diagnostics : diagnostics
  return {
    result: {
      format: 'yarramate/check-result/v1',
      ok: finalOk,
      diagnostics: shown,
      ...(finalOk && counted !== undefined ? { counted } : {}),
      ...(strictSummary === undefined ? {} : { strict: strictSummary }),
    },
    shown,
    strictOnly: ok && !strictOk,
    ...(ok && result.ok
      ? {
          checked: {
            documents: result.graph.documents.length,
            // Everything in `coreSources` that is not a document was a profile
            // until patterns joined the source list (#268), and counting them
            // as profiles said "2 profiles" about a workspace with one.
            profiles:
              coreSources.length -
              result.graph.documents.length -
              input.patterns.length,
            patterns: input.patterns.length,
            mappings: mappingSources.length,
            projections: input.projections.length,
            evidence: input.evidence.length,
            contracts: input.contracts.length,
          },
        }
      : {}),
  }
}

export interface CheckOptions {
  /** Contradicted evidence fails the check (YM901), as `--strict`. */
  readonly strict?: boolean
}

/**
 * `yarramate check <workspace.yaml> [--strict] --json`, path-free. Never a
 * ToolResult: `ok: false` with diagnostics IS the answer. A path the
 * workspace names but the store does not hold is reported as a refusal
 * diagnostic on the manifest rather than thrown, because a check that
 * throws has no verdict.
 */
export const checkWorkspace = (
  workspace: ToolWorkspace,
  options: CheckOptions = {},
): CheckResult => {
  const read = (path: string): string => {
    const held = workspace.store.read(path)
    if (held === undefined) throw new MissingSourceError(path)
    return held.source
  }
  const resolved = workspace.workspace
  try {
    return checkSources({
      read,
      exists: (path) => workspace.store.read(path) !== undefined,
      paths: [
        ...resolved.profiles,
        ...resolved.patterns,
        ...resolved.documents,
        ...resolved.adapterMappings,
      ],
      projections: resolved.projections,
      evidence: resolved.evidence,
      contracts: resolved.contracts,
      patterns: resolved.patterns,
      questions: resolved.questions ?? [],
      catalogueBase: workspace.catalogue ?? SHIPPED_CATALOGUE,
      ...(options.strict === undefined ? {} : { strict: options.strict }),
    }).result
  } catch (error) {
    if (!(error instanceof MissingSourceError)) throw error
    return {
      format: 'yarramate/check-result/v1',
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'YM702',
          message: error.message,
          path: error.path,
          pointer: '/',
          line: 1,
          column: 1,
        },
      ],
    }
  }
}
