import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  evaluateEvidenceWorkspace,
  loadEvidence,
} from './evidence.js'
import { loadProjection } from './projection.js'

export function runCheckCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const json = options.includes('--json')
  const paths = options.filter((option) => option !== '--json')
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

    if (json) {
      return {
        exitCode: ok ? 0 : 1,
        stdout: checkResultJson(ok, ok ? [] : diagnostics),
        stderr: '',
      }
    }

    if (ok && result.ok) {
      const documentCount = result.graph.documents.length
      const profileCount = coreSources.length - documentCount
      const mappingCount = mappingSources.length
      const projectionCount = resolved.projections.length
      const evidenceCount = resolved.evidence.length
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
      ].join(' and ')
      return {
        exitCode: 0,
        stdout: `Checked ${checked}: no errors\n`,
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
