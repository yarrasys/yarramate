import Ajv2020Module from 'ajv/dist/2020.js'
import type {
  Diagnostic,
  SemanticGraph,
  WorkspaceSource,
} from './compiler.js'
import {
  diagnosticOrder,
  loadSourceDocument,
  locateSourcePath,
  type SourceLocation,
} from './source-document.js'
import evidenceSchema from '../schema/yarramate-evidence.schema.json' with {
  type: 'json',
}

const Ajv2020 = Ajv2020Module.default
const validateEvidenceSchema = new Ajv2020({ allErrors: true }).compile(
  evidenceSchema,
)

export type EvidenceResult =
  | 'confirmed'
  | 'contradicted'
  | 'unknown'
  | 'not-observed'

export interface EvidenceLocator {
  readonly uri: string
  readonly message?: string
}

export type EvidenceObservation =
  | {
      readonly subject: string
      readonly result: EvidenceResult
      readonly evidence: EvidenceLocator
    }
  | {
      readonly claim: string
      readonly result: EvidenceResult
      readonly evidence: EvidenceLocator
    }

export interface EvidenceDocument {
  readonly format: 'yarramate/evidence/v1'
  readonly id: string
  readonly version: string
  readonly provider: string
  readonly observations: readonly EvidenceObservation[]
}

export interface EvidenceReport {
  readonly format: 'yarramate/evidence-report/v1'
  readonly evidence: string
  readonly provider: string
  readonly summary: {
    readonly confirmed: number
    readonly contradicted: number
    readonly unknown: number
    readonly notObserved: number
  }
  readonly observations: readonly EvidenceObservation[]
}

export type EvidenceLoadResult =
  | { readonly ok: true; readonly evidence: EvidenceDocument }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export type EvidenceEvaluationResult =
  | { readonly ok: true; readonly report: EvidenceReport }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export type EvidenceWorkspaceEvaluationResult =
  | { readonly ok: true; readonly reports: readonly EvidenceReport[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

type EvidenceLocation = SourceLocation

interface EvidenceLocations {
  readonly id: EvidenceLocation
  readonly observations: readonly EvidenceLocation[]
}

const evidenceLocations = new WeakMap<EvidenceDocument, EvidenceLocations>()

const observationTarget = (observation: EvidenceObservation) =>
  'subject' in observation ? observation.subject : observation.claim

export function loadEvidence(source: WorkspaceSource): EvidenceLoadResult {
  const loaded = loadSourceDocument<EvidenceDocument>(
    source,
    validateEvidenceSchema,
    'Evidence',
  )
  if (!loaded.ok) return loaded
  const { value, yaml, lineCounter } = loaded.document

  const orderedObservations = value.observations
    .map((observation, authoredIndex) => ({
      authoredIndex,
      observation: {
        ...('subject' in observation
          ? { subject: observation.subject }
          : { claim: observation.claim }),
        result: observation.result,
        evidence: {
          uri: observation.evidence.uri,
          ...(observation.evidence.message === undefined
            ? {}
            : { message: observation.evidence.message }),
        },
      } as EvidenceObservation,
    }))
    .sort((left, right) =>
      observationTarget(left.observation).localeCompare(
        observationTarget(right.observation),
      ),
    )
  const evidence: EvidenceDocument = {
    format: value.format,
    id: value.id,
    version: value.version,
    provider: value.provider,
    observations: orderedObservations.map(({ observation }) => observation),
  }
  evidenceLocations.set(
    evidence,
    {
      id: locateSourcePath(
        source.path,
        yaml,
        lineCounter,
        ['id'],
        '/id',
      ),
      observations: orderedObservations.map(
        ({ observation, authoredIndex }) => {
          const field = 'subject' in observation ? 'subject' : 'claim'
          return locateSourcePath(
            source.path,
            yaml,
            lineCounter,
            ['observations', authoredIndex, field],
            `/observations/${authoredIndex}/${field}`,
          )
        },
      ),
    },
  )
  return { ok: true, evidence }
}

export function evaluateEvidence(
  graph: SemanticGraph,
  evidence: EvidenceDocument,
): EvidenceEvaluationResult {
  const subjectIds = new Set(graph.subjects.map(({ id }) => id))
  const claimIds = new Set(graph.claims.map(({ id }) => id))
  const locations = evidenceLocations.get(evidence)?.observations ?? []
  const diagnostics: Diagnostic[] = []
  const seenTargets = new Set<string>()
  for (const [index, observation] of evidence.observations.entries()) {
    const location = locations[index] ?? {
      path: `${evidence.id}.evidence.yaml`,
      pointer: `/observations/${index}/${'subject' in observation ? 'subject' : 'claim'}`,
      line: 1,
      column: 1,
    }
    if (
      'subject' in observation &&
      !subjectIds.has(observation.subject)
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'YM801',
        message: `Evidence subject "${observation.subject}" does not exist`,
        ...location,
      })
    }
    if ('claim' in observation && !claimIds.has(observation.claim)) {
      diagnostics.push({
        severity: 'error',
        code: 'YM802',
        message: `Evidence claim "${observation.claim}" does not exist`,
        ...location,
      })
    }
    const target = observationTarget(observation)
    const targetKey = `${'subject' in observation ? 'subject' : 'claim'}:${target}`
    if (seenTargets.has(targetKey)) {
      diagnostics.push({
        severity: 'error',
        code: 'YM803',
        message: `Evidence target "${target}" is evaluated more than once`,
        ...location,
      })
    }
    seenTargets.add(targetKey)
  }
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.sort(diagnosticOrder),
    }
  }

  const summary = {
    confirmed: 0,
    contradicted: 0,
    unknown: 0,
    notObserved: 0,
  }
  for (const observation of evidence.observations) {
    if (observation.result === 'not-observed') {
      summary.notObserved += 1
    } else {
      summary[observation.result] += 1
    }
  }
  return {
    ok: true,
    report: {
      format: 'yarramate/evidence-report/v1',
      evidence: `${evidence.id}@${evidence.version}`,
      provider: evidence.provider,
      summary,
      observations: evidence.observations,
    },
  }
}

export function evaluateEvidenceWorkspace(
  graph: SemanticGraph,
  evidenceDocuments: readonly EvidenceDocument[],
): EvidenceWorkspaceEvaluationResult {
  const ordered = [...evidenceDocuments].sort((left, right) => {
    const identityOrder = `${left.id}@${left.version}`.localeCompare(
      `${right.id}@${right.version}`,
    )
    if (identityOrder !== 0) return identityOrder
    const leftPath = evidenceLocations.get(left)?.id.path ?? ''
    const rightPath = evidenceLocations.get(right)?.id.path ?? ''
    return leftPath.localeCompare(rightPath)
  })
  const diagnostics: Diagnostic[] = []
  const reports: EvidenceReport[] = []
  const seenIdentities = new Set<string>()

  for (const evidence of ordered) {
    const identity = `${evidence.id}@${evidence.version}`
    if (seenIdentities.has(identity)) {
      const location = evidenceLocations.get(evidence)?.id ?? {
        path: `${evidence.id}.evidence.yaml`,
        pointer: '/id',
        line: 1,
        column: 1,
      }
      diagnostics.push({
        severity: 'error',
        code: 'YM804',
        message: `Evidence document "${identity}" is declared more than once`,
        ...location,
      })
    }
    seenIdentities.add(identity)
    const evaluation = evaluateEvidence(graph, evidence)
    if (evaluation.ok) {
      reports.push(evaluation.report)
    } else {
      diagnostics.push(...evaluation.diagnostics)
    }
  }

  return diagnostics.length === 0
    ? { ok: true, reports }
    : { ok: false, diagnostics: diagnostics.sort(diagnosticOrder) }
}
