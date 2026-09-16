import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020Module from 'ajv/dist/2020.js'
import { shippedCatalogueSource } from './catalogue-sources.js'
import {
  humanDiagnostics,
  resolveCliWorkspaceSources,
  usage,
  type CliResult,
} from './cli-support.js'
import { checkSources } from './tools/check.js'

// The check itself is `checkSources` in `tools/check.ts` (ADR 0156): this
// command resolves the sources against the filesystem, lends the core Ajv
// for the schemas a Core contract names, and renders the two outputs.

// `.default ?? module`, not a bare `.default`: NodeNext sees the raw CJS
// `module.exports` and a bundler the unwrapped class. One shape for all of
// them, so which modules a browser happens to reach is not a thing anyone has
// to keep track of (#252).
const ajv2020Module = Ajv2020Module as unknown as {
  default?: typeof Ajv2020Module
} & typeof Ajv2020Module
const Ajv2020 = ajv2020Module.default ?? ajv2020Module

const schemaCompiles = (schema: object): boolean => {
  try {
    new Ajv2020({ strict: false }).compile(schema)
    return true
  } catch {
    return false
  }
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
        ? `${JSON.stringify(
            {
              format: 'yarramate/check-result/v1',
              ok: false,
              diagnostics: resolved.diagnostics,
            },
            null,
            2,
          )}\n`
        : humanDiagnostics(resolved.diagnostics)
      return { exitCode: 1, stdout: output, stderr: '' }
    }
    const evaluation = checkSources({
      read: (path) => readFileSync(resolve(cwd, path), 'utf8'),
      exists: (path) => existsSync(resolve(cwd, path)),
      paths: resolved.paths,
      projections: resolved.projections,
      evidence: resolved.evidence,
      contracts: resolved.contracts,
      patterns: resolved.patterns,
      questions: resolved.questions,
      catalogueBase: shippedCatalogueSource(),
      strict,
      schemaCompiles,
    })
    const { result } = evaluation

    if (json) {
      return {
        exitCode: result.ok ? 0 : 1,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: '',
      }
    }

    if (!result.ok || evaluation.checked === undefined) {
      return {
        exitCode: 1,
        stdout: humanDiagnostics(evaluation.shown),
        stderr: '',
      }
    }

    const counts = result.counted!
    const {
      documents: documentCount,
      profiles: profileCount,
      patterns: patternCount,
      mappings: mappingCount,
      projections: projectionCount,
      evidence: evidenceCount,
      contracts: contractCount,
    } = evaluation.checked
    const checked = [
      `${documentCount} ${documentCount === 1 ? 'document' : 'documents'}`,
      ...(profileCount > 0
        ? [`${profileCount} ${profileCount === 1 ? 'profile' : 'profiles'}`]
        : []),
      ...(patternCount > 0
        ? [`${patternCount} ${patternCount === 1 ? 'pattern' : 'patterns'}`]
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
      result.strict === undefined
        ? ''
        : result.strict.observations === 0
          ? 'Strict: no evidence observations to evaluate\n'
          : `Strict: ${result.strict.observations} ${result.strict.observations === 1 ? 'observation' : 'observations'}, 0 contradicted\n`
    return {
      exitCode: 0,
      stdout:
        `Checked ${checked} (` +
        `${counts.concepts} ${counts.concepts === 1 ? 'concept' : 'concepts'}, ` +
        `${counts.relationships} ${counts.relationships === 1 ? 'relationship' : 'relationships'}, ` +
        `${counts.states} ${counts.states === 1 ? 'state' : 'states'}` +
        '): no errors\n' +
        strictLine,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
